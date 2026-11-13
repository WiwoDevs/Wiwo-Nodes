/**
 * Las rutas de marcas/cuentas y del workflow no deben leer ni reescribir el store completo:
 * en producción hay decenas de miles de interacciones y cada reescritura bloqueaba la API.
 * Aquí se verifica (1) qué métodos del repositorio llaman las rutas y (2) qué SQL emite el
 * repositorio PostgreSQL para esas mutaciones, con un cliente simulado y datos ficticios.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { JsonRepository } from "../../server/repository.js";
import type { SacFlowRepository } from "../../server/repository-contract.js";
import { PostgresRepository, type PgPoolLike } from "../../server/postgres-repository.js";
import { createDemoStore } from "../../server/seed.js";
import type { DataStore, Interaction } from "../../server/types.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function admin(brandIds = "*") {
  return {
    "x-sac-user-id": "user-admin",
    "x-sac-user-name": "Usuario admin",
    "x-sac-tenant-id": "tenant-test",
    "x-sac-role": "admin",
    "x-sac-brand-ids": brandIds,
  };
}

/** Envuelve el repositorio y registra qué métodos del contrato invoca la aplicación. */
function recordingRepository(target: SacFlowRepository): { repository: SacFlowRepository; calls: string[] } {
  const calls: string[] = [];
  const repository = new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(property));
        return (value as (...values: unknown[]) => unknown).apply(object, args);
      };
    },
  });
  return { repository, calls };
}

async function makeRecordedApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-catalog-"));
  directories.push(directory);
  const dataFile = path.join(directory, "store.json");
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: dataFile,
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
  }, directory);
  const recorded = recordingRepository(new JsonRepository(dataFile));
  const app = await buildApp({ config, repository: recorded.repository });
  apps.push(app);
  recorded.calls.length = 0;
  return { app, calls: recorded.calls };
}

const FULL_STORE_METHODS = ["snapshot", "mutate"];

describe("rutas de catálogo sin store completo", () => {
  it("desactivar una marca usa mutateCatalog y no lee ni reescribe el store completo", async () => {
    const { app, calls } = await makeRecordedApp();
    const response = await app.inject({ method: "DELETE", url: "/api/brands/brand-01", headers: admin() });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ id: "brand-01", active: false, account: { active: false } });
    expect(calls).toContain("mutateCatalog");
    expect(calls.filter((method) => FULL_STORE_METHODS.includes(method))).toEqual([]);
  });

  it("guardar, publicar y revertir el workflow no tocan el store completo", async () => {
    const { app, calls } = await makeRecordedApp();
    const saved = await app.inject({
      method: "PUT",
      url: "/api/workflow",
      headers: admin(),
      payload: { name: "Workflow editado", pollIntervalMinutes: 15 },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ name: "Workflow editado", pollIntervalMinutes: 15, version: 2 });

    const published = await app.inject({ method: "POST", url: "/api/workflow/publish", headers: admin(), payload: {} });
    expect(published.statusCode).toBe(200);

    const rolledBack = await app.inject({
      method: "POST",
      url: "/api/workflow/rollback",
      headers: admin(),
      payload: { version: 1 },
    });
    expect(rolledBack.statusCode).toBe(200);
    expect(rolledBack.json().data.version).toBe(3);

    expect(calls.filter((method) => method === "mutateCatalog")).toHaveLength(3);
    expect(calls.filter((method) => FULL_STORE_METHODS.includes(method))).toEqual([]);
  });

  it("las demás rutas de marcas y la lectura de readiness/ejecuciones tampoco leen interacciones", async () => {
    const { app, calls } = await makeRecordedApp();
    const requests = [
      { method: "POST" as const, url: "/api/brands", payload: { name: "Marca Ficticia", accountHandle: "@marca_ficticia", channels: ["instagram"] } },
      { method: "PATCH" as const, url: "/api/brands/brand-02", payload: { name: "Marca Dos Editada" } },
      { method: "POST" as const, url: "/api/brands/brand-02/resources", payload: { name: "Guía", url: "https://example.test/guia", kind: "brand_guide" } },
      { method: "GET" as const, url: "/api/brands/brand-02/resources" },
      { method: "GET" as const, url: "/api/brands/brand-02/workbook" },
      { method: "GET" as const, url: "/api/brands/brand-02/qa-workbook" },
      { method: "GET" as const, url: "/api/workflow/versions" },
      { method: "GET" as const, url: "/api/executions" },
      { method: "GET" as const, url: "/api/security/audit" },
      { method: "GET" as const, url: "/api/ready" },
    ];
    for (const request of requests) {
      const response = await app.inject({ ...request, headers: admin() });
      expect(response.statusCode, `${request.method} ${request.url}: ${response.body}`).toBeLessThan(300);
    }
    expect(calls.filter((method) => FULL_STORE_METHODS.includes(method))).toEqual([]);
  });

  it("readiness informa conteos reales sin materializar las interacciones", async () => {
    const { app } = await makeRecordedApp();
    const store = await app.sacFlow.repository.snapshot();
    const ready = await app.inject({ method: "GET", url: "/api/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks.repository).toMatchObject({
      status: "ok",
      brands: store.brands.length,
      interactions: store.interactions.length,
      deliveries: store.deliveries.length,
    });
  });

  it("una mutación de catálogo no puede eliminar marcas en ningún repositorio", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-catalog-"));
    directories.push(directory);
    const repository = new JsonRepository(path.join(directory, "store.json"));
    await repository.initialize();
    await expect(repository.mutateCatalog((catalog) => {
      catalog.brands = catalog.brands.filter((brand) => brand.id !== "brand-01");
    })).rejects.toThrow(/no puede eliminar marcas/);
    expect((await repository.snapshotCatalog()).brands.some((brand) => brand.id === "brand-01")).toBe(true);
  });
});

type Statement = { sql: string; params: readonly unknown[] };

function brandRow(brand: DataStore["brands"][number]) {
  return {
    brand_id: brand.id,
    brand_name: brand.name,
    color: brand.color,
    brand_active: brand.active,
    sac_policy: brand.sacPolicy ?? null,
    workbook_config: brand.workbook ?? null,
    qa_workbook_config: brand.qaWorkbook ?? null,
    resources: brand.resources ?? [],
    account_id: brand.account.id,
    account_name: brand.account.name,
    handle: brand.account.handle,
    channels: brand.account.channels,
    account_active: brand.account.active,
    user_id: null,
    blog_id: null,
    instagram_provider: null,
  };
}

function interactionRow(interaction: Interaction) {
  return {
    interaction_key: interaction.id,
    external_id: interaction.externalId,
    brand_id: interaction.brandId,
    account_id: interaction.accountId,
    provider: interaction.channel,
    kind: interaction.type,
    direction: interaction.direction,
    customer_name: interaction.customerName,
    customer_handle: interaction.customerHandle,
    body_text: interaction.text,
    category: interaction.category,
    sentiment: interaction.sentiment,
    confidence: interaction.confidence,
    status: interaction.status,
    source: interaction.source,
    version: interaction.version,
    received_at: interaction.createdAt,
    updated_at: interaction.updatedAt,
    assigned_to_user_id: interaction.assignedTo?.userId ?? null,
    assigned_to_display_name: interaction.assignedTo?.displayName ?? null,
    internal_notes: interaction.internalNotes ?? [],
    response_text: interaction.responseText ?? null,
    responded_at: interaction.respondedAt ?? null,
    metricool_ref: interaction.metricoolRef ?? null,
    audit_trail: interaction.audit,
    status_reason: interaction.statusReason ?? null,
    automation_assessment: interaction.automation ?? null,
  };
}

/**
 * Cliente PostgreSQL simulado que responde las lecturas del catálogo (y opcionalmente de
 * interacciones) a partir del seed ficticio, y registra cada sentencia emitida.
 */
function fakePostgres(store: DataStore, options: { interactions?: Interaction[] } = {}) {
  const statements: Statement[] = [];
  const rows = (items: unknown[]) => ({ rows: items, rowCount: items.length });
  const workflow = store.workflow;
  const client = {
    async query(sql: string, params: readonly unknown[] = []) {
      statements.push({ sql, params });
      const text = sql.trim();
      if (text.startsWith("SELECT") || text.startsWith("WITH")) {
        if (sql.includes("FROM organizations")) return rows([{ id: "organization-1" }]);
        if (sql.includes("pgp_sym_decrypt")) return rows(store.brands.map(brandRow));
        if (sql.includes("brand_key")) {
          return rows(store.brands.map((brand) => ({
            brand_key: brand.id,
            brand_id: `uuid-${brand.id}`,
            account_key: brand.account.id,
            account_id: `uuid-${brand.account.id}`,
          })));
        }
        if (sql.includes("FROM workflow_configs") && sql.includes("published_version")) {
          return rows([{
            workflow_id: "workflow-uuid",
            workflow_key: workflow.id,
            name: workflow.name,
            version: workflow.version,
            published_version: workflow.publishedVersion,
            published_at: workflow.publishedAt ?? null,
            published_by: workflow.publishedBy ?? null,
            enabled: workflow.enabled,
            poll_interval_minutes: workflow.pollIntervalMinutes,
            auto_reply_enabled: workflow.autoReplyEnabled,
            minimum_confidence: workflow.minimumConfidence,
            require_human_for: workflow.requireHumanFor,
            business_hours_only: workflow.businessHoursOnly,
            updated_at: workflow.updatedAt,
            last_run_at: workflow.lastRunAt ?? null,
            last_run_status: workflow.lastRunStatus ?? null,
          }]);
        }
        if (sql.includes("FROM workflow_configs")) return rows([{ id: "workflow-uuid" }]);
        if (sql.includes("FROM workflow_account_allowlist")) {
          return rows(workflow.autoReplyAccountIds.map((accountKey) => ({ account_key: accountKey })));
        }
        if (sql.includes("FROM workflow_nodes")) {
          return rows(workflow.nodes.map((node) => ({
            node_key: node.id,
            type: node.type,
            label: node.label,
            enabled: node.enabled,
            position_x: node.position.x,
            position_y: node.position.y,
            config: node.config,
          })));
        }
        if (sql.includes("FROM workflow_edges")) {
          return rows(workflow.edges.map((edge) => ({
            edge_key: edge.id,
            source_node_key: edge.source,
            target_node_key: edge.target,
            label: edge.label ?? null,
            connector_type: edge.connectorType ?? "smoothstep",
          })));
        }
        if (sql.includes("FROM workflow_versions")) {
          return rows(store.workflowVersions.map((version) => ({
            version_key: version.id,
            workflow_key: version.workflowId,
            version: version.version,
            status: version.status,
            snapshot: version.snapshot,
            created_at: version.createdAt,
            created_by: version.createdBy,
            change_note: version.changeNote ?? null,
          })));
        }
        if (sql.includes("FROM interactions i")) return rows((options.interactions ?? []).map(interactionRow));
        return rows([]);
      }
      if (text.startsWith("INSERT INTO interactions") && sql.includes("RETURNING")) {
        const returned = [];
        for (let index = 0; index < params.length; index += 28) {
          returned.push({ id: `uuid-${String(params[index + 3])}`, interaction_key: params[index + 3] });
        }
        return rows(returned);
      }
      if (sql.includes("RETURNING id::text AS id")) return rows([{ id: `uuid-${String(params[1] ?? "row")}` }]);
      return { rows: [], rowCount: 1 };
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
  const writes = () => statements
    .map((statement) => statement.sql.trim())
    .filter((sql) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));
  return { repository, statements, writes };
}

describe("PostgresRepository: mutaciones acotadas", () => {
  it("desactivar una marca actualiza solo su marca y su cuenta, sin tocar interacciones", async () => {
    const store = createDemoStore();
    const { repository, statements, writes } = fakePostgres(store);
    const updated = await repository.mutateCatalog((catalog) => {
      const brand = catalog.brands.find((item) => item.id === "brand-01")!;
      brand.active = false;
      brand.account.active = false;
      return brand;
    });
    expect(updated).toMatchObject({ id: "brand-01", active: false, account: { active: false } });

    expect(statements.some((statement) => /\binteractions\b/.test(statement.sql))).toBe(false);
    expect(writes()).toHaveLength(2);
    expect(writes()[0]).toMatch(/^UPDATE brands\b/);
    expect(writes()[1]).toMatch(/^UPDATE social_accounts\b/);
    const brandUpdate = statements.find((statement) => statement.sql.trim().startsWith("UPDATE brands"))!;
    expect(brandUpdate.params.slice(0, 2)).toEqual(["organization-1", "uuid-brand-01"]);
  });

  it("actualizar el workflow escribe una sola fila de configuración y nunca el store completo", async () => {
    const { repository, statements, writes } = fakePostgres(createDemoStore());
    const workflow = await repository.updateWorkflow({ name: "Workflow ficticio", pollIntervalMinutes: 30 });
    expect(workflow).toMatchObject({ name: "Workflow ficticio", pollIntervalMinutes: 30 });

    expect(statements.some((statement) => /\binteractions\b/.test(statement.sql))).toBe(false);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatch(/^UPDATE workflow_configs\b/);
    expect(writes().some((sql) => sql.startsWith("DELETE"))).toBe(false);
  });

  it("el grafo y la allowlist solo se reescriben cuando cambian, por lotes", async () => {
    const store = createDemoStore();
    const { repository, writes } = fakePostgres(store);
    await repository.updateWorkflow({
      autoReplyAccountIds: ["account-01", "account-02"],
      nodes: store.workflow.nodes.map((node, index) => index === 0 ? { ...node, label: "Nodo renombrado" } : node),
    });
    const issued = writes();
    expect(issued.filter((sql) => sql.startsWith("INSERT INTO workflow_nodes"))).toHaveLength(1);
    expect(issued.filter((sql) => sql.startsWith("INSERT INTO workflow_edges"))).toHaveLength(1);
    expect(issued.filter((sql) => sql.startsWith("INSERT INTO workflow_account_allowlist"))).toHaveLength(1);
    expect(issued.some((sql) => /\binteractions\b|\bbrands\b|\bsocial_accounts\b/.test(sql))).toBe(false);
  });

  it("guardar una versión nueva del workflow solo inserta/actualiza esas versiones", async () => {
    const { repository, writes } = fakePostgres(createDemoStore());
    await repository.mutateCatalog((catalog) => {
      const next = { ...catalog.workflow, version: catalog.workflow.version + 1, name: "Borrador" };
      catalog.workflow = next;
      catalog.workflowVersions.unshift({
        id: `${next.id}-v${next.version}`,
        workflowId: next.id,
        version: next.version,
        status: "draft",
        snapshot: structuredClone(next),
        createdAt: next.updatedAt,
        createdBy: "user-admin",
      });
    });
    const issued = writes();
    expect(issued).toHaveLength(2);
    expect(issued[0]).toMatch(/^UPDATE workflow_configs\b/);
    expect(issued[1]).toMatch(/^INSERT INTO workflow_versions[\s\S]*ON CONFLICT/);
  });

  it("mutate() genérico persiste solo la interacción modificada, sin vaciar tablas", async () => {
    const store = createDemoStore();
    const interactions = store.interactions.slice(0, 25);
    const { repository, statements, writes } = fakePostgres(store, { interactions });
    const target = interactions[3]!.id;
    await repository.mutate((current) => {
      const interaction = current.interactions.find((item) => item.id === target)!;
      interaction.status = "resolved";
      interaction.version += 1;
    });
    const issued = writes();
    expect(issued.some((sql) => sql.startsWith("DELETE"))).toBe(false);
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatch(/^INSERT INTO interactions[\s\S]*ON CONFLICT \(organization_id, interaction_key\) DO UPDATE/);
    const upsert = statements.find((statement) => statement.sql.trim().startsWith("INSERT INTO interactions"))!;
    expect(upsert.params).toHaveLength(28);
    expect(upsert.params[3]).toBe(target);
    expect(upsert.params[14]).toBe("resolved");
  });

  it("el reemplazo explícito inserta interacciones por lotes, no una sentencia por fila", async () => {
    const store = createDemoStore();
    const base = store.interactions[0]!;
    store.interactions = Array.from({ length: 1_200 }, (_, index) => ({
      ...structuredClone(base),
      id: `interaccion-ficticia-${index}`,
      externalId: `externa-ficticia-${index}`,
    }));
    store.deliveries = [];
    const { repository, writes } = fakePostgres(store);
    await repository.replace(store);
    const inserts = writes().filter((sql) => sql.startsWith("INSERT INTO interactions"));
    expect(inserts).toHaveLength(3);
  });
});
