/**
 * Permisos del actor en el navegador. El servidor es quien decide; esto solo habilita o
 * deshabilita controles. Admin puede todo; el resto según los permisos que entrega /api/me.
 */
import type { SessionActor } from "../types";

export type Permission =
  | "inbox.reply"
  | "inbox.triage"
  | "inbox.assign"
  | "inbox.assign_others"
  | "inbox.archive_expired"
  | "sync.run"
  | "export.xlsx"
  | "metrics.read"
  | "deliveries.reconcile"
  | "workflow.edit"
  | "workflow.publish"
  | "automations.run"
  | "automations.edit"
  | "brands.manage"
  | "records.import";

/** Por si un servidor anterior no envía permisos: lo que permitía cada nivel. */
const LEGACY_DEFAULTS: Record<Exclude<SessionActor["role"], "admin">, Permission[]> = {
  viewer: [],
  agent: ["inbox.reply", "inbox.triage", "inbox.assign", "sync.run", "automations.run"],
  supervisor: [
    "inbox.reply", "inbox.triage", "inbox.assign", "sync.run", "automations.run",
    "inbox.assign_others", "inbox.archive_expired", "export.xlsx", "metrics.read", "deliveries.reconcile", "workflow.edit",
    "records.import",
  ],
};

export function can(actor: Pick<SessionActor, "role" | "permissions">, permission: Permission): boolean {
  if (actor.role === "admin") return true;
  return (actor.permissions ?? LEGACY_DEFAULTS[actor.role]).includes(permission);
}

const BUILT_IN_ROLE_NAMES: Record<SessionActor["role"], string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  agent: "Agente",
  viewer: "Lector",
};

export function roleDisplayName(actor: Pick<SessionActor, "role" | "roleName">): string {
  return actor.roleName || BUILT_IN_ROLE_NAMES[actor.role];
}
