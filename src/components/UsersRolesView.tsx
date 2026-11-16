/**
 * Usuarios y roles (solo admin).
 *
 * - Personas: rol efectivo de cada persona y de dónde sale; asignar otro rol, quitar el
 *   acceso o volver a la regla del servidor. Los admins del entorno y el propio rol no se
 *   cambian desde aquí.
 * - Roles: qué puede hacer cada rol. Admin es fijo; Lector, Agente y Supervisor se pueden
 *   ajustar y restablecer; los roles propios se crean desde una plantilla y se pueden borrar
 *   cuando nadie los tiene.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CheckSquare,
  LockSimple,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  Trash,
  UserPlus,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { createAccessRole, deleteAccessRole, listUserAccess, setUserAccessRole, setUserPermissions, updateAccessRole } from "../lib/api";
import type { AccessControlListing, AccessRole, RoleView, UserAccessView } from "../types";
import { confirmAction } from "../lib/confirm";

type Toast = { tone: "success" | "warning"; title: string; detail: string };
type Tab = "people" | "roles";

const NO_ACCESS = "none";

function sourceLabel(user: UserAccessView): string {
  switch (user.serverSource) {
    case "server_admin": return "Admin del servidor";
    case "allowlist_file": return "Archivo del servidor";
    case "server_supervisor": return "Lista de supervisores";
    case "server_allowed": return "Lista permitida";
    case "domain": return `Dominio ${user.email.split("@")[1] ?? ""}`.trim();
    default: return "Sin regla del servidor";
  }
}

const formatDate = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function when(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : formatDate.format(date);
}

function initials(user: UserAccessView): string {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

type UsersRolesViewProps = {
  onToast: (toast: Toast) => void;
};

export function UsersRolesView({ onToast }: UsersRolesViewProps) {
  const [data, setData] = useState<AccessControlListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("people");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await listUserAccess());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudo cargar la lista de usuarios.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const roles = data?.roles ?? [];
  const roleName = useCallback((id: AccessRole | null | undefined) => {
    if (!id || id === NO_ACCESS) return "Sin acceso";
    return roles.find((role) => role.id === id)?.name ?? id;
  }, [roles]);

  /** Ejecuta una acción de administración y muestra el resultado. */
  async function run<T extends AccessControlListing>(key: string, action: () => Promise<T>, success: (result: T) => Toast): Promise<T | null> {
    setBusy(key);
    try {
      const result = await action();
      setData(result);
      onToast(success(result));
      return result;
    } catch (error) {
      onToast({ tone: "warning", title: "No se pudo guardar", detail: error instanceof Error ? error.message : "Error desconocido." });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function applyRole(target: { email: string; name?: string | null }, role: AccessRole | null): Promise<boolean> {
    const who = target.name ? `${target.name} (${target.email})` : target.email;
    if (role === "admin" && !(await confirmAction({
      title: `¿Dar rol Admin a ${who}?`,
      message: "Podrá cambiar marcas, credenciales, el envío automático y los roles de otras personas.",
      confirmLabel: "Dar rol Admin",
    }))) return false;
    if (role === NO_ACCESS && !(await confirmAction({
      title: `¿Quitar el acceso de ${who}?`,
      message: "Su sesión se corta en su siguiente acción.",
      confirmLabel: "Quitar acceso",
      tone: "danger",
    }))) return false;
    const result = await run(`user:${target.email}`, () => setUserAccessRole(target.email, role), (listing) => ({
      tone: "success",
      title: role === null ? "Rol restablecido" : "Rol actualizado",
      detail: `${target.name || target.email} ahora es ${roleNameIn(listing.roles, listing.user?.effectiveRole ?? role)}. Rige en su siguiente acción.`,
    }));
    return Boolean(result);
  }

  return (
    <section className="app-view users-roles-view" aria-labelledby="users-roles-title">
      <header className="view-header">
        <div className="view-header__copy">
          <p className="view-header__eyebrow">Sistema</p>
          <h1 id="users-roles-title" className="view-header__title">Usuarios y roles</h1>
          <p className="view-header__description">
            Define qué puede hacer cada rol y qué rol tiene cada persona. Los cambios rigen en su siguiente acción, sin volver a iniciar sesión.
          </p>
        </div>
        <div className="view-header__actions">
          <div className="users-roles-tabs" role="tablist" aria-label="Secciones">
            <button type="button" role="tab" aria-selected={tab === "people"} className={tab === "people" ? "is-active" : ""} onClick={() => setTab("people")}>
              <UsersThree size={15} aria-hidden="true" /> Personas
            </button>
            <button type="button" role="tab" aria-selected={tab === "roles"} className={tab === "roles" ? "is-active" : ""} onClick={() => setTab("roles")}>
              <ShieldCheck size={15} aria-hidden="true" /> Roles
            </button>
          </div>
          <button className="button button--secondary" type="button" onClick={() => void load()} disabled={loading}>
            <ArrowClockwise className={loading ? "spin" : undefined} size={16} aria-hidden="true" />
            Actualizar
          </button>
        </div>
      </header>

      {data && !data.policy.authEnabled ? (
        <p className="users-roles-notice" role="status">
          <WarningCircle size={16} weight="fill" aria-hidden="true" />
          El inicio de sesión no está activo en este entorno: los roles se guardan, pero no se aplican hasta activarlo.
        </p>
      ) : null}
      {loadError ? <p className="users-roles-notice" role="alert"><WarningCircle size={16} weight="fill" aria-hidden="true" />{loadError}</p> : null}

      {tab === "people" ? (
        <PeopleTab
          data={data}
          loading={loading}
          busy={busy}
          roleName={roleName}
          onApplyRole={applyRole}
          onOpenRoles={() => setTab("roles")}
          onSavePermissions={(user, permissions) => run(`user:${user.email}`, () => setUserPermissions(user.email, permissions), () => ({
            tone: "success",
            title: permissions === null ? "Ajustes quitados" : "Permisos actualizados",
            detail: permissions === null
              ? `${user.name || user.email} vuelve a los permisos de su rol.`
              : `Los permisos de ${user.name || user.email} rigen en su siguiente acción.`,
          }))}
        />
      ) : (
        <RolesTab
          data={data}
          busy={busy}
          onSave={(role, input) => run(`role:${role.id}`, () => updateAccessRole(role.id, input), () => ({
            tone: "success",
            title: "Rol actualizado",
            detail: `${input.name || role.name} quedó con ${input.permissions.length} permiso${input.permissions.length === 1 ? "" : "s"}. Rige en la siguiente acción de quienes lo tienen.`,
          }))}
          onCreate={(input) => run("role:new", () => createAccessRole(input), () => ({
            tone: "success",
            title: "Rol creado",
            detail: `${input.name} ya se puede asignar en Personas.`,
          }))}
          onRemove={(role) => run(`role:${role.id}`, () => deleteAccessRole(role.id), () => ({
            tone: "success",
            title: role.builtIn ? "Rol restablecido" : "Rol borrado",
            detail: role.builtIn ? `${role.name} volvió a sus permisos por defecto.` : `${role.name} ya no existe.`,
          }))}
        />
      )}
    </section>
  );
}

function roleNameIn(roles: RoleView[], id: AccessRole | null | undefined): string {
  if (!id || id === NO_ACCESS) return "Sin acceso";
  return roles.find((role) => role.id === id)?.name ?? id;
}

type PeopleTabProps = {
  data: AccessControlListing | null;
  loading: boolean;
  busy: string | null;
  roleName: (id: AccessRole | null | undefined) => string;
  onApplyRole: (target: { email: string; name?: string | null }, role: AccessRole | null) => Promise<boolean>;
  onOpenRoles: () => void;
  onSavePermissions: (user: UserAccessView, permissions: string[] | null) => Promise<unknown>;
};

function PeopleTab({ data, loading, busy, roleName, onApplyRole, onOpenRoles, onSavePermissions }: PeopleTabProps) {
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<AccessRole>("agent");
  const [addError, setAddError] = useState<string | null>(null);
  const users = data?.users ?? [];
  const roles = data?.roles ?? [];
  const policy = data?.policy;

  const visibleUsers = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es-CL");
    if (!term) return users;
    return users.filter((user) => `${user.name ?? ""} ${user.email}`.toLocaleLowerCase("es-CL").includes(term));
  }, [query, users]);

  const summary = useMemo(() => {
    const parts = roles.filter((role) => role.userCount > 0).map((role) => `${role.userCount} ${role.name.toLocaleLowerCase("es")}`);
    const revoked = users.filter((user) => user.effectiveRole === NO_ACCESS).length;
    if (revoked) parts.push(`${revoked} sin acceso`);
    return parts.join(" · ");
  }, [roles, users]);

  const roleOptions = [...roles.map((role) => ({ id: role.id, name: role.name })), { id: NO_ACCESS, name: "Sin acceso" }];

  async function addPerson(event: FormEvent) {
    event.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setAddError("Escribe un correo válido.");
      return;
    }
    setAddError(null);
    const existing = users.find((user) => user.email === email);
    if (await onApplyRole({ email, name: existing?.name }, newRole)) setNewEmail("");
  }

  return (
    <div className="users-roles-layout">
      <article className="panel users-roles-panel" aria-labelledby="users-roles-list-title">
        <header className="panel__header">
          <div>
            <h2 id="users-roles-list-title" className="panel__title">Personas</h2>
            <p className="panel__description">
              {users.length ? summary : "Aparecen quienes están en la configuración del servidor, tienen un rol asignado o ya ingresaron."}
            </p>
          </div>
          <label className="users-roles-search">
            <MagnifyingGlass size={15} aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o correo" aria-label="Buscar personas" />
          </label>
        </header>

        {loading && !users.length ? <p className="users-roles-empty">Cargando personas…</p> : null}
        {!loading && !visibleUsers.length ? (
          <p className="users-roles-empty">{query ? "Nadie coincide con la búsqueda." : "Aún no hay personas registradas."}</p>
        ) : null}

        <ul className="users-roles-list">
          {visibleUsers.map((user) => {
            const lastSignIn = when(user.lastSignInAt);
            const assignedAt = when(user.assignedAt);
            const disabled = user.locked || user.isSelf || busy === `user:${user.email}`;
            const currentValue = user.assignedRole ?? user.effectiveRole;
            const lockTitle = user.isSelf
              ? "No puedes cambiar tu propio rol."
              : user.locked
                ? user.serverSource === "server_admin"
                  ? "Admin definido en el .env del servidor (SAC_FLOW_AUTH_ADMIN_EMAILS)."
                  : "Definido en el archivo de usuarios del servidor."
                : undefined;
            const tone = user.effectiveRole === NO_ACCESS ? "none" : roles.find((role) => role.id === user.effectiveRole)?.baseRole ?? "viewer";
            return (
              <li key={user.email} className={`users-roles-row${user.effectiveRole === NO_ACCESS ? " is-revoked" : ""}`}>
                <span className={`users-roles-avatar users-roles-avatar--${user.effectiveRole === "admin" ? "admin" : tone}`} aria-hidden="true">{initials(user)}</span>
                <button type="button" className="users-roles-person" onClick={() => setOpenEmail(user.email)} title="Ver y ajustar lo que puede hacer">
                  <strong>
                    {user.name || user.email}
                    {user.isSelf ? <span className="users-roles-you">Tú</span> : null}
                  </strong>
                  {user.name ? <span className="users-roles-email">{user.email}</span> : null}
                  <span className="users-roles-meta">
                    {user.assignedRole ? (
                      <span className="users-roles-chip users-roles-chip--assigned">
                        Asignado{user.assignedBy ? ` por ${user.assignedBy}` : ""}{assignedAt ? ` · ${assignedAt}` : ""}
                      </span>
                    ) : (
                      <span className="users-roles-chip">
                        {user.locked ? <LockSimple size={11} weight="bold" aria-hidden="true" /> : null}
                        {sourceLabel(user)}
                      </span>
                    )}
                    {user.permissionsAdd.length || user.permissionsRemove.length ? (
                      <span className="users-roles-chip users-roles-chip--personal">Permisos ajustados</span>
                    ) : null}
                    <span className="users-roles-last">{lastSignIn ? `Último ingreso ${lastSignIn}` : "Aún no ingresa"}</span>
                  </span>
                </button>
                <div className="users-roles-actions">
                  <label className="users-roles-select" title={lockTitle}>
                    <span className="sr-only">Rol de {user.name || user.email}</span>
                    <select
                      value={currentValue}
                      disabled={disabled}
                      onChange={(event) => {
                        const role = event.target.value;
                        if (role !== currentValue) void onApplyRole(user, role);
                      }}
                    >
                      {roleOptions.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                    {user.locked || user.isSelf ? <LockSimple size={13} weight="bold" aria-hidden="true" /> : null}
                  </label>
                  {user.assignedRole && !disabled ? (
                    <button
                      className="users-roles-reset"
                      type="button"
                      onClick={() => void onApplyRole(user, null)}
                      title={user.serverRole ? `Volver a la regla del servidor: ${roleName(user.serverRole)}` : "Quitar la asignación: la persona queda sin acceso"}
                    >
                      <ArrowCounterClockwise size={13} weight="bold" aria-hidden="true" />
                      {user.serverRole ? `Volver a ${roleName(user.serverRole)}` : "Quitar asignación"}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </article>

      <aside className="users-roles-aside">
        <form className="panel users-roles-add" onSubmit={(event) => void addPerson(event)} aria-labelledby="users-roles-add-title">
          <header className="panel__header">
            <div>
              <h2 id="users-roles-add-title" className="panel__title">Agregar o cambiar por correo</h2>
              <p className="panel__description">Sirve para alguien que todavía no ingresa. Un correo fuera de los dominios permitidos podrá entrar con el rol que le des.</p>
            </div>
            <UserPlus size={22} aria-hidden="true" />
          </header>
          <div className="users-roles-add__fields">
            <label className="form-field">
              <span>Correo</span>
              <input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="nombre@empresa.com" autoComplete="off" />
            </label>
            <label className="form-field">
              <span>Rol</span>
              <select value={newRole} onChange={(event) => setNewRole(event.target.value)}>
                {roleOptions.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
            {addError ? <p className="users-roles-add__error" role="alert">{addError}</p> : null}
            <button className="button button--primary" type="submit" disabled={!newEmail.trim() || busy !== null}>
              Guardar rol
            </button>
          </div>
        </form>

        <article className="panel users-roles-legend" aria-labelledby="users-roles-legend-title">
          <header className="panel__header">
            <div>
              <h2 id="users-roles-legend-title" className="panel__title">Roles disponibles</h2>
              <p className="panel__description">
                {policy?.allowedDomains.length
                  ? `Quien entra por ${policy.allowedDomains.join(", ")} sin rol asignado es ${roleName(policy.defaultRole)}.`
                  : "Asigna a cada persona el rol que corresponda."}
              </p>
            </div>
            <ShieldCheck size={22} aria-hidden="true" />
          </header>
          <dl>
            {roles.map((role) => (
              <div key={role.id}>
                <dt>
                  <span className={`users-roles-dot users-roles-dot--${role.id === "admin" ? "admin" : role.baseRole}`} aria-hidden="true" />
                  {role.name}
                  {!role.builtIn ? <span className="users-roles-tag">Propio</span> : role.customized ? <span className="users-roles-tag">Ajustado</span> : null}
                </dt>
                <dd>
                  {role.id === "admin"
                    ? "Todo, incluida la administración."
                    : role.permissions.length
                      ? role.permissions.map((key) => data?.permissions.find((permission) => permission.key === key)?.label ?? key).join(", ")
                      : "Solo lectura."}
                </dd>
              </div>
            ))}
          </dl>
          <div className="users-roles-legend__footer">
            <button className="button button--secondary" type="button" onClick={onOpenRoles}>Editar roles</button>
          </div>
        </article>
      </aside>

      {openEmail && data ? (() => {
        const person = data.users.find((user) => user.email === openEmail);
        return person ? (
          <PersonDrawer
            key={person.email}
            user={person}
            data={data}
            busy={busy === `user:${person.email}`}
            roleName={roleName}
            roleOptions={roleOptions}
            onClose={() => setOpenEmail(null)}
            onApplyRole={onApplyRole}
            onSavePermissions={onSavePermissions}
          />
        ) : null;
      })() : null}
    </div>
  );
}

type PersonDrawerProps = {
  user: UserAccessView;
  data: AccessControlListing;
  busy: boolean;
  roleName: (id: AccessRole | null | undefined) => string;
  roleOptions: { id: string; name: string }[];
  onClose: () => void;
  onApplyRole: (target: { email: string; name?: string | null }, role: AccessRole | null) => Promise<boolean>;
  onSavePermissions: (user: UserAccessView, permissions: string[] | null) => Promise<unknown>;
};

/** Panel lateral de una persona: su rol y lo que puede hacer en específico. */
function PersonDrawer({ user, data, busy, roleName, roleOptions, onClose, onApplyRole, onSavePermissions }: PersonDrawerProps) {
  const [draft, setDraft] = useState<string[]>(user.permissions);

  useEffect(() => {
    setDraft(user.permissions);
  }, [user.permissions]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const groups = useMemo(() => {
    const map = new Map<string, AccessControlListing["permissions"]>();
    for (const permission of data.permissions) map.set(permission.group, [...(map.get(permission.group) ?? []), permission]);
    return [...map];
  }, [data.permissions]);

  const isAdmin = user.effectiveRole === "admin";
  const revoked = user.effectiveRole === NO_ACCESS;
  const roleLocked = user.locked || user.isSelf;
  const permissionsLocked = roleLocked || isAdmin || revoked;
  const hasOverrides = user.permissionsAdd.length > 0 || user.permissionsRemove.length > 0;
  const dirty = !sameSet(draft, user.permissions);
  const currentRole = user.assignedRole ?? user.effectiveRole;
  const lastSignIn = when(user.lastSignInAt);
  const lockMessage = user.isSelf
    ? "No puedes cambiar tu propio rol ni tus permisos. Pide a otro admin que lo haga."
    : user.locked
      ? user.serverSource === "server_admin"
        ? "Es admin por configuración del servidor (SAC_FLOW_AUTH_ADMIN_EMAILS): se cambia en el .env del servidor."
        : "Está definido en el archivo de usuarios del servidor: se cambia en ese archivo."
      : isAdmin
        ? "Admin tiene siempre todos los permisos."
        : revoked
          ? "No tiene acceso. Asígnale un rol para ajustar sus permisos."
          : null;

  function toggle(key: string) {
    setDraft((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  }

  return (
    <div className="users-roles-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <aside className="users-roles-drawer" role="dialog" aria-modal="true" aria-labelledby="users-roles-drawer-title">
        <header className="users-roles-drawer__header">
          <span className={`users-roles-avatar users-roles-avatar--${isAdmin ? "admin" : revoked ? "none" : data.roles.find((role) => role.id === user.effectiveRole)?.baseRole ?? "viewer"}`} aria-hidden="true">{initials(user)}</span>
          <div>
            <h2 id="users-roles-drawer-title">{user.name || user.email}{user.isSelf ? <span className="users-roles-you">Tú</span> : null}</h2>
            {user.name ? <p className="users-roles-email">{user.email}</p> : null}
            <p className="users-roles-last">{lastSignIn ? `Último ingreso ${lastSignIn}` : "Aún no ingresa"} · {user.assignedRole ? `Rol asignado${user.assignedBy ? ` por ${user.assignedBy}` : ""}` : sourceLabel(user)}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose} disabled={busy}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <div className="users-roles-drawer__body">
          {lockMessage ? (
            <p className="users-roles-drawer__lock"><LockSimple size={14} weight="bold" aria-hidden="true" />{lockMessage}</p>
          ) : null}

          <section className="users-roles-drawer__section">
            <h3>Rol</h3>
            <div className="users-roles-drawer__role">
              <label className="form-field">
                <span className="sr-only">Rol</span>
                <select
                  value={currentRole}
                  disabled={roleLocked || busy}
                  onChange={(event) => {
                    const role = event.target.value;
                    if (role !== currentRole) void onApplyRole(user, role);
                  }}
                >
                  {roleOptions.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </label>
              {user.assignedRole && !roleLocked ? (
                <button className="users-roles-reset" type="button" disabled={busy} onClick={() => void onApplyRole(user, null)}>
                  <ArrowCounterClockwise size={13} weight="bold" aria-hidden="true" />
                  {user.serverRole ? `Volver a ${roleName(user.serverRole)}` : "Quitar asignación"}
                </button>
              ) : null}
            </div>
          </section>

          <section className="users-roles-drawer__section">
            <h3>Lo que puede hacer</h3>
            <p className="users-roles-drawer__hint">
              Parte de los permisos de su rol ({roleName(user.effectiveRole)}). Marca o desmarca para ajustarlos solo para esta persona.
              {user.permissionsUpdatedBy ? ` Último ajuste por ${user.permissionsUpdatedBy}${when(user.permissionsUpdatedAt) ? ` (${when(user.permissionsUpdatedAt)})` : ""}.` : ""}
            </p>
            {groups.map(([group, permissions]) => (
              <fieldset key={group} className="users-roles-perms users-roles-perms--compact">
                <legend>{group}</legend>
                {permissions.map((permission) => {
                  const checked = isAdmin || draft.includes(permission.key);
                  const fromRole = user.rolePermissions.includes(permission.key);
                  const state = isAdmin ? "" : checked && !fromRole ? "added" : !checked && fromRole ? "removed" : "";
                  return (
                    <label key={permission.key} className={`users-roles-perm${checked ? " is-on" : ""}${state ? ` is-${state}` : ""}`}>
                      <input type="checkbox" checked={checked} disabled={permissionsLocked || busy} onChange={() => toggle(permission.key)} />
                      <span>
                        <strong>
                          {permission.label}
                          {state === "added" ? <em className="users-roles-perm__tag users-roles-perm__tag--added">Agregado</em> : null}
                          {state === "removed" ? <em className="users-roles-perm__tag users-roles-perm__tag--removed">Quitado</em> : null}
                        </strong>
                        <small>{permission.description}</small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
            <fieldset className="users-roles-perms users-roles-perms--locked">
              <legend><LockSimple size={12} weight="bold" aria-hidden="true" /> Solo Admin</legend>
              <ul>{data.adminOnly.map((item) => <li key={item}>{item}</li>)}</ul>
            </fieldset>
          </section>
        </div>

        {!permissionsLocked ? (
          <footer className="users-roles-editor__actions">
            {hasOverrides ? (
              <button className="button button--secondary" type="button" disabled={busy} onClick={() => void onSavePermissions(user, null)}>
                <ArrowCounterClockwise size={15} aria-hidden="true" /> Quitar ajustes
              </button>
            ) : null}
            <span className="users-roles-editor__spacer" />
            {dirty ? (
              <button className="button button--secondary" type="button" disabled={busy} onClick={() => setDraft(user.permissions)}>Descartar</button>
            ) : null}
            <button className="button button--primary" type="button" disabled={!dirty || busy} onClick={() => void onSavePermissions(user, draft)}>
              {busy ? "Guardando…" : "Guardar permisos"}
            </button>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}

type RolesTabProps = {
  data: AccessControlListing | null;
  busy: string | null;
  onSave: (role: RoleView, input: { name?: string; permissions: string[] }) => Promise<unknown>;
  onCreate: (input: { name: string; baseRole: RoleView["baseRole"]; permissions: string[] }) => Promise<(AccessControlListing & { roleId: string }) | null>;
  onRemove: (role: RoleView) => Promise<unknown>;
};

function RolesTab({ data, busy, onSave, onCreate, onRemove }: RolesTabProps) {
  const roles = data?.roles ?? [];
  const catalog = data?.permissions ?? [];
  const [selectedId, setSelectedId] = useState<string>("supervisor");
  const [draftName, setDraftName] = useState("");
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [template, setTemplate] = useState<string>("supervisor");

  const selected = roles.find((role) => role.id === selectedId) ?? roles[0];

  useEffect(() => {
    if (!selected) return;
    setDraftName(selected.name);
    setDraftPermissions(selected.permissions);
  }, [selected]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof catalog>();
    for (const permission of catalog) map.set(permission.group, [...(map.get(permission.group) ?? []), permission]);
    return [...map];
  }, [catalog]);

  if (!selected) return <p className="users-roles-empty">Cargando roles…</p>;

  const isAdmin = selected.id === "admin";
  const dirty = !isAdmin && (!sameSet(draftPermissions, selected.permissions) || (!selected.builtIn && draftName.trim() !== selected.name));
  const isBusy = busy === `role:${selected.id}`;
  const matchesDefault = selected.defaultPermissions ? sameSet(selected.permissions, selected.defaultPermissions) : true;

  function toggle(key: string) {
    setDraftPermissions((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (name.length < 2) return;
    const source = roles.find((role) => role.id === template);
    const baseRole = source?.id === "admin" ? "supervisor" : source?.baseRole ?? "agent";
    const permissions = source?.id === "admin" ? catalog.map((permission) => permission.key) : source?.permissions ?? [];
    const result = await onCreate({ name, baseRole, permissions });
    if (result) {
      setCreating(false);
      setNewName("");
      setSelectedId(result.roleId);
    }
  }

  async function remove() {
    if (!selected) return;
    const confirmed = await confirmAction(selected.builtIn
      ? { title: `¿Restablecer ${selected.name} a sus permisos por defecto?`, confirmLabel: "Restablecer" }
      : { title: `¿Borrar el rol ${selected.name}?`, message: "No se puede deshacer.", confirmLabel: "Borrar rol", tone: "danger" });
    if (!confirmed) return;
    await onRemove(selected);
    if (!selected.builtIn) setSelectedId("supervisor");
  }

  return (
    <div className="users-roles-layout users-roles-layout--roles">
      <article className="panel users-roles-role-list" aria-labelledby="users-roles-roles-title">
        <header className="panel__header">
          <div>
            <h2 id="users-roles-roles-title" className="panel__title">Roles</h2>
            <p className="panel__description">Elige un rol para ver y cambiar sus permisos.</p>
          </div>
          <button className="button button--secondary" type="button" onClick={() => setCreating((value) => !value)}>
            <Plus size={15} weight="bold" aria-hidden="true" /> Crear rol
          </button>
        </header>

        {creating ? (
          <form className="users-roles-create" onSubmit={(event) => void create(event)}>
            <label className="form-field">
              <span>Nombre</span>
              <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Ej. Supervisor sin exportar" maxLength={60} autoFocus />
            </label>
            <label className="form-field">
              <span>Partir de</span>
              <select value={template} onChange={(event) => setTemplate(event.target.value)}>
                {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
              <small>Copia sus permisos; después ajustas lo que quieras. Nunca incluye la administración.</small>
            </label>
            <div className="users-roles-create__actions">
              <button className="button button--secondary" type="button" onClick={() => setCreating(false)}>Cancelar</button>
              <button className="button button--primary" type="submit" disabled={newName.trim().length < 2 || busy === "role:new"}>Crear</button>
            </div>
          </form>
        ) : null}

        <ul className="users-roles-role-items">
          {roles.map((role) => (
            <li key={role.id}>
              <button type="button" className={role.id === selected.id ? "is-active" : ""} onClick={() => setSelectedId(role.id)} aria-current={role.id === selected.id ? "true" : undefined}>
                <span className={`users-roles-dot users-roles-dot--${role.id === "admin" ? "admin" : role.baseRole}`} aria-hidden="true" />
                <span className="users-roles-role-items__copy">
                  <strong>{role.name}</strong>
                  <small>
                    {role.id === "admin" ? "Todos los permisos" : `${role.permissions.length} de ${catalog.length} permisos`}
                    {` · ${role.userCount} persona${role.userCount === 1 ? "" : "s"}`}
                  </small>
                </span>
                {role.id === "admin" ? <LockSimple size={13} weight="bold" aria-hidden="true" /> : !role.builtIn ? <span className="users-roles-tag">Propio</span> : role.customized ? <span className="users-roles-tag">Ajustado</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </article>

      <article className="panel users-roles-editor" aria-labelledby="users-roles-editor-title">
        <header className="panel__header">
          <div>
            <h2 id="users-roles-editor-title" className="panel__title">{selected.name}</h2>
            <p className="panel__description">
              {isAdmin
                ? "Admin tiene siempre todos los permisos y es el único que administra."
                : selected.builtIn
                  ? selected.customized ? "Rol de base ajustado. Puedes volver a sus permisos por defecto." : "Rol de base con sus permisos por defecto."
                  : `Rol propio basado en ${roleNameIn(roles, selected.baseRole)}.`}
              {!isAdmin && selected.updatedBy ? ` Último cambio por ${selected.updatedBy}${when(selected.updatedAt) ? ` (${when(selected.updatedAt)})` : ""}.` : ""}
            </p>
          </div>
          <CheckSquare size={22} aria-hidden="true" />
        </header>

        <div className="users-roles-editor__body">
          {!selected.builtIn ? (
            <label className="form-field users-roles-editor__name">
              <span>Nombre del rol</span>
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={60} />
            </label>
          ) : null}

          <p className="users-roles-editor__base">Todos los roles pueden ver bandejas, conversaciones, resumen, cuentas y flujos de sus marcas.</p>

          {groups.map(([group, permissions]) => (
            <fieldset key={group} className="users-roles-perms">
              <legend>{group}</legend>
              {permissions.map((permission) => {
                const checked = isAdmin || draftPermissions.includes(permission.key);
                return (
                  <label key={permission.key} className={`users-roles-perm${checked ? " is-on" : ""}`}>
                    <input type="checkbox" checked={checked} disabled={isAdmin || isBusy} onChange={() => toggle(permission.key)} />
                    <span>
                      <strong>{permission.label}</strong>
                      <small>{permission.description}</small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ))}

          <fieldset className="users-roles-perms users-roles-perms--locked">
            <legend><LockSimple size={12} weight="bold" aria-hidden="true" /> Solo Admin</legend>
            <ul>
              {(data?.adminOnly ?? []).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </fieldset>
        </div>

        {!isAdmin ? (
          <footer className="users-roles-editor__actions">
            {selected.builtIn ? (
              <button className="button button--secondary" type="button" onClick={() => void remove()} disabled={isBusy || (!selected.customized && matchesDefault)}>
                <ArrowCounterClockwise size={15} aria-hidden="true" /> Restablecer
              </button>
            ) : (
              <button
                className="button button--secondary users-roles-danger"
                type="button"
                onClick={() => void remove()}
                disabled={isBusy || selected.userCount > 0}
                title={selected.userCount > 0 ? "Cámbiales el rol a sus personas antes de borrarlo." : undefined}
              >
                <Trash size={15} aria-hidden="true" /> Borrar rol
              </button>
            )}
            <span className="users-roles-editor__spacer" />
            {dirty ? (
              <button className="button button--secondary" type="button" onClick={() => { setDraftName(selected.name); setDraftPermissions(selected.permissions); }} disabled={isBusy}>
                Descartar
              </button>
            ) : null}
            <button
              className="button button--primary"
              type="button"
              disabled={!dirty || isBusy || (!selected.builtIn && draftName.trim().length < 2)}
              onClick={() => void onSave(selected, { ...(selected.builtIn ? {} : { name: draftName.trim() }), permissions: draftPermissions })}
            >
              {isBusy ? "Guardando…" : "Guardar cambios"}
            </button>
          </footer>
        ) : null}
      </article>
    </div>
  );
}
