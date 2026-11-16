/**
 * "Usuarios y roles": roles asignados por un admin desde la app y roles editables.
 *
 * Precedencia al iniciar sesión y en cada solicitud (ver identity.ts → findAllowedUser):
 * 1. Archivo de allowlist (SAC_FLOW_AUTH_ALLOWED_USERS_FILE) — bloqueado en la app.
 * 2. SAC_FLOW_AUTH_ADMIN_EMAILS — siempre admin, bloqueado en la app (evita quedar sin admins).
 * 3. Rol asignado desde la app (de base, propio o "none" = sin acceso).
 * 4. SAC_FLOW_AUTH_SUPERVISOR_EMAILS, SAC_FLOW_AUTH_ALLOWED_EMAILS y dominios permitidos.
 *
 * Los permisos de cada rol salen de permissions.ts más los ajustes guardados en access_roles.
 */
import type { SacFlowRepository } from "./repository-contract.js";
import {
  normalizeEmail,
  readAllowlistRecords,
  serverAccessRule,
  type AccessDirectory,
  type IdentityConfig,
  type ServerAccessSource,
} from "./identity.js";
import {
  ADMIN_ONLY_CAPABILITIES,
  applyPermissionOverrides,
  DEFAULT_ROLE_PERMISSIONS,
  MASTER_ONLY_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  resolveRoleCatalog,
  type BaseRole,
  type Permission,
  type PermissionDefinition,
  type RoleDefinition,
} from "./permissions.js";
import type { AccessRole, ActorRole, UserAccessRecord } from "./types.js";

const ACCESS_DIRECTORY_CACHE_MS = 15_000;

export interface CachedAccessDirectory extends AccessDirectory {
  /** Catálogo de roles vigente (Admin, de base con ajustes y propios). */
  roles(): Promise<RoleDefinition[]>;
  /** Descarta la caché tras un cambio de rol para que surta efecto en la siguiente solicitud. */
  invalidate(): void;
}

/**
 * La identidad consulta el rol asignado y sus permisos en cada solicitud. Para no leer la
 * base cada vez, usuarios y roles se guardan unos segundos y se descartan al cambiar algo.
 */
export function createAccessDirectory(repository: SacFlowRepository): CachedAccessDirectory {
  type Snapshot = { users: Map<string, UserAccessRecord>; roles: RoleDefinition[] };
  let cache: { at: number; snapshot: Promise<Snapshot> } | undefined;
  const current = () => {
    const now = Date.now();
    if (!cache || now - cache.at >= ACCESS_DIRECTORY_CACHE_MS) {
      const snapshot = Promise.all([repository.listUserAccess(), repository.listAccessRoles()])
        .then(([users, roles]) => ({
          users: new Map(users.map((user) => [user.email, user])),
          roles: resolveRoleCatalog(roles),
        }));
      const entry = { at: now, snapshot };
      cache = entry;
      snapshot.catch(() => {
        if (cache === entry) cache = undefined;
      });
    }
    return cache.snapshot;
  };
  return {
    async find(email) {
      return (await current()).users.get(normalizeEmail(email));
    },
    async customRoleBase(roleId) {
      const role = (await current()).roles.find((item) => item.id === roleId && !item.builtIn);
      return role?.baseRole;
    },
    async roles() {
      return (await current()).roles;
    },
    invalidate() {
      cache = undefined;
    },
  };
}

export interface UserAccessView {
  email: string;
  name: string | null;
  /** Rol con el que entra hoy (id); "none" = sin acceso. */
  effectiveRole: AccessRole;
  /** Rol asignado desde la app, si existe. */
  assignedRole?: AccessRole;
  assignedBy?: string;
  assignedAt?: string;
  /** Regla del servidor que aplica si no hay rol asignado. */
  serverRole: ActorRole | null;
  serverSource: ServerAccessSource | null;
  /** No se puede cambiar desde la app (archivo o lista de admins del entorno). */
  locked: boolean;
  lastSignInAt?: string;
  isSelf: boolean;
  /** Permisos del rol efectivo, antes de los ajustes personales. */
  rolePermissions: Permission[];
  /** Permisos efectivos: los del rol más los ajustes personales. */
  permissions: Permission[];
  permissionsAdd: Permission[];
  permissionsRemove: Permission[];
  permissionsUpdatedBy?: string;
  permissionsUpdatedAt?: string;
}

/** Permisos que trae un rol (por id) según el catálogo; "none" o desconocido = ninguno. */
export function rolePermissionsFor(catalog: RoleDefinition[], roleId: AccessRole): Permission[] {
  if (roleId === "admin") return [...PERMISSION_KEYS];
  return catalog.find((role) => role.id === roleId)?.permissions ?? [];
}

export interface UserAccessPolicy {
  authEnabled: boolean;
  allowedDomains: string[];
  defaultRole: ActorRole;
}

export interface RoleView extends RoleDefinition {
  userCount: number;
  defaultPermissions?: string[];
}

export interface AccessControlListing {
  users: UserAccessView[];
  roles: RoleView[];
  permissions: PermissionDefinition[];
  adminOnly: string[];
  /** Permisos que solo un admin principal puede otorgar. */
  masterOnlyPermissions: Permission[];
  /** Quién mira: un admin principal (SAC_FLOW_AUTH_ADMIN_EMAILS) o uno asignado desde la app. */
  viewer: { masterAdmin: boolean };
  policy: UserAccessPolicy;
}

/** Admin principal: su correo está en SAC_FLOW_AUTH_ADMIN_EMAILS. Los demás admin son asignados. */
export function isMasterAdmin(config: IdentityConfig, email: string | undefined): boolean {
  // Sin inicio de sesión propio (gateway con cabeceras o modo local) no hay correos que
  // distinguir: el admin que llega es el principal.
  if (!config.enabled) return true;
  return Boolean(email) && (config.adminEmails ?? []).includes(normalizeEmail(email!));
}

/** Permisos que tendría una persona con otro rol, conservando sus ajustes personales. */
export function permissionsWithRole(
  catalog: RoleDefinition[],
  roleId: AccessRole,
  overrides: { permissionsAdd?: Permission[]; permissionsRemove?: Permission[] },
): Permission[] {
  if (roleId === "none") return [];
  const base = rolePermissionsFor(catalog, roleId);
  if (roleId === "admin") return base;
  return applyPermissionOverrides(base, { permissionsAdd: overrides.permissionsAdd ?? [], permissionsRemove: overrides.permissionsRemove ?? [] });
}

/** Permisos solo de admin principal que el cambio agregaría a quien no los tenía. */
export function newlyGrantedMasterOnly(before: readonly Permission[], after: readonly Permission[]): Permission[] {
  return MASTER_ONLY_PERMISSIONS.filter((permission) => after.includes(permission) && !before.includes(permission));
}

/**
 * Une las personas conocidas por el servidor (listas del entorno y archivo) con las que
 * tienen rol asignado o ya ingresaron, calcula el rol efectivo de cada una y adjunta el
 * catálogo de roles y permisos.
 */
export async function listAccessControl(
  config: IdentityConfig,
  repository: SacFlowRepository,
  currentEmail: string | undefined,
): Promise<AccessControlListing> {
  const [records, fileRecords, storedRoles] = await Promise.all([
    repository.listUserAccess(),
    readAllowlistRecords(config),
    repository.listAccessRoles(),
  ]);
  const catalog = resolveRoleCatalog(storedRoles);
  const roleIds = new Set(catalog.map((role) => role.id));
  const byEmail = new Map(records.map((record) => [record.email, record]));
  const emails = new Set<string>([
    ...fileRecords.map((record) => record.email),
    ...(config.adminEmails ?? []),
    ...(config.supervisorEmails ?? []),
    ...(config.allowedEmails ?? []),
    ...records.map((record) => record.email),
  ]);
  const fileNames = new Map(fileRecords.map((record) => [record.email, record.name]));
  const self = currentEmail ? normalizeEmail(currentEmail) : undefined;

  const users = [...emails].map((email): UserAccessView => {
    const stored = byEmail.get(email);
    const rule = serverAccessRule(config, email, fileRecords);
    const locked = rule?.locked ?? false;
    // Un rol propio borrado deja de contar como asignación.
    const storedRole = stored?.role && (stored.role === "none" || roleIds.has(stored.role)) ? stored.role : undefined;
    const assignedRole = locked ? undefined : storedRole;
    const effectiveRole: AccessRole = assignedRole ?? rule?.role ?? "none";
    const rolePermissions = rolePermissionsFor(catalog, effectiveRole);
    // Admin tiene todo y "sin acceso" nada: los ajustes personales no aplican a ninguno.
    const overridable = effectiveRole !== "admin" && effectiveRole !== "none" && !locked;
    const permissionsAdd = overridable ? stored?.permissionsAdd ?? [] : [];
    const permissionsRemove = overridable ? stored?.permissionsRemove ?? [] : [];
    return {
      rolePermissions,
      permissions: applyPermissionOverrides(rolePermissions, { permissionsAdd, permissionsRemove }),
      permissionsAdd,
      permissionsRemove,
      ...(overridable && stored?.permissionsUpdatedBy ? { permissionsUpdatedBy: stored.permissionsUpdatedBy } : {}),
      ...(overridable && stored?.permissionsUpdatedAt ? { permissionsUpdatedAt: stored.permissionsUpdatedAt } : {}),
      email,
      name: stored?.name ?? fileNames.get(email) ?? null,
      effectiveRole,
      ...(assignedRole ? { assignedRole, assignedBy: stored?.assignedBy, assignedAt: stored?.assignedAt } : {}),
      serverRole: rule?.role ?? null,
      serverSource: rule?.source ?? null,
      locked,
      ...(stored?.lastSignInAt ? { lastSignInAt: stored.lastSignInAt } : {}),
      isSelf: email === self,
    };
  });

  const order = new Map(catalog.map((role, index) => [role.id, index]));
  const rank = (role: AccessRole) => (role === "none" ? catalog.length : order.get(role) ?? catalog.length - 0.5);
  users.sort((left, right) => rank(left.effectiveRole) - rank(right.effectiveRole) || left.email.localeCompare(right.email));

  const counts = new Map<string, number>();
  for (const user of users) counts.set(user.effectiveRole, (counts.get(user.effectiveRole) ?? 0) + 1);
  const roles = catalog.map((role): RoleView => ({
    ...role,
    userCount: counts.get(role.id) ?? 0,
    ...(role.builtIn && role.id !== "admin" ? { defaultPermissions: DEFAULT_ROLE_PERMISSIONS[role.id as BaseRole] } : {}),
  }));

  return {
    users,
    roles,
    permissions: PERMISSION_CATALOG,
    adminOnly: ADMIN_ONLY_CAPABILITIES,
    masterOnlyPermissions: MASTER_ONLY_PERMISSIONS,
    viewer: { masterAdmin: isMasterAdmin(config, currentEmail) },
    policy: {
      authEnabled: config.enabled,
      allowedDomains: config.allowedDomains,
      defaultRole: config.defaultRole,
    },
  };
}

/** Motivo por el que un correo no admite cambios desde la app, o undefined si los admite. */
export async function lockedReason(config: IdentityConfig, email: string, currentEmail: string | undefined): Promise<string | undefined> {
  const normalized = normalizeEmail(email);
  if (currentEmail && normalizeEmail(currentEmail) === normalized) {
    return "No puedes cambiar tu propio rol. Pide a otro admin que lo haga.";
  }
  const rule = serverAccessRule(config, normalized, await readAllowlistRecords(config));
  if (rule?.source === "server_admin") {
    return "Este correo es admin por configuración del servidor (SAC_FLOW_AUTH_ADMIN_EMAILS); se cambia en el .env del servidor.";
  }
  if (rule?.source === "allowlist_file" && rule.locked) {
    return "Este correo está definido en el archivo de usuarios del servidor; se cambia en ese archivo.";
  }
  return undefined;
}

/** Id estable para un rol propio a partir de su nombre. */
export function customRoleId(name: string, taken: Set<string>): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "rol";
  let id = `rol-${slug}`;
  let suffix = 2;
  while (taken.has(id)) id = `rol-${slug}-${suffix++}`;
  return id;
}
