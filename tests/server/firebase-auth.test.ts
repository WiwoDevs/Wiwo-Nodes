import { describe, expect, it } from "vitest";
import {
  FirebaseAuthError,
  normalizeEmail,
  resolveActorFromAllowedUser,
  type AllowedUserRecord,
  type FirebaseAuthConfig,
  type FirebaseSessionUser,
} from "../../server/firebase-auth.js";

const config: FirebaseAuthConfig = {
  enabled: true,
  cookieName: "wiwo_nodes_session",
  sessionTtlMs: 432_000_000,
  allowedUsersCollection: "allowed_users",
  requiredPermission: "sac",
  adminPermission: "admin",
  defaultRole: "agent",
  tenantId: "wiwo",
};

const session: FirebaseSessionUser = {
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
    const actor = resolveActorFromAllowedUser(allowedUser(), session, config);
    expect(actor.role).toBe("agent");
    expect(actor.brandIds).toBe("all");
    expect(actor.source).toBe("firebase");
    expect(actor.tenantId).toBe("wiwo");
    expect(actor.userId).toBe("uid-1");
  });

  it("otorga rol admin a quien tiene el permiso de administración", () => {
    const actor = resolveActorFromAllowedUser(allowedUser({ permissions: ["admin"] }), session, config);
    expect(actor.role).toBe("admin");
  });

  it("rechaza a un usuario autenticado que no tiene el permiso del módulo", () => {
    expect(() => resolveActorFromAllowedUser(
      allowedUser({ permissions: ["reports", "campaigns"] }),
      session,
      config,
    )).toThrow(FirebaseAuthError);
  });

  it("acepta el override explícito de rol del documento", () => {
    const actor = resolveActorFromAllowedUser(
      allowedUser({ permissions: ["sac"], nodesRole: "supervisor" }),
      session,
      config,
    );
    expect(actor.role).toBe("supervisor");
  });

  it("restringe el alcance de marcas de un no-admin", () => {
    const actor = resolveActorFromAllowedUser(
      allowedUser({ permissions: ["sac"], nodesBrandIds: ["brand-01", "brand-02"] }),
      session,
      config,
    );
    expect(actor.brandIds).toEqual(["brand-01", "brand-02"]);
  });

  it("no permite recortar el portafolio de un admin mediante el override", () => {
    const actor = resolveActorFromAllowedUser(
      allowedUser({ permissions: ["admin"], nodesBrandIds: ["brand-01"] }),
      session,
      config,
    );
    expect(actor.brandIds).toBe("all");
  });

  it("ignora diferencias de mayúsculas en los permisos guardados", () => {
    const actor = resolveActorFromAllowedUser(allowedUser({ permissions: ["SAC"] }), session, config);
    expect(actor.role).toBe("agent");
  });
});
