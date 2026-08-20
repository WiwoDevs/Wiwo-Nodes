import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonRepository } from "../../server/repository.js";
import { createDemoAutomationState } from "../../server/automation-seed.js";
import { PostgresRepository, type PgPoolLike } from "../../server/postgres-repository.js";
import { createDemoStore } from "../../server/seed.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("JsonRepository", () => {
  it("creates a valid seed and publishes serialized atomic writes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-repository-"));
    directories.push(directory);
    const file = path.join(directory, "nested", "store.json");
    const repository = new JsonRepository(file);
    await repository.initialize();
    expect((await repository.snapshot()).brands).toHaveLength(20);

    await Promise.all([
      repository.updateWorkflow({ name: "Workflow A" }),
      repository.updateWorkflow({ pollIntervalMinutes: 15 }),
      repository.updateWorkflow({ businessHoursOnly: true }),
    ]);
    const workflow = await repository.getWorkflow();
    await repository.updateWorkflow({
      edges: workflow.edges.map((edge, index) => ({
        ...edge,
        connectorType: index === 0 ? "bezier" : index === 1 ? "straight" : "smoothstep",
      })),
    });
    const decoded = JSON.parse(await readFile(file, "utf8"));
    expect(decoded.workflow.pollIntervalMinutes).toBe(15);
    expect(decoded.workflow.businessHoursOnly).toBe(true);
    expect(decoded.workflow.edges.slice(0, 3).map((edge: { connectorType: string }) => edge.connectorType)).toEqual([
      "bezier",
      "straight",
      "smoothstep",
    ]);
    expect(decoded.brands).toHaveLength(20);
    expect((await readdir(path.dirname(file))).filter((name) => name.endsWith(".tmp"))).toHaveLength(0);

    const reopened = new JsonRepository(file);
    await reopened.initialize();
    expect((await reopened.getWorkflow()).edges[0].connectorType).toBe("bezier");
  });

  it("filters case-insensitively and computes DM/comment totals", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-repository-"));
    directories.push(directory);
    const repository = new JsonRepository(path.join(directory, "store.json"));
    await repository.initialize();
    const matches = await repository.listInteractions({ search: "ENVÍOS", channel: "instagram" });
    expect(matches).toHaveLength(20);
    const stats = await repository.stats();
    expect(stats).toMatchObject({ total: 60, dms: 40, comments: 20 });
    expect(stats.byBrand).toHaveLength(20);
  });

  it("persists case coordination state and increments the optimistic version", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-repository-"));
    directories.push(directory);
    const file = path.join(directory, "store.json");
    const repository = new JsonRepository(file);
    await repository.initialize();
    const initial = (await repository.snapshot()).interactions[0];
    expect(initial.version).toBe(1);
    expect(initial.internalNotes).toEqual([]);

    const updated = await repository.updateInteraction(initial.id, (interaction) => {
      interaction.assignedTo = { userId: "agent-01", displayName: "Agente Uno" };
      interaction.internalNotes.push({
        id: "note-01",
        authorId: "agent-01",
        authorName: "Agente Uno",
        text: "Contexto interno persistido.",
        createdAt: "2026-08-12T14:00:00.000Z",
      });
    });
    expect(updated).toMatchObject({
      version: 2,
      assignedTo: { userId: "agent-01", displayName: "Agente Uno" },
    });

    const reopened = new JsonRepository(file);
    await reopened.initialize();
    const persisted = await reopened.findInteraction(initial.id);
    expect(persisted?.version).toBe(2);
    expect(persisted?.internalNotes[0].text).toBe("Contexto interno persistido.");
  });

  it("enriches legacy Metricool content and missing references without changing case state", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-repository-"));
    directories.push(directory);
    const repository = new JsonRepository(path.join(directory, "store.json"));
    await repository.initialize();
    const source = (await repository.snapshot()).interactions[0]!;
    const existing = await repository.updateInteraction(source.id, (interaction) => {
      interaction.text = "Mensaje recibido desde Metricool";
      interaction.status = "drafted";
      interaction.responseText = "Borrador que debe conservarse";
      interaction.assignedTo = { userId: "agent-1", displayName: "Agente Uno" };
      interaction.metricoolRef = {
        provider: "INSTAGRAM",
        postId: "post-existing",
        contentContext: {
          kind: "unavailable",
          mediaUrls: ["https://cdn.example.test/existing.jpg"],
        },
        post: { id: "post-existing", text: "Texto existente" },
      };
    });
    const before = structuredClone(existing!);
    const incoming = structuredClone(existing!);
    incoming.id = "incoming-duplicate-id";
    incoming.text = "Texto exacto recuperado desde Metricool";
    incoming.status = "resolved";
    incoming.version = 99;
    incoming.responseText = "No debe reemplazar el borrador";
    incoming.assignedTo = undefined;
    incoming.internalNotes = [];
    incoming.audit = [];
    incoming.automation = undefined;
    incoming.updatedAt = "2030-01-01T00:00:00.000Z";
    incoming.metricoolRef = {
      provider: "FACEBOOK",
      actorId: "actor-new",
      threadId: "thread-new",
      postId: "post-existing",
      contentContext: {
        kind: "story_reply",
        mediaUrls: [
          "https://cdn.example.test/existing.jpg",
          "https://cdn.example.test/story.mp4",
        ],
        permalink: "https://www.instagram.com/stories/example/1/",
        storyId: "story-new",
      },
      post: {
        id: "post-existing",
        url: "https://www.instagram.com/p/context/",
        text: "No debe reemplazar el texto existente",
        mediaUrl: "https://cdn.example.test/context.jpg",
        publishedAt: "2026-08-10T09:00:00.000Z",
      },
    };

    expect(await repository.insertInteractions([incoming])).toEqual({ created: [], duplicates: 1 });
    expect(await repository.findInteraction(source.id)).toEqual({
      ...before,
      text: "Texto exacto recuperado desde Metricool",
      metricoolRef: {
        provider: "INSTAGRAM",
        actorId: "actor-new",
        threadId: "thread-new",
        postId: "post-existing",
        contentContext: {
          kind: "story_reply",
          mediaUrls: [
            "https://cdn.example.test/existing.jpg",
            "https://cdn.example.test/story.mp4",
          ],
          permalink: "https://www.instagram.com/stories/example/1/",
          storyId: "story-new",
        },
        post: {
          id: "post-existing",
          url: "https://www.instagram.com/p/context/",
          text: "Texto existente",
          mediaUrl: "https://cdn.example.test/context.jpg",
          publishedAt: "2026-08-10T09:00:00.000Z",
        },
      },
    });
  });

  it("does not replace real content with an unavailable-content fallback", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-repository-"));
    directories.push(directory);
    const repository = new JsonRepository(path.join(directory, "store.json"));
    await repository.initialize();
    const existing = (await repository.snapshot()).interactions[0]!;
    const incoming = structuredClone(existing);
    incoming.id = "incoming-duplicate-id";
    incoming.text = "Contenido no disponible";

    expect(await repository.insertInteractions([incoming])).toEqual({ created: [], duplicates: 1 });
    expect((await repository.findInteraction(existing.id))?.text).toBe(existing.text);
  });

  it("tombstones content deleted at the provider without changing the case workflow", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-repository-"));
    directories.push(directory);
    const repository = new JsonRepository(path.join(directory, "store.json"));
    await repository.initialize();
    const source = (await repository.snapshot()).interactions[0]!;
    const existing = await repository.updateInteraction(source.id, (interaction) => {
      interaction.status = "drafted";
      interaction.responseText = "Borrador humano preservado";
      interaction.metricoolRef = {
        provider: "INSTAGRAM",
        contentContext: {
          kind: "text",
          mediaUrls: ["https://cdn.example.test/old.jpg"],
          permalink: "https://www.instagram.com/stories/example/1/",
        },
      };
    });
    const before = structuredClone(existing!);
    const incoming = structuredClone(existing!);
    incoming.id = "incoming-deleted-duplicate";
    incoming.text = "Mensaje eliminado";
    incoming.status = "resolved";
    incoming.version = 99;
    incoming.responseText = undefined;
    incoming.metricoolRef = { provider: "INSTAGRAM", contentContext: { kind: "deleted" } };

    expect(await repository.insertInteractions([incoming])).toEqual({ created: [], duplicates: 1 });
    expect(await repository.findInteraction(source.id)).toEqual({
      ...before,
      text: "Mensaje eliminado",
      metricoolRef: { provider: "INSTAGRAM", contentContext: { kind: "deleted" } },
    });
  });

  it("sanitizes legacy Metricool placeholders on reads without changing persisted source data", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-repository-"));
    directories.push(directory);
    const file = path.join(directory, "store.json");
    const repository = new JsonRepository(file);
    await repository.initialize();
    const source = (await repository.snapshot()).interactions[0]!;
    const updated = await repository.updateInteraction(source.id, (interaction) => {
      interaction.text = "Mensaje enviado desde Metricool";
    });

    expect(updated?.text).toBe("Contenido no disponible");
    expect((await repository.snapshot()).interactions.find((item) => item.id === source.id)?.text)
      .toBe("Contenido no disponible");
    expect((await repository.listInteractions()).find((item) => item.id === source.id)?.text)
      .toBe("Contenido no disponible");
    expect((await repository.findInteraction(source.id))?.text).toBe("Contenido no disponible");

    const persisted = JSON.parse(await readFile(file, "utf8"));
    expect(persisted.interactions.find((item: { id: string }) => item.id === source.id)?.text)
      .toBe("Mensaje enviado desde Metricool");
  });

  it("claims scheduled jobs once and records retry/dead-letter state", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-repository-"));
    directories.push(directory);
    const repository = new JsonRepository(path.join(directory, "store.json"));
    await repository.initialize();
    const now = new Date().toISOString();
    const job = {
      id: "job-01",
      scheduleKey: "workflow-sac-metricool:1",
      kind: "sync" as const,
      status: "queued" as const,
      accountIds: ["account-01"],
      limit: 100,
      attempts: 0,
      maxAttempts: 2,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    };
    expect(await repository.enqueueJob(job)).toBe(true);
    expect(await repository.enqueueJob({ ...job, id: "job-duplicate" })).toBe(false);
    const first = await repository.claimNextJob("worker-a", 60_000);
    expect(first).toMatchObject({ id: "job-01", status: "running", attempts: 1, lockedBy: "worker-a" });
    expect(await repository.claimNextJob("worker-b", 60_000)).toBeUndefined();
    expect(await repository.failJob("job-01", "worker-a", "temporary", 0)).toBe(true);
    const second = await repository.claimNextJob("worker-b", 60_000);
    expect(second).toMatchObject({ status: "running", attempts: 2, lockedBy: "worker-b" });
    expect(await repository.failJob("job-01", "worker-b", "final", 0)).toBe(true);
    expect((await repository.snapshot()).jobs[0]).toMatchObject({ status: "dead", lastError: "final" });
  });

  it("recovers stale reply leases as uncertain and requires explicit reconciliation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-repository-"));
    directories.push(directory);
    const repository = new JsonRepository(path.join(directory, "store.json"));
    await repository.initialize();
    const interaction = (await repository.snapshot()).interactions[0];
    const prepared = await repository.prepareReplyDelivery({
      id: "00000000-0000-4000-8000-000000000101",
      interactionId: interaction.id,
      brandId: interaction.brandId,
      accountId: interaction.accountId,
      bodyText: "Respuesta controlada",
      approvedByHuman: true,
      requestedBy: { userId: "supervisor-1", displayName: "Supervisora Uno" },
      idempotencyKey: "delivery-recovery-test",
      requestId: "request-recovery-test",
      createdAt: "2026-08-12T12:00:00.000Z",
    });
    expect(prepared).toMatchObject({ created: true, delivery: { status: "pending", attemptCount: 0 } });
    expect(await repository.claimReplyDelivery(prepared.delivery.id, 1)).toMatchObject({
      status: "sending",
      attemptCount: 1,
    });
    expect(await repository.recoverStaleReplyDeliveries("2030-01-01T00:00:00.000Z")).toBe(1);
    const uncertain = await repository.findReplyDelivery(prepared.delivery.id);
    expect(uncertain).toMatchObject({ status: "uncertain", errorCode: "DELIVERY_LEASE_EXPIRED" });

    const sameAccountInteraction = (await repository.snapshot()).interactions
      .find((item) => item.accountId === interaction.accountId && item.id !== interaction.id)!;
    const blocked = await repository.prepareReplyDelivery({
      id: "00000000-0000-4000-8000-000000000103",
      interactionId: sameAccountInteraction.id,
      brandId: sameAccountInteraction.brandId,
      accountId: sameAccountInteraction.accountId,
      bodyText: "Respuesta bloqueada por breaker",
      approvedByHuman: true,
      requestedBy: { userId: "supervisor-1", displayName: "Supervisora Uno" },
      idempotencyKey: "delivery-account-breaker-test",
      requestId: "request-account-breaker-test",
      createdAt: "2030-01-01T00:01:00.000Z",
    });
    expect(await repository.claimReplyDelivery(blocked.delivery.id, 60_000)).toBeUndefined();

    const reconciled = await repository.reconcileReplyDelivery(prepared.delivery.id, {
      outcome: "sent",
      expectedVersion: uncertain!.version,
      actor: { userId: "supervisor-1", displayName: "Supervisora Uno" },
      note: "Verificado manualmente en el proveedor.",
      at: "2030-01-01T00:05:00.000Z",
    });
    expect(reconciled).toMatchObject({
      delivery: { status: "sent", reconciliationNote: "Verificado manualmente en el proveedor." },
      interaction: { status: "replied", responseText: "Respuesta controlada" },
    });
    expect(await repository.claimReplyDelivery(blocked.delivery.id, 60_000)).toMatchObject({ status: "sending" });
  });

  it("defers a confirmed rate limit and does not lease the delivery before it is due", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-repository-"));
    directories.push(directory);
    const repository = new JsonRepository(path.join(directory, "store.json"));
    await repository.initialize();
    const interaction = (await repository.snapshot()).interactions[0];
    const prepared = await repository.prepareReplyDelivery({
      id: "00000000-0000-4000-8000-000000000102",
      interactionId: interaction.id,
      brandId: interaction.brandId,
      accountId: interaction.accountId,
      bodyText: "Respuesta con backpressure",
      approvedByHuman: false,
      requestedBy: { userId: "worker-1", displayName: "Worker Uno" },
      idempotencyKey: "delivery-backpressure-test",
      requestId: "request-backpressure-test",
      createdAt: new Date().toISOString(),
    });
    expect(await repository.claimReplyDelivery(prepared.delivery.id, 60_000)).toBeDefined();
    const retryAt = new Date(Date.now() + 60_000).toISOString();
    expect(await repository.deferReplyDelivery(prepared.delivery.id, {
      errorCode: "METRICOOL_HTTP_429",
      nextAttemptAt: retryAt,
      at: new Date().toISOString(),
    })).toMatchObject({ status: "pending", attemptCount: 1, nextAttemptAt: retryAt });
    expect(await repository.claimReplyDelivery(prepared.delivery.id, 60_000)).toBeUndefined();
    await repository.mutate((store) => {
      const delivery = store.deliveries.find((item) => item.id === prepared.delivery.id)!;
      delivery.nextAttemptAt = new Date(Date.now() - 1_000).toISOString();
    });
    expect(await repository.claimReplyDelivery(prepared.delivery.id, 60_000)).toMatchObject({
      status: "sending",
      attemptCount: 2,
      nextAttemptAt: undefined,
    });
  });

  it("reserves automatic queue capacity atomically under concurrent writers", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-repository-"));
    directories.push(directory);
    const repository = new JsonRepository(path.join(directory, "store.json"));
    await repository.initialize();
    const [first, second] = (await repository.snapshot()).interactions.slice(0, 2);
    const input = (interaction: typeof first, suffix: string) => ({
      id: `00000000-0000-4000-8000-0000000002${suffix}`,
      interactionId: interaction.id,
      brandId: interaction.brandId,
      accountId: interaction.accountId,
      bodyText: `Respuesta automática ${suffix}`,
      approvedByHuman: false,
      requestedBy: { userId: "worker-capacity", displayName: "Worker Capacity" },
      idempotencyKey: `auto-reply:capacity:${suffix}`,
      requestId: `capacity-${suffix}`,
      createdAt: new Date().toISOString(),
    });
    const firstInput = input(first, "01");
    const secondInput = input(second, "02");
    const results = await Promise.all([
      repository.prepareAutoReplyDelivery(firstInput, 1),
      repository.prepareAutoReplyDelivery(secondInput, 1),
    ]);
    expect(results.filter((item) => item.created)).toHaveLength(1);
    expect(results.filter((item) => item.capacityReached)).toHaveLength(1);
    expect(await repository.listReplyDeliveries({ status: "pending", automaticOnly: true })).toHaveLength(1);

    const acceptedInput = results[0].created ? firstInput : secondInput;
    expect(await repository.prepareAutoReplyDelivery(acceptedInput, 1)).toMatchObject({
      created: false,
      capacityReached: false,
      delivery: { idempotencyKey: acceptedInput.idempotencyKey },
    });
  });
});

describe("PostgresRepository", () => {
  it("enriches only content and Metricool references when a PostgreSQL insert is a duplicate", async () => {
    const updates: Array<{ sql: string; params: readonly unknown[] }> = [];
    const client = {
      async query(sql: string, params?: readonly unknown[]) {
        if (sql.includes("FROM organizations")) return { rows: [{ id: "organization-1" }], rowCount: 1 };
        if (sql.includes("FROM brands b") && sql.includes("JOIN social_accounts")) {
          return {
            rows: [{ brand_key: "brand-01", brand_id: "brand-uuid", account_key: "account-01", account_id: "account-uuid" }],
            rowCount: 1,
          };
        }
        if (sql.includes("INSERT INTO interactions")) return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT metricool_ref, body_text")) {
          return {
            rows: [{
              metricool_ref: {
                provider: "INSTAGRAM",
                postId: "post-1",
                contentContext: {
                  kind: "unavailable",
                  mediaUrls: ["https://cdn.example.test/existing.jpg"],
                },
                post: { id: "post-1", text: "Original" },
              },
              body_text: "Mensaje recibido desde Metricool",
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("SET metricool_ref = $5::jsonb")) {
          updates.push({ sql, params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
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
    const incoming = structuredClone(createDemoStore().interactions.find((item) => item.brandId === "brand-01")!);
    incoming.metricoolRef = {
      provider: "FACEBOOK",
      actorId: "actor-1",
      postId: "post-1",
      contentContext: {
        kind: "attachment",
        mediaUrls: [
          "https://cdn.example.test/existing.jpg",
          "https://cdn.example.test/new.jpg",
        ],
      },
      post: { id: "post-1", text: "Replacement", url: "https://www.instagram.com/p/context/" },
    };
    incoming.text = "Texto exacto recuperado desde Metricool";

    expect(await repository.insertInteractions([incoming])).toEqual({ created: [], duplicates: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.sql).toContain("body_text = $6");
    expect(updates[0]!.sql).not.toMatch(/status|version|response_text|assigned_to|audit_trail|automation_assessment/);
    expect(JSON.parse(String(updates[0]!.params[4]))).toEqual({
      provider: "INSTAGRAM",
      actorId: "actor-1",
      postId: "post-1",
      contentContext: {
        kind: "attachment",
        mediaUrls: [
          "https://cdn.example.test/existing.jpg",
          "https://cdn.example.test/new.jpg",
        ],
      },
      post: { id: "post-1", text: "Original", url: "https://www.instagram.com/p/context/" },
    });
    expect(updates[0]!.params[5]).toBe("Texto exacto recuperado desde Metricool");
  });

  it("enriches PostgreSQL references without downgrading real content", async () => {
    const updates: string[] = [];
    const metricoolRef = { provider: "INSTAGRAM", threadId: "thread-1" };
    const client = {
      async query(sql: string) {
        if (sql.includes("FROM organizations")) return { rows: [{ id: "organization-1" }], rowCount: 1 };
        if (sql.includes("FROM brands b") && sql.includes("JOIN social_accounts")) {
          return {
            rows: [{ brand_key: "brand-01", brand_id: "brand-uuid", account_key: "account-01", account_id: "account-uuid" }],
            rowCount: 1,
          };
        }
        if (sql.includes("INSERT INTO interactions")) return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT metricool_ref, body_text")) {
          return { rows: [{ metricool_ref: metricoolRef, body_text: "Texto real existente" }], rowCount: 1 };
        }
        if (sql.includes("UPDATE interactions")) updates.push(sql);
        return { rows: [], rowCount: 0 };
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
    const incoming = structuredClone(createDemoStore().interactions.find((item) => item.brandId === "brand-01")!);
    incoming.text = "Contenido no disponible";
    incoming.metricoolRef = { ...metricoolRef, actorId: "actor-new" };

    expect(await repository.insertInteractions([incoming])).toEqual({ created: [], duplicates: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("SET metricool_ref = $5::jsonb");
    expect(updates[0]).not.toContain("body_text");
  });

  it("sanitizes legacy Metricool placeholders returned from PostgreSQL", async () => {
    const client = {
      async query(sql: string) {
        if (sql.includes("FROM organizations")) return { rows: [{ id: "organization-1" }], rowCount: 1 };
        if (sql.includes("i.interaction_key") && sql.includes("i.body_text")) {
          return {
            rows: [{
              interaction_key: "interaction-legacy",
              external_id: "external-legacy",
              brand_id: "brand-01",
              account_id: "account-01",
              provider: "instagram",
              kind: "dm",
              direction: "inbound",
              customer_name: "Cliente",
              customer_handle: "@cliente",
              body_text: "Mensaje recibido desde Metricool",
              category: "general",
              sentiment: "neutral",
              confidence: 0,
              status: "new",
              source: "metricool",
              version: 1,
              received_at: "2026-08-18T12:00:00.000Z",
              updated_at: "2026-08-18T12:00:00.000Z",
              assigned_to_user_id: null,
              assigned_to_display_name: null,
              internal_notes: [],
              response_text: null,
              responded_at: null,
              metricool_ref: {},
              audit_trail: [],
              status_reason: null,
              automation_assessment: null,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
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

    const store = await repository.snapshot();
    expect(store.interactions).toHaveLength(1);
    expect(store.interactions[0]?.text).toBe("Contenido no disponible");
  });

  it("serializes tenant queries on a checked-out PostgreSQL client", async () => {
    let queryInFlight = false;
    const client = {
      async query(sql: string) {
        if (queryInFlight) throw new Error("concurrent client query");
        queryInFlight = true;
        await new Promise((resolve) => setTimeout(resolve, 1));
        try {
          if (sql.includes("FROM organizations")) return { rows: [{ id: "organization-1" }], rowCount: 1 };
          if (sql.includes("FROM workflow_configs")) {
            return {
              rows: [{ workflow_key: "workflow-sac", enabled: true, poll_interval_minutes: 5 }],
              rowCount: 1,
            };
          }
          if (sql.includes("FROM social_accounts")) return { rows: [{ account_key: "account-1" }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        } finally {
          queryInFlight = false;
        }
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

    await expect(repository.getSchedulerState()).resolves.toEqual({
      workflowId: "workflow-sac",
      enabled: true,
      pollIntervalMinutes: 5,
      accountIds: ["account-1"],
    });
  });

  it("updates only the automation document for automation mutations", async () => {
    const statements: string[] = [];
    let state = createDemoAutomationState(new Date("2026-08-12T12:00:00.000Z"));
    const client = {
      async query(sql: string, params?: readonly unknown[]) {
        statements.push(sql);
        if (sql.includes("FROM organizations")) return { rows: [{ id: "organization-1" }], rowCount: 1 };
        if (sql.includes("SELECT state FROM automation_platform_states")) return { rows: [{ state }], rowCount: 1 };
        if (sql.includes("INSERT INTO automation_platform_states")) {
          state = JSON.parse(String(params?.[1]));
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
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

    await repository.mutateAutomation((automation) => {
      automation.projects[0].name = "Operaciones actualizadas";
    });

    expect(state.projects[0].name).toBe("Operaciones actualizadas");
    expect(statements.some((sql) => sql.includes("INSERT INTO automation_platform_states"))).toBe(true);
    expect(statements.some((sql) => /DELETE FROM/i.test(sql))).toBe(false);

    statements.length = 0;
    const automation = await repository.snapshotAutomation();
    expect(automation.projects[0].name).toBe("Operaciones actualizadas");
    expect(statements.some((sql) => sql.includes("SELECT state FROM automation_platform_states"))).toBe(true);
    expect(statements.some((sql) => /FROM (brands|interactions|workflow_jobs)/i.test(sql))).toBe(false);
  });
});
