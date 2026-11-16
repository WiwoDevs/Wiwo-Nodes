/**
 * PostgresRepository: "Usuarios y roles" sobre la tabla user_access. El pool simulado guarda
 * las filas en memoria interpretando solo las sentencias de este módulo, para comprobar que
 * cada operación va acotada a la organización, conserva el último ingreso y elimina registros
 * que quedan sin rol ni ingreso.
 */
import { describe, expect, it } from "vitest";
import { PostgresRepository, type PgPoolLike } from "../../server/postgres-repository.js";

type Row = {
  email: string;
  display_name: string | null;
  role: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  last_sign_in_at: string | null;
};

function fakeUserAccessPool() {
  const table = new Map<string, Row>();
  const statements: string[] = [];
  const result = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const client = {
    async query(sql: string, params: readonly unknown[] = []) {
      const text = sql.replace(/\s+/g, " ").trim();
      statements.push(text);
      if (text.includes("FROM organizations")) return result([{ id: "organization-1" }]);
      if (text.startsWith("SELECT email, display_name, role")) {
        expect(params[0]).toBe("organization-1");
        return result([...table.values()].sort((left, right) => left.email.localeCompare(right.email)));
      }
      if (text.startsWith("INSERT INTO user_access") && text.includes("role, assigned_by")) {
        const [organizationId, email, name, role, assignedBy, assignedAt] = params as [string, string, string | null, string | null, string | null, string | null];
        expect(organizationId).toBe("organization-1");
        const current = table.get(email);
        const row: Row = {
          email,
          display_name: name ?? current?.display_name ?? null,
          role,
          assigned_by: assignedBy,
          assigned_at: assignedAt,
          last_sign_in_at: current?.last_sign_in_at ?? null,
        };
        table.set(email, row);
        return result([row]);
      }
      if (text.startsWith("INSERT INTO user_access") && text.includes("last_sign_in_at")) {
        const [organizationId, email, name, at] = params as [string, string, string | null, string];
        expect(organizationId).toBe("organization-1");
        const current = table.get(email);
        table.set(email, {
          email,
          display_name: name ?? current?.display_name ?? null,
          role: current?.role ?? null,
          assigned_by: current?.assigned_by ?? null,
          assigned_at: current?.assigned_at ?? null,
          last_sign_in_at: at,
        });
        return result([]);
      }
      if (text.startsWith("DELETE FROM user_access")) {
        expect(params[0]).toBe("organization-1");
        table.delete(String(params[1]));
        return result([]);
      }
      return result([]);
    },
    release() {},
  };
  const pool = { connect: async () => client, query: client.query.bind(client) } as unknown as PgPoolLike;
  const repository = new PostgresRepository({
    connectionString: "postgres://unused",
    encryptionKey: "postgres-test-encryption-key",
    organizationSlug: "test",
    organizationName: "Test",
    pool,
  });
  return { repository, table, statements };
}

describe("PostgresRepository: user_access", () => {
  it("asigna, conserva el último ingreso y elimina la fila al quitar un rol sin ingresos", async () => {
    const { repository, table, statements } = fakeUserAccessPool();

    await repository.recordUserSignIn({ email: "agente@demo.test", name: "Agente", at: "2026-11-16T12:00:00.000Z" });
    const assigned = await repository.setUserAccessRole({
      email: "agente@demo.test",
      role: "supervisor",
      assignedBy: "Jefa",
      at: "2026-11-16T13:00:00.000Z",
    });
    expect(assigned).toEqual({
      email: "agente@demo.test",
      name: "Agente",
      role: "supervisor",
      assignedBy: "Jefa",
      assignedAt: "2026-11-16T13:00:00.000Z",
      lastSignInAt: "2026-11-16T12:00:00.000Z",
    });
    // Las escrituras de rol toman el candado de la organización.
    expect(statements.some((statement) => statement.includes("pg_advisory_xact_lock"))).toBe(true);

    const cleared = await repository.setUserAccessRole({ email: "agente@demo.test", role: null, assignedBy: "Jefa", at: "2026-11-16T14:00:00.000Z" });
    expect(cleared).toEqual({ email: "agente@demo.test", name: "Agente", lastSignInAt: "2026-11-16T12:00:00.000Z" });
    expect(table.has("agente@demo.test")).toBe(true);

    await repository.setUserAccessRole({ email: "nueva@demo.test", role: "viewer", assignedBy: "Jefa", at: "2026-11-16T15:00:00.000Z" });
    expect(await repository.setUserAccessRole({ email: "nueva@demo.test", role: null, assignedBy: "Jefa", at: "2026-11-16T16:00:00.000Z" })).toBeUndefined();
    expect(table.has("nueva@demo.test")).toBe(false);

    expect((await repository.listUserAccess()).map((record) => record.email)).toEqual(["agente@demo.test"]);
  });
});

describe("PostgresRepository: access_roles", () => {
  it("guarda, lista y borra roles acotados a la organización, normalizando los permisos", async () => {
    const table = new Map<string, Record<string, unknown>>();
    const statements: string[] = [];
    const result = (rows: unknown[]) => ({ rows, rowCount: rows.length });
    const client = {
      async query(sql: string, params: readonly unknown[] = []) {
        const text = sql.replace(/\s+/g, " ").trim();
        statements.push(text);
        if (text.includes("FROM organizations")) return result([{ id: "organization-1" }]);
        if (text.startsWith("SELECT role_id")) {
          expect(params[0]).toBe("organization-1");
          return result([...table.values()]);
        }
        if (text.startsWith("INSERT INTO access_roles")) {
          const [organizationId, roleId, name, baseRole, permissions, builtIn, updatedBy, updatedAt] = params as [string, string, string, string, string, boolean, string | null, string | null];
          expect(organizationId).toBe("organization-1");
          const row = { role_id: roleId, name, base_role: baseRole, permissions: JSON.parse(permissions), built_in: builtIn, updated_by: updatedBy, updated_at: updatedAt ?? "2026-11-16T00:00:00.000Z" };
          table.set(roleId, row);
          return result([row]);
        }
        if (text.startsWith("DELETE FROM access_roles")) {
          expect(params[0]).toBe("organization-1");
          const existed = table.delete(String(params[1]));
          return { rows: [], rowCount: existed ? 1 : 0 };
        }
        return result([]);
      },
      release() {},
    };
    const pool = { connect: async () => client, query: client.query.bind(client) } as unknown as PgPoolLike;
    const repository = new PostgresRepository({ connectionString: "postgres://unused", encryptionKey: "postgres-test-encryption-key", organizationSlug: "test", organizationName: "Test", pool });

    const saved = await repository.saveAccessRole({
      id: "rol-supervisor-sin-exportar",
      name: "Supervisor sin exportar",
      baseRole: "supervisor",
      permissions: ["metrics.read", "inbox.reply"],
      builtIn: false,
      updatedBy: "Jefa",
      updatedAt: "2026-11-16T10:00:00.000Z",
    });
    expect(saved).toEqual({
      id: "rol-supervisor-sin-exportar",
      name: "Supervisor sin exportar",
      baseRole: "supervisor",
      permissions: ["inbox.reply", "metrics.read"],
      builtIn: false,
      updatedBy: "Jefa",
      updatedAt: "2026-11-16T10:00:00.000Z",
    });
    expect(statements.some((statement) => statement.includes("pg_advisory_xact_lock"))).toBe(true);
    table.get("rol-supervisor-sin-exportar")!.permissions = ["metrics.read", "permiso-desconocido"];
    expect((await repository.listAccessRoles())[0]!.permissions).toEqual(["metrics.read"]);
    expect(await repository.deleteAccessRole("rol-supervisor-sin-exportar")).toBe(true);
    expect(await repository.deleteAccessRole("rol-supervisor-sin-exportar")).toBe(false);
  });
});
