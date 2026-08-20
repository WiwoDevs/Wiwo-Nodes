import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { MetricoolRequestError, type MetricoolGateway } from "../../server/metricool-client.js";
import { PostgresRepository } from "../../server/postgres-repository.js";
import { createRepository } from "../../server/repository-factory.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];
const TEST_API_KEY = "test-api-key-123";

const authHeaders = {
  "x-api-key": TEST_API_KEY,
};

function scopedActor(role: "viewer" | "agent" | "supervisor" | "admin", brandIds = "*") {
  return {
    "x-sac-user-id": `user-${role}`,
    "x-sac-user-name": `Usuario ${role}`,
    "x-sac-tenant-id": "tenant-test",
    "x-sac-role": role,
    "x-sac-brand-ids": brandIds,
  };
}

async function makeApp(options: {
  env?: NodeJS.ProcessEnv;
  client?: MetricoolGateway;
  serveFrontend?: boolean;
} = {}): Promise<{ app: SacFlowApp; dataFile: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-api-"));
  directories.push(directory);
  const dataFile = path.join(directory, "store.json");
  const frontendDir = path.join(directory, "client");
  if (options.serveFrontend) {
    await mkdir(frontendDir, { recursive: true });
    await writeFile(path.join(frontendDir, "index.html"), "<!doctype html><title>SAC Flow test</title>");
  }
  const env = {
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: dataFile,
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
    ...(options.serveFrontend ? { SERVE_FRONTEND: "true", FRONTEND_DIR: frontendDir } : {}),
    ...options.env,
  };
  if (env.METRICOOL_MODE === "live" && !env.SAC_FLOW_API_KEY) env.SAC_FLOW_API_KEY = TEST_API_KEY;
  const config = loadConfig(env, directory);
  const app = await buildApp({ config, metricoolClient: options.client });
  apps.push(app);
  return { app, dataFile };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SAC Flow API", () => {
  it("never exposes obsolete Metricool placeholder copy in list, detail or history", async () => {
    const { app } = await makeApp();
    const target = (await app.sacFlow.repository.listInteractions())[0]!;
    await app.sacFlow.repository.updateInteraction(target.id, (item) => {
      item.type = "dm";
      item.direction = "inbound";
      item.customerHandle = "@legacy-placeholder-test";
      item.text = "Mensaje recibido desde Metricool";
      item.metricoolRef = { conversationId: "legacy-placeholder-thread" };
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/interactions?search=legacy-placeholder-test&page=1&pageSize=10",
    });
    const detail = await app.inject({ method: "GET", url: `/api/interactions/${target.id}` });
    const history = await app.inject({ method: "GET", url: `/api/interactions/${target.id}/conversation` });

    for (const response of [list, detail, history]) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toMatch(/Mensaje (?:recibido|enviado) desde Metricool/iu);
      expect(response.body).toContain("Contenido no disponible");
    }
  });

  it("exposes only safe content context in list, detail and history", async () => {
    const { app } = await makeApp();
    const target = (await app.sacFlow.repository.listInteractions())[0]!;
    await app.sacFlow.repository.updateInteraction(target.id, (item) => {
      item.type = "dm";
      item.direction = "inbound";
      item.customerHandle = "@safe-content-context";
      item.text = "Archivo adjunto";
      item.metricoolRef = {
        conversationId: "private-thread-reference",
        contentContext: {
          kind: "attachment",
          mediaUrls: [
            "https://cdn.example.test/file.jpg",
            "javascript:alert(1)",
            "http://cdn.example.test/insecure.jpg",
          ],
          permalink: "https://www.instagram.com/p/example/",
          storyId: "story-safe-1",
        },
      };
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/interactions?search=safe-content-context&page=1&pageSize=10",
    });
    const detail = await app.inject({ method: "GET", url: `/api/interactions/${target.id}` });
    const history = await app.inject({ method: "GET", url: `/api/interactions/${target.id}/conversation` });

    for (const response of [list, detail, history]) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain("metricoolRef");
      expect(response.body).not.toContain("private-thread-reference");
      expect(response.body).not.toContain("javascript:");
      expect(response.body).not.toContain("http://cdn.example.test");
      expect(response.body).toContain("https://cdn.example.test/file.jpg");
      expect(response.body).toContain('"kind":"attachment"');
    }
  });

  it("returns chronological conversation history and deletes only the local draft", async () => {
    const { app } = await makeApp();
    const interactions = await app.sacFlow.repository.listInteractions();
    const [first, second] = interactions.slice(0, 2);
    expect(first && second).toBeTruthy();
    const firstUpdated = await app.sacFlow.repository.updateInteraction(first!.id, (item) => {
      item.accountId = first!.accountId;
      item.brandId = first!.brandId;
      item.type = "dm";
      item.direction = "inbound";
      item.customerHandle = "@history-test";
      item.metricoolRef = {
        conversationId: "history-thread",
        contentContext: {
          kind: "attachment",
          mediaUrls: ["https://cdn.example.test/private-history-file.jpg?signature=private"],
          storyId: "private-story-id",
        },
      };
      item.createdAt = "2026-08-17T10:00:00.000Z";
      item.responseText = undefined;
      item.respondedAt = undefined;
    });
    await app.sacFlow.repository.updateInteraction(second!.id, (item) => {
      item.accountId = first!.accountId;
      item.brandId = first!.brandId;
      item.type = "dm";
      item.direction = "inbound";
      item.customerHandle = "@history-test";
      item.metricoolRef = { conversationId: "history-thread" };
      item.createdAt = "2026-08-17T10:01:00.000Z";
      item.responseText = undefined;
      item.respondedAt = undefined;
    });
    const history = await app.inject({ method: "GET", url: `/api/interactions/${first!.id}/conversation` });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({ meta: { hasHistory: true, total: 2 } });
    expect(history.json().data.map((item: { id: string }) => item.id)).toEqual([first!.id, second!.id]);

    const draft = await app.inject({
      method: "POST",
      url: `/api/interactions/${first!.id}/reply`,
      payload: { text: "Borrador local", mode: "draft", expectedVersion: firstUpdated!.version },
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().data).toMatchObject({ id: first!.id, status: "drafted" });
    expect(draft.body).not.toContain("metricoolRef");
    expect(draft.body).not.toContain("history-thread");
    expect(draft.body).not.toContain("private-history-file");
    expect(draft.body).not.toContain("private-story-id");
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/interactions/${first!.id}/draft`,
      payload: { expectedVersion: draft.json().data.version },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data).toMatchObject({ id: first!.id, status: "pending" });
    expect(deleted.body).not.toContain("metricoolRef");
    expect(deleted.body).not.toContain("private-history-file");
    expect(deleted.json()).toMatchObject({ meta: { deleted: true, externalWrites: false } });
  });

  it("paginates inbox contacts after grouping, scopes brands and exposes exact reply targets", async () => {
    const { app } = await makeApp({ env: { SAC_FLOW_TRUST_ACTOR_HEADERS: "true" } });
    const interactions = await app.sacFlow.repository.listInteractions();
    const [first, second, outsideScope] = interactions.slice(0, 3);
    const configure = async (
      id: string,
      options: { brandId: string; accountId: string; actorId: string; threadId: string; postId: string; status: "new" | "escalated"; at: string },
    ) => app.sacFlow.repository.updateInteraction(id, (item) => {
      item.brandId = options.brandId;
      item.accountId = options.accountId;
      item.channel = "instagram";
      item.type = "comment";
      item.direction = "inbound";
      item.customerName = "Contacto agrupado";
      item.customerHandle = "@contacto.agrupado";
      item.text = `contact-group-test ${options.threadId}`;
      item.status = options.status;
      item.createdAt = options.at;
      item.automation = undefined;
      item.responseText = options.status === "escalated" ? "Borrador exacto" : undefined;
      item.respondedAt = undefined;
      item.metricoolRef = {
        actorId: options.actorId,
        threadId: options.threadId,
        postId: options.postId,
        post: {
          id: options.postId,
          url: `https://www.instagram.com/p/${options.postId}/`,
          text: `Post ${options.postId}`,
          mediaUrl: `https://cdn.example.test/${options.postId}.jpg`,
        },
      };
    });
    await configure(first!.id, {
      brandId: "brand-01", accountId: "account-01", actorId: "actor-shared", threadId: "thread-a", postId: "post-a",
      status: "escalated", at: "2026-08-17T10:00:00.000Z",
    });
    await configure(second!.id, {
      brandId: "brand-01", accountId: "account-01", actorId: "actor-shared", threadId: "thread-b", postId: "post-b",
      status: "new", at: "2026-08-17T11:00:00.000Z",
    });
    await configure(outsideScope!.id, {
      brandId: "brand-02", accountId: "account-02", actorId: "actor-shared", threadId: "thread-c", postId: "post-c",
      status: "new", at: "2026-08-17T12:00:00.000Z",
    });

    const headers = scopedActor("viewer", "brand-01");
    const listed = await app.inject({
      method: "GET",
      url: "/api/inbox/contacts?search=contact-group-test&page=1&pageSize=1",
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      pagination: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
      data: [{
        brandId: "brand-01",
        messageCount: 2,
        pendingCount: 2,
        commentCount: 2,
        threadCount: 2,
        latest: { id: second!.id, status: "new", postContext: { postId: "post-b" } },
        replyTarget: { id: first!.id, status: "escalated", responseText: "Borrador exacto", postContext: { postId: "post-a" } },
      }],
    });
    expect(listed.json().data[0].replyTarget).not.toHaveProperty("metricoolRef");
    expect(listed.body).not.toContain("actor-shared");

    const interactionDetail = await app.inject({ method: "GET", url: `/api/interactions/${first!.id}`, headers });
    expect(interactionDetail.json().data.postContext).toEqual({
      postId: "post-a",
      permalink: "https://www.instagram.com/p/post-a/",
      caption: "Post post-a",
      thumbnailUrl: "https://cdn.example.test/post-a.jpg",
    });
    expect(interactionDetail.json().data).not.toHaveProperty("metricoolRef");

    const threadHistory = await app.inject({ method: "GET", url: `/api/interactions/${first!.id}/conversation`, headers });
    expect(threadHistory.json()).toMatchObject({ meta: { scope: "thread", total: 1 } });
    const contactHistory = await app.inject({
      method: "GET",
      url: `/api/interactions/${first!.id}/conversation?scope=contact`,
      headers,
    });
    expect(contactHistory.statusCode).toBe(200);
    expect(contactHistory.json()).toMatchObject({ meta: { scope: "contact", total: 2, hasHistory: true } });
    expect(contactHistory.json().data.map((item: { id: string; postContext?: { postId: string } }) => ({
      id: item.id,
      postId: item.postContext?.postId,
    }))).toEqual([
      { id: first!.id, postId: "post-a" },
      { id: second!.id, postId: "post-b" },
    ]);
  });

  it("lists posts newest first and exposes every exact unanswered comment oldest first", async () => {
    const { app } = await makeApp();
    const interactions = await app.sacFlow.repository.listInteractions();
    const [oldPendingOlder, oldPendingNewer, oldAnswered, oldTeamReply, newPending] = interactions.slice(0, 5);
    expect(oldPendingOlder && oldPendingNewer && oldAnswered && oldTeamReply && newPending).toBeTruthy();

    const configure = async (
      id: string,
      options: {
        postId: string;
        publishedAt?: string;
        createdAt: string;
        status: "pending" | "escalated" | "resolved" | "replied";
        direction?: "inbound" | "outbound";
        actorId: string;
      },
    ) => app.sacFlow.repository.updateInteraction(id, (item) => {
      item.brandId = "brand-01";
      item.accountId = "account-01";
      item.channel = "instagram";
      item.type = "comment";
      item.direction = options.direction ?? "inbound";
      item.customerName = `Cliente ${options.actorId}`;
      item.customerHandle = `@${options.actorId}`;
      item.text = `Comentario ${id}`;
      item.status = options.status;
      item.createdAt = options.createdAt;
      item.updatedAt = options.createdAt;
      item.automation = undefined;
      item.responseText = undefined;
      item.respondedAt = undefined;
      item.metricoolRef = {
        actorId: options.actorId,
        postId: options.postId,
        commentId: `provider-${id}`,
        post: {
          id: options.postId,
          text: `Publicación ${options.postId}`,
          publishedAt: options.publishedAt,
        },
      };
    });

    await configure(oldPendingOlder!.id, {
      postId: "post-old", publishedAt: "2026-08-01T09:00:00.000Z", createdAt: "2026-08-18T10:00:00.000Z",
      status: "pending", actorId: "actor-a",
    });
    await configure(oldPendingNewer!.id, {
      postId: "post-old", publishedAt: "2026-08-01T09:00:00.000Z", createdAt: "2026-08-18T12:00:00.000Z",
      status: "escalated", actorId: "actor-b",
    });
    await configure(oldAnswered!.id, {
      postId: "post-old", publishedAt: "2026-08-01T09:00:00.000Z", createdAt: "2026-08-18T11:00:00.000Z",
      status: "resolved", actorId: "actor-c",
    });
    await configure(oldTeamReply!.id, {
      postId: "post-old", publishedAt: "2026-08-01T09:00:00.000Z", createdAt: "2026-08-18T13:00:00.000Z",
      status: "replied", direction: "outbound", actorId: "actor-a",
    });
    await configure(newPending!.id, {
      postId: "post-new", publishedAt: "2026-08-10T09:00:00.000Z", createdAt: "2026-08-12T10:00:00.000Z",
      status: "pending", actorId: "actor-d",
    });

    const posts = await app.inject({
      method: "GET",
      url: "/api/inbox/posts?accountId=account-01&channel=instagram&pendingOnly=true&page=1&pageSize=10",
    });
    expect(posts.statusCode).toBe(200);
    expect(posts.json()).toMatchObject({
      meta: {
        ordering: "newest_first",
        primarySort: "published_at",
        fallbackSort: "latest_comment_at",
        pendingOnly: true,
        externalWrites: false,
      },
    });
    const matchingPosts = posts.json().data.filter((post: { postContext: { postId: string } }) =>
      ["post-new", "post-old"].includes(post.postContext.postId));
    expect(matchingPosts.map((post: { postContext: { postId: string } }) => post.postContext.postId)).toEqual([
      "post-new",
      "post-old",
    ]);
    expect(matchingPosts[1]).toMatchObject({
      publishedAt: "2026-08-01T09:00:00.000Z",
      sortAt: "2026-08-01T09:00:00.000Z",
      sortSource: "published_at",
      commentCount: 3,
      pendingCount: 2,
      teamReplyCount: 1,
      participantCount: 3,
    });

    const postKey = matchingPosts[1].postKey as string;
    const pendingComments = await app.inject({
      method: "GET",
      url: `/api/inbox/posts/${postKey}/comments`,
    });
    expect(pendingComments.statusCode).toBe(200);
    expect(pendingComments.json()).toMatchObject({
      pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      meta: { pendingOnly: true, ordering: "oldest_first", externalWrites: false },
    });
    expect(pendingComments.json().data.map((item: { id: string }) => item.id)).toEqual([
      oldPendingOlder!.id,
      oldPendingNewer!.id,
    ]);
    expect(pendingComments.json().data.every((item: Record<string, unknown>) => !("metricoolRef" in item))).toBe(true);

    const allPostComments = await app.inject({
      method: "GET",
      url: `/api/inbox/posts/${postKey}/comments?pendingOnly=false`,
    });
    expect(allPostComments.statusCode).toBe(200);
    expect(allPostComments.json().data.map((item: { id: string }) => item.id)).toEqual([
      oldPendingOlder!.id,
      oldAnswered!.id,
      oldPendingNewer!.id,
      oldTeamReply!.id,
    ]);
  });

  it("organizes shared HTTPS resources per brand without touching the source file", async () => {
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        SAC_FLOW_TRUST_ACTOR_HEADERS: "true",
      },
    });
    const adminHeaders = { ...authHeaders, ...scopedActor("admin") };
    const brands = await app.inject({ method: "GET", url: "/api/brands", headers: adminHeaders });
    const brandId = brands.json().data[0].id as string;
    const forbidden = await app.inject({
      method: "POST",
      url: `/api/brands/${brandId}/resources`,
      headers: { ...authHeaders, ...scopedActor("agent") },
      payload: { name: "Manual restringido", url: "https://drive.google.com/file/d/restricted", kind: "brand_guide" },
    });
    expect(forbidden.statusCode).toBe(403);
    const created = await app.inject({
      method: "POST",
      url: `/api/brands/${brandId}/resources`,
      headers: adminHeaders,
      payload: { name: "Manual de tono", url: "https://drive.google.com/file/d/manual", kind: "brand_guide" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ meta: { externalWrites: false }, data: { kind: "brand_guide" } });
    const resourceId = created.json().data.id as string;
    const listed = await app.inject({ method: "GET", url: `/api/brands/${brandId}/resources`, headers: adminHeaders });
    expect(listed.json().meta.count).toBe(1);
    const removed = await app.inject({ method: "DELETE", url: `/api/brands/${brandId}/resources/${resourceId}`, headers: adminHeaders });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ meta: { deleted: true, externalWrites: false } });
  });

  it("versions, validates, publishes and rolls back workflow drafts", async () => {
    const { app } = await makeApp();
    const current = await app.inject({ method: "GET", url: "/api/workflow" });
    const workflow = current.json().data;
    workflow.nodes[0].position.x += 20;

    const saved = await app.inject({
      method: "PUT",
      url: "/api/workflow",
      payload: { nodes: workflow.nodes, edges: workflow.edges },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ version: 2, publishedVersion: 1 });
    expect(saved.json().meta.validation.valid).toBe(true);

    const validated = await app.inject({ method: "POST", url: "/api/workflow/validate", payload: {} });
    expect(validated.statusCode).toBe(200);
    expect(validated.json().data).toMatchObject({ valid: true, errors: 0 });

    const published = await app.inject({ method: "POST", url: "/api/workflow/publish", payload: { changeNote: "Versión probada" } });
    expect(published.statusCode).toBe(200);
    expect(published.json().data).toMatchObject({ version: 2, publishedVersion: 2 });

    const rollback = await app.inject({ method: "POST", url: "/api/workflow/rollback", payload: { version: 1 } });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().data).toMatchObject({ version: 3, publishedVersion: 2 });

    const versions = await app.inject({ method: "GET", url: "/api/workflow/versions" });
    expect(versions.statusCode).toBe(200);
    expect(versions.json().data.map((item: { version: number }) => item.version)).toEqual([3, 2, 1]);
  });

  it("persists the three supported workflow connector types and rejects unknown ones", async () => {
    const { app } = await makeApp();
    const current = await app.inject({ method: "GET", url: "/api/workflow" });
    const workflow = current.json().data;
    const connectorTypes = ["bezier", "straight", "smoothstep"] as const;
    connectorTypes.forEach((connectorType, index) => {
      workflow.edges[index].connectorType = connectorType;
    });

    const saved = await app.inject({
      method: "PUT",
      url: "/api/workflow",
      payload: { nodes: workflow.nodes, edges: workflow.edges },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.edges.slice(0, 3).map((edge: { connectorType: string }) => edge.connectorType)).toEqual(connectorTypes);

    const reloaded = await app.inject({ method: "GET", url: "/api/workflow" });
    expect(reloaded.json().data.edges.slice(0, 3).map((edge: { connectorType: string }) => edge.connectorType)).toEqual(connectorTypes);

    const invalidEdges = structuredClone(workflow.edges);
    invalidEdges[0].connectorType = "step";
    const invalid = await app.inject({
      method: "PUT",
      url: "/api/workflow",
      payload: { nodes: workflow.nodes, edges: invalidEdges },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("persists, filters and retries executions with lineage", async () => {
    const { app } = await makeApp();
    const first = await app.inject({ method: "POST", url: "/api/workflow/run", payload: { sampleSize: 10 } });
    expect(first.statusCode).toBe(200);
    const firstRun = first.json().data;

    const retry = await app.inject({ method: "POST", url: `/api/executions/${firstRun.id}/retry`, payload: {} });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data).toMatchObject({ kind: "simulation", retryOf: firstRun.id });

    const list = await app.inject({ method: "GET", url: "/api/executions?kind=simulation&pageSize=10" });
    expect(list.statusCode).toBe(200);
    expect(list.json().meta.total).toBe(2);
    expect(list.json().data[0].retryOf).toBe(firstRun.id);

    const detail = await app.inject({ method: "GET", url: `/api/executions/${firstRun.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.id).toBe(firstRun.id);
  });

  it("protects queue operations and idempotently requeues dead jobs", async () => {
    const { app } = await makeApp({ env: { SAC_FLOW_TRUST_ACTOR_HEADERS: "true" } });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/jobs",
      headers: scopedActor("agent"),
    });
    expect(forbidden.statusCode).toBe(403);

    const now = new Date().toISOString();
    const deadJobId = "00000000-0000-4000-8000-000000000301";
    await app.sacFlow.repository.enqueueJob({
      id: deadJobId,
      scheduleKey: "api-dead-job:1",
      kind: "sync",
      status: "queued",
      accountIds: ["account-01"],
      limit: 25,
      attempts: 0,
      maxAttempts: 1,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
    expect((await app.sacFlow.repository.claimNextJob("worker-api-dead", 60_000))?.id).toBe(deadJobId);
    expect(await app.sacFlow.repository.failJob(deadJobId, "worker-api-dead", "Fallo durable de prueba", 30_000)).toBe(true);

    const list = await app.inject({
      method: "GET",
      url: "/api/jobs?status=dead",
      headers: scopedActor("supervisor"),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      data: [{ id: deadJobId, status: "dead", attempts: 1, maxAttempts: 1, lastError: "Fallo durable de prueba" }],
      meta: { count: 1 },
    });

    const supervisorRetry = await app.inject({
      method: "POST",
      url: `/api/jobs/${deadJobId}/retry`,
      headers: scopedActor("supervisor"),
    });
    expect(supervisorRetry.statusCode).toBe(403);

    const retryHeaders = { ...scopedActor("admin"), "idempotency-key": "api-job-retry-301" };
    const validRetry = await app.inject({
      method: "POST",
      url: `/api/jobs/${deadJobId}/retry`,
      headers: retryHeaders,
    });
    expect(validRetry.statusCode).toBe(200);
    expect(validRetry.json()).toMatchObject({ data: { id: deadJobId, status: "queued", attempts: 0 }, meta: { requeued: true } });
    expect(validRetry.json().data).not.toHaveProperty("lastError");

    const replayedRetry = await app.inject({
      method: "POST",
      url: `/api/jobs/${deadJobId}/retry`,
      headers: retryHeaders,
    });
    expect(replayedRetry.statusCode).toBe(200);
    expect(replayedRetry.json().data).toMatchObject({ id: deadJobId, status: "queued", attempts: 0 });

    const retry = await app.inject({
      method: "POST",
      url: "/api/jobs/00000000-0000-4000-8000-000000000399/retry",
      headers: scopedActor("admin"),
    });
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe("JOB_NOT_RETRYABLE");
  });

  it("provides a secret-free production security audit", async () => {
    const { app } = await makeApp({ env: {
      SAC_FLOW_API_KEY: TEST_API_KEY,
      SAC_FLOW_REQUIRE_API_KEY: "true",
      SAC_FLOW_SECURITY_HEADERS: "true",
      SAC_FLOW_ENFORCE_ORIGIN_CHECK: "true",
      SAC_FLOW_RATE_LIMIT_ENABLED: "true",
      SAC_FLOW_CORS_ORIGINS: "https://sac.example.com",
      SAC_FLOW_DISABLE_OUTBOUND_SENDS: "true",
    } });
    const response = await app.inject({ method: "GET", url: "/api/security/audit", headers: authHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ ready: true });
    expect(response.json().data.score).toBeGreaterThan(60);
    expect(response.body).not.toContain(TEST_API_KEY);
  });

  it("adds a safe request correlation id to success and error responses", async () => {
    const { app } = await makeApp();

    const success = await app.inject({ method: "GET", url: "/api/health" });
    const missing = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    const successRequestId = success.headers["x-request-id"];
    const missingRequestId = missing.headers["x-request-id"];

    expect(success.statusCode).toBe(200);
    expect(missing.statusCode).toBe(404);
    expect(successRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(missingRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(successRequestId).not.toBe(missingRequestId);
  });

  it("reports an explicit demo mode and seeds exactly 20 accounts", async () => {
    const { app } = await makeApp();
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: "ok",
      mode: "demo",
      demoMode: true,
      metricool: { configured: false },
    });

    const brands = await app.inject({ method: "GET", url: "/api/brands" });
    expect(brands.statusCode).toBe(200);
    const body = brands.json();
    expect(body.data).toHaveLength(20);
    expect(new Set(body.data.map((brand: { account: { id: string } }) => brand.account.id)).size).toBe(20);
    expect(body.data[0].account.metricoolConfigured).toBe(false);
    expect(body.data[0].account.metricool.tokenConfigured).toBe(false);
  });

  it("fails closed when live is requested without credentials", async () => {
    await expect(makeApp({
      env: { METRICOOL_MODE: "live", METRICOOL_API_TOKEN: "" },
    })).rejects.toThrow("METRICOOL_MODE=live requiere METRICOOL_API_TOKEN");
  });

  it("defaults automatic delivery to shadow and requires an explicit live mode", async () => {
    const shadow = loadConfig({ METRICOOL_MODE: "demo" });
    const manualOnly = loadConfig({
      METRICOOL_MODE: "live",
      METRICOOL_API_TOKEN: "configured-token",
      SAC_FLOW_API_KEY: TEST_API_KEY,
      SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "true",
      SAC_FLOW_ENABLE_MANUAL_REPLIES: "true",
    });
    const live = loadConfig({
      METRICOOL_MODE: "live",
      METRICOOL_API_TOKEN: "configured-token",
      SAC_FLOW_API_KEY: TEST_API_KEY,
      SAC_FLOW_AUTO_REPLY_DISPATCH_MODE: "live",
    });

    expect(shadow.operations.autoReplyDispatchMode).toBe("shadow");
    expect(shadow.operations.autoReplyMaxPending).toBe(1_000);
    expect(shadow.operations.manualRepliesEnabled).toBe(false);
    expect(manualOnly.operations.manualRepliesEnabled).toBe(true);
    expect(manualOnly.operations.metricoolMutationsDisabled).toBe(true);
    expect(manualOnly.operations.autoReplyDispatchMode).toBe("shadow");
    expect(live.operations.autoReplyDispatchMode).toBe("live");
    expect(() => loadConfig({
      METRICOOL_MODE: "demo",
      SAC_FLOW_AUTO_REPLY_DISPATCH_MODE: "unsafe",
    })).toThrow();
    expect(() => loadConfig({
      METRICOOL_MODE: "demo",
      SAC_FLOW_AUTO_REPLY_MAX_PENDING: "0",
    })).toThrow();
  });

  it("fails closed for unsafe production persistence settings", async () => {
    expect(() => loadConfig({
      NODE_ENV: "production",
      METRICOOL_MODE: "live",
      METRICOOL_API_TOKEN: "configured-token",
      SAC_FLOW_API_KEY: TEST_API_KEY,
    })).toThrow("SAC_FLOW_REPOSITORY=json no está permitido en live");

    expect(() => loadConfig({
      METRICOOL_MODE: "demo",
      SAC_FLOW_REPOSITORY: "postgres",
    })).toThrow("SAC_FLOW_REPOSITORY=postgres requiere SAC_FLOW_POSTGRES_URL");

    expect(() => loadConfig({
      METRICOOL_MODE: "demo",
      SAC_FLOW_REPOSITORY: "postgres",
      SAC_FLOW_POSTGRES_URL: "postgres://sac-flow.invalid/db",
    })).toThrow("SAC_FLOW_REPOSITORY=postgres requiere SAC_FLOW_POSTGRES_ENCRYPTION_KEY");

    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-postgres-"));
    directories.push(directory);
    const config = loadConfig({
      METRICOOL_MODE: "demo",
      SAC_FLOW_REPOSITORY: "postgres",
      SAC_FLOW_POSTGRES_URL: "postgres://sac-flow.invalid/db",
      SAC_FLOW_POSTGRES_ENCRYPTION_KEY: "test-encryption-key",
    }, directory);
    expect(createRepository(config)).toBeInstanceOf(PostgresRepository);
  });

  it("protects live API endpoints with an API key while leaving health readable", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => []),
      listPostComments: vi.fn(async () => []),
      listReviews: vi.fn(async () => []),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: { METRICOOL_MODE: "live", METRICOOL_API_TOKEN: "configured-token" },
      client,
    });

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      mode: "live",
      security: { apiKeyRequired: true, cors: "same-origin" },
    });

    const blocked = await app.inject({ method: "GET", url: "/api/brands" });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error.code).toBe("UNAUTHORIZED");

    const rejectedSession = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { apiKey: "incorrect-key-123" },
    });
    expect(rejectedSession.statusCode).toBe(401);

    const session = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { apiKey: TEST_API_KEY },
    });
    expect(session.statusCode).toBe(204);
    const cookie = session.headers["set-cookie"]?.split(";", 1)[0];
    expect(cookie).toMatch(/^sac_flow_session=/);
    expect(session.headers["set-cookie"]).toContain("HttpOnly");
    expect(session.headers["set-cookie"]).toContain("SameSite=Strict");
    const cookieAllowed = await app.inject({ method: "GET", url: "/api/brands", headers: { cookie } });
    expect(cookieAllowed.statusCode).toBe(200);

    const allowed = await app.inject({ method: "GET", url: "/api/brands", headers: authHeaders });
    expect(allowed.statusCode).toBe(200);
  });

  it("keeps health and readiness readable for infrastructure probes", async () => {
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        SAC_FLOW_INBOX_SYNC_ENABLED: "true",
        SAC_FLOW_REQUIRE_ACTOR_CONTEXT: "true",
      },
    });

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().persistence).toMatchObject({ ready: true, driver: "json" });
    expect(health.json().operations).toMatchObject({ inboxSyncEnabled: true });

    const ready = await app.inject({ method: "GET", url: "/api/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      status: "ready",
      checks: {
        repository: { status: "ok", driver: "json", brands: 20 },
        metricool: { status: "ok", mode: "live", configured: true },
        inboxSync: {
          enabled: true,
          intervalMinutes: 5,
          lastRunStatus: "never",
        },
      },
    });
    expect(ready.json().checks.inboxSync).not.toHaveProperty("lastRunAt");
  });

  it("reports the dedicated inbox sync gate and the latest completed sync run", async () => {
    const { app } = await makeApp({
      env: { SAC_FLOW_INBOX_SYNC_ENABLED: "false" },
    });
    const totals = {
      fetched: 0,
      created: 0,
      duplicates: 0,
      drafted: 0,
      replied: 0,
      escalated: 0,
      errors: 0,
    };
    await app.sacFlow.repository.recordRun({
      id: "readiness-sync-older",
      kind: "sync",
      startedAt: "2026-08-17T10:00:00.000Z",
      finishedAt: "2026-08-17T10:01:00.000Z",
      status: "success",
      workflowVersion: 1,
      demoMode: true,
      accountIds: ["account-01"],
      totals,
      auditTrail: [],
    });
    await app.sacFlow.repository.recordRun({
      id: "readiness-sync-latest",
      kind: "sync",
      startedAt: "2026-08-17T10:05:00.000Z",
      finishedAt: "2026-08-17T10:06:00.000Z",
      status: "partial",
      workflowVersion: 1,
      demoMode: true,
      accountIds: ["account-01"],
      totals: { ...totals, errors: 1 },
      auditTrail: [],
    });
    await app.sacFlow.repository.recordRun({
      id: "readiness-simulation-newer",
      kind: "simulation",
      startedAt: "2026-08-17T10:10:00.000Z",
      finishedAt: "2026-08-17T10:11:00.000Z",
      status: "failed",
      workflowVersion: 1,
      demoMode: true,
      accountIds: ["account-01"],
      totals: { ...totals, errors: 1 },
      auditTrail: [],
    });

    const ready = await app.inject({ method: "GET", url: "/api/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks.inboxSync).toEqual({
      enabled: false,
      intervalMinutes: 5,
      lastRunAt: "2026-08-17T10:06:00.000Z",
      lastRunStatus: "partial",
    });
  });

  it("exposes aggregate Prometheus metrics only to supervisors or admins", async () => {
    const { app } = await makeApp({
      env: { SAC_FLOW_TRUST_ACTOR_HEADERS: "true" },
    });
    const failedAt = new Date(Date.now() - 120_000).toISOString();
    await app.sacFlow.repository.enqueueJob({
      id: "00000000-0000-4000-8000-000000000401",
      scheduleKey: "metrics-dead:1",
      kind: "sync",
      status: "dead",
      accountIds: ["account-01"],
      limit: 25,
      attempts: 5,
      maxAttempts: 5,
      nextAttemptAt: failedAt,
      createdAt: failedAt,
      updatedAt: failedAt,
      lastError: "Detalle interno que no debe entrar a Prometheus.",
    });
    await app.sacFlow.repository.enqueueJob({
      id: "00000000-0000-4000-8000-000000000402",
      scheduleKey: "metrics-retry:1",
      kind: "automation",
      workflowId: "workflow-sac-metricool",
      status: "retry",
      accountIds: [],
      limit: 25,
      attempts: 2,
      maxAttempts: 5,
      nextAttemptAt: failedAt,
      createdAt: failedAt,
      updatedAt: failedAt,
      lastError: "Otro detalle interno.",
    });

    const viewer = await app.inject({
      method: "GET",
      url: "/api/metrics",
      headers: scopedActor("viewer", "*"),
    });
    expect(viewer.statusCode).toBe(403);

    const metrics = await app.inject({
      method: "GET",
      url: "/api/metrics",
      headers: scopedActor("supervisor", "*"),
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers["content-type"]).toContain("text/plain");
    expect(metrics.body).toContain("# TYPE sac_flow_up gauge");
    expect(metrics.body).toContain('sac_flow_mode_info{mode="demo",repository="json"} 1');
    expect(metrics.body).toContain("sac_flow_pending_interactions_total");
    expect(metrics.body).toContain("sac_flow_sync_runs_total");
    expect(metrics.body).toContain('sac_flow_sync_items_total{outcome="error"}');
    expect(metrics.body).toContain("sac_flow_last_successful_sync_timestamp_seconds");
    expect(metrics.body).toContain("sac_flow_oldest_pending_age_seconds");
    expect(metrics.body).toContain('sac_flow_jobs_total{status="dead"} 1');
    expect(metrics.body).toContain('sac_flow_jobs_overdue_total{status="retry"} 1');
    const oldestDeadJob = metrics.body.match(/sac_flow_oldest_job_state_age_seconds\{status="dead"\} (\d+)/);
    expect(Number(oldestDeadJob?.[1])).toBeGreaterThanOrEqual(100);
    expect(metrics.body).not.toContain("Cliente 1");
    expect(metrics.body).not.toContain("@cliente_1");
    expect(metrics.body).not.toContain("Hola, ¿me pueden confirmar");
    expect(metrics.body).not.toContain("metrics-dead");
    expect(metrics.body).not.toContain("Detalle interno");
  });

  it("requires trusted actor context when configured", async () => {
    const { app } = await makeApp({
      env: { SAC_FLOW_REQUIRE_ACTOR_CONTEXT: "true" },
    });

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().security).toMatchObject({
      actorContextRequired: true,
      trustedActorHeaders: true,
    });

    const blocked = await app.inject({ method: "GET", url: "/api/brands" });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error.code).toBe("ACTOR_CONTEXT_REQUIRED");

    const allowed = await app.inject({
      method: "GET",
      url: "/api/brands",
      headers: scopedActor("viewer", "brand-01"),
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data).toHaveLength(1);
    expect(allowed.json().data[0].id).toBe("brand-01");

    const session = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: scopedActor("viewer", "brand-01"),
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().data).toEqual({
      userId: "user-viewer",
      displayName: "Usuario viewer",
      tenantId: "tenant-test",
      role: "viewer",
      brandIds: ["brand-01"],
    });
  });

  it("keeps the API error envelope when serving the frontend", async () => {
    const { app } = await makeApp({
      env: { SAC_FLOW_REQUIRE_ACTOR_CONTEXT: "true" },
      serveFrontend: true,
    });

    const blocked = await app.inject({ method: "GET", url: "/api/brands" });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error.code).toBe("ACTOR_CONTEXT_REQUIRED");

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/interactions?brandId=brand-02",
      headers: scopedActor("viewer", "brand-01"),
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("FORBIDDEN");

    const web = await app.inject({ method: "GET", url: "/", headers: { accept: "text/html" } });
    expect(web.statusCode).toBe(200);
    expect(web.headers["content-type"]).toContain("text/html");
  });

  it("enforces roles and brand scopes on sensitive routes", async () => {
    const { app } = await makeApp({
      env: { SAC_FLOW_TRUST_ACTOR_HEADERS: "true" },
    });

    const viewerWrite = await app.inject({
      method: "PUT",
      url: "/api/accounts/account-01/metricool",
      headers: scopedActor("viewer", "brand-01"),
      payload: { userId: "scoped-user-01", blogId: "scoped-blog-01" },
    });
    expect(viewerWrite.statusCode).toBe(403);
    expect(viewerWrite.json().error.code).toBe("FORBIDDEN");

    const wrongBrand = await app.inject({
      method: "PUT",
      url: "/api/accounts/account-01/metricool",
      headers: scopedActor("admin", "brand-02"),
      payload: { userId: "scoped-user-01", blogId: "scoped-blog-01" },
    });
    expect(wrongBrand.statusCode).toBe(403);
    expect(wrongBrand.json().error.code).toBe("FORBIDDEN");

    const saved = await app.inject({
      method: "PUT",
      url: "/api/accounts/account-01/metricool",
      headers: scopedActor("admin", "brand-01"),
      payload: { userId: "scoped-user-01", blogId: "scoped-blog-01" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain("scoped-user-01");
    expect(saved.body).not.toContain("scoped-blog-01");

    const brands = await app.inject({
      method: "GET",
      url: "/api/brands",
      headers: scopedActor("viewer", "brand-01"),
    });
    expect(brands.statusCode).toBe(200);
    expect(brands.json().data.map((brand: { id: string }) => brand.id)).toEqual(["brand-01"]);

    const stats = await app.inject({
      method: "GET",
      url: "/api/stats/summary",
      headers: scopedActor("viewer", "brand-01"),
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().data).toMatchObject({ total: 3 });
    expect(stats.json().data.byBrand).toHaveLength(1);

    const crossBrand = await app.inject({
      method: "GET",
      url: "/api/interactions?brandId=brand-02",
      headers: scopedActor("viewer", "brand-01"),
    });
    expect(crossBrand.statusCode).toBe(403);

    const crossSync = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...scopedActor("agent", "brand-01"), "idempotency-key": "scoped-sync-cross" },
      payload: { accountIds: ["account-02"] },
    });
    expect(crossSync.statusCode).toBe(403);

    const scopedSync = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...scopedActor("agent", "brand-01"), "idempotency-key": "scoped-sync-brand-01" },
      payload: {},
    });
    expect(scopedSync.statusCode).toBe(200);
    expect(scopedSync.json().data.run.accountIds).toEqual(["account-01"]);
    expect(scopedSync.json().data.run.totals).toMatchObject({ fetched: 2, created: 2 });
  });

  it("adds security headers and rate limits live API traffic without limiting probes", async () => {
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        SAC_FLOW_RATE_LIMIT_MAX: "2",
      },
    });

    const first = await app.inject({ method: "GET", url: "/api/health" });
    expect(first.statusCode).toBe(200);
    expect(first.headers["x-content-type-options"]).toBe("nosniff");
    expect(first.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(first.headers["content-security-policy"]).toContain("img-src 'self' data: https:");
    expect(first.headers["content-security-policy"]).toContain("media-src 'self' https:");

    const second = await app.inject({ method: "GET", url: "/api/brands", headers: authHeaders });
    expect(second.statusCode).toBe(200);

    const third = await app.inject({ method: "GET", url: "/api/brands", headers: authHeaders });
    expect(third.statusCode).toBe(200);

    const limited = await app.inject({ method: "GET", url: "/api/brands", headers: authHeaders });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.json().error.code).toBe("RATE_LIMITED");

    const readyAfterLimit = await app.inject({ method: "GET", url: "/api/ready" });
    expect(readyAfterLimit.statusCode).toBe(200);
  });

  it("rejects cross-site browser mutations and accepts allowlisted origins", async () => {
    const { app } = await makeApp({
      env: {
        NODE_ENV: "production",
        SAC_FLOW_API_KEY: TEST_API_KEY,
        SAC_FLOW_CORS_ORIGINS: "https://portal.example",
      },
    });

    const blocked = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, origin: "https://attacker.example" },
      payload: { accountIds: ["account-01"] },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("ORIGIN_NOT_ALLOWED");

    const fetchMetadataBlocked = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: {
        ...authHeaders,
        origin: "https://portal.example",
        "sec-fetch-site": "cross-site",
      },
      payload: { accountIds: ["account-01"] },
    });
    expect(fetchMetadataBlocked.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, origin: "https://portal.example" },
      payload: { accountIds: ["account-01"] },
    });
    expect(allowed.statusCode).toBe(200);

    const sameOrigin = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: {
        ...authHeaders,
        host: "127.0.0.1:8787",
        origin: "http://127.0.0.1:8787",
        "sec-fetch-site": "same-origin",
      },
      payload: { accountIds: ["account-01"] },
    });
    expect(sameOrigin.statusCode).toBe(200);

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json().security.originCheckEnabled).toBe(true);
  });

  it("lists, filters and paginates interactions and returns consistent stats", async () => {
    const { app } = await makeApp();
    const listed = await app.inject({
      method: "GET",
      url: "/api/interactions?channel=instagram&type=dm&page=1&pageSize=5",
    });
    expect(listed.statusCode).toBe(200);
    const listBody = listed.json();
    expect(listBody.data).toHaveLength(5);
    expect(listBody.data.every((item: { channel: string; type: string }) =>
      item.channel === "instagram" && item.type === "dm",
    )).toBe(true);
    expect(listBody.pagination).toMatchObject({ page: 1, pageSize: 5, total: 20, totalPages: 4 });

    const stats = await app.inject({ method: "GET", url: "/api/stats/summary?brandId=brand-01" });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().data).toMatchObject({ total: 3, dms: 2, comments: 1 });
    expect(stats.json().data.byBrand).toHaveLength(1);
  });

  it("lets portfolio admins create, update and deactivate brands without deleting history", async () => {
    const { app } = await makeApp({
      env: { SAC_FLOW_TRUST_ACTOR_HEADERS: "true" },
    });

    const viewerCreate = await app.inject({
      method: "POST",
      url: "/api/brands",
      headers: scopedActor("viewer", "*"),
      payload: {
        name: "Marca Nueva",
        accountHandle: "@marca_nueva",
        channels: ["instagram", "facebook"],
      },
    });
    expect(viewerCreate.statusCode).toBe(403);

    const scopedAdminCreate = await app.inject({
      method: "POST",
      url: "/api/brands",
      headers: scopedActor("admin", "brand-01"),
      payload: {
        name: "Marca Fuera Scope",
        accountHandle: "@marca_fuera_scope",
        channels: ["instagram"],
      },
    });
    expect(scopedAdminCreate.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/brands",
      headers: scopedActor("admin", "*"),
      payload: {
        id: "brand-21",
        accountId: "account-21",
        name: "Marca Nueva",
        color: "#22c55e",
        accountName: "Marca Nueva IG",
        accountHandle: "marca_nueva",
        channels: ["instagram", "facebook"],
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      data: {
        id: "brand-21",
        name: "Marca Nueva",
        color: "#22c55e",
        active: true,
        account: {
          id: "account-21",
          brandId: "brand-21",
          name: "Marca Nueva IG",
          handle: "@marca_nueva",
          active: true,
          metricoolConfigured: false,
        },
      },
      meta: { created: true, externalWrites: false },
    });
    expect(created.body).not.toContain("userId");
    expect(created.body).not.toContain("blogId");

    const duplicateHandle = await app.inject({
      method: "POST",
      url: "/api/brands",
      headers: scopedActor("admin", "*"),
      payload: {
        name: "Duplicada",
        accountHandle: "@marca_nueva",
        channels: ["instagram"],
      },
    });
    expect(duplicateHandle.statusCode).toBe(409);
    expect(duplicateHandle.json().error.code).toBe("ACCOUNT_HANDLE_ALREADY_EXISTS");

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/brands/brand-21",
      headers: scopedActor("admin", "brand-21"),
      payload: {
        name: "Marca Nueva Editada",
        accountHandle: "@marca_nueva_editada",
        channels: ["facebook"],
        accountActive: true,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({
      id: "brand-21",
      name: "Marca Nueva Editada",
      account: {
        handle: "@marca_nueva_editada",
        channels: ["facebook"],
      },
    });

    await app.inject({
      method: "PUT",
      url: "/api/workflow",
      headers: scopedActor("admin", "*"),
      payload: { autoReplyEnabled: true, autoReplyAccountIds: ["account-21"] },
    });

    const deactivated = await app.inject({
      method: "DELETE",
      url: "/api/brands/brand-21",
      headers: scopedActor("admin", "brand-21"),
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json()).toMatchObject({
      data: { id: "brand-21", active: false, account: { active: false } },
      meta: { deactivated: true, autoReplyRemoved: true, externalWrites: false },
    });

    const workflow = await app.inject({
      method: "GET",
      url: "/api/workflow",
      headers: scopedActor("viewer", "*"),
    });
    expect(workflow.json().data).toMatchObject({ autoReplyEnabled: false, autoReplyAccountIds: [] });

    const brands = await app.inject({
      method: "GET",
      url: "/api/brands",
      headers: scopedActor("viewer", "*"),
    });
    expect(brands.json().data).toHaveLength(21);
    expect(brands.json().data.find((brand: { id: string }) => brand.id === "brand-21")).toMatchObject({
      active: false,
      account: { active: false },
    });
  });

  it("stores and clears Metricool account references without exposing them in API responses", async () => {
    const { app } = await makeApp();
    const saved = await app.inject({
      method: "PUT",
      url: "/api/accounts/account-01/metricool",
      payload: { userId: "user-secret-01", blogId: "blog-secret-01" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({
      accountId: "account-01",
      metricoolConfigured: false,
      metricool: {
        referenceStored: true,
        tokenConfigured: false,
        liveReady: false,
        source: "stored",
      },
    });
    expect(saved.body).not.toContain("user-secret-01");
    expect(saved.body).not.toContain("blog-secret-01");

    const brands = await app.inject({ method: "GET", url: "/api/brands" });
    expect(brands.statusCode).toBe(200);
    expect(brands.json().data[0].account.metricool).toMatchObject({
      referenceStored: true,
      source: "stored",
    });
    expect(brands.body).not.toContain("user-secret-01");
    expect(brands.body).not.toContain("blog-secret-01");

    await app.inject({
      method: "PUT",
      url: "/api/workflow",
      payload: { autoReplyEnabled: true, autoReplyAccountIds: ["account-01"] },
    });

    const cleared = await app.inject({ method: "DELETE", url: "/api/accounts/account-01/metricool" });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data.metricool).toMatchObject({
      referenceStored: false,
      source: "none",
      liveReady: false,
    });
    expect(cleared.body).not.toContain("user-secret-01");
    expect(cleared.body).not.toContain("blog-secret-01");

    const workflow = await app.inject({ method: "GET", url: "/api/workflow" });
    expect(workflow.json().data).toMatchObject({
      autoReplyEnabled: false,
      autoReplyAccountIds: [],
    });
  });

  it("returns interaction detail with brand context and audit trail", async () => {
    const { app } = await makeApp();
    const listed = await app.inject({ method: "GET", url: "/api/interactions?pageSize=1" });
    const item = listed.json().data[0] as { id: string; brandId: string };

    const detail = await app.inject({ method: "GET", url: `/api/interactions/${item.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({
      id: item.id,
      brandId: item.brandId,
      brandName: expect.any(String),
      accountHandle: expect.any(String),
    });
    expect(detail.json().data.audit.length).toBeGreaterThan(0);
    expect(detail.json().data.audit[0]).toMatchObject({ action: "ingested" });
  });

  it("validates updates and keeps auto-reply opt-in by account", async () => {
    const { app } = await makeApp();
    const invalid = await app.inject({
      method: "PUT",
      url: "/api/workflow",
      payload: { pollIntervalMinutes: 4, secret: "must-not-leak" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("VALIDATION_ERROR");
    expect(invalid.body).not.toContain("must-not-leak");

    const updated = await app.inject({
      method: "PUT",
      url: "/api/workflow",
      payload: {
        pollIntervalMinutes: 10,
        autoReplyEnabled: true,
        autoReplyAccountIds: ["account-01"],
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({
      pollIntervalMinutes: 10,
      autoReplyEnabled: true,
      autoReplyAccountIds: ["account-01"],
    });
  });

  it("does not allow mandatory human-review categories to be removed", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "PUT",
      url: "/api/workflow",
      payload: { requireHumanFor: [] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.requireHumanFor).toEqual(expect.arrayContaining([
      "amenaza",
      "datos_personales",
      "fraude",
      "legal",
      "pago",
      "reclamo",
      "salud",
    ]));
  });

  it("simulates workflow runs without external writes and replays idempotently", async () => {
    const { app } = await makeApp();
    const request = {
      method: "POST" as const,
      url: "/api/workflow/run",
      headers: { "idempotency-key": "workflow-run-001" },
      payload: { accountIds: ["account-01"], sampleSize: 10 },
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(200);
    expect(first.json().meta).toMatchObject({ simulated: true, externalWrites: false });
    expect(first.json().data.auditTrail.length).toBeGreaterThan(3);

    const second = await app.inject(request);
    expect(second.statusCode).toBe(200);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect(second.json().data.id).toBe(first.json().data.id);
  });

  it("processes existing cases through the SAC protocol without external writes", async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/sac/protocol/evaluate",
      headers: { "idempotency-key": "sac-protocol-account-01" },
      payload: { accountIds: ["account-01"], limit: 20 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().meta).toMatchObject({ externalWrites: false, localWrites: true });
    expect(response.json().data).toMatchObject({ evaluated: 2, drafted: 1, escalated: 1 });
    expect(response.json().data).not.toHaveProperty("interactions");

    const stats = await app.inject({ method: "GET", url: "/api/stats/summary" });
    expect(stats.json().data.automationEvaluated).toBe(2);
    expect(stats.json().data.knowledgeBlocked).toBeGreaterThan(0);
  });

  it("turns auto-replies into drafts in simulations when outbound sends are disabled", async () => {
    const { app } = await makeApp({
      env: { SAC_FLOW_DISABLE_OUTBOUND_SENDS: "true" },
    });
    const updated = await app.inject({
      method: "PUT",
      url: "/api/workflow",
      payload: {
        autoReplyEnabled: true,
        autoReplyAccountIds: ["account-01"],
        minimumConfidence: 0.5,
      },
    });
    expect(updated.statusCode).toBe(200);

    const run = await app.inject({
      method: "POST",
      url: "/api/workflow/run",
      payload: { accountIds: ["account-01"], sampleSize: 10 },
    });
    expect(run.statusCode).toBe(200);
    expect(run.json().data.totals.replied).toBe(0);
    expect(run.json().data.totals.drafted).toBeGreaterThan(0);
    expect(JSON.stringify(run.json().data.auditTrail)).toContain("cortacorriente");

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json().operations).toMatchObject({ outboundSendsDisabled: true });
  });

  it("performs demo polling for all 20 accounts and does not duplicate an idempotent retry", async () => {
    const { app } = await makeApp();
    const request = {
      method: "POST" as const,
      url: "/api/sync",
      headers: { "idempotency-key": "sync-all-accounts-001" },
      payload: { limit: 50 },
    };
    const first = await app.inject(request);
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.data.run.accountIds).toHaveLength(20);
    expect(firstBody.data.run.totals).toMatchObject({ fetched: 40, created: 40, errors: 0 });
    expect(firstBody.data.run.totals.drafted).toBe(40);
    expect(firstBody.data.newInteractions).toBe(40);
    expect(first.body).not.toContain("metricoolRef");
    expect(firstBody.meta).toMatchObject({ demoMode: true, externalWrites: false });

    const second = await app.inject(request);
    expect(second.headers["idempotent-replay"]).toBe("true");
    const listed = await app.inject({ method: "GET", url: "/api/interactions?pageSize=200" });
    expect(listed.json().pagination.total).toBe(100);
  });

  it("uses stable demo provider ids to prove deduplication across distinct sync requests", async () => {
    const { app } = await makeApp();
    const first = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { "idempotency-key": "stable-demo-sync-first" },
      payload: { accountIds: ["account-01"] },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { "idempotency-key": "stable-demo-sync-second" },
      payload: { accountIds: ["account-01"] },
    });
    expect(first.json().data.run.totals).toMatchObject({ fetched: 2, created: 2, duplicates: 0 });
    expect(second.json().data.run.totals).toMatchObject({ fetched: 2, created: 0, duplicates: 2 });
  });

  it("saves drafts, simulates safe sends, and blocks sensitive sends without approval", async () => {
    const { app } = await makeApp();
    const safeList = await app.inject({
      method: "GET",
      url: "/api/interactions?brandId=brand-01&type=dm&sentiment=neutral&pageSize=10",
    });
    const safeInteraction = safeList.json().data[0] as { id: string; version: number };
    const safeId = safeInteraction.id;
    const draft = await app.inject({
      method: "POST",
      url: `/api/interactions/${safeId}/reply`,
      payload: { text: "Te compartimos la información solicitada.", mode: "draft", expectedVersion: safeInteraction.version },
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({ data: { status: "drafted" }, meta: { delivery: "draft_saved" } });

    const sent = await app.inject({
      method: "POST",
      url: `/api/interactions/${safeId}/reply`,
      payload: { text: "Respuesta demo", mode: "send", expectedVersion: draft.json().data.version },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ data: { status: "replied" }, meta: { delivery: "demo_simulated" } });

    const sensitiveList = await app.inject({
      method: "GET",
      url: "/api/interactions?sentiment=negative&pageSize=1",
    });
    const sensitiveInteraction = sensitiveList.json().data[0] as { id: string; version: number };
    const sensitiveId = sensitiveInteraction.id;
    const blocked = await app.inject({
      method: "POST",
      url: `/api/interactions/${sensitiveId}/reply`,
      payload: { text: "Respuesta automática", mode: "send", expectedVersion: sensitiveInteraction.version },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("HUMAN_REVIEW_REQUIRED");
  });

  it("lets an agent attempt an old reply and delegates final acceptance to Metricool", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => []),
      listPostComments: vi.fn(async () => []),
      listReviews: vi.fn(async () => []),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ id: "metricool-old-comment-reply" })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        SAC_FLOW_DISABLE_OUTBOUND_SENDS: "false",
        SAC_FLOW_ENABLE_MANUAL_REPLIES: "true",
        SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "true",
        SAC_FLOW_AUTO_REPLY_DISPATCH_MODE: "shadow",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1" },
        }),
      },
      client,
    });
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json()).toMatchObject({
      operations: {
        outboundSendsDisabled: false,
        manualRepliesEnabled: true,
        metricoolMutationsDisabled: true,
        autoReplyDispatchMode: "shadow",
      },
    });
    const comment = (await app.sacFlow.repository.listInteractions({ accountId: "account-01", type: "comment" }))[0];
    expect(comment).toBeDefined();
    const updated = await app.sacFlow.repository.updateInteraction(comment!.id, (interaction) => {
      interaction.createdAt = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
      interaction.status = "pending";
      interaction.metricoolRef = { objectId: "old-comment-1", provider: "FACEBOOK" };
    });
    expect(updated).toBeDefined();

    const draft = await app.inject({
      method: "POST",
      url: `/api/interactions/${comment!.id}/reply`,
      headers: authHeaders,
      payload: { text: "Borrador para registro", mode: "draft", expectedVersion: updated!.version },
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().data.status).toBe("drafted");

    const sent = await app.inject({
      method: "POST",
      url: `/api/interactions/${comment!.id}/reply`,
      headers: { ...authHeaders, "idempotency-key": "old-comment-manual-attempt" },
      payload: { text: "Respuesta aprobada", mode: "send", approvedByHuman: true, expectedVersion: draft.json().data.version },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ data: { status: "replied" }, meta: { delivery: "sent" } });
    expect(client.replyToPostComment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", blogId: "blog-1" }),
      { text: "Respuesta aprobada", objectId: "old-comment-1", provider: "FACEBOOK" },
    );
  });

  it("keeps automatic sends blocked when only human-approved replies are enabled", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => []),
      listPostComments: vi.fn(async () => []),
      listReviews: vi.fn(async () => []),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        SAC_FLOW_DISABLE_OUTBOUND_SENDS: "false",
        SAC_FLOW_ENABLE_MANUAL_REPLIES: "true",
        SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "true",
        SAC_FLOW_AUTO_REPLY_DISPATCH_MODE: "shadow",
      },
      client,
    });
    const interaction = (await app.sacFlow.repository.listInteractions())
      .find((item) => item.direction === "inbound");
    expect(interaction).toBeDefined();

    const blocked = await app.inject({
      method: "POST",
      url: `/api/interactions/${interaction!.id}/reply`,
      headers: { ...authHeaders, "idempotency-key": "automatic-send-must-stay-blocked" },
      payload: {
        text: "No debe salir automáticamente",
        mode: "send",
        approvedByHuman: false,
        expectedVersion: interaction!.version,
      },
    });

    expect(blocked.statusCode).toBe(423);
    expect(blocked.json().error.code).toBe("METRICOOL_MUTATIONS_DISABLED");
    expect(client.replyToConversation).not.toHaveBeenCalled();
    expect(client.replyToPostComment).not.toHaveBeenCalled();
    expect(client.replyToReview).not.toHaveBeenCalled();
  });

  it("blocks a human-approved live reply until the manual-only gate is enabled", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => []),
      listPostComments: vi.fn(async () => []),
      listReviews: vi.fn(async () => []),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        SAC_FLOW_DISABLE_OUTBOUND_SENDS: "false",
        SAC_FLOW_ENABLE_MANUAL_REPLIES: "false",
        SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "true",
      },
      client,
    });
    const interaction = (await app.sacFlow.repository.listInteractions())
      .find((item) => item.direction === "inbound");
    expect(interaction).toBeDefined();

    const blocked = await app.inject({
      method: "POST",
      url: `/api/interactions/${interaction!.id}/reply`,
      headers: { ...authHeaders, "idempotency-key": "manual-send-gate-must-stay-closed" },
      payload: {
        text: "No debe salir sin autorización manual",
        mode: "send",
        approvedByHuman: true,
        expectedVersion: interaction!.version,
      },
    });

    expect(blocked.statusCode).toBe(423);
    expect(blocked.json().error.code).toBe("MANUAL_REPLIES_DISABLED");
    expect(client.replyToConversation).not.toHaveBeenCalled();
    expect(client.replyToPostComment).not.toHaveBeenCalled();
    expect(client.replyToReview).not.toHaveBeenCalled();
  });

  it("keeps the reply as a draft when Metricool explicitly rejects an old manual attempt", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => []),
      listPostComments: vi.fn(async () => []),
      listReviews: vi.fn(async () => []),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => {
        throw new MetricoolRequestError(400, "/v2/inbox/post-comments");
      }),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "false",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1" },
        }),
      },
      client,
    });
    const comment = (await app.sacFlow.repository.listInteractions({ accountId: "account-01", type: "comment" }))[0];
    expect(comment).toBeDefined();
    const updated = await app.sacFlow.repository.updateInteraction(comment!.id, (interaction) => {
      interaction.createdAt = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
      interaction.status = "pending";
      interaction.responseText = undefined;
      interaction.metricoolRef = { objectId: "old-comment-rejected", provider: "FACEBOOK" };
    });

    const rejected = await app.inject({
      method: "POST",
      url: `/api/interactions/${comment!.id}/reply`,
      headers: { ...authHeaders, "idempotency-key": "old-comment-rejected-attempt" },
      payload: {
        text: "Conservar esta respuesta",
        mode: "send",
        approvedByHuman: true,
        expectedVersion: updated!.version,
      },
    });

    expect(rejected.statusCode).toBe(502);
    expect(rejected.json().error.code).toBe("METRICOOL_ERROR");
    expect(await app.sacFlow.repository.findInteraction(comment!.id)).toMatchObject({
      status: "drafted",
      responseText: "Conservar esta respuesta",
    });
    expect(await app.sacFlow.repository.listReplyDeliveries({ interactionId: comment!.id })).toEqual([
      expect.objectContaining({ status: "failed", errorCode: "METRICOOL_HTTP_400" }),
    ]);
  });

  it("blocks outbound sends with a kill switch while still allowing drafts", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => []),
      listPostComments: vi.fn(async () => []),
      listReviews: vi.fn(async () => []),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        SAC_FLOW_DISABLE_OUTBOUND_SENDS: "true",
      },
      client,
    });
    const safeList = await app.inject({
      method: "GET",
      url: "/api/interactions?brandId=brand-01&type=dm&sentiment=neutral&pageSize=1",
      headers: authHeaders,
    });
    const safeInteraction = safeList.json().data[0] as { id: string; version: number };
    const safeId = safeInteraction.id;

    const blocked = await app.inject({
      method: "POST",
      url: `/api/interactions/${safeId}/reply`,
      headers: authHeaders,
      payload: { text: "Respuesta aprobada", mode: "send", approvedByHuman: true, expectedVersion: safeInteraction.version },
    });
    expect(blocked.statusCode).toBe(423);
    expect(blocked.json().error.code).toBe("OUTBOUND_SENDS_DISABLED");
    expect(client.replyToConversation).not.toHaveBeenCalled();
    expect(client.replyToPostComment).not.toHaveBeenCalled();

    const draft = await app.inject({
      method: "POST",
      url: `/api/interactions/${safeId}/reply`,
      headers: authHeaders,
      payload: { text: "Borrador seguro", mode: "draft", expectedVersion: safeInteraction.version },
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({ data: { status: "drafted" }, meta: { delivery: "draft_saved" } });
  });

  it("updates interaction status with an audited agent action", async () => {
    const { app } = await makeApp();
    const interactions = await app.inject({ method: "GET", url: "/api/interactions?status=pending&pageSize=1" });
    const interaction = interactions.json().data[0] as { id: string; version: number };
    const id = interaction.id;

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/interactions/${id}/status`,
      payload: {
        status: "resolved",
        reasonCode: "answered",
        reasonNote: "Caso cerrado desde QA.",
        expectedVersion: interaction.version,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      data: { id, status: "resolved", version: interaction.version + 1 },
      meta: { statusChanged: true },
    });
    expect(updated.body).not.toContain("metricoolRef");
    const detail = await app.inject({ method: "GET", url: `/api/interactions/${id}` });
    expect(detail.json().data.statusReason).toMatchObject({
      code: "answered",
      label: "Consulta respondida",
      note: "Caso cerrado desde QA.",
    });
    expect(detail.json().data.audit.at(-1)).toMatchObject({
      action: "status_changed",
      actor: "agent",
      detail: "Consulta respondida: Caso cerrado desde QA.",
      metadata: { status: "resolved", reasonCode: "answered" },
    });

    const resolved = await app.inject({ method: "GET", url: "/api/interactions?status=resolved&pageSize=10" });
    expect(resolved.json().data.some((item: { id: string }) => item.id === id)).toBe(true);
  });

  it("publishes status reason catalogs and rejects invalid or incomplete reasons", async () => {
    const { app } = await makeApp();
    const catalog = await app.inject({ method: "GET", url: "/api/status-reasons" });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().data).toMatchObject({
      escalated: expect.arrayContaining([{ code: "legal_or_privacy", label: "Legal o privacidad" }]),
      resolved: expect.arrayContaining([{ code: "answered", label: "Consulta respondida" }]),
    });

    const listed = await app.inject({ method: "GET", url: "/api/interactions?pageSize=1" });
    const interaction = listed.json().data[0] as { id: string; version: number };
    const invalid = await app.inject({
      method: "PATCH",
      url: `/api/interactions/${interaction.id}/status`,
      payload: { status: "resolved", reasonCode: "invented", expectedVersion: interaction.version },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("INVALID_STATUS_REASON");

    const missingNote = await app.inject({
      method: "PATCH",
      url: `/api/interactions/${interaction.id}/status`,
      payload: { status: "escalated", reasonCode: "other", expectedVersion: interaction.version },
    });
    expect(missingNote.statusCode).toBe(400);
    expect(missingNote.json().error.code).toBe("STATUS_REASON_NOTE_REQUIRED");
  });

  it("coordinates agents with claim, internal notes and release without external writes", async () => {
    const { app } = await makeApp({
      env: {
        SAC_FLOW_TRUST_ACTOR_HEADERS: "true",
        SAC_FLOW_REQUIRE_ACTOR_CONTEXT: "true",
      },
    });
    const headers = scopedActor("agent", "brand-01");
    const listed = await app.inject({
      method: "GET",
      url: "/api/interactions?brandId=brand-01&pageSize=1",
      headers,
    });
    const initial = listed.json().data[0] as { id: string; version: number };

    const claimed = await app.inject({
      method: "PUT",
      url: `/api/interactions/${initial.id}/assignment`,
      headers,
      payload: { action: "claim", expectedVersion: initial.version },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({
      data: { id: initial.id, version: initial.version + 1 },
      meta: { assignmentChanged: true },
    });
    expect(claimed.body).not.toContain("metricoolRef");
    const assignedList = await app.inject({
      method: "GET",
      url: "/api/interactions?brandId=brand-01&assignment=assigned&assigneeId=user-agent&pageSize=10",
      headers,
    });
    expect(assignedList.statusCode).toBe(200);
    expect(assignedList.json().data.find((item: { id: string }) => item.id === initial.id)?.assignedTo).toEqual({
      userId: "user-agent",
      displayName: "Usuario agent",
    });

    const noteText = "Cliente solicita seguimiento del número de pedido por canal interno.";
    const noted = await app.inject({
      method: "POST",
      url: `/api/interactions/${initial.id}/notes`,
      headers,
      payload: { text: noteText, expectedVersion: claimed.json().data.version },
    });
    expect(noted.statusCode).toBe(200);
    expect(noted.json()).toMatchObject({
      data: { id: initial.id, version: initial.version + 2 },
      meta: { noteCreated: true, externalWrites: false },
    });
    expect(noted.body).not.toContain("metricoolRef");
    expect(noted.body).not.toContain(noteText);
    const notedDetail = await app.inject({ method: "GET", url: `/api/interactions/${initial.id}`, headers });
    expect(notedDetail.json().data.internalNotes).toEqual([
      expect.objectContaining({ authorId: "user-agent", authorName: "Usuario agent", text: noteText }),
    ]);
    const auditOnly = JSON.stringify(notedDetail.json().data.audit);
    expect(auditOnly).not.toContain(noteText);
    expect(notedDetail.json().data.audit.at(-1)).toMatchObject({ action: "note_added", actor: "agent" });

    const released = await app.inject({
      method: "PUT",
      url: `/api/interactions/${initial.id}/assignment`,
      headers,
      payload: { action: "release", expectedVersion: noted.json().data.version },
    });
    expect(released.statusCode).toBe(200);
    expect(released.json().data).toMatchObject({ id: initial.id, version: initial.version + 3 });
    const releasedDetail = await app.inject({ method: "GET", url: `/api/interactions/${initial.id}`, headers });
    expect(releasedDetail.json().data.assignedTo).toBeUndefined();
    expect(releasedDetail.json().data.audit.at(-1)).toMatchObject({ action: "unassigned" });
  });

  it("rejects stale case writes and returns the current safe version", async () => {
    const { app } = await makeApp({
      env: {
        SAC_FLOW_TRUST_ACTOR_HEADERS: "true",
        SAC_FLOW_REQUIRE_ACTOR_CONTEXT: "true",
      },
    });
    const headers = scopedActor("agent", "brand-01");
    const listed = await app.inject({
      method: "GET",
      url: "/api/interactions?brandId=brand-01&pageSize=1",
      headers,
    });
    const initial = listed.json().data[0] as { id: string; version: number };

    const first = await app.inject({
      method: "POST",
      url: `/api/interactions/${initial.id}/notes`,
      headers,
      payload: { text: "Primera actualización.", expectedVersion: initial.version },
    });
    expect(first.statusCode).toBe(200);

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/interactions/${initial.id}/status`,
      headers,
      payload: { status: "resolved", reasonCode: "answered", expectedVersion: initial.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: {
        code: "INTERACTION_VERSION_CONFLICT",
        details: { expectedVersion: initial.version, currentVersion: initial.version + 1 },
      },
    });

    const detail = await app.inject({ method: "GET", url: `/api/interactions/${initial.id}`, headers });
    expect(detail.json().data.status).not.toBe("resolved");
    expect(detail.json().data.internalNotes).toHaveLength(1);
  });

  it("enforces assignment roles and brand scope", async () => {
    const { app } = await makeApp({
      env: {
        SAC_FLOW_TRUST_ACTOR_HEADERS: "true",
        SAC_FLOW_REQUIRE_ACTOR_CONTEXT: "true",
      },
    });
    const supervisorHeaders = scopedActor("supervisor", "brand-01");
    const agentHeaders = scopedActor("agent", "brand-01");
    const viewerHeaders = scopedActor("viewer", "brand-01");
    const listed = await app.inject({
      method: "GET",
      url: "/api/interactions?brandId=brand-01&pageSize=1",
      headers: supervisorHeaders,
    });
    const initial = listed.json().data[0] as { id: string; version: number };

    const viewerBlocked = await app.inject({
      method: "POST",
      url: `/api/interactions/${initial.id}/notes`,
      headers: viewerHeaders,
      payload: { text: "No autorizado", expectedVersion: initial.version },
    });
    expect(viewerBlocked.statusCode).toBe(403);

    const transferBlocked = await app.inject({
      method: "PUT",
      url: `/api/interactions/${initial.id}/assignment`,
      headers: agentHeaders,
      payload: {
        action: "assign",
        expectedVersion: initial.version,
        userId: "user-target",
        displayName: "Agente destino",
      },
    });
    expect(transferBlocked.statusCode).toBe(403);

    const assigned = await app.inject({
      method: "PUT",
      url: `/api/interactions/${initial.id}/assignment`,
      headers: supervisorHeaders,
      payload: {
        action: "assign",
        expectedVersion: initial.version,
        userId: "user-target",
        displayName: "Agente destino",
      },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().data).toMatchObject({ id: initial.id, version: initial.version + 1 });
    const assignedDetail = await app.inject({
      method: "GET",
      url: `/api/interactions/${initial.id}`,
      headers: supervisorHeaders,
    });
    expect(assignedDetail.json().data.assignedTo).toEqual({ userId: "user-target", displayName: "Agente destino" });

    const otherBrand = await app.inject({
      method: "POST",
      url: `/api/interactions/${initial.id}/notes`,
      headers: scopedActor("agent", "brand-02"),
      payload: { text: "Fuera de scope", expectedVersion: assigned.json().data.version },
    });
    expect(otherBrand.statusCode).toBe(403);
  });

  it("requires confirmation and an account allowlist before enabling live auto-replies", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => []),
      listPostComments: vi.fn(async () => []),
      listReviews: vi.fn(async () => []),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: { METRICOOL_MODE: "live", METRICOOL_API_TOKEN: "configured-token" },
      client,
    });
    const blocked = await app.inject({
      method: "PUT",
      url: "/api/workflow",
      headers: authHeaders,
      payload: { autoReplyEnabled: true, autoReplyAccountIds: ["account-01"] },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("AUTO_REPLY_CONFIRMATION_REQUIRED");

    const allowed = await app.inject({
      method: "PUT",
      url: "/api/workflow",
      headers: authHeaders,
      payload: {
        autoReplyEnabled: true,
        autoReplyAccountIds: ["account-01"],
        confirmAutoReply: true,
      },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data.autoReplyEnabled).toBe(true);
  });

  it("exports a valid workbook with Interacciones and Resumen sheets", async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: "GET", url: "/api/export/xlsx" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml.sheet");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.rawPayload);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Interacciones", "Resumen"]);
    expect(workbook.getWorksheet("Interacciones")?.rowCount).toBe(61);
  });

  it("neutralizes formula-like text in Excel exports", async () => {
    const { app } = await makeApp();
    const listed = await app.inject({ method: "GET", url: "/api/interactions?pageSize=1" });
    const id = listed.json().data[0].id as string;
    await app.sacFlow.repository.updateInteraction(id, (interaction) => {
      interaction.text = "=HYPERLINK(\"https://example.com\",\"abrir\")";
      interaction.customerHandle = "+usuario";
      interaction.responseText = "@respuesta";
    });

    const response = await app.inject({ method: "GET", url: "/api/export/xlsx" });
    expect(response.statusCode).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.rawPayload);
    const sheet = workbook.getWorksheet("Interacciones");
    let exportedRow: ExcelJS.Row | undefined;
    sheet?.eachRow((row) => {
      if (row.getCell(1).value === id) exportedRow = row;
    });
    expect(exportedRow?.getCell(9).value).toBe("'+usuario");
    expect(exportedRow?.getCell(10).value).toBe("'=HYPERLINK(\"https://example.com\",\"abrir\")");
    expect(exportedRow?.getCell(17).value).toBe("'@respuesta");
  });

  it("rejects concurrent inbox syncs and releases the single-flight lock", async () => {
    let releaseFirstRead!: () => void;
    const firstReadGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let markFirstReadStarted!: () => void;
    const firstReadStarted = new Promise<void>((resolve) => {
      markFirstReadStarted = resolve;
    });
    let shouldBlock = true;
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => {
        if (shouldBlock) {
          shouldBlock = false;
          markFirstReadStarted();
          await firstReadGate;
        }
        return { data: [] };
      }),
      listPostComments: vi.fn(async () => ({ data: [] })),
      listReviews: vi.fn(async () => ({ data: [] })),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1", instagramProvider: "INSTAGRAMBUSINESS" },
        }),
      },
      client,
    });
    const payload = { accountIds: ["account-01"] };
    const first = app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "single-flight-first" },
      payload,
    });
    await firstReadStarted;

    const concurrent = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "single-flight-second" },
      payload,
    });
    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json().error.code).toBe("SYNC_IN_PROGRESS");

    releaseFirstRead();
    expect((await first).statusCode).toBe(200);

    const afterRelease = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "single-flight-third" },
      payload,
    });
    expect(afterRelease.statusCode).toBe(200);
  });

  it("uses the Metricool gateway in live sync without exposing credentials", async () => {
    const token = "top-secret-metricool-token";
    const client: MetricoolGateway = {
      listConversations: vi.fn(async (_account, provider) => provider === "INSTAGRAMBUSINESS" ? {
        data: [{
          id: "conversation-1",
          self: "brand-profile",
          provider,
          status: "PENDING",
          participants: [{ id: "brand-profile", name: "Marca" }, { id: "customer-1", name: "Cliente Uno" }],
          messages: [{
            id: "message-1",
            from: "customer-1",
            to: "brand-profile",
            text: "Hola",
            attachments: ["https://cdn.example.test/private-dm.jpg?signature=private"],
            publicationDateTime: new Date().toISOString(),
          }],
        }],
      } : { data: [] }),
      listPostComments: vi.fn(async (_account, provider) => provider === "FACEBOOK" ? {
        data: [{
          id: "thread-1",
          self: "brand-page",
          provider,
          status: "PENDING",
          participants: [{ id: "brand-page", name: "Marca" }, { id: "customer-2", name: "Cliente Dos" }],
          root: {
            id: "comment-1",
            element: "post-1",
            owner: "customer-2",
            text: "Precio",
            creationDate: new Date().toISOString(),
            comments: [],
          },
        }],
      } : { data: [] }),
      listReviews: vi.fn(async () => ({ data: [] })),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app, dataFile } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: token,
        SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "false",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1" },
        }),
      },
      client,
    });
    const missingKey = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: authHeaders,
      payload: { accountIds: ["account-01"] },
    });
    expect(missingKey.statusCode).toBe(428);
    expect(missingKey.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const response = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "live-sync-account-01" },
      payload: { accountIds: ["account-01"] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.run.totals).toMatchObject({ fetched: 2, created: 2, errors: 0 });
    expect(client.listConversations).toHaveBeenCalledTimes(2);
    expect(client.listPostComments).toHaveBeenCalledTimes(2);
    expect(client.listConversations).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", blogId: "blog-1" }),
      "INSTAGRAMBUSINESS",
    );
    expect(client.listPostComments).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", blogId: "blog-1" }),
      "INSTAGRAM",
    );
    expect(client.listPostComments).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", blogId: "blog-1" }),
      "FACEBOOK",
    );
    expect(response.json().data.newInteractions).toBe(2);
    expect(response.body).not.toContain("metricoolRef");
    expect(response.body).not.toContain("conversation-1");
    expect(response.body).not.toContain("private-dm.jpg");
    const snapshot = await app.sacFlow.repository.snapshot();
    const dm = snapshot.interactions.find((item) => item.externalId === "message-1");
    const comment = snapshot.interactions.find((item) => item.externalId === "comment-1");
    expect(dm).toBeDefined();
    expect(comment).toBeDefined();

    const dmReply = await app.inject({
      method: "POST",
      url: `/api/interactions/${dm?.id}/reply`,
      headers: { ...authHeaders, "idempotency-key": "live-dm-reply-contract" },
      payload: {
        text: "Respuesta por DM",
        mode: "send",
        approvedByHuman: true,
        expectedVersion: dm?.version,
      },
    });
    expect(dmReply.statusCode).toBe(200);
    expect(dmReply.body).not.toContain("metricoolRef");
    expect(dmReply.body).not.toContain("conversation-1");
    expect(dmReply.body).not.toContain("private-dm.jpg");
    expect(client.replyToConversation).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", blogId: "blog-1" }),
      {
        text: "Respuesta por DM",
        conversationId: "conversation-1",
        provider: "INSTAGRAMBUSINESS",
        recipient: "customer-1",
      },
    );

    const commentReply = await app.inject({
      method: "POST",
      url: `/api/interactions/${comment?.id}/reply`,
      headers: { ...authHeaders, "idempotency-key": "live-comment-reply-contract" },
      payload: {
        text: "Respuesta al comentario",
        mode: "send",
        approvedByHuman: true,
        expectedVersion: comment?.version,
      },
    });
    expect(commentReply.statusCode).toBe(200);
    expect(commentReply.body).not.toContain("metricoolRef");
    expect(commentReply.body).not.toContain("comment-1");
    expect(client.replyToPostComment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", blogId: "blog-1" }),
      {
        text: "Respuesta al comentario",
        objectId: "comment-1",
        provider: "FACEBOOK",
      },
    );
    expect(response.body).not.toContain(token);
    expect(await readFile(dataFile, "utf8")).not.toContain(token);
  });

  it("does not truncate Instagram comments when sync omits an explicit safety limit", async () => {
    const comments = Array.from({ length: 120 }, (_, index) => ({
      id: `instagram-thread-${index + 1}`,
      self: "brand-profile",
      provider: "INSTAGRAM",
      status: "PENDING",
      participants: [{ id: "brand-profile", name: "Marca" }, { id: `customer-${index + 1}`, name: "Cliente" }],
      root: {
        id: `instagram-comment-${index + 1}`,
        element: `post-${index + 1}`,
        owner: `customer-${index + 1}`,
        text: `Consulta ${index + 1}`,
        creationDate: new Date().toISOString(),
        comments: [],
      },
    }));
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => ({ data: [] })),
      listPostComments: vi.fn(async (_account, provider) => provider === "INSTAGRAM" ? { data: comments } : { data: [] }),
      listReviews: vi.fn(async () => ({ data: [] })),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1" },
        }),
      },
      client,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "instagram-comments-without-truncation" },
      payload: { accountIds: ["account-01"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.run.totals).toMatchObject({ fetched: 120, created: 120, errors: 0 });
    expect(client.listPostComments).toHaveBeenCalledWith(expect.any(Object), "INSTAGRAM");
  });

  it("falls back to INSTAGRAM when the configured Instagram DM provider is empty", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async (_account, provider) => provider === "INSTAGRAM" ? {
        data: [{
          id: "instagram-conversation-fallback",
          self: "brand-profile",
          provider,
          status: "PENDING",
          participants: [{ id: "brand-profile", name: "Marca" }, { id: "customer-instagram", name: "Cliente" }],
          messages: [{
            id: "instagram-message-fallback",
            from: "customer-instagram",
            to: "brand-profile",
            text: "Necesito ayuda",
            publicationDateTime: new Date().toISOString(),
          }],
        }],
      } : { data: [] }),
      listPostComments: vi.fn(async () => ({ data: [] })),
      listReviews: vi.fn(async () => ({ data: [] })),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1", instagramProvider: "INSTAGRAMBUSINESS" },
        }),
      },
      client,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "instagram-dm-provider-fallback" },
      payload: { accountIds: ["account-01"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.run.totals).toMatchObject({ fetched: 1, created: 1, errors: 0 });
    expect((client.listConversations as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1])).toEqual([
      "INSTAGRAMBUSINESS", "INSTAGRAM", "FACEBOOK",
    ]);
    expect(response.json().data.newInteractions).toBe(1);
    expect(response.body).not.toContain("metricoolRef");
    expect(response.body).not.toContain("instagram-message-fallback");
    const fallbackInteraction = (await app.sacFlow.repository.snapshot()).interactions.find((item) =>
      item.externalId === "instagram-message-fallback");
    expect(fallbackInteraction).toMatchObject({
      channel: "instagram",
      type: "dm",
      metricoolRef: { provider: "INSTAGRAM" },
    });
    expect(JSON.stringify(response.json().data.run.auditTrail)).toContain("proveedor alternativo");
  });

  it("treats an inbound DM as answered when the account sent a later message", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async (_account, provider) => provider === "INSTAGRAMBUSINESS" ? {
        data: [{
          id: "conversation-answered-by-team",
          self: "brand-profile",
          provider,
          status: "PENDING",
          participants: [{ id: "brand-profile", name: "Marca" }, { id: "customer-team", name: "Cliente" }],
          messages: [{
            id: "message-customer-question",
            from: "customer-team",
            to: "brand-profile",
            text: "¿Tienen disponibilidad?",
            publicationDateTime: "2026-08-13T13:50:00.000Z",
          }, {
            id: "message-team-answer",
            from: "brand-profile",
            to: "customer-team",
            text: "Sí, tenemos disponibilidad.",
            publicationDateTime: "2026-08-13T13:55:00.000Z",
          }],
        }],
      } : { data: [] }),
      listPostComments: vi.fn(async () => ({ data: [] })),
      listReviews: vi.fn(async () => ({ data: [] })),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1", instagramProvider: "INSTAGRAMBUSINESS" },
        }),
      },
      client,
    });

    const sync = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "team-response-reconciliation" },
      payload: { accountIds: ["account-01"] },
    });

    expect(sync.statusCode).toBe(200);
    expect(sync.json().data.run.totals).toMatchObject({ fetched: 2, created: 2, replied: 1 });
    expect(sync.json().data.newInteractions).toBe(2);
    expect(sync.body).not.toContain("metricoolRef");
    const interactions = (await app.sacFlow.repository.snapshot()).interactions.filter((interaction) =>
      ["message-customer-question", "message-team-answer"].includes(interaction.externalId));
    const inbound = interactions.find((interaction) => interaction.direction === "inbound");
    expect(inbound).toMatchObject({
      status: "replied",
      respondedAt: "2026-08-13T13:55:00.000Z",
    });
    expect(inbound?.automation).toBeUndefined();
    expect(inbound?.audit.at(-1)).toMatchObject({
      action: "status_changed",
      metadata: { reason: "OUTBOUND_MESSAGE_DETECTED" },
    });
    expect(inbound?.id).toBeTruthy();

    const protocol = await app.inject({
      method: "POST",
      url: "/api/sac/protocol/evaluate",
      headers: { ...authHeaders, "idempotency-key": "team-response-protocol-skip" },
      payload: { interactionIds: [inbound!.id] },
    });
    expect(protocol.statusCode).toBe(200);
    expect(protocol.json().data).toMatchObject({ evaluated: 0, reconciledTeamResponses: 0 });

    const staleDraft = await app.inject({
      method: "POST",
      url: `/api/interactions/${inbound!.id}/reply`,
      headers: authHeaders,
      payload: { text: "Borrador que no debe reabrir el caso", mode: "draft", expectedVersion: inbound!.version },
    });
    expect(staleDraft.statusCode).toBe(409);
    expect(staleDraft.json().error.code).toBe("CASE_ALREADY_CLOSED");
  });

  it("reconciles an existing inbound DM when a later sync discovers the team reply", async () => {
    let instagramReads = 0;
    const client: MetricoolGateway = {
      listConversations: vi.fn(async (_account, provider) => {
        if (provider !== "INSTAGRAMBUSINESS") return { data: [] };
        instagramReads += 1;
        const messages = [{
          id: "message-existing-question",
          from: "customer-existing",
          to: "brand-profile",
          text: "¿Dónde está mi pedido?",
          publicationDateTime: "2026-08-13T13:40:00.000Z",
        }];
        if (instagramReads > 1) messages.push({
          id: "message-later-team-answer",
          from: "brand-profile",
          to: "customer-existing",
          text: "Ya revisamos tu pedido.",
          publicationDateTime: "2026-08-13T13:45:00.000Z",
        });
        return {
          data: [{
            id: "conversation-sequential-response",
            self: "brand-profile",
            provider,
            status: "PENDING",
            participants: [{ id: "brand-profile", name: "Marca" }, { id: "customer-existing", name: "Cliente" }],
            messages,
          }],
        };
      }),
      listPostComments: vi.fn(async () => ({ data: [] })),
      listReviews: vi.fn(async () => ({ data: [] })),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1", instagramProvider: "INSTAGRAMBUSINESS" },
        }),
      },
      client,
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "sequential-team-response-first" },
      payload: { accountIds: ["account-01"] },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.run.totals).toMatchObject({ fetched: 1, created: 1, replied: 0 });

    const second = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "sequential-team-response-second" },
      payload: { accountIds: ["account-01"] },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.run.totals).toMatchObject({ fetched: 2, created: 1, duplicates: 1, replied: 1 });

    const snapshot = await app.sacFlow.repository.snapshot();
    const inbound = snapshot.interactions.find((interaction) =>
      interaction.externalId === "message-existing-question");
    expect(inbound).toMatchObject({
      status: "replied",
      respondedAt: "2026-08-13T13:45:00.000Z",
    });
    expect(inbound?.responseText).toBeUndefined();
    expect(inbound?.automation).toBeUndefined();
  });

  it("queries only the supported Inbox surfaces for every connected platform", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => ({ data: [] })),
      listPostComments: vi.fn(async () => ({ data: [] })),
      listReviews: vi.fn(async (_account, provider) => provider === "GMB" ? {
        data: [{
          providerId: "google-review-1",
          provider,
          creationDate: new Date().toISOString(),
          participants: [{ id: "reviewer-1", name: "Cliente Google" }],
          message: "Muy buena atención",
          stars: 5,
        }],
      } : { data: [] }),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1" },
        }),
      },
      client,
    });
    await app.sacFlow.repository.mutate((store) => {
      const brand = store.brands.find((item) => item.account.id === "account-01");
      if (!brand) throw new Error("missing test account");
      brand.account.channels = [
        "instagram",
        "facebook",
        "x",
        "tiktok",
        "youtube",
        "linkedin",
        "google_business",
      ];
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "all-platform-surfaces" },
      payload: { accountIds: ["account-01"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.run.totals).toMatchObject({ fetched: 1, created: 1, errors: 0 });
    expect(client.listConversations).toHaveBeenCalledTimes(4);
    expect(client.listPostComments).toHaveBeenCalledTimes(5);
    expect(client.listReviews).toHaveBeenCalledTimes(1);
    expect((client.listConversations as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1])).toEqual([
      "INSTAGRAMBUSINESS", "INSTAGRAM", "FACEBOOK", "TWITTER",
    ]);
    expect((client.listPostComments as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1])).toEqual([
      "INSTAGRAM", "FACEBOOK", "TIKTOKBUSINESS", "YOUTUBE", "LINKEDIN",
    ]);
    expect(client.listReviews).toHaveBeenCalledWith(expect.any(Object), "GMB");
    expect(response.json().data.newInteractions).toBe(1);
    const review = (await app.sacFlow.repository.snapshot()).interactions.find((item) =>
      item.externalId === "google-review-1");
    expect(review).toMatchObject({
      channel: "google_business",
      type: "review",
      sentiment: "positive",
    });
  });

  it("uses stored Metricool account references for live sync without returning IDs", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async (_account, provider) => provider === "INSTAGRAMBUSINESS" ? {
        data: [{
          id: "conversation-stored",
          self: "brand-profile",
          provider,
          participants: [{ id: "brand-profile" }, { id: "customer-stored", name: "Cliente" }],
          messages: [{
            id: "message-stored",
            from: "customer-stored",
            to: "brand-profile",
            text: "Hola",
            publicationDateTime: new Date().toISOString(),
          }],
        }],
      } : { data: [] }),
      listPostComments: vi.fn(async () => ({ data: [] })),
      listReviews: vi.fn(async () => ({ data: [] })),
      replyToConversation: vi.fn(async () => ({ ok: true })),
      replyToPostComment: vi.fn(async () => ({ ok: true })),
      replyToReview: vi.fn(async () => ({ ok: true })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
      },
      client,
    });

    const saved = await app.inject({
      method: "PUT",
      url: "/api/accounts/account-01/metricool",
      headers: authHeaders,
      payload: { userId: "stored-user-1", blogId: "stored-blog-1" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.metricool).toMatchObject({
      referenceStored: true,
      tokenConfigured: true,
      liveReady: true,
      source: "stored",
    });
    expect(saved.body).not.toContain("stored-user-1");
    expect(saved.body).not.toContain("stored-blog-1");

    const response = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "live-sync-stored-account-01" },
      payload: { accountIds: ["account-01"] },
    });
    expect(response.statusCode).toBe(200);
    expect(client.listConversations).toHaveBeenCalledWith(
      {
        userId: "stored-user-1",
        blogId: "stored-blog-1",
        instagramProvider: "INSTAGRAMBUSINESS",
      },
      "INSTAGRAMBUSINESS",
    );
    expect(response.body).not.toContain("stored-user-1");
    expect(response.body).not.toContain("stored-blog-1");
  });

  it("queues a safe live candidate without sending it inside the sync request", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async (_account, provider) => provider === "INSTAGRAMBUSINESS" ? {
        data: [{
          id: "conversation-auto-queue",
          self: "brand-profile",
          provider,
          participants: [{ id: "brand-profile" }, { id: "customer-auto", name: "Ana" }],
          messages: [{
            id: "message-auto-queue",
            from: "customer-auto",
            to: "brand-profile",
            text: "Hola",
            publicationDateTime: new Date().toISOString(),
          }],
        }],
      } : { data: [] }),
      listPostComments: vi.fn(async () => ({ data: [] })),
      listReviews: vi.fn(async () => ({ data: [] })),
      replyToConversation: vi.fn(async () => ({ id: "must-not-send-during-sync" })),
      replyToPostComment: vi.fn(async () => ({ id: "must-not-send-during-sync" })),
      replyToReview: vi.fn(async () => ({ id: "must-not-send-during-sync" })),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        SAC_FLOW_AUTO_REPLY_DISPATCH_MODE: "live",
        SAC_FLOW_DISABLE_OUTBOUND_SENDS: "false",
        SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "false",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1" },
        }),
      },
      client,
    });
    const workflowUpdate = await app.inject({
      method: "PUT",
      url: "/api/workflow",
      headers: authHeaders,
      payload: {
        autoReplyEnabled: true,
        autoReplyAccountIds: ["account-01"],
        confirmAutoReply: true,
      },
    });
    expect(workflowUpdate.statusCode).toBe(200);
    const published = await app.inject({
      method: "POST",
      url: "/api/workflow/publish",
      headers: authHeaders,
      payload: { confirmAutoReply: true, changeNote: "Prueba de cola automática" },
    });
    expect(published.statusCode).toBe(200);

    const sync = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "auto-queue-sync" },
      payload: { accountIds: ["account-01"] },
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json().data.newInteractions).toBe(1);
    const queuedInteraction = (await app.sacFlow.repository.snapshot()).interactions.find((item) =>
      item.externalId === "message-auto-queue");
    expect(queuedInteraction).toMatchObject({
      status: "pending",
      automation: { recommendedRoute: "auto_reply", effectiveRoute: "auto_reply" },
    });
    const deliveries = await app.inject({
      method: "GET",
      url: `/api/deliveries?interactionId=${queuedInteraction.id}`,
      headers: authHeaders,
    });
    expect(deliveries.json().data).toHaveLength(1);
    expect(deliveries.json().data[0]).toMatchObject({ status: "pending", approvedByHuman: false, attemptCount: 0 });
    expect(client.replyToConversation).not.toHaveBeenCalled();
    expect(client.replyToPostComment).not.toHaveBeenCalled();
  });

  it("returns sanitized upstream errors", async () => {
    const token = "never-return-this-token";
    const client: MetricoolGateway = {
      listConversations: vi.fn(async (_account, provider) => provider === "INSTAGRAMBUSINESS" ? {
        data: [{
          id: "conversation-error",
          self: "brand-profile",
          provider,
          participants: [{ id: "brand-profile" }, { id: "customer-error", name: "Cliente" }],
          messages: [{
            id: "message-error",
            from: "customer-error",
            to: "brand-profile",
            text: "Necesito ayuda",
            publicationDateTime: new Date().toISOString(),
          }],
        }],
      } : { data: [] }),
      listPostComments: vi.fn(async () => ({ data: [] })),
      listReviews: vi.fn(async () => ({ data: [] })),
      replyToConversation: vi.fn(async () => { throw new MetricoolRequestError(401, "/v2/inbox/conversations"); }),
      replyToPostComment: vi.fn(async () => { throw new Error(token); }),
      replyToReview: vi.fn(async () => { throw new Error(token); }),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: token,
        SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "false",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1" },
        }),
      },
      client,
    });
    const sync = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { ...authHeaders, "idempotency-key": "sanitized-error-sync" },
      payload: { accountIds: ["account-01"] },
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json().data.newInteractions).toBe(1);
    const interaction = (await app.sacFlow.repository.snapshot()).interactions.find((item) =>
      item.externalId === "message-error");
    expect(interaction).toBeDefined();
    const id = interaction!.id;
    const missingKey = await app.inject({
      method: "POST",
      url: `/api/interactions/${id}/reply`,
      headers: authHeaders,
      payload: { text: "Respuesta aprobada", mode: "send", approvedByHuman: true, expectedVersion: interaction!.version },
    });
    expect(missingKey.statusCode).toBe(428);
    expect(missingKey.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const response = await app.inject({
      method: "POST",
      url: `/api/interactions/${id}/reply`,
      headers: { ...authHeaders, "idempotency-key": "live-reply-001" },
      payload: { text: "Respuesta aprobada", mode: "send", approvedByHuman: true, expectedVersion: interaction!.version },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("METRICOOL_ERROR");
    expect(response.body).not.toContain(token);
    const deliveries = await app.inject({
      method: "GET",
      url: `/api/deliveries?interactionId=${id}`,
      headers: authHeaders,
    });
    expect(deliveries.statusCode).toBe(200);
    expect(deliveries.json().data[0]).toMatchObject({ status: "failed", attemptCount: 1, errorCode: "METRICOOL_HTTP_401" });
  });

  it("defers a confirmed Metricool 429 and prevents an early retry", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => ({ data: [] })),
      listPostComments: vi.fn(async () => ({ data: [] })),
      listReviews: vi.fn(async () => ({ data: [] })),
      replyToConversation: vi.fn(async () => { throw new MetricoolRequestError(429, "/v2/inbox/conversations", 5_000); }),
      replyToPostComment: vi.fn(async () => { throw new MetricoolRequestError(429, "/v2/inbox/post-comments", 5_000); }),
      replyToReview: vi.fn(async () => { throw new MetricoolRequestError(429, "/v2/inbox/reviews/replies", 5_000); }),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "false",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1" },
        }),
      },
      client,
    });
    const interaction = await app.sacFlow.repository.updateInteraction("interaction-001", (item) => {
      item.createdAt = new Date().toISOString();
      item.status = "pending";
      item.source = "metricool";
      item.metricoolRef = {
        provider: "INSTAGRAMBUSINESS",
        conversationId: "conversation-rate-limit",
        recipient: "recipient-rate-limit",
      };
    });
    const headers = { ...authHeaders, "idempotency-key": "rate-limited-delivery-test" };
    const payload = {
      text: "Respuesta reprogramable",
      mode: "send",
      approvedByHuman: true,
      expectedVersion: interaction!.version,
    };
    const first = await app.inject({
      method: "POST",
      url: `/api/interactions/${interaction!.id}/reply`,
      headers,
      payload,
    });
    expect(first.statusCode).toBe(429);
    expect(first.json()).toMatchObject({ error: { code: "METRICOOL_RATE_LIMITED" } });
    const delivery = (await app.sacFlow.repository.listReplyDeliveries({ interactionId: interaction!.id }))[0];
    expect(delivery).toMatchObject({ status: "pending", attemptCount: 1, errorCode: "METRICOOL_HTTP_429" });
    expect(Date.parse(delivery.nextAttemptAt!)).toBeGreaterThan(Date.now());

    const second = await app.inject({
      method: "POST",
      url: `/api/interactions/${interaction!.id}/reply`,
      headers,
      payload,
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: { code: "DELIVERY_DEFERRED" } });
    expect(client.replyToConversation).toHaveBeenCalledTimes(1);
  });

  it("never retries an uncertain delivery and supports supervised reconciliation", async () => {
    const client: MetricoolGateway = {
      listConversations: vi.fn(async () => ({ data: [] })),
      listPostComments: vi.fn(async () => ({ data: [] })),
      listReviews: vi.fn(async () => ({ data: [] })),
      replyToConversation: vi.fn(async () => { throw new Error("ambiguous network failure"); }),
      replyToPostComment: vi.fn(async () => { throw new Error("ambiguous network failure"); }),
      replyToReview: vi.fn(async () => { throw new Error("ambiguous network failure"); }),
    };
    const { app } = await makeApp({
      env: {
        METRICOOL_MODE: "live",
        METRICOOL_API_TOKEN: "configured-token",
        SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "false",
        METRICOOL_ACCOUNTS_JSON: JSON.stringify({
          "account-01": { userId: "user-1", blogId: "blog-1" },
        }),
      },
      client,
    });
    const interaction = await app.sacFlow.repository.updateInteraction("interaction-001", (item) => {
      item.createdAt = new Date().toISOString();
      item.status = "pending";
      item.source = "metricool";
      item.metricoolRef = {
        provider: "INSTAGRAMBUSINESS",
        conversationId: "conversation-uncertain",
        recipient: "recipient-uncertain",
      };
    });
    expect(interaction).toBeDefined();
    const headers = { ...authHeaders, "idempotency-key": "uncertain-delivery-test" };
    const payload = {
      text: "Respuesta de entrega incierta",
      mode: "send",
      approvedByHuman: true,
      expectedVersion: interaction!.version,
    };
    const first = await app.inject({
      method: "POST",
      url: `/api/interactions/${interaction!.id}/reply`,
      headers,
      payload,
    });
    expect(first.statusCode).toBe(502);
    expect(first.json()).toMatchObject({
      error: { code: "DELIVERY_UNCERTAIN", details: { deliveryId: expect.any(String) } },
    });
    expect(client.replyToConversation).toHaveBeenCalledTimes(1);
    const preservedDraft = await app.sacFlow.repository.findInteraction(interaction!.id);
    expect(preservedDraft).toMatchObject({
      status: "drafted",
      responseText: "Respuesta de entrega incierta",
    });
    const retryPayload = { ...payload, expectedVersion: preservedDraft!.version };

    const second = await app.inject({
      method: "POST",
      url: `/api/interactions/${interaction!.id}/reply`,
      headers,
      payload: retryPayload,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("DELIVERY_RECONCILIATION_REQUIRED");
    expect(client.replyToConversation).toHaveBeenCalledTimes(1);

    const differentKey = await app.inject({
      method: "POST",
      url: `/api/interactions/${interaction!.id}/reply`,
      headers: { ...authHeaders, "idempotency-key": "uncertain-delivery-new-key" },
      payload: { ...retryPayload, text: "Otra respuesta que no debe enviarse" },
    });
    expect(differentKey.statusCode).toBe(409);
    expect(differentKey.json().error.code).toBe("DELIVERY_RECONCILIATION_REQUIRED");
    expect(client.replyToConversation).toHaveBeenCalledTimes(1);

    const sameAccount = (await app.sacFlow.repository.listInteractions())
      .find((item) => item.accountId === interaction!.accountId && item.id !== interaction!.id)!;
    const preparedSameAccount = await app.sacFlow.repository.updateInteraction(sameAccount.id, (item) => {
      item.createdAt = new Date().toISOString();
      item.status = "pending";
      item.source = "metricool";
      item.metricoolRef = {
        provider: "INSTAGRAMBUSINESS",
        conversationId: "conversation-blocked-by-account-breaker",
        recipient: "recipient-blocked-by-account-breaker",
      };
    });
    const accountBlocked = await app.inject({
      method: "POST",
      url: `/api/interactions/${preparedSameAccount!.id}/reply`,
      headers: { ...authHeaders, "idempotency-key": "account-breaker-different-case" },
      payload: {
        text: "No debe salir mientras haya una entrega incierta",
        mode: "send",
        approvedByHuman: true,
        expectedVersion: preparedSameAccount!.version,
      },
    });
    expect(accountBlocked.statusCode).toBe(409);
    expect(accountBlocked.json().error.code).toBe("ACCOUNT_DELIVERY_RECONCILIATION_REQUIRED");
    expect(client.replyToConversation).toHaveBeenCalledTimes(1);

    const list = await app.inject({
      method: "GET",
      url: `/api/deliveries?interactionId=${interaction!.id}`,
      headers: authHeaders,
    });
    const uncertain = list.json().data[0] as { id: string; status: string; version: number };
    expect(uncertain.status).toBe("uncertain");
    const reconciled = await app.inject({
      method: "POST",
      url: `/api/deliveries/${uncertain.id}/reconcile`,
      headers: authHeaders,
      payload: {
        outcome: "sent",
        expectedVersion: uncertain.version,
        note: "Verificado manualmente en la bandeja de Metricool.",
      },
    });
    expect(reconciled.statusCode).toBe(200);
    expect(reconciled.json()).toMatchObject({
      data: {
        delivery: { status: "sent" },
        interaction: { id: interaction!.id, status: "replied" },
      },
    });
    expect(reconciled.body).not.toContain("metricoolRef");
    const reconciledDetail = await app.inject({
      method: "GET",
      url: `/api/interactions/${interaction!.id}`,
      headers: authHeaders,
    });
    expect(reconciledDetail.json().data.responseText).toBe("Respuesta de entrega incierta");
  });
});
