import { describe, expect, it } from "vitest";
import {
  IdentityError,
  normalizeEmail,
  resolveActorFromAllowedUser,
  type AllowedUserRecord,
  type IdentityConfig,
  type SessionUser,
} from "../../server/identity.js";
import { createSigner, findAllowedUser } from "../../server/identity.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const config: IdentityConfig = {
  enabled: true,
  cookieName: "wiwo_nodes_session",
  sessionTtlMs: 432_000_000,
  allowedDomains: [],
  postLoginRedirect: "/",
  requiredPermission: "sac",
  adminPermission: "admin",
  defaultRole: "agent",
  tenantId: "wiwo",
};

const session: SessionUser = {
  uid: "uid-1",
  email: "agente@wiwo.me",
  name: "Agente Uno",
};

function allowedUser(overrides: Partial<AllowedUserRecord> = {}): AllowedUserRecord {
  return {
    email: "agente@wiwo.me",
    name: "Agente Uno",
    permissions: ["sac"],
    ...overrides,
  };
}

describe("normalizeEmail", () => {
  it("normaliza mayúsculas y espacios para usarlo como id de documento", () => {
    expect(normalizeEmail("  Agente@Wiwo.ME ")).toBe("agente@wiwo.me");
  });
});

describe("resolveActorFromAllowedUser", () => {
  it("otorga el rol por defecto a quien tiene el permiso requerido", () => {
    const actor = resolveActorFromAllowedUser(allowedUser(), session, config, "google");
    expect(actor.role).toBe("agent");
    expect(actor.brandIds).toBe("all");
    expect(actor.source).toBe("google");
    expect(actor.tenantId).toBe("wiwo");
    expect(actor.userId).toBe("uid-1");
  });

  it("otorga rol admin a quien tiene el permiso de administración", () => {
    const actor = resolveActorFromAllowedUser(allowedUser({ permissions: ["admin"] }), session, config, "google");
    expect(actor.role).toBe("admin");
  });

  it("rechaza a un usuario autenticado que no tiene el permiso del módulo", () => {
    expect(() => resolveActorFromAllowedUser(
      allowedUser({ permissions: ["reports", "campaigns"] }),
      session,
      config,
      "google",
    )).toThrow(IdentityError);
  });

  it("acepta el override explícito de rol del documento", () => {
    const actor = resolveActorFromAllowedUser(
      allowedUser({ permissions: ["sac"], nodesRole: "supervisor" }),
      session,
      config,
      "google",
    );
    expect(actor.role).toBe("supervisor");
  });

  it("restringe el alcance de marcas de un no-admin", () => {
    const actor = resolveActorFromAllowedUser(
      allowedUser({ permissions: ["sac"], nodesBrandIds: ["brand-01", "brand-02"] }),
      session,
      config,
      "google",
    );
    expect(actor.brandIds).toEqual(["brand-01", "brand-02"]);
  });

  it("no permite recortar el portafolio de un admin mediante el override", () => {
    const actor = resolveActorFromAllowedUser(
      allowedUser({ permissions: ["admin"], nodesBrandIds: ["brand-01"] }),
      session,
      config,
      "google",
    );
    expect(actor.brandIds).toBe("all");
  });

  it("ignora diferencias de mayúsculas en los permisos guardados", () => {
    const actor = resolveActorFromAllowedUser(allowedUser({ permissions: ["SAC"] }), session, config, "google");
    expect(actor.role).toBe("agent");
  });
});

describe("findAllowedUser", () => {
  async function withAllowlist(users: unknown[], run: (file: string) => Promise<void>) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-allowlist-"));
    try {
      const file = path.join(directory, "allowed-users.json");
      await writeFile(file, JSON.stringify({ users }));
      await run(file);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it("encuentra al usuario listado sin importar mayúsculas", async () => {
    await withAllowlist([{ email: "Admin@Demo.test", name: "Admin", permissions: ["admin"] }], async (file) => {
      const user = await findAllowedUser({ ...config, allowedUsersFile: file }, "admin@demo.test", null);
      expect(user).toMatchObject({ email: "admin@demo.test", permissions: ["admin"], name: "Admin" });
    });
  });

  it("admite las listas del entorno: admins con rol admin y permitidos con el permiso mínimo", async () => {
    const withLists = { ...config, adminEmails: ["jefa@demo.test"], allowedEmails: ["agente@demo.test"] };
    expect((await findAllowedUser(withLists, "Jefa@Demo.test", null)).permissions).toEqual(["admin"]);
    expect((await findAllowedUser(withLists, "agente@demo.test", null)).permissions).toEqual(["sac"]);
    await expect(findAllowedUser(withLists, "otra@demo.test", null)).rejects.toMatchObject({ code: "ACCOUNT_NOT_ALLOWED" });
  });

  it("admite por dominio permitido con el permiso mínimo", async () => {
    const user = await findAllowedUser({ ...config, allowedDomains: ["demo.test"] }, "nueva@demo.test", "Nueva");
    expect(user).toMatchObject({ email: "nueva@demo.test", permissions: ["sac"], name: "Nueva" });
  });

  it("rechaza un correo que no está listado ni pertenece a un dominio permitido", async () => {
    await expect(findAllowedUser({ ...config, allowedDomains: ["demo.test"] }, "otro@ajeno.test", null))
      .rejects.toMatchObject({ status: 403, code: "ACCOUNT_NOT_ALLOWED" });
  });

  it("falla cerrado sin archivo ni dominios", async () => {
    await expect(findAllowedUser({ ...config, allowedUsersFile: path.join(os.tmpdir(), "no-existe-allowlist.json") }, "a@demo.test", null))
      .rejects.toMatchObject({ code: "ACCOUNT_NOT_ALLOWED" });
  });
});

describe("createSigner", () => {
  it("abre lo que sella y rechaza valores alterados o vencidos", () => {
    const signer = createSigner("secreto-de-prueba-de-al-menos-32-caracteres");
    const sealed = signer.seal({ email: "a@demo.test", exp: Date.now() + 60_000 });
    expect(signer.open<{ email: string }>(sealed)?.email).toBe("a@demo.test");
    expect(signer.open(sealed.replace(/.$/, (char) => (char === "a" ? "b" : "a")))).toBeNull();
    expect(signer.open(signer.seal({ email: "a@demo.test", exp: Date.now() - 1 }))).toBeNull();
    expect(createSigner("otro-secreto-de-prueba-de-al-menos-32-chars").open(sealed)).toBeNull();
  });
});
