/**
 * Identidad de sac.wiwo: allowlist local, roles y cookie de sesión firmada.
 *
 * Dos proveedores comparten este contrato:
 * - "google": inicio de sesión con Google (OAuth 2.0 / OpenID Connect) — ver google-auth.ts.
 * - "dev": prueba local con correo y contraseña de usuarios ficticios — ver dev-auth.ts.
 *
 * La autorización sale EXCLUSIVAMENTE del backend: archivo JSON local, listas del entorno,
 * roles asignados por un admin desde "Usuarios y roles" y, opcionalmente, dominios de correo
 * permitidos. Un correo verificado que no esté autorizado no entra.
 */
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ActorContext, ActorRole, UserAccessRecord } from "./types.js";
import { ACTOR_ROLES } from "./types.js";

export type IdentityProvider = "google" | "dev";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Roles asignados desde la app; se consulta en cada inicio de sesión y solicitud. */
export interface AccessDirectory {
  find(email: string): Promise<UserAccessRecord | undefined>;
  /** Rol de base de un rol propio, o undefined si no existe. */
  customRoleBase?(roleId: string): Promise<Exclude<ActorRole, "admin"> | undefined>;
}

export interface IdentityConfig {
  enabled: boolean;
  provider?: IdentityProvider;
  cookieName: string;
  sessionTtlMs: number;
  /** Secreto HMAC de la cookie de sesión. Sin él se usa uno aleatorio por proceso. */
  sessionSecret?: string;
  /** Allowlist local `{ "users": [...] }` (proveedor google). */
  allowedUsersFile?: string;
  /** Correos con rol admin definidos en el entorno del servidor (SAC_FLOW_AUTH_ADMIN_EMAILS). */
  adminEmails?: string[];
  /** Correos con rol supervisor definidos en el entorno del servidor (SAC_FLOW_AUTH_SUPERVISOR_EMAILS). */
  supervisorEmails?: string[];
  /** Correos con `defaultRole` definidos en el entorno del servidor (SAC_FLOW_AUTH_ALLOWED_EMAILS). */
  allowedEmails?: string[];
  /** Dominios cuyo correo verificado entra con `defaultRole` aunque no esté en el archivo. */
  allowedDomains: string[];
  /** Roles asignados por un admin desde la app (tabla `user_access`). */
  accessDirectory?: AccessDirectory;
  /** Usuarios ficticios con contraseña (proveedor dev). */
  devUsersFile?: string;
  google?: GoogleOAuthConfig;
  /** Ruta del frontend a la que se vuelve después del inicio de sesión. */
  postLoginRedirect: string;
  /** Permiso mínimo que debe tener el usuario en la allowlist para entrar a sac.wiwo. */
  requiredPermission: string;
  /** Permiso que otorga rol admin dentro de sac.wiwo. */
  adminPermission: string;
  /** Rol asignado a quien tiene `requiredPermission` pero no `adminPermission`. */
  defaultRole: ActorRole;
  tenantId: string;
}

/** Entrada de la allowlist. */
export interface AllowedUserRecord {
  email: string;
  name: string | null;
  permissions: string[];
  /** Override opcional del rol dentro de sac.wiwo; si falta se deriva de `permissions`. */
  nodesRole?: ActorRole;
  /** Rol propio asignado desde la app; `nodesRole` lleva su rol de base. */
  nodesRoleId?: string;
  /** Override opcional del alcance de marcas; `"*"` o lista de brandIds. */
  nodesBrandIds?: string[] | "all";
}

export interface SessionUser {
  uid: string;
  email: string;
  name: string | null;
}

export interface CreatedSession {
  cookie: string;
  actor: ActorContext;
  user: SessionUser;
}

export class IdentityError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "IdentityError";
    this.status = status;
    this.code = code;
  }
}

export interface IdentityService {
  readonly config: IdentityConfig;
  /** Resuelve el actor desde la cookie de sesión. Lanza 401/403 si no es válida o ya no está autorizada. */
  resolveActor(cookieValue: string): Promise<ActorContext>;
  /** Solo proveedor dev: valida correo y contraseña de usuarios ficticios. */
  createPasswordSession?(email: string, password: string): Promise<CreatedSession>;
  /** Solo proveedor google: flujo OAuth en dos pasos (redirección y callback). */
  google?: {
    start(): Promise<{ url: string; flowCookie: string }>;
    complete(params: { code?: string; state?: string; error?: string }, flowCookie: string | undefined): Promise<CreatedSession>;
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Comparación en tiempo constante sobre digests de igual largo. */
export function sameSecret(received: string, expected: string): boolean {
  return timingSafeEqual(digest(received), digest(expected));
}

/** Firma y verifica valores JSON compactos (cookie de sesión y del flujo OAuth). */
export function createSigner(secret: string | undefined) {
  const key = secret ? Buffer.from(secret, "utf8") : randomBytes(32);
  const sign = (payload: string) => createHmac("sha256", key).update(payload).digest("base64url");
  return {
    seal(value: Record<string, unknown>): string {
      const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
      return `${payload}.${sign(payload)}`;
    },
    open<T extends Record<string, unknown>>(sealed: string | undefined): T | null {
      if (!sealed) return null;
      const [payload, signature] = sealed.split(".");
      if (!payload || !signature || !sameSecret(signature, sign(payload))) return null;
      try {
        const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T & { exp?: unknown };
        if (typeof value.exp !== "number" || value.exp < Date.now()) return null;
        return value;
      } catch {
        return null;
      }
    },
  };
}

/** Normaliza una entrada de allowlist; descarta las que no tienen correo. */
export function allowedUserFromRecord(data: Record<string, unknown>): AllowedUserRecord | null {
  if (typeof data.email !== "string" || !data.email.trim()) return null;
  const permissions = Array.isArray(data.permissions)
    ? data.permissions.filter((value): value is string => typeof value === "string")
    : [];
  const rawRole = typeof data.nodesRole === "string" ? data.nodesRole.toLowerCase() : undefined;
  const nodesRole = rawRole && (ACTOR_ROLES as readonly string[]).includes(rawRole) ? rawRole as ActorRole : undefined;
  const rawBrands = data.nodesBrandIds;
  const nodesBrandIds: AllowedUserRecord["nodesBrandIds"] = rawBrands === "*" || rawBrands === "all"
    ? "all"
    : Array.isArray(rawBrands)
      ? rawBrands.filter((value): value is string => typeof value === "string")
      : undefined;
  return {
    email: normalizeEmail(data.email),
    name: typeof data.name === "string" ? data.name : null,
    permissions,
    nodesRole,
    nodesBrandIds,
  };
}

/** Lee un archivo `{ "users": [...] }`. Un archivo ausente equivale a una lista vacía. */
export async function readUsersFile(file: string | undefined): Promise<Array<Record<string, unknown>>> {
  if (!file) return [];
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new IdentityError(503, "ALLOWLIST_UNAVAILABLE", "No fue posible leer la lista de usuarios autorizados.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new IdentityError(503, "ALLOWLIST_INVALID", "La lista de usuarios autorizados no es un JSON válido.");
  }
  const list = parsed && typeof parsed === "object" ? (parsed as { users?: unknown }).users : undefined;
  if (!Array.isArray(list)) {
    throw new IdentityError(503, "ALLOWLIST_INVALID", "La lista de usuarios autorizados debe tener la forma { \"users\": [...] }.");
  }
  return list.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
}

/**
 * Entradas válidas del archivo de usuarios: la allowlist (`SAC_FLOW_AUTH_ALLOWED_USERS_FILE`)
 * o, con el proveedor dev, los usuarios ficticios.
 */
export async function readAllowlistRecords(config: IdentityConfig): Promise<AllowedUserRecord[]> {
  const file = config.provider === "dev" && config.devUsersFile ? config.devUsersFile : config.allowedUsersFile;
  return (await readUsersFile(file))
    .map(allowedUserFromRecord)
    .filter((record): record is AllowedUserRecord => Boolean(record));
}

/** Origen de la regla de acceso que el servidor aplica a un correo sin rol asignado en la app. */
export type ServerAccessSource = "allowlist_file" | "server_admin" | "server_supervisor" | "server_allowed" | "domain";

export interface ServerAccessRule {
  role: ActorRole | null;
  source: ServerAccessSource;
  /** El archivo y la lista de admins del entorno no se pueden cambiar desde la app. */
  locked: boolean;
}

/**
 * Regla del servidor para un correo, ignorando lo asignado desde la app. Sirve para mostrar
 * en "Usuarios y roles" qué rol tendría la persona si se quita la asignación.
 */
export function serverAccessRule(config: IdentityConfig, email: string, fileRecords: AllowedUserRecord[]): ServerAccessRule | undefined {
  const normalized = normalizeEmail(email);
  const listed = fileRecords.find((record) => record.email === normalized);
  // Con el proveedor dev el archivo es el de usuarios ficticios, y la app sí puede cambiarles el rol.
  const devUsers = config.provider === "dev";
  if (listed && !(devUsers && config.adminEmails?.includes(normalized))) {
    const permissions = listed.permissions.map((permission) => permission.trim().toLowerCase());
    const isAdmin = permissions.includes(config.adminPermission);
    const hasAccess = isAdmin || permissions.includes(config.requiredPermission);
    const role = !hasAccess ? null : listed.nodesRole ?? (isAdmin ? "admin" : config.defaultRole);
    return { role, source: "allowlist_file", locked: !devUsers };
  }
  if (config.adminEmails?.includes(normalized)) return { role: "admin", source: "server_admin", locked: true };
  if (config.supervisorEmails?.includes(normalized)) return { role: "supervisor", source: "server_supervisor", locked: false };
  if (config.allowedEmails?.includes(normalized)) return { role: config.defaultRole, source: "server_allowed", locked: false };
  const domain = normalized.split("@")[1] ?? "";
  if (domain && config.allowedDomains.includes(domain)) return { role: config.defaultRole, source: "domain", locked: false };
  return undefined;
}

/**
 * Convierte un rol asignado desde la app en una entrada de allowlist, o niega el acceso.
 * Un rol propio que ya no existe se ignora y rige la regla del servidor.
 */
async function assignedAccessRecord(config: IdentityConfig, email: string, name: string | null, assigned: UserAccessRecord): Promise<AllowedUserRecord | undefined> {
  const role = assigned.role;
  if (!role) return undefined;
  if (role === "none") {
    throw new IdentityError(403, "ACCESS_REVOKED", "Un administrador quitó el acceso de esta cuenta a sac.wiwo.");
  }
  if (role === "admin") return { email, name, permissions: [config.adminPermission] };
  if ((ACTOR_ROLES as readonly string[]).includes(role)) {
    return { email, name, permissions: [config.requiredPermission], nodesRole: role as ActorRole };
  }
  const base = await config.accessDirectory?.customRoleBase?.(role);
  if (!base) return undefined;
  return { email, name, permissions: [config.requiredPermission], nodesRole: base, nodesRoleId: role };
}

/**
 * Busca el correo en la allowlist del archivo (que permite afinar rol y marcas); si no está,
 * en la lista de admins del entorno, luego en los roles asignados desde la app, después en
 * las listas de supervisores y permitidos y por último en los dominios permitidos.
 * Lanza 403 cuando no hay autorización.
 */
export async function findAllowedUser(config: IdentityConfig, email: string, name: string | null): Promise<AllowedUserRecord> {
  const normalized = normalizeEmail(email);
  const records = await readAllowlistRecords(config);
  const listed = records.find((record) => record.email === normalized);
  if (listed) return { ...listed, name: listed.name ?? name };
  if (config.adminEmails?.includes(normalized)) {
    return { email: normalized, name, permissions: [config.adminPermission] };
  }
  const assigned = await config.accessDirectory?.find(normalized);
  const fromApp = assigned ? await assignedAccessRecord(config, normalized, name, assigned) : undefined;
  if (fromApp) return fromApp;
  if (config.supervisorEmails?.includes(normalized)) {
    return { email: normalized, name, permissions: [config.requiredPermission], nodesRole: "supervisor" };
  }
  if (config.allowedEmails?.includes(normalized)) {
    return { email: normalized, name, permissions: [config.requiredPermission] };
  }
  const domain = normalized.split("@")[1] ?? "";
  if (domain && config.allowedDomains.includes(domain)) {
    return { email: normalized, name, permissions: [config.requiredPermission] };
  }
  throw new IdentityError(403, "ACCOUNT_NOT_ALLOWED", `La cuenta ${normalized} no está autorizada. Pide a un administrador que te agregue.`);
}

/**
 * Proveedor dev: aplica sobre un usuario ficticio el rol asignado desde la app, salvo que su
 * correo esté en la lista de admins del entorno.
 */
export async function applyAssignedAccess(config: IdentityConfig, user: AllowedUserRecord): Promise<AllowedUserRecord> {
  if (config.adminEmails?.includes(user.email)) return user;
  const assigned = await config.accessDirectory?.find(user.email);
  const fromApp = assigned ? await assignedAccessRecord(config, user.email, user.name, assigned) : undefined;
  return fromApp ? { ...user, permissions: fromApp.permissions, nodesRole: fromApp.nodesRole, nodesRoleId: fromApp.nodesRoleId } : user;
}

/**
 * Deriva el rol y el alcance de marcas desde la allowlist. Un override explícito
 * `nodesRole`/`nodesBrandIds` gana sobre la derivación por permisos.
 */
export function resolveActorFromAllowedUser(
  user: AllowedUserRecord,
  session: SessionUser,
  config: IdentityConfig,
  source: "google" | "dev",
): ActorContext {
  const permissions = user.permissions.map((permission) => permission.trim().toLowerCase());
  const isAdmin = permissions.includes(config.adminPermission);
  const hasAccess = isAdmin || permissions.includes(config.requiredPermission);
  if (!hasAccess) {
    throw new IdentityError(
      403,
      "PERMISSION_REQUIRED",
      `La cuenta ${user.email} no tiene el permiso "${config.requiredPermission}" para sac.wiwo.`,
    );
  }

  const role: ActorRole = user.nodesRole && ACTOR_ROLES.includes(user.nodesRole)
    ? user.nodesRole
    : isAdmin
      ? "admin"
      : config.defaultRole;

  const brandIds: ActorContext["brandIds"] = user.nodesBrandIds === "all" || user.nodesBrandIds === undefined
    ? "all"
    : user.nodesBrandIds.length
      ? [...new Set(user.nodesBrandIds.map((id) => id.trim()).filter(Boolean))]
      : "all";

  return {
    userId: session.uid,
    displayName: user.name || session.name || user.email,
    tenantId: config.tenantId,
    role,
    ...(user.nodesRoleId && role !== "admin" ? { roleId: user.nodesRoleId } : {}),
    // Un admin siempre ve el portafolio completo; el override solo restringe a no-admins.
    brandIds: role === "admin" ? "all" : brandIds,
    source,
    email: session.email,
  };
}
