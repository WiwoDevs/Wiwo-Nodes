import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AUTOMATION_CREDENTIAL_TYPES, AUTOMATION_NODE_CATALOG, AUTOMATION_TEMPLATES } from "./automation-catalog.js";
import {
  archiveAutomationWorkflow,
  createAutomationCredential,
  createAutomationWorkflow,
  deleteAutomationCredential,
  executeAutomation,
  AutomationServiceError,
  publicAutomationExecution,
  publicAutomationState,
  publishAutomationWorkflow,
  rollbackAutomationWorkflow,
  saveAutomationWorkflow,
  setAutomationWorkflowActive,
  updateAutomationCredential,
  upsertAutomationVariable,
  type AutomationRuntimePolicy,
} from "./automation-service.js";
import type { AppConfig } from "./config.js";
import { CredentialVault } from "./credential-vault.js";
import type { SacFlowRepository } from "./repository-contract.js";
import type { ActorContext, ActorRole } from "./types.js";
import { validateAutomationWorkflow } from "./automation-validation.js";

const idParams = z.object({ id: z.string().min(1).max(120) }).strict();
const webhookParams = z.object({ path: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/) }).strict();
const workflowCreate = z.object({
  projectId: z.string().min(1),
  folderId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1_000).optional(),
  templateId: z.string().optional(),
}).strict();
const workflowUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(1_000).optional(),
  folderId: z.string().min(1).nullable().optional(),
  tags: z.array(z.string()).max(20).optional(),
  nodes: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), type: z.string().min(1), typeVersion: z.number().int().positive(),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }), parameters: z.record(z.string(), z.unknown()),
    credentialId: z.string().optional(), disabled: z.boolean().optional(), notes: z.string().max(4_000).optional(),
    continueOnFail: z.boolean().optional(), retryOnFail: z.boolean().optional(), maxTries: z.number().int().min(1).max(10).optional(),
  }).strict()).max(500).optional(),
  connections: z.array(z.object({
    id: z.string().min(1), sourceNode: z.string().min(1), sourceOutput: z.string().min(1), targetNode: z.string().min(1), targetInput: z.string().min(1),
  }).strict()).max(2_000).optional(),
  settings: z.object({
    timezone: z.string().min(1), executionTimeoutSeconds: z.number().int().min(1).max(86_400),
    saveSuccessfulExecutions: z.boolean(), saveFailedExecutions: z.boolean(), errorWorkflowId: z.string().optional(), concurrency: z.number().int().min(1).max(100),
  }).strict().optional(),
  changeNote: z.string().max(500).optional(),
}).strict();
const runBody = z.object({ input: z.array(z.record(z.string(), z.unknown())).max(10_000).default([{}]) }).strict().default({ input: [{}] });
const credentialBody = z.object({
  projectId: z.string().min(1), name: z.string().trim().min(1).max(120), type: z.string().min(1), data: z.record(z.string(), z.string().max(20_000)).optional(),
}).strict();
const credentialUpdate = z.object({ name: z.string().trim().min(1).max(120).optional(), data: z.record(z.string(), z.string().max(20_000)).optional() }).strict();
const variableBody = z.object({ projectId: z.string().min(1), key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{1,79}$/), value: z.string().max(20_000), secret: z.boolean().default(false) }).strict();
const namedResourceBody = z.object({ projectId: z.string().min(1), name: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), parentId: z.string().optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).strict();
const projectBody = namedResourceBody.omit({ projectId: true, parentId: true });
const rollbackBody = z.object({ version: z.number().int().positive(), changeNote: z.string().max(500).optional() }).strict();
const workflowImportBody = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1_000).optional(),
  nodes: workflowUpdate.shape.nodes.unwrap(),
  connections: workflowUpdate.shape.connections.unwrap(),
  settings: workflowUpdate.shape.settings.unwrap(),
}).strict();

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function idempotencyKey(request: FastifyRequest, required: boolean): string | undefined {
  const raw = request.headers["idempotency-key"];
  if (Array.isArray(raw)) throw new AutomationServiceError(400, "INVALID_IDEMPOTENCY_KEY", "Use un único Idempotency-Key.");
  if (!raw) {
    if (required) throw new AutomationServiceError(428, "IDEMPOTENCY_KEY_REQUIRED", "La operación requiere Idempotency-Key para evitar efectos duplicados.");
    return undefined;
  }
  const key = String(raw);
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) throw new AutomationServiceError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key debe tener entre 8 y 200 caracteres seguros.");
  return key;
}

async function replayIdempotent(repository: SacFlowRepository, scope: string, key: string | undefined, hash: string, reply: FastifyReply): Promise<boolean> {
  if (!key) return false;
  const record = await repository.claimIdempotency({ key, scope, requestHash: hash, statusCode: 102, response: null, createdAt: new Date().toISOString() });
  if (!record) return false;
  if (record.requestHash !== hash) throw new AutomationServiceError(409, "IDEMPOTENCY_KEY_REUSED", "El Idempotency-Key ya fue usado con un payload diferente.");
  if (record.statusCode === 102) {
    reply.header("Retry-After", "3");
    throw new AutomationServiceError(409, "IDEMPOTENCY_IN_PROGRESS", "Ya hay una solicitud en curso con este Idempotency-Key.");
  }
  reply.header("Idempotent-Replay", "true").code(record.statusCode).send(record.response);
  return true;
}

async function rememberIdempotent(repository: SacFlowRepository, scope: string, key: string | undefined, hash: string, response: unknown): Promise<void> {
  if (!key) return;
  await repository.saveIdempotency({ key, scope, requestHash: hash, statusCode: 200, response, createdAt: new Date().toISOString() });
}

function safeSecretEqual(actual: string, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

export interface AutomationRouteDependencies {
  repository: SacFlowRepository;
  config: AppConfig;
  requireRole: (request: FastifyRequest, role: ActorRole) => ActorContext;
}

export function registerAutomationRoutes(app: FastifyInstance, dependencies: AutomationRouteDependencies): void {
  const { repository, config } = dependencies;
  const vault = new CredentialVault(config.automation.credentialEncryptionKey);
  const policy: AutomationRuntimePolicy = {
    allowExternalRequests: !config.operations.externalNodesDisabled,
    allowMetricoolOperations: !config.operations.metricoolMutationsDisabled,
  };
  const meta = () => ({ demoMode: config.demoMode, externalNodesDisabled: !policy.allowExternalRequests, metricoolMutationsDisabled: !policy.allowMetricoolOperations });

  app.get("/api/platform", async (request) => {
    dependencies.requireRole(request, "viewer");
    const state = await repository.snapshotAutomation();
    return { data: publicAutomationState(state), meta: { ...meta(), templates: AUTOMATION_TEMPLATES.length, nodeTypes: AUTOMATION_NODE_CATALOG.length } };
  });

  app.get("/api/platform/catalog", async (request) => {
    dependencies.requireRole(request, "viewer");
    return { data: { nodes: AUTOMATION_NODE_CATALOG, credentialTypes: AUTOMATION_CREDENTIAL_TYPES }, meta: meta() };
  });

  app.get("/api/platform/templates", async (request) => {
    dependencies.requireRole(request, "viewer");
    return { data: AUTOMATION_TEMPLATES, meta: { ...meta(), count: AUTOMATION_TEMPLATES.length } };
  });

  app.get("/api/platform/workflows", async (request) => {
    dependencies.requireRole(request, "viewer");
    const query = z.object({ projectId: z.string().optional(), archived: z.enum(["true", "false"]).optional(), search: z.string().max(120).optional() }).strict().parse(request.query);
    const state = await repository.snapshotAutomation();
    const data = state.workflows.filter((workflow) => {
      if (query.projectId && workflow.projectId !== query.projectId) return false;
      if (query.archived && workflow.archived !== (query.archived === "true")) return false;
      if (query.search && !`${workflow.name} ${workflow.description}`.toLocaleLowerCase("es-CL").includes(query.search.toLocaleLowerCase("es-CL"))) return false;
      return true;
    });
    return { data, meta: { ...meta(), count: data.length } };
  });

  app.get("/api/platform/workflows/:id", async (request) => {
    dependencies.requireRole(request, "viewer");
    const { id } = idParams.parse(request.params);
    const state = await repository.snapshotAutomation();
    const workflow = state.workflows.find((item) => item.id === id);
    if (!workflow) throw new AutomationServiceError(404, "AUTOMATION_WORKFLOW_NOT_FOUND", "El workflow no existe.");
    return { data: { workflow, validation: validateAutomationWorkflow(workflow, state), versions: state.workflowVersions.filter((item) => item.workflowId === id) }, meta: meta() };
  });

  app.post("/api/platform/workflows", async (request) => {
    const actor = dependencies.requireRole(request, "admin");
    const workflow = await createAutomationWorkflow(repository, actor, workflowCreate.parse(request.body));
    return { data: workflow, meta: { ...meta(), created: true } };
  });

  app.put("/api/platform/workflows/:id", async (request) => {
    const actor = dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    const { changeNote, folderId, ...body } = workflowUpdate.parse(request.body);
    const patch = { ...body, ...(folderId === null ? { folderId: undefined } : folderId ? { folderId } : {}) };
    const workflow = await saveAutomationWorkflow(repository, actor, id, patch, changeNote);
    const state = await repository.snapshotAutomation();
    return { data: workflow, meta: { ...meta(), validation: validateAutomationWorkflow(workflow, state) } };
  });

  app.post("/api/platform/workflows/:id/validate", async (request) => {
    dependencies.requireRole(request, "viewer");
    const { id } = idParams.parse(request.params);
    const state = await repository.snapshotAutomation();
    const workflow = state.workflows.find((item) => item.id === id);
    if (!workflow) throw new AutomationServiceError(404, "AUTOMATION_WORKFLOW_NOT_FOUND", "El workflow no existe.");
    return { data: validateAutomationWorkflow(workflow, state), meta: meta() };
  });

  app.post("/api/platform/workflows/:id/publish", async (request) => {
    const actor = dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    const body = z.object({ changeNote: z.string().max(500).optional() }).strict().parse(request.body || {});
    return { data: await publishAutomationWorkflow(repository, actor, id, body.changeNote), meta: { ...meta(), published: true } };
  });

  app.post("/api/platform/workflows/:id/rollback", async (request) => {
    const actor = dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    const body = rollbackBody.parse(request.body);
    return { data: await rollbackAutomationWorkflow(repository, actor, id, body.version, body.changeNote), meta: { ...meta(), restoredFrom: body.version, publicationRequired: true } };
  });

  app.get("/api/platform/workflows/:id/export", async (request, reply) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    const state = await repository.snapshotAutomation();
    const workflow = state.workflows.find((item) => item.id === id);
    if (!workflow) throw new AutomationServiceError(404, "AUTOMATION_WORKFLOW_NOT_FOUND", "El workflow no existe.");
    const credentialIds = [...new Set(workflow.nodes.map((node) => node.credentialId).filter((value): value is string => Boolean(value)))];
    const exported = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workflow: {
        name: workflow.name,
        description: workflow.description,
        nodes: workflow.nodes.map(({ credentialId: _credentialId, ...node }) => node),
        connections: workflow.connections,
        settings: { ...workflow.settings, errorWorkflowId: undefined },
      },
      requiredCredentials: credentialIds.map((credentialId) => {
        const credential = state.credentials.find((item) => item.id === credentialId);
        return credential ? { name: credential.name, type: credential.type } : { name: "Credencial no encontrada", type: "unknown" };
      }),
    };
    return reply.header("Content-Disposition", `attachment; filename="${workflow.id}.json"`).send(exported);
  });

  app.post("/api/platform/workflows/import", async (request) => {
    const actor = dependencies.requireRole(request, "admin");
    const body = workflowImportBody.parse(request.body);
    const created = await createAutomationWorkflow(repository, actor, { projectId: body.projectId, name: body.name, description: body.description });
    const nodeIds = new Map(body.nodes.map((node) => [node.id, randomUUID()]));
    const saved = await saveAutomationWorkflow(repository, actor, created.id, {
      nodes: body.nodes.map((node) => ({ ...structuredClone(node), id: nodeIds.get(node.id)!, credentialId: undefined })),
      connections: body.connections.map((connection) => ({ ...structuredClone(connection), id: randomUUID(), sourceNode: nodeIds.get(connection.sourceNode) || "", targetNode: nodeIds.get(connection.targetNode) || "" })),
      settings: { ...body.settings, errorWorkflowId: undefined },
      tags: [],
    }, "Importación local de workflow.");
    const validation = validateAutomationWorkflow(saved, await repository.snapshotAutomation());
    return { data: saved, meta: { ...meta(), imported: true, validation } };
  });

  app.post("/api/platform/workflows/:id/active", async (request) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    const { active } = z.object({ active: z.boolean() }).strict().parse(request.body);
    return { data: await setAutomationWorkflowActive(repository, id, active), meta: { ...meta(), active } };
  });

  app.post("/api/platform/workflows/:id/archive", async (request) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    const { archived } = z.object({ archived: z.boolean() }).strict().parse(request.body);
    return { data: await archiveAutomationWorkflow(repository, id, archived), meta: { ...meta(), archived } };
  });

  app.post("/api/platform/workflows/:id/duplicate", async (request) => {
    const actor = dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    const state = await repository.snapshotAutomation();
    const source = state.workflows.find((item) => item.id === id);
    if (!source) throw new AutomationServiceError(404, "AUTOMATION_WORKFLOW_NOT_FOUND", "El workflow no existe.");
    const duplicate = await createAutomationWorkflow(repository, actor, { projectId: source.projectId, folderId: source.folderId, name: `${source.name} copia`, description: source.description });
    const nodeIds = new Map(source.nodes.map((node) => [node.id, randomUUID()]));
    const saved = await saveAutomationWorkflow(repository, actor, duplicate.id, {
      nodes: source.nodes.map((node) => ({ ...structuredClone(node), id: nodeIds.get(node.id)! })),
      connections: source.connections.map((connection) => ({
        ...structuredClone(connection),
        id: randomUUID(),
        sourceNode: nodeIds.get(connection.sourceNode)!,
        targetNode: nodeIds.get(connection.targetNode)!,
      })),
      tags: source.tags,
      settings: source.settings,
    }, "Duplicado local.");
    return { data: saved, meta: { ...meta(), duplicatedFrom: id } };
  });

  app.post("/api/platform/workflows/:id/run", async (request, reply) => {
    const actor = dependencies.requireRole(request, "agent");
    const { id } = idParams.parse(request.params);
    const body = runBody.parse(request.body || {});
    const key = idempotencyKey(request, !config.demoMode);
    const hash = requestHash({ id, ...body });
    const scope = `automation-run:${id}`;
    if (await replayIdempotent(repository, scope, key, hash, reply)) return reply;
    const response = { data: publicAutomationExecution(await executeAutomation(repository, vault, actor, policy, id, body.input, "manual")), meta: meta() };
    await rememberIdempotent(repository, scope, key, hash, response);
    return response;
  });

  app.get("/api/platform/executions", async (request) => {
    dependencies.requireRole(request, "viewer");
    const query = z.object({ workflowId: z.string().optional(), status: z.enum(["queued", "running", "waiting", "success", "error", "canceled"]).optional(), mode: z.enum(["manual", "webhook", "schedule", "subworkflow", "retry"]).optional() }).strict().parse(request.query);
    const data = (await repository.snapshotAutomation()).executions.filter((execution) => (!query.workflowId || execution.workflowId === query.workflowId) && (!query.status || execution.status === query.status) && (!query.mode || execution.mode === query.mode));
    return { data: data.map(publicAutomationExecution), meta: { ...meta(), count: data.length } };
  });

  app.get("/api/platform/executions/:id", async (request) => {
    dependencies.requireRole(request, "viewer");
    const { id } = idParams.parse(request.params);
    const execution = (await repository.snapshotAutomation()).executions.find((item) => item.id === id);
    if (!execution) throw new AutomationServiceError(404, "AUTOMATION_EXECUTION_NOT_FOUND", "La ejecución no existe.");
    return { data: publicAutomationExecution(execution), meta: meta() };
  });

  app.post("/api/platform/executions/:id/retry", async (request, reply) => {
    const actor = dependencies.requireRole(request, "agent");
    const { id } = idParams.parse(request.params);
    const key = idempotencyKey(request, !config.demoMode);
    const hash = requestHash({ executionId: id });
    const scope = `automation-retry:${id}`;
    if (await replayIdempotent(repository, scope, key, hash, reply)) return reply;
    const previous = (await repository.snapshotAutomation()).executions.find((item) => item.id === id);
    if (!previous) throw new AutomationServiceError(404, "AUTOMATION_EXECUTION_NOT_FOUND", "La ejecución no existe.");
    const triggerNodeId = typeof previous.metadata.triggerNodeId === "string" ? previous.metadata.triggerNodeId : undefined;
    const response = { data: publicAutomationExecution(await executeAutomation(repository, vault, actor, policy, previous.workflowId, previous.input, "retry", previous.id, 0, triggerNodeId)), meta: { ...meta(), retryOf: previous.id } };
    await rememberIdempotent(repository, scope, key, hash, response);
    return response;
  });

  app.post("/api/platform/credentials", async (request) => {
    dependencies.requireRole(request, "admin");
    const body = credentialBody.parse(request.body);
    return { data: await createAutomationCredential(repository, vault, body), meta: { ...meta(), encrypted: true } };
  });

  app.put("/api/platform/credentials/:id", async (request) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    return { data: await updateAutomationCredential(repository, vault, id, credentialUpdate.parse(request.body)), meta: { ...meta(), encrypted: true } };
  });

  app.delete("/api/platform/credentials/:id", async (request, reply) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    await deleteAutomationCredential(repository, id);
    return reply.code(204).send();
  });

  app.put("/api/platform/variables", async (request) => {
    dependencies.requireRole(request, "admin");
    return { data: await upsertAutomationVariable(repository, vault, variableBody.parse(request.body)), meta: { ...meta(), encryptedSecrets: true } };
  });

  app.delete("/api/platform/variables/:id", async (request, reply) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    await repository.mutateAutomation((state) => {
      if (!state.variables.some((item) => item.id === id)) throw new AutomationServiceError(404, "VARIABLE_NOT_FOUND", "La variable no existe.");
      state.variables = state.variables.filter((item) => item.id !== id);
    });
    return reply.code(204).send();
  });

  app.post("/api/platform/projects", async (request) => {
    dependencies.requireRole(request, "admin");
    const body = projectBody.parse(request.body);
    const now = new Date().toISOString();
    const project = { id: randomUUID(), name: body.name, description: body.description || "", type: "team" as const, color: body.color || "#4b46f5", createdAt: now, updatedAt: now };
    await repository.mutateAutomation((state) => {
      if (state.projects.some((item) => item.name.toLocaleLowerCase("es-CL") === project.name.toLocaleLowerCase("es-CL"))) throw new AutomationServiceError(409, "PROJECT_NAME_EXISTS", "Ya existe un proyecto con ese nombre.");
      state.projects.push(project);
    });
    return { data: project, meta: { ...meta(), created: true } };
  });

  app.put("/api/platform/projects/:id", async (request) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    const body = projectBody.partial().parse(request.body);
    const project = await repository.mutateAutomation((state) => {
      const current = state.projects.find((item) => item.id === id);
      if (!current) throw new AutomationServiceError(404, "PROJECT_NOT_FOUND", "El proyecto no existe.");
      if (body.name && state.projects.some((item) => item.id !== id && item.name.toLocaleLowerCase("es-CL") === body.name!.toLocaleLowerCase("es-CL"))) throw new AutomationServiceError(409, "PROJECT_NAME_EXISTS", "Ya existe un proyecto con ese nombre.");
      Object.assign(current, body, { updatedAt: new Date().toISOString() });
      return current;
    });
    return { data: project, meta: meta() };
  });

  app.delete("/api/platform/projects/:id", async (request, reply) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    await repository.mutateAutomation((state) => {
      const exists = state.projects.some((item) => item.id === id);
      if (!exists) throw new AutomationServiceError(404, "PROJECT_NOT_FOUND", "El proyecto no existe.");
      if (state.workflows.some((item) => item.projectId === id) || state.credentials.some((item) => item.projectId === id)) throw new AutomationServiceError(409, "PROJECT_NOT_EMPTY", "Mueve o elimina sus workflows y credenciales antes de borrar el proyecto.");
      state.projects = state.projects.filter((item) => item.id !== id);
      state.folders = state.folders.filter((item) => item.projectId !== id);
      state.tags = state.tags.filter((item) => item.projectId !== id);
      state.variables = state.variables.filter((item) => item.projectId !== id);
    });
    return reply.code(204).send();
  });

  app.post("/api/platform/folders", async (request) => {
    dependencies.requireRole(request, "admin");
    const body = namedResourceBody.parse(request.body);
    const now = new Date().toISOString();
    const folder = { id: randomUUID(), projectId: body.projectId, parentId: body.parentId, name: body.name, createdAt: now, updatedAt: now };
    await repository.mutateAutomation((state) => {
      if (!state.projects.some((project) => project.id === body.projectId)) throw new AutomationServiceError(404, "PROJECT_NOT_FOUND", "El proyecto no existe.");
      if (body.parentId && !state.folders.some((item) => item.id === body.parentId && item.projectId === body.projectId)) throw new AutomationServiceError(404, "PARENT_FOLDER_NOT_FOUND", "La carpeta padre no existe en el proyecto.");
      state.folders.push(folder);
    });
    return { data: folder, meta: { ...meta(), created: true } };
  });

  app.put("/api/platform/folders/:id", async (request) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(120).optional(), parentId: z.string().nullable().optional() }).strict().parse(request.body);
    const folder = await repository.mutateAutomation((state) => {
      const current = state.folders.find((item) => item.id === id);
      if (!current) throw new AutomationServiceError(404, "FOLDER_NOT_FOUND", "La carpeta no existe.");
      if (body.parentId === id) throw new AutomationServiceError(400, "SELF_PARENT_FOLDER", "Una carpeta no puede contenerse a sí misma.");
      if (body.parentId && !state.folders.some((item) => item.id === body.parentId && item.projectId === current.projectId)) throw new AutomationServiceError(404, "PARENT_FOLDER_NOT_FOUND", "La carpeta padre no existe.");
      let parentId = body.parentId || undefined;
      while (parentId) {
        if (parentId === id) throw new AutomationServiceError(409, "FOLDER_CYCLE", "La jerarquía de carpetas no puede formar un ciclo.");
        parentId = state.folders.find((item) => item.id === parentId)?.parentId;
      }
      if (body.name) current.name = body.name;
      if (body.parentId === null) delete current.parentId;
      else if (body.parentId) current.parentId = body.parentId;
      current.updatedAt = new Date().toISOString();
      return current;
    });
    return { data: folder, meta: meta() };
  });

  app.delete("/api/platform/folders/:id", async (request, reply) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    await repository.mutateAutomation((state) => {
      if (!state.folders.some((item) => item.id === id)) throw new AutomationServiceError(404, "FOLDER_NOT_FOUND", "La carpeta no existe.");
      if (state.workflows.some((item) => item.folderId === id) || state.folders.some((item) => item.parentId === id)) throw new AutomationServiceError(409, "FOLDER_NOT_EMPTY", "Mueve sus workflows y subcarpetas antes de borrarla.");
      state.folders = state.folders.filter((item) => item.id !== id);
    });
    return reply.code(204).send();
  });

  app.post("/api/platform/tags", async (request) => {
    dependencies.requireRole(request, "admin");
    const body = namedResourceBody.parse(request.body);
    const tag = { id: randomUUID(), projectId: body.projectId, name: body.name, color: body.color || "#4b46f5", createdAt: new Date().toISOString() };
    await repository.mutateAutomation((state) => {
      if (!state.projects.some((project) => project.id === body.projectId)) throw new AutomationServiceError(404, "PROJECT_NOT_FOUND", "El proyecto no existe.");
      if (state.tags.some((item) => item.projectId === body.projectId && item.name.toLocaleLowerCase("es-CL") === body.name.toLocaleLowerCase("es-CL"))) throw new AutomationServiceError(409, "TAG_NAME_EXISTS", "Ya existe un tag con ese nombre.");
      state.tags.push(tag);
    });
    return { data: tag, meta: { ...meta(), created: true } };
  });

  app.put("/api/platform/tags/:id", async (request) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(120).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).strict().parse(request.body);
    const tag = await repository.mutateAutomation((state) => {
      const current = state.tags.find((item) => item.id === id);
      if (!current) throw new AutomationServiceError(404, "TAG_NOT_FOUND", "El tag no existe.");
      if (body.name && state.tags.some((item) => item.id !== id && item.projectId === current.projectId && item.name.toLocaleLowerCase("es-CL") === body.name!.toLocaleLowerCase("es-CL"))) throw new AutomationServiceError(409, "TAG_NAME_EXISTS", "Ya existe un tag con ese nombre.");
      Object.assign(current, body);
      return current;
    });
    return { data: tag, meta: meta() };
  });

  app.delete("/api/platform/tags/:id", async (request, reply) => {
    dependencies.requireRole(request, "admin");
    const { id } = idParams.parse(request.params);
    await repository.mutateAutomation((state) => {
      if (!state.tags.some((item) => item.id === id)) throw new AutomationServiceError(404, "TAG_NOT_FOUND", "El tag no existe.");
      state.tags = state.tags.filter((item) => item.id !== id);
      for (const workflow of state.workflows) workflow.tags = workflow.tags.filter((tagId) => tagId !== id);
    });
    return reply.code(204).send();
  });

  app.all("/api/webhooks/:path", async (request, reply) => {
    const actor = dependencies.requireRole(request, "agent");
    const { path } = webhookParams.parse(request.params);
    const state = await repository.snapshotAutomation();
    const workflow = state.workflows.find((candidate) => candidate.active && candidate.nodes.some((node) => ["core.webhook", "core.formTrigger"].includes(node.type) && String(node.parameters.path) === path && String(node.parameters.method || "POST").toUpperCase() === request.method));
    if (!workflow) throw new AutomationServiceError(404, "WEBHOOK_NOT_FOUND", "No existe un webhook activo para esta ruta y método.");
    const trigger = workflow.nodes.find((node) => ["core.webhook", "core.formTrigger"].includes(node.type) && String(node.parameters.path) === path && String(node.parameters.method || "POST").toUpperCase() === request.method);
    if (trigger?.parameters.authentication === "credential") {
      const credential = state.credentials.find((item) => item.id === trigger.credentialId);
      if (!credential?.encryptedData) throw new AutomationServiceError(401, "WEBHOOK_UNAUTHORIZED", "El webhook requiere una credencial válida.");
      const secret = vault.decrypt(credential.encryptedData);
      const provided = typeof secret.token === "string"
        ? String(request.headers.authorization || "")
        : typeof secret.name === "string"
          ? String(request.headers[secret.name.toLowerCase()] || "")
          : "";
      const expected = typeof secret.token === "string" ? `Bearer ${secret.token}` : typeof secret.value === "string" ? secret.value : "";
      if (!expected || !safeSecretEqual(provided, expected)) throw new AutomationServiceError(401, "WEBHOOK_UNAUTHORIZED", "La credencial del webhook no es válida.");
    }
    const input = request.method === "GET" ? [request.query as Record<string, unknown>] : [request.body as Record<string, unknown> || {}];
    const key = idempotencyKey(request, !config.demoMode && request.method !== "GET");
    const hash = requestHash({ workflowId: workflow.id, method: request.method, input });
    const scope = `automation-webhook:${workflow.id}:${path}`;
    if (await replayIdempotent(repository, scope, key, hash, reply)) return reply;
    const execution = await executeAutomation(repository, vault, actor, policy, workflow.id, input, "webhook", undefined, 0, trigger?.id);
    const output = publicAutomationExecution(execution).output;
    const responseItem = output.find((item) => Object.hasOwn(item, "response"));
    const response = { data: responseItem?.response ?? output, meta: { ...meta(), executionId: execution.id } };
    await rememberIdempotent(repository, scope, key, hash, response);
    return response;
  });
}
