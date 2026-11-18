/**
 * Permisos de Wiwo Nodes y roles editables.
 *
 * Cada rol es un conjunto de permisos. Lector, Agente y Supervisor traen permisos por defecto
 * (los mismos que tenía cada nivel fijo) y un admin puede cambiarlos o crear roles propios.
 * Admin queda fijo con todo, y la administración (usuarios y roles, credenciales, envío
 * automático, auditoría de seguridad, reintento de jobs) no se delega: solo Admin la tiene.
 * Ver cualquier dato dentro del alcance de marcas no requiere permiso: lo tiene todo rol.
 */
import type { ActorContext, ActorRole } from "./types.js";

export const PERMISSION_KEYS = [
  "inbox.reply",
  "inbox.triage",
  "inbox.assign",
  "inbox.assign_others",
  "inbox.archive_expired",
  "sync.run",
  "export.xlsx",
  "metrics.read",
  "deliveries.reconcile",
  "workflow.edit",
  "workflow.publish",
  "automations.run",
  "automations.edit",
  "brands.manage",
  "records.import",
] as const;

export type Permission = (typeof PERMISSION_KEYS)[number];

export interface PermissionDefinition {
  key: Permission;
  group: "Bandeja" | "Reportes" | "Flujo y automatizaciones" | "Marcas";
  label: string;
  description: string;
}

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  { key: "inbox.reply", group: "Bandeja", label: "Responder", description: "Redactar, guardar y enviar respuestas, y ver el estado de los envíos." },
  { key: "inbox.triage", group: "Bandeja", label: "Notas y estados", description: "Agregar notas internas, cambiar el estado de un caso y evaluar el protocolo SAC." },
  { key: "inbox.assign", group: "Bandeja", label: "Tomar casos", description: "Asignarse un caso y soltar los propios." },
  { key: "inbox.assign_others", group: "Bandeja", label: "Asignar a otras personas", description: "Asignar casos a otra persona y soltar casos ajenos." },
  { key: "inbox.archive_expired", group: "Bandeja", label: "Archivar vencidos en lote", description: "Cerrar como histórico los casos fuera del plazo de respuesta (nunca los sensibles)." },
  { key: "sync.run", group: "Bandeja", label: "Actualizar desde Metricool", description: "Pedir una lectura de Metricool con «Actualizar ahora»." },
  { key: "export.xlsx", group: "Reportes", label: "Exportar a Excel", description: "Descargar el Excel de interacciones por período y marca." },
  { key: "metrics.read", group: "Reportes", label: "Ver métricas y cola", description: "Ver métricas técnicas y la cola de trabajos de sincronización." },
  { key: "deliveries.reconcile", group: "Reportes", label: "Conciliar envíos", description: "Marcar el resultado real de un envío dudoso." },
  { key: "records.import", group: "Reportes", label: "Cargar registros manuales", description: "Subir el Excel BD SAC con los casos de TikTok y LinkedIn que Metricool no trae; cuentan en Reportes y METRIQ." },
  { key: "workflow.edit", group: "Flujo y automatizaciones", label: "Ajustar el flujo SAC", description: "Cambiar reglas del flujo SAC, sin activar el envío automático." },
  { key: "workflow.publish", group: "Flujo y automatizaciones", label: "Publicar el flujo SAC", description: "Publicar una versión del flujo SAC o volver a una anterior." },
  { key: "automations.run", group: "Flujo y automatizaciones", label: "Ejecutar automatizaciones", description: "Probar y reintentar flujos y automatizaciones, y llamar webhooks." },
  { key: "automations.edit", group: "Flujo y automatizaciones", label: "Editar automatizaciones", description: "Crear, editar, publicar, importar y archivar automatizaciones, proyectos, carpetas y etiquetas." },
  { key: "brands.manage", group: "Marcas", label: "Gestionar marcas", description: "Crear y editar marcas, vincular cuentas de Metricool y gestionar planillas y documentos." },
];

/** Lo que solo Admin puede hacer; se muestra como referencia, no se puede asignar a otro rol. */
export const ADMIN_ONLY_CAPABILITIES = [
  "Gestionar usuarios y roles",
  "Credenciales y variables",
  "Activar el envío automático",
  "Auditoría de seguridad",
  "Reintentar trabajos de sincronización",
];

/**
 * Permisos que solo un admin principal (SAC_FLOW_AUTH_ADMIN_EMAILS) puede otorgar. Un admin
 * asignado desde la app no los agrega a nadie: ni con ajustes personales ni asignando un rol
 * que los traiga a quien no los tenía.
 */
export const MASTER_ONLY_PERMISSIONS: Permission[] = [
  "brands.manage",
  "automations.edit",
  "workflow.publish",
  "inbox.archive_expired",
  "export.xlsx",
];

export type BaseRole = Exclude<ActorRole, "admin">;
export const BASE_ROLES: BaseRole[] = ["viewer", "agent", "supervisor"];

const AGENT_DEFAULTS: Permission[] = ["inbox.reply", "inbox.triage", "inbox.assign", "sync.run", "automations.run"];

/** Permisos por defecto: exactamente lo que permitía cada nivel antes de los roles editables. */
export const DEFAULT_ROLE_PERMISSIONS: Record<BaseRole, Permission[]> = {
  viewer: [],
  agent: AGENT_DEFAULTS,
  supervisor: [...AGENT_DEFAULTS, "inbox.assign_others", "inbox.archive_expired", "export.xlsx", "metrics.read", "deliveries.reconcile", "workflow.edit", "records.import"],
};

export const BUILT_IN_ROLE_NAMES: Record<ActorRole, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  agent: "Agente",
  viewer: "Lector",
};

/** Rol guardado: ajuste de un rol de base o rol propio. */
export interface AccessRoleRecord {
  id: string;
  name: string;
  /** Nivel de referencia: rol de base que se ajustó o plantilla con que se creó el propio. */
  baseRole: BaseRole;
  permissions: Permission[];
  builtIn: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

export interface RoleDefinition extends AccessRoleRecord {
  /** Admin no se edita; los roles de base se pueden restablecer; los propios se pueden borrar. */
  editable: boolean;
  customized: boolean;
}

export function isPermission(value: string): value is Permission {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

export function normalizePermissions(values: readonly string[]): Permission[] {
  const set = new Set(values.filter(isPermission));
  return PERMISSION_KEYS.filter((key) => set.has(key));
}

/** Roles vigentes: Admin fijo, los tres de base (con sus ajustes) y los propios. */
export function resolveRoleCatalog(stored: AccessRoleRecord[]): RoleDefinition[] {
  const byId = new Map(stored.map((record) => [record.id, record]));
  const admin: RoleDefinition = {
    id: "admin",
    name: BUILT_IN_ROLE_NAMES.admin,
    baseRole: "supervisor",
    permissions: [...PERMISSION_KEYS],
    builtIn: true,
    editable: false,
    customized: false,
  };
  const builtIns = BASE_ROLES.map((role): RoleDefinition => {
    const override = byId.get(role);
    return {
      id: role,
      name: BUILT_IN_ROLE_NAMES[role],
      baseRole: role,
      permissions: override ? normalizePermissions(override.permissions) : DEFAULT_ROLE_PERMISSIONS[role],
      builtIn: true,
      editable: true,
      customized: Boolean(override),
      ...(override?.updatedBy ? { updatedBy: override.updatedBy } : {}),
      ...(override?.updatedAt ? { updatedAt: override.updatedAt } : {}),
    };
  });
  const custom = stored
    .filter((record) => !record.builtIn && !(["admin", ...BASE_ROLES] as string[]).includes(record.id))
    .map((record): RoleDefinition => ({
      ...record,
      permissions: normalizePermissions(record.permissions),
      builtIn: false,
      editable: true,
      customized: true,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "es"));
  return [admin, ...builtIns, ...custom];
}

/** Permisos efectivos de un actor según el catálogo vigente. */
export function permissionsForActor(actor: ActorContext, catalog: RoleDefinition[]): { roleId: string; roleName: string; permissions: Permission[] } {
  if (actor.role === "admin") return { roleId: "admin", roleName: BUILT_IN_ROLE_NAMES.admin, permissions: [...PERMISSION_KEYS] };
  const roleId = actor.roleId ?? actor.role;
  const definition = catalog.find((role) => role.id === roleId) ?? catalog.find((role) => role.id === actor.role);
  return {
    roleId: definition?.id ?? actor.role,
    roleName: definition?.name ?? BUILT_IN_ROLE_NAMES[actor.role],
    permissions: definition?.permissions ?? DEFAULT_ROLE_PERMISSIONS[actor.role],
  };
}

/**
 * Aplica los ajustes personales de una persona sobre los permisos de su rol: suma los
 * agregados y resta los quitados. El resultado queda en el orden del catálogo.
 */
export function applyPermissionOverrides(
  base: readonly Permission[],
  overrides: { permissionsAdd?: readonly string[]; permissionsRemove?: readonly string[] } | undefined,
): Permission[] {
  if (!overrides) return [...base];
  const removed = new Set(normalizePermissions(overrides.permissionsRemove ?? []));
  const result = new Set(base.filter((permission) => !removed.has(permission)));
  for (const permission of normalizePermissions(overrides.permissionsAdd ?? [])) result.add(permission);
  return PERMISSION_KEYS.filter((key) => result.has(key));
}

/** Diferencia entre el conjunto deseado y el del rol, como ajustes personales. */
export function permissionOverridesFor(rolePermissions: readonly Permission[], desired: readonly string[]): { add: Permission[]; remove: Permission[] } {
  const wanted = new Set(normalizePermissions(desired));
  const fromRole = new Set(rolePermissions);
  return {
    add: PERMISSION_KEYS.filter((key) => wanted.has(key) && !fromRole.has(key)),
    remove: PERMISSION_KEYS.filter((key) => fromRole.has(key) && !wanted.has(key)),
  };
}

/** Admin puede todo; el resto según sus permisos (o los de su nivel, si aún no se resolvieron). */
export function actorCan(actor: ActorContext, permission: Permission): boolean {
  if (actor.role === "admin") return true;
  return (actor.permissions ?? DEFAULT_ROLE_PERMISSIONS[actor.role]).includes(permission);
}

export function permissionLabel(permission: Permission): string {
  return PERMISSION_CATALOG.find((definition) => definition.key === permission)?.label ?? permission;
}
