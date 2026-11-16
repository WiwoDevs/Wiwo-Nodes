/**
 * "Usuarios y roles": un admin asigna roles desde la app. La asignación rige en la siguiente
 * solicitud de la persona (sin volver a iniciar sesión), puede quitar el acceso, y no puede
 * tocar a los admins del entorno ni el propio rol.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import type { GoogleOAuthClient } from "../../server/google-auth.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

/** Cliente OAuth falso cuyo usuario se cambia entre inicios de sesión. */
function switchableGoogle() {
  const current = { email: "", name: "" };
  let requestedNonce = "";
  const client: GoogleOAuthClient = {
    async generateCodeVerifierAsync() {
      return { codeVerifier: "verificador", codeChallenge: "desafio" };
    },
    generateAuthUrl(options) {
      requestedNonce = String(options.nonce);
      const url = new URL("https://accounts.google.test/o/oauth2/v2/auth");
      url.searchParams.set("state", String(options.state));
      return url.toString();
    },
    async getToken() {
      return { tokens: { id_token: "id-token" } };
    },
    async verifyIdToken() {
      return {
        getPayload: () => ({ sub: current.email, nonce: requestedNonce, email: current.email, email_verified: true, name: current.name }),
      };
    },
  };
  return { client, current };
}

async function makeApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-user-access-"));
  directories.push(directory);
  const allowlist = path.join(directory, "allowed-users.json");
  await writeFile(allowlist, JSON.stringify({ users: [] }));
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
    SAC_FLOW_AUTH_MODE: "google",
    GOOGLE_OAUTH_CLIENT_ID: "cliente.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "secreto",
    SAC_FLOW_AUTH_ALLOWED_USERS_FILE: allowlist,
    SAC_FLOW_AUTH_ADMIN_EMAILS: "jefa@demo.test",
    SAC_FLOW_AUTH_SUPERVISOR_EMAILS: "super@demo.test",
    SAC_FLOW_AUTH_ALLOWED_DOMAINS: "demo.test",
  }, directory);
  const google = switchableGoogle();
  const app = await buildApp({ config, googleClient: google.client });
  apps.push(app);
  return { app, google };
}

function cookieFrom(setCookie: string | string[] | undefined, name: string): string | undefined {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return all.find((value) => value.startsWith(`${name}=`) && !value.includes("Max-Age=0"))?.split(";", 1)[0];
}

async function signIn(context: Awaited<ReturnType<typeof makeApp>>, email: string, name: string) {
  context.google.current.email = email;
  context.google.current.name = name;
  const start = await context.app.inject({ method: "GET", url: "/api/auth/google/start" });
  const state = new URL(String(start.headers.location)).searchParams.get("state") ?? "";
  const flow = cookieFrom(start.headers["set-cookie"], "wiwo_nodes_session_oauth");
  const callback = await context.app.inject({
    method: "GET",
    url: `/api/auth/google/callback?code=codigo&state=${state}`,
    headers: flow ? { cookie: flow } : {},
  });
  return { callback, session: cookieFrom(callback.headers["set-cookie"], "wiwo_nodes_session") };
}

async function me(app: SacFlowApp, session: string | undefined) {
  return app.inject({ method: "GET", url: "/api/me", headers: session ? { cookie: session } : {} });
}

async function setRole(app: SacFlowApp, session: string | undefined, email: string, role: string | null) {
  return app.inject({ method: "PUT", url: "/api/admin/users/role", headers: session ? { cookie: session } : {}, payload: { email, role } });
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Usuarios y roles", () => {
  it("un admin cambia el rol de otra persona y rige sin volver a iniciar sesión", async () => {
    const context = await makeApp();
    const admin = await signIn(context, "jefa@demo.test", "Jefa");
    const agent = await signIn(context, "agente@demo.test", "Agente Demo");
    expect((await me(context.app, agent.session)).json().data.role).toBe("agent");

    const listing = await context.app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: admin.session! } });
    expect(listing.statusCode).toBe(200);
    const agentRow = listing.json().data.users.find((user: { email: string }) => user.email === "agente@demo.test");
    expect(agentRow).toMatchObject({ name: "Agente Demo", effectiveRole: "agent", serverRole: "agent", serverSource: "domain", locked: false });
    expect(agentRow.lastSignInAt).toBeTruthy();
    expect(listing.json().data.users.find((user: { email: string }) => user.email === "jefa@demo.test"))
      .toMatchObject({ effectiveRole: "admin", serverSource: "server_admin", locked: true, isSelf: true });

    const promoted = await setRole(context.app, admin.session, "Agente@Demo.test", "supervisor");
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().data.user).toMatchObject({ email: "agente@demo.test", effectiveRole: "supervisor", assignedRole: "supervisor", assignedBy: "Jefa" });
    expect((await me(context.app, agent.session)).json().data.role).toBe("supervisor");

    const restored = await setRole(context.app, admin.session, "agente@demo.test", null);
    expect(restored.json().data.user).toMatchObject({ effectiveRole: "agent" });
    expect(restored.json().data.user.assignedRole).toBeUndefined();
    expect((await me(context.app, agent.session)).json().data.role).toBe("agent");
  });

  it("quitar el acceso corta la sesión activa y bloquea el siguiente inicio", async () => {
    const context = await makeApp();
    const admin = await signIn(context, "jefa@demo.test", "Jefa");
    const agent = await signIn(context, "agente@demo.test", "Agente");
    expect((await setRole(context.app, admin.session, "agente@demo.test", "none")).statusCode).toBe(200);

    const blocked = await me(context.app, agent.session);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("ACCESS_REVOKED");
    const again = await signIn(context, "agente@demo.test", "Agente");
    expect(String(again.callback.headers.location)).toContain("login_error=ACCESS_REVOKED");
  });

  it("dar un rol a un correo fuera de los dominios le permite entrar", async () => {
    const context = await makeApp();
    const admin = await signIn(context, "jefa@demo.test", "Jefa");
    const before = await signIn(context, "externa@otro.test", "Externa");
    expect(String(before.callback.headers.location)).toContain("login_error=ACCOUNT_NOT_ALLOWED");

    expect((await setRole(context.app, admin.session, "externa@otro.test", "viewer")).statusCode).toBe(200);
    const after = await signIn(context, "externa@otro.test", "Externa");
    expect((await me(context.app, after.session)).json().data.role).toBe("viewer");
  });

  it("protege a los admins del entorno y el propio rol, y la lista de supervisores se puede ajustar", async () => {
    const context = await makeApp();
    const admin = await signIn(context, "jefa@demo.test", "Jefa");
    const self = await setRole(context.app, admin.session, "jefa@demo.test", "agent");
    expect(self.statusCode).toBe(409);
    expect(self.json().error.code).toBe("ACCESS_LOCKED");

    // Un admin asignado desde la app no puede quitarle el rol a un admin del entorno.
    expect((await setRole(context.app, admin.session, "otra@demo.test", "admin")).statusCode).toBe(200);
    const second = await signIn(context, "otra@demo.test", "Otra");
    expect((await me(context.app, second.session)).json().data.role).toBe("admin");
    const demote = await setRole(context.app, second.session, "jefa@demo.test", "viewer");
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error.message).toContain("SAC_FLOW_AUTH_ADMIN_EMAILS");

    const supervisor = await signIn(context, "super@demo.test", "Super");
    expect((await me(context.app, supervisor.session)).json().data.role).toBe("supervisor");
    expect((await setRole(context.app, admin.session, "super@demo.test", "agent")).statusCode).toBe(200);
    expect((await me(context.app, supervisor.session)).json().data.role).toBe("agent");
  });

  it("solo un admin ve y cambia roles, y el cuerpo se valida", async () => {
    const context = await makeApp();
    const admin = await signIn(context, "jefa@demo.test", "Jefa");
    const supervisor = await signIn(context, "super@demo.test", "Super");
    expect((await context.app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: supervisor.session! } })).statusCode).toBe(403);
    expect((await setRole(context.app, supervisor.session, "agente@demo.test", "admin")).statusCode).toBe(403);
    expect((await setRole(context.app, admin.session, "no-es-correo", "agent")).statusCode).toBe(400);
    expect((await setRole(context.app, admin.session, "agente@demo.test", "superadmin")).statusCode).toBe(400);
  });
});

async function adminCall(app: SacFlowApp, session: string | undefined, method: "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({ method, url, headers: session ? { cookie: session } : {}, ...(payload ? { payload: payload as Record<string, unknown> } : {}) });
}

describe("Roles editables", () => {
  it("quitar Exportar al rol Supervisor lo bloquea para todos los supervisores y restablecerlo lo devuelve", async () => {
    const context = await makeApp();
    const admin = await signIn(context, "jefa@demo.test", "Jefa");
    const supervisor = await signIn(context, "super@demo.test", "Super");
    const exportUrl = "/api/export/xlsx";
    expect((await context.app.inject({ method: "GET", url: exportUrl, headers: { cookie: supervisor.session! } })).statusCode).toBe(200);

    const listing = await context.app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: admin.session! } });
    const supervisorRole = listing.json().data.roles.find((role: { id: string }) => role.id === "supervisor");
    expect(supervisorRole.permissions).toContain("export.xlsx");
    const withoutExport = supervisorRole.permissions.filter((permission: string) => permission !== "export.xlsx");

    const updated = await adminCall(context.app, admin.session, "PUT", "/api/admin/roles/supervisor", { permissions: withoutExport });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.roles.find((role: { id: string }) => role.id === "supervisor")).toMatchObject({ customized: true });

    const denied = await context.app.inject({ method: "GET", url: exportUrl, headers: { cookie: supervisor.session! } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.message).toContain("Exportar a Excel");
    expect((await me(context.app, supervisor.session)).json().data.permissions).not.toContain("export.xlsx");
    // El resto de lo que hace un supervisor sigue igual.
    expect((await context.app.inject({ method: "GET", url: "/api/metrics", headers: { cookie: supervisor.session! } })).statusCode).toBe(200);

    expect((await adminCall(context.app, admin.session, "DELETE", "/api/admin/roles/supervisor")).statusCode).toBe(200);
    expect((await context.app.inject({ method: "GET", url: exportUrl, headers: { cookie: supervisor.session! } })).statusCode).toBe(200);
  });

  it("un rol propio se asigna a una persona, rige sin volver a entrar y no se borra mientras esté en uso", async () => {
    const context = await makeApp();
    const admin = await signIn(context, "jefa@demo.test", "Jefa");
    const agent = await signIn(context, "agente@demo.test", "Agente");

    const created = await adminCall(context.app, admin.session, "POST", "/api/admin/roles", {
      name: "Supervisor sin exportar",
      baseRole: "supervisor",
      // "users.manage" no existe como permiso delegable: se descarta.
      permissions: ["inbox.reply", "inbox.triage", "inbox.assign", "inbox.assign_others", "metrics.read", "users.manage"],
    });
    expect(created.statusCode).toBe(200);
    const roleId = created.json().data.roleId as string;
    const role = created.json().data.roles.find((item: { id: string }) => item.id === roleId);
    expect(role).toMatchObject({ name: "Supervisor sin exportar", baseRole: "supervisor", builtIn: false });
    expect(role.permissions).toEqual(["inbox.reply", "inbox.triage", "inbox.assign", "inbox.assign_others", "metrics.read"]);

    expect((await adminCall(context.app, admin.session, "POST", "/api/admin/roles", { name: "supervisor sin EXPORTAR", baseRole: "agent", permissions: [] })).statusCode).toBe(409);

    expect((await setRole(context.app, admin.session, "agente@demo.test", roleId)).statusCode).toBe(200);
    const profile = (await me(context.app, agent.session)).json().data;
    expect(profile).toMatchObject({ role: "supervisor", roleId, roleName: "Supervisor sin exportar" });
    expect((await context.app.inject({ method: "GET", url: "/api/export/xlsx", headers: { cookie: agent.session! } })).statusCode).toBe(403);
    expect((await context.app.inject({ method: "GET", url: "/api/metrics", headers: { cookie: agent.session! } })).statusCode).toBe(200);
    // Un rol propio basado en Supervisor no hereda nada de Admin.
    expect((await context.app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: agent.session! } })).statusCode).toBe(403);

    const inUse = await adminCall(context.app, admin.session, "DELETE", `/api/admin/roles/${roleId}`);
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().error.code).toBe("ROLE_IN_USE");

    expect((await setRole(context.app, admin.session, "agente@demo.test", null)).statusCode).toBe(200);
    expect((await adminCall(context.app, admin.session, "DELETE", `/api/admin/roles/${roleId}`)).statusCode).toBe(200);
    expect((await me(context.app, agent.session)).json().data).toMatchObject({ role: "agent", roleId: "agent" });
  });

  it("Admin no se edita, el rol debe existir y solo un admin gestiona roles", async () => {
    const context = await makeApp();
    const admin = await signIn(context, "jefa@demo.test", "Jefa");
    const supervisor = await signIn(context, "super@demo.test", "Super");
    expect((await adminCall(context.app, admin.session, "PUT", "/api/admin/roles/admin", { permissions: [] })).json().error.code).toBe("ROLE_LOCKED");
    expect((await adminCall(context.app, admin.session, "DELETE", "/api/admin/roles/admin")).statusCode).toBe(409);
    const unknown = await setRole(context.app, admin.session, "agente@demo.test", "rol-inexistente");
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe("ROLE_NOT_FOUND");
    expect((await adminCall(context.app, supervisor.session, "POST", "/api/admin/roles", { name: "Otro", baseRole: "agent", permissions: [] })).statusCode).toBe(403);
    expect((await adminCall(context.app, supervisor.session, "PUT", "/api/admin/roles/agent", { permissions: [] })).statusCode).toBe(403);
  });
});

describe("Permisos por persona", () => {
  async function setPermissions(app: SacFlowApp, session: string | undefined, email: string, permissions: string[] | null) {
    return app.inject({ method: "PUT", url: "/api/admin/users/permissions", headers: session ? { cookie: session } : {}, payload: { email, permissions } });
  }

  it("quita Exportar a un supervisor en específico sin tocar su rol ni a los demás", async () => {
    const context = await makeApp();
    const admin = await signIn(context, "jefa@demo.test", "Jefa");
    const supervisor = await signIn(context, "super@demo.test", "Super");
    const other = await signIn(context, "otro@demo.test", "Otro");
    expect((await setRole(context.app, admin.session, "otro@demo.test", "supervisor")).statusCode).toBe(200);

    const listing = (await context.app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: admin.session! } })).json().data;
    const row = listing.users.find((user: { email: string }) => user.email === "super@demo.test");
    const desired = row.permissions.filter((permission: string) => permission !== "export.xlsx");
    const saved = await setPermissions(context.app, admin.session, "super@demo.test", desired);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.user).toMatchObject({ effectiveRole: "supervisor", permissionsAdd: [], permissionsRemove: ["export.xlsx"], permissionsUpdatedBy: "Jefa" });
    expect(saved.json().data.user.permissions).not.toContain("export.xlsx");

    expect((await context.app.inject({ method: "GET", url: "/api/export/xlsx", headers: { cookie: supervisor.session! } })).statusCode).toBe(403);
    expect((await context.app.inject({ method: "GET", url: "/api/metrics", headers: { cookie: supervisor.session! } })).statusCode).toBe(200);
    expect((await me(context.app, supervisor.session)).json().data).toMatchObject({ role: "supervisor", roleName: "Supervisor" });
    // Otro supervisor no se ve afectado.
    expect((await context.app.inject({ method: "GET", url: "/api/export/xlsx", headers: { cookie: other.session! } })).statusCode).toBe(200);

    const cleared = await setPermissions(context.app, admin.session, "super@demo.test", null);
    expect(cleared.json().data.user).toMatchObject({ permissionsAdd: [], permissionsRemove: [] });
    expect((await context.app.inject({ method: "GET", url: "/api/export/xlsx", headers: { cookie: supervisor.session! } })).statusCode).toBe(200);
  });

  it("agrega un permiso a un agente y el ajuste sobrevive a un cambio de rol", async () => {
    const context = await makeApp();
    const admin = await signIn(context, "jefa@demo.test", "Jefa");
    const agent = await signIn(context, "agente@demo.test", "Agente");
    expect((await context.app.inject({ method: "GET", url: "/api/export/xlsx", headers: { cookie: agent.session! } })).statusCode).toBe(403);

    const listing = (await context.app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: admin.session! } })).json().data;
    const row = listing.users.find((user: { email: string }) => user.email === "agente@demo.test");
    const saved = await setPermissions(context.app, admin.session, "agente@demo.test", [...row.permissions, "export.xlsx"]);
    expect(saved.json().data.user).toMatchObject({ effectiveRole: "agent", permissionsAdd: ["export.xlsx"], permissionsRemove: [] });
    expect((await context.app.inject({ method: "GET", url: "/api/export/xlsx", headers: { cookie: agent.session! } })).statusCode).toBe(200);

    expect((await setRole(context.app, admin.session, "agente@demo.test", "viewer")).statusCode).toBe(200);
    const asViewer = (await me(context.app, agent.session)).json().data;
    expect(asViewer).toMatchObject({ role: "viewer" });
    expect(asViewer.permissions).toEqual(["export.xlsx"]);
  });

  it("no ajusta a Admin, a quien no tiene acceso ni a uno mismo", async () => {
    const context = await makeApp();
    const admin = await signIn(context, "jefa@demo.test", "Jefa");
    await signIn(context, "agente@demo.test", "Agente");
    expect((await setRole(context.app, admin.session, "otra@demo.test", "admin")).statusCode).toBe(200);
    expect((await setPermissions(context.app, admin.session, "otra@demo.test", [])).json().error.code).toBe("ADMIN_HAS_ALL");
    expect((await setRole(context.app, admin.session, "agente@demo.test", "none")).statusCode).toBe(200);
    expect((await setPermissions(context.app, admin.session, "agente@demo.test", [])).json().error.code).toBe("ACCESS_REVOKED");
    expect((await setPermissions(context.app, admin.session, "jefa@demo.test", [])).json().error.code).toBe("ACCESS_LOCKED");
    expect((await setPermissions(context.app, admin.session, "nadie@demo.test", [])).statusCode).toBe(404);
  });
});

describe("Admin principal y admin asignado", () => {
  async function setPermissions(app: SacFlowApp, session: string | undefined, email: string, permissions: string[] | null) {
    return app.inject({ method: "PUT", url: "/api/admin/users/permissions", headers: session ? { cookie: session } : {}, payload: { email, permissions } });
  }
  async function listing(app: SacFlowApp, session: string | undefined) {
    return (await app.inject({ method: "GET", url: "/api/admin/users", headers: session ? { cookie: session } : {} })).json().data;
  }

  it("solo un admin principal da el rol Admin o cambia a otro admin", async () => {
    const context = await makeApp();
    const master = await signIn(context, "jefa@demo.test", "Jefa");
    await signIn(context, "agente@demo.test", "Agente Demo");
    expect((await setRole(context.app, master.session, "segunda@demo.test", "admin")).statusCode).toBe(200);
    expect((await setRole(context.app, master.session, "tercera@demo.test", "admin")).statusCode).toBe(200);
    const assigned = await signIn(context, "segunda@demo.test", "Segunda");

    expect((await listing(context.app, master.session)).viewer).toEqual({ masterAdmin: true });
    const view = await listing(context.app, assigned.session);
    expect(view.viewer).toEqual({ masterAdmin: false });
    expect(view.masterOnlyPermissions).toEqual(["brands.manage", "automations.edit", "workflow.publish", "inbox.archive_expired", "export.xlsx"]);

    const promote = await setRole(context.app, assigned.session, "agente@demo.test", "admin");
    expect(promote.statusCode).toBe(403);
    expect(promote.json().error.code).toBe("MASTER_ADMIN_REQUIRED");
    const demote = await setRole(context.app, assigned.session, "tercera@demo.test", "agent");
    expect(demote.statusCode).toBe(403);
    expect(demote.json().error.code).toBe("MASTER_ADMIN_REQUIRED");

    // El principal sí puede quitarle el rol a un admin asignado.
    expect((await setRole(context.app, master.session, "tercera@demo.test", "agent")).statusCode).toBe(200);
  });

  it("un admin asignado no reparte permisos sensibles, pero sí puede quitarlos", async () => {
    const context = await makeApp();
    const master = await signIn(context, "jefa@demo.test", "Jefa");
    await signIn(context, "agente@demo.test", "Agente Demo");
    await signIn(context, "super@demo.test", "Super Demo");
    await setRole(context.app, master.session, "segunda@demo.test", "admin");
    const assigned = await signIn(context, "segunda@demo.test", "Segunda");

    // Supervisor trae Exportar y Archivar, que el agente no tenía.
    const toSupervisor = await setRole(context.app, assigned.session, "agente@demo.test", "supervisor");
    expect(toSupervisor.statusCode).toBe(403);
    expect(toSupervisor.json().error.code).toBe("MASTER_ONLY_PERMISSION");
    expect(toSupervisor.json().error.message).toContain("Exportar a Excel");
    // Bajar de rol sí se puede.
    expect((await setRole(context.app, assigned.session, "agente@demo.test", "viewer")).statusCode).toBe(200);

    const addExport = await setPermissions(context.app, assigned.session, "agente@demo.test", ["export.xlsx"]);
    expect(addExport.statusCode).toBe(403);
    expect(addExport.json().error.code).toBe("MASTER_ONLY_PERMISSION");
    // Un permiso no sensible sí lo puede dar.
    expect((await setPermissions(context.app, assigned.session, "agente@demo.test", ["inbox.reply"])).statusCode).toBe(200);

    // Quitar Exportar a un supervisor está permitido.
    const supervisor = (await listing(context.app, master.session)).users.find((user: { email: string }) => user.email === "super@demo.test");
    const withoutExport = supervisor.permissions.filter((permission: string) => permission !== "export.xlsx");
    expect((await setPermissions(context.app, assigned.session, "super@demo.test", withoutExport)).statusCode).toBe(200);
    // Y devolvérselo ya no: solo el principal.
    expect((await setPermissions(context.app, assigned.session, "super@demo.test", supervisor.permissions)).statusCode).toBe(403);
    expect((await setPermissions(context.app, master.session, "super@demo.test", supervisor.permissions)).statusCode).toBe(200);
    expect((await setRole(context.app, master.session, "agente@demo.test", "supervisor")).statusCode).toBe(200);
  });

  it("solo un admin principal crea, edita o restablece roles", async () => {
    const context = await makeApp();
    const master = await signIn(context, "jefa@demo.test", "Jefa");
    await setRole(context.app, master.session, "segunda@demo.test", "admin");
    const assigned = await signIn(context, "segunda@demo.test", "Segunda");
    const headers = { cookie: assigned.session! };

    const create = await context.app.inject({ method: "POST", url: "/api/admin/roles", headers, payload: { name: "Agente plus", baseRole: "agent", permissions: ["inbox.reply"] } });
    expect(create.statusCode).toBe(403);
    expect(create.json().error.code).toBe("MASTER_ADMIN_REQUIRED");
    expect((await context.app.inject({ method: "PUT", url: "/api/admin/roles/agent", headers, payload: { permissions: ["inbox.reply"] } })).statusCode).toBe(403);
    expect((await context.app.inject({ method: "DELETE", url: "/api/admin/roles/supervisor", headers })).statusCode).toBe(403);

    const masterCreate = await context.app.inject({ method: "POST", url: "/api/admin/roles", headers: { cookie: master.session! }, payload: { name: "Agente plus", baseRole: "agent", permissions: ["inbox.reply"] } });
    expect(masterCreate.statusCode).toBe(200);
  });
});
