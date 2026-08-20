import { randomUUID } from "node:crypto";
import { AUTOMATION_CREDENTIAL_TYPES, AUTOMATION_TEMPLATES, defaultAutomationWorkflowSettings } from "./automation-catalog.js";
import { CredentialVault } from "./credential-vault.js";
import { executeAutomationWorkflow } from "./automation-engine.js";
import type { SacFlowRepository } from "./repository-contract.js";
import type { ActorContext } from "./types.js";
import type {
  AutomationCredential,
  AutomationExecution,
  AutomationExecutionMode,
  AutomationState,
  AutomationVariable,
  AutomationWorkflow,
  PublicAutomationCredential,
  PublicAutomationVariable,
} from "./automation-types.js";
import { validateAutomationWorkflow } from "./automation-validation.js";

export interface AutomationRuntimePolicy {
  allowExternalRequests: boolean;
  allowMetricoolOperations: boolean;
}

export class AutomationServiceError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

function credentialData(type: string, data?: Record<string, unknown>, current: Record<string, unknown> = {}): Record<string, unknown> {
  const definition = AUTOMATION_CREDENTIAL_TYPES.find((item) => item.type === type);
  if (!definition) throw new AutomationServiceError(400, "UNKNOWN_CREDENTIAL_TYPE", "El tipo de credencial no está instalado.");
  if (!data) return current;
  const unknown = Object.keys(data).filter((key) => !(definition.fields as readonly string[]).includes(key));
  if (unknown.length) throw new AutomationServiceError(400, "UNKNOWN_CREDENTIAL_FIELD", `La credencial contiene campos no permitidos: ${unknown.join(", ")}.`);
  const merged = { ...current, ...data };
  const invalid = definition.fields.filter((field) => typeof merged[field] !== "string" || !String(merged[field]).trim());
  if (invalid.length) throw new AutomationServiceError(400, "CREDENTIAL_FIELDS_REQUIRED", `Faltan campos requeridos: ${invalid.join(", ")}.`);
  if (type === "httpHeaderAuth") {
    const headerName = String(merged.name);
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(headerName) || ["connection", "content-length", "host", "transfer-encoding"].includes(headerName.toLowerCase())) {
      throw new AutomationServiceError(400, "INVALID_CREDENTIAL_HEADER", "El nombre del header HTTP no es seguro.");
    }
  }
  return merged;
}

function publicCredential(credential: AutomationCredential): PublicAutomationCredential {
  const { encryptedData: _encryptedData, ...safe } = credential;
  return { ...safe, configured: credential.status === "configured" && Boolean(credential.encryptedData) };
}

function publicVariable(variable: AutomationVariable): PublicAutomationVariable {
  const { encryptedValue: _encryptedValue, ...safe } = variable;
  return { ...safe, value: variable.secret ? "••••••••" : variable.value || "" };
}

function redactAutomationValue(value: unknown, sensitiveValues: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactAutomationValue(item, sensitiveValues));
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    let safe = value;
    for (const secret of sensitiveValues) {
      if (!secret) continue;
      if (safe === secret) return "[REDACTED]";
      if (secret.length >= 4) safe = safe.replaceAll(secret, "[REDACTED]");
    }
    return safe.length > 10_000 ? `${safe.slice(0, 10_000)}…` : safe;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key,
    /(authorization|cookie|password|secret|token|api[-_]?key|credential)/i.test(key) ? "[REDACTED]" : redactAutomationValue(nested, sensitiveValues),
  ]));
}

export function publicAutomationExecution(execution: AutomationExecution): AutomationExecution {
  return {
    ...execution,
    input: redactAutomationValue(execution.input.slice(0, 20)) as AutomationExecution["input"],
    output: redactAutomationValue(execution.output.slice(0, 20)) as AutomationExecution["output"],
    nodeRuns: execution.nodeRuns.map((run) => ({
      ...run,
      outputs: redactAutomationValue(run.outputs) as typeof run.outputs,
    })),
  };
}

export function publicAutomationState(state: AutomationState) {
  return {
    ...state,
    credentials: state.credentials.map(publicCredential),
    variables: state.variables.map(publicVariable),
    executions: state.executions.map(publicAutomationExecution),
  };
}

export async function createAutomationWorkflow(
  repository: SacFlowRepository,
  actor: ActorContext,
  input: { projectId: string; folderId?: string; name: string; description?: string; templateId?: string },
): Promise<AutomationWorkflow> {
  return repository.mutateAutomation((state) => {
    if (!state.projects.some((project) => project.id === input.projectId)) throw new AutomationServiceError(404, "PROJECT_NOT_FOUND", "El proyecto no existe.");
    if (input.folderId && !state.folders.some((folder) => folder.id === input.folderId && folder.projectId === input.projectId)) throw new AutomationServiceError(404, "FOLDER_NOT_FOUND", "La carpeta no existe en el proyecto.");
    const template = input.templateId ? AUTOMATION_TEMPLATES.find((item) => item.id === input.templateId) : undefined;
    if (input.templateId && !template) throw new AutomationServiceError(404, "TEMPLATE_NOT_FOUND", "La plantilla no existe.");
    const now = new Date().toISOString();
    const workflow: AutomationWorkflow = {
      id: randomUUID(),
      projectId: input.projectId,
      folderId: input.folderId,
      name: input.name,
      description: input.description || template?.description || "",
      active: false,
      archived: false,
      version: 1,
      publishedVersion: 0,
      tags: structuredClone(template?.workflow.tags || []),
      nodes: structuredClone(template?.workflow.nodes || [{ id: randomUUID(), name: "Inicio manual", type: "core.manualTrigger", typeVersion: 1, position: { x: 120, y: 260 }, parameters: {} }]),
      connections: structuredClone(template?.workflow.connections || []),
      settings: structuredClone(template?.workflow.settings || defaultAutomationWorkflowSettings()),
      createdAt: now,
      updatedAt: now,
    };
    state.workflows.unshift(workflow);
    state.workflowVersions.unshift({ id: randomUUID(), workflowId: workflow.id, version: 1, status: "draft", snapshot: structuredClone(workflow), createdAt: now, createdBy: actor.userId, changeNote: template ? `Creado desde ${template.name}.` : "Workflow creado." });
    return workflow;
  });
}

export async function saveAutomationWorkflow(
  repository: SacFlowRepository,
  actor: ActorContext,
  workflowId: string,
  patch: Partial<Pick<AutomationWorkflow, "name" | "description" | "folderId" | "tags" | "nodes" | "connections" | "settings">>,
  changeNote?: string,
): Promise<AutomationWorkflow> {
  return repository.mutateAutomation((state) => {
    const workflow = state.workflows.find((item) => item.id === workflowId);
    if (!workflow) throw new AutomationServiceError(404, "AUTOMATION_WORKFLOW_NOT_FOUND", "El workflow no existe.");
    if (workflow.archived) throw new AutomationServiceError(409, "WORKFLOW_ARCHIVED", "Restaura el workflow antes de editarlo.");
    if (patch.folderId && !state.folders.some((folder) => folder.id === patch.folderId && folder.projectId === workflow.projectId)) throw new AutomationServiceError(404, "FOLDER_NOT_FOUND", "La carpeta no existe en el proyecto.");
    if (patch.tags?.some((tagId) => !state.tags.some((tag) => tag.id === tagId && tag.projectId === workflow.projectId))) throw new AutomationServiceError(400, "UNKNOWN_TAG", "El workflow contiene un tag que no pertenece al proyecto.");
    const now = new Date().toISOString();
    Object.assign(workflow, structuredClone(patch), { id: workflow.id, projectId: workflow.projectId, version: workflow.version + 1, active: false, updatedAt: now });
    state.workflowVersions.unshift({ id: randomUUID(), workflowId, version: workflow.version, status: "draft", snapshot: structuredClone(workflow), createdAt: now, createdBy: actor.userId, changeNote });
    state.workflowVersions = state.workflowVersions.slice(0, 500);
    return workflow;
  });
}

export async function publishAutomationWorkflow(repository: SacFlowRepository, actor: ActorContext, workflowId: string, changeNote?: string): Promise<AutomationWorkflow> {
  return repository.mutateAutomation((state) => {
    const workflow = state.workflows.find((item) => item.id === workflowId);
    if (!workflow) throw new AutomationServiceError(404, "AUTOMATION_WORKFLOW_NOT_FOUND", "El workflow no existe.");
    if (workflow.archived) throw new AutomationServiceError(409, "WORKFLOW_ARCHIVED", "Restaura el workflow antes de publicarlo.");
    const validation = validateAutomationWorkflow(workflow, state);
    if (!validation.valid) throw new AutomationServiceError(409, "AUTOMATION_WORKFLOW_INVALID", `El workflow contiene ${validation.errors} error(es).`);
    const now = new Date().toISOString();
    workflow.publishedVersion = workflow.version;
    workflow.publishedAt = now;
    workflow.updatedAt = now;
    for (const version of state.workflowVersions.filter((item) => item.workflowId === workflowId && item.status === "published")) version.status = "archived";
    const version = state.workflowVersions.find((item) => item.workflowId === workflowId && item.version === workflow.version);
    if (version) {
      version.status = "published";
      version.changeNote = changeNote || version.changeNote;
      version.createdBy = actor.userId;
    }
    return workflow;
  });
}

export async function rollbackAutomationWorkflow(
  repository: SacFlowRepository,
  actor: ActorContext,
  workflowId: string,
  sourceVersion: number,
  changeNote?: string,
): Promise<AutomationWorkflow> {
  return repository.mutateAutomation((state) => {
    const current = state.workflows.find((item) => item.id === workflowId);
    if (!current) throw new AutomationServiceError(404, "AUTOMATION_WORKFLOW_NOT_FOUND", "El workflow no existe.");
    const source = state.workflowVersions.find((item) => item.workflowId === workflowId && item.version === sourceVersion);
    if (!source) throw new AutomationServiceError(404, "AUTOMATION_VERSION_NOT_FOUND", "La versión solicitada no existe.");
    const now = new Date().toISOString();
    const restored: AutomationWorkflow = {
      ...structuredClone(source.snapshot),
      id: current.id,
      projectId: current.projectId,
      version: current.version + 1,
      publishedVersion: current.publishedVersion,
      publishedAt: current.publishedAt,
      active: false,
      archived: false,
      updatedAt: now,
    };
    const index = state.workflows.findIndex((item) => item.id === workflowId);
    state.workflows[index] = restored;
    for (const version of state.workflowVersions.filter((item) => item.workflowId === workflowId && item.status === "draft")) version.status = "archived";
    state.workflowVersions.unshift({
      id: randomUUID(),
      workflowId,
      version: restored.version,
      status: "draft",
      snapshot: structuredClone(restored),
      createdAt: now,
      createdBy: actor.userId,
      changeNote: changeNote || `Rollback preparado desde la versión ${sourceVersion}.`,
    });
    state.workflowVersions = state.workflowVersions.slice(0, 500);
    return restored;
  });
}

export async function setAutomationWorkflowActive(repository: SacFlowRepository, workflowId: string, active: boolean): Promise<AutomationWorkflow> {
  return repository.mutateAutomation((state) => {
    const workflow = state.workflows.find((item) => item.id === workflowId);
    if (!workflow) throw new AutomationServiceError(404, "AUTOMATION_WORKFLOW_NOT_FOUND", "El workflow no existe.");
    if (active) {
      if (workflow.archived) throw new AutomationServiceError(409, "WORKFLOW_ARCHIVED", "Restaura el workflow antes de activarlo.");
      const validation = validateAutomationWorkflow(workflow, state);
      if (!validation.valid) throw new AutomationServiceError(409, "AUTOMATION_WORKFLOW_INVALID", "Corrige y publica el workflow antes de activarlo.");
      if (workflow.version !== workflow.publishedVersion) throw new AutomationServiceError(409, "AUTOMATION_DRAFT_NOT_PUBLISHED", "Publica la versión actual antes de activarla.");
      if (!workflow.nodes.some((node) => ["core.schedule", "core.webhook", "core.formTrigger", "core.errorTrigger"].includes(node.type) && !node.disabled)) {
        throw new AutomationServiceError(409, "ACTIVATION_TRIGGER_REQUIRED", "La activación requiere un trigger automático.");
      }
    }
    workflow.active = active;
    workflow.updatedAt = new Date().toISOString();
    return workflow;
  });
}

export async function archiveAutomationWorkflow(repository: SacFlowRepository, workflowId: string, archived: boolean): Promise<AutomationWorkflow> {
  return repository.mutateAutomation((state) => {
    const workflow = state.workflows.find((item) => item.id === workflowId);
    if (!workflow) throw new AutomationServiceError(404, "AUTOMATION_WORKFLOW_NOT_FOUND", "El workflow no existe.");
    workflow.archived = archived;
    workflow.active = false;
    workflow.updatedAt = new Date().toISOString();
    return workflow;
  });
}

export async function createAutomationCredential(
  repository: SacFlowRepository,
  vault: CredentialVault,
  input: { projectId: string; name: string; type: string; data?: Record<string, unknown> },
): Promise<PublicAutomationCredential> {
  return repository.mutateAutomation((state) => {
    if (!state.projects.some((project) => project.id === input.projectId)) throw new AutomationServiceError(404, "PROJECT_NOT_FOUND", "El proyecto no existe.");
    const now = new Date().toISOString();
    const data = credentialData(input.type, input.data);
    const credential: AutomationCredential = {
      id: randomUUID(), projectId: input.projectId, name: input.name, type: input.type,
      status: Object.keys(data).length ? "configured" : "unconfigured",
      encryptedData: Object.keys(data).length ? vault.encrypt(data) : undefined,
      dataKeys: Object.keys(data).sort(), createdAt: now, updatedAt: now,
    };
    state.credentials.unshift(credential);
    return publicCredential(credential);
  });
}

export async function updateAutomationCredential(
  repository: SacFlowRepository,
  vault: CredentialVault,
  credentialId: string,
  input: { name?: string; data?: Record<string, unknown> },
): Promise<PublicAutomationCredential> {
  return repository.mutateAutomation((state) => {
    const credential = state.credentials.find((item) => item.id === credentialId);
    if (!credential) throw new AutomationServiceError(404, "CREDENTIAL_NOT_FOUND", "La credencial no existe.");
    if (input.name) credential.name = input.name;
    if (input.data) {
      const data = credentialData(credential.type, input.data, credential.encryptedData ? vault.decrypt(credential.encryptedData) : {});
      credential.encryptedData = vault.encrypt(data);
      credential.dataKeys = Object.keys(data).sort();
      credential.status = credential.dataKeys.length ? "configured" : "unconfigured";
    }
    credential.updatedAt = new Date().toISOString();
    return publicCredential(credential);
  });
}

export async function deleteAutomationCredential(repository: SacFlowRepository, credentialId: string): Promise<void> {
  await repository.mutateAutomation((state) => {
    if (state.workflows.some((workflow) => workflow.nodes.some((node) => node.credentialId === credentialId))) {
      throw new AutomationServiceError(409, "CREDENTIAL_IN_USE", "La credencial está asignada a un workflow.");
    }
    const before = state.credentials.length;
    state.credentials = state.credentials.filter((item) => item.id !== credentialId);
    if (before === state.credentials.length) throw new AutomationServiceError(404, "CREDENTIAL_NOT_FOUND", "La credencial no existe.");
  });
}

export async function upsertAutomationVariable(
  repository: SacFlowRepository,
  vault: CredentialVault,
  input: { projectId: string; key: string; value: string; secret: boolean },
): Promise<PublicAutomationVariable> {
  return repository.mutateAutomation((state) => {
    if (!state.projects.some((project) => project.id === input.projectId)) throw new AutomationServiceError(404, "PROJECT_NOT_FOUND", "El proyecto no existe.");
    const normalizedKey = input.key.trim().toUpperCase();
    const existing = state.variables.find((item) => item.projectId === input.projectId && item.key === normalizedKey);
    const now = new Date().toISOString();
    const variable: AutomationVariable = existing || { id: randomUUID(), projectId: input.projectId, key: normalizedKey, secret: input.secret, createdAt: now, updatedAt: now };
    variable.secret = input.secret;
    variable.updatedAt = now;
    if (input.secret) {
      variable.encryptedValue = vault.encrypt({ value: input.value });
      delete variable.value;
    } else {
      variable.value = input.value;
      delete variable.encryptedValue;
    }
    if (!existing) state.variables.unshift(variable);
    return publicVariable(variable);
  });
}

export async function executeAutomation(
  repository: SacFlowRepository,
  vault: CredentialVault,
  actor: ActorContext,
  policy: AutomationRuntimePolicy,
  workflowId: string,
  input: Array<Record<string, unknown>>,
  mode: AutomationExecutionMode,
  retryOf?: string,
  depth = 0,
  triggerNodeId?: string,
): Promise<AutomationExecution> {
  if (depth > 3) throw new AutomationServiceError(409, "SUBWORKFLOW_DEPTH_EXCEEDED", "Se alcanzó el límite de subworkflows anidados.");
  const executionId = randomUUID();
  const startedAt = new Date().toISOString();
  const { workflow, credentials, variables, sensitiveValues } = await repository.mutateAutomation((state) => {
    const workflow = state.workflows.find((item) => item.id === workflowId && !item.archived);
    if (!workflow) throw new AutomationServiceError(404, "AUTOMATION_WORKFLOW_NOT_FOUND", "El workflow no existe.");
    if (["schedule", "webhook"].includes(mode) && (!workflow.active || workflow.version !== workflow.publishedVersion)) {
      throw new AutomationServiceError(409, "AUTOMATION_WORKFLOW_INACTIVE", "El workflow no está activo con una versión publicada.");
    }
    const validation = validateAutomationWorkflow(workflow, state);
    if (!validation.valid) throw new AutomationServiceError(409, "AUTOMATION_WORKFLOW_INVALID", `El workflow contiene ${validation.errors} error(es).`);

    const variables: Record<string, string> = {};
    const sensitiveValues: string[] = [];
    for (const variable of state.variables.filter((item) => item.projectId === workflow.projectId)) {
      const value = variable.secret && variable.encryptedValue
        ? String(vault.decrypt(variable.encryptedValue).value || "")
        : variable.value || "";
      variables[variable.key] = value;
      if (variable.secret && value) sensitiveValues.push(value);
    }

    const now = Date.parse(startedAt);
    const staleBefore = now - (workflow.settings.executionTimeoutSeconds + 60) * 1_000;
    for (const execution of state.executions.filter((item) => item.workflowId === workflow.id && item.status === "running" && Date.parse(item.startedAt) < staleBefore)) {
      execution.status = "error";
      execution.finishedAt = startedAt;
      execution.error = { message: "La ejecución anterior perdió su lease antes de finalizar." };
    }
    const running = state.executions.filter((item) => item.workflowId === workflow.id && item.status === "running").length;
    if (running >= workflow.settings.concurrency) {
      throw new AutomationServiceError(429, "AUTOMATION_CONCURRENCY_LIMIT", `El workflow alcanzó su límite de ${workflow.settings.concurrency} ejecución(es) simultánea(s).`);
    }
    state.executions.unshift({
      id: executionId,
      workflowId: workflow.id,
      projectId: workflow.projectId,
      workflowVersion: workflow.version,
      mode,
      status: "running",
      startedAt,
      requestedBy: actor.userId,
      retryOf,
      input: redactAutomationValue(input.slice(0, 100), sensitiveValues) as AutomationExecution["input"],
      output: [],
      nodeRuns: [],
      metadata: {
        depth,
        externalRequestsAllowed: policy.allowExternalRequests,
        metricoolOperationsAllowed: policy.allowMetricoolOperations,
        ...(triggerNodeId ? { triggerNodeId } : {}),
      },
    });
    state.executions = state.executions.slice(0, 500);
    workflow.lastRunAt = startedAt;
    workflow.lastRunStatus = "running";
    return { workflow, credentials: state.credentials.filter((item) => item.projectId === workflow.projectId), variables, sensitiveValues };
  });

  const signal = AbortSignal.timeout(Math.max(1, workflow.settings.executionTimeoutSeconds) * 1_000);
  const sensitiveSet = new Set(sensitiveValues);
  let result: Awaited<ReturnType<typeof executeAutomationWorkflow>>;
  try {
    result = await executeAutomationWorkflow(workflow, input.slice(0, 10_000), {
      mode,
      variables,
      allowExternalRequests: policy.allowExternalRequests,
      allowMetricoolOperations: policy.allowMetricoolOperations,
      depth,
      triggerNodeId,
      signal,
      sensitiveValues: sensitiveSet,
      resolveCredential: async (credentialId) => {
        const credential = credentials.find((item) => item.id === credentialId);
        if (!credential?.encryptedData) throw new AutomationServiceError(409, "CREDENTIAL_NOT_CONFIGURED", "La credencial no está configurada.");
        const data = vault.decrypt(credential.encryptedData);
        for (const value of Object.values(data)) if (typeof value === "string" && value) sensitiveSet.add(value);
        return data;
      },
      executeSubworkflow: async (targetId, items, nextDepth) => {
        const subExecution = await executeAutomation(repository, vault, actor, policy, targetId, items, "subworkflow", undefined, nextDepth);
        if (subExecution.status !== "success") throw new Error(subExecution.error?.message || "El subworkflow falló.");
        return subExecution.output;
      },
    });
  } catch (error) {
    result = { status: "error", output: [], nodeRuns: [], error: { message: error instanceof Error ? error.message.slice(0, 1_000) : "La ejecución falló." } };
  }
  const finishedAt = new Date().toISOString();
  const execution: AutomationExecution = {
    id: executionId,
    workflowId: workflow.id,
    projectId: workflow.projectId,
    workflowVersion: workflow.version,
    mode,
    status: result.status === "success" ? "success" : "error",
    startedAt,
    finishedAt,
    requestedBy: actor.userId,
    retryOf,
    input: redactAutomationValue(input.slice(0, 100), [...sensitiveSet]) as AutomationExecution["input"],
    output: result.output.slice(0, 100),
    nodeRuns: result.nodeRuns,
    error: result.error,
    metadata: {
      depth,
      externalRequestsAllowed: policy.allowExternalRequests,
      metricoolOperationsAllowed: policy.allowMetricoolOperations,
      ...(triggerNodeId ? { triggerNodeId } : {}),
    },
  };
  await repository.mutateAutomation((latest) => {
    const currentWorkflow = latest.workflows.find((item) => item.id === workflow.id);
    const shouldSave = execution.status === "success"
      ? workflow.settings.saveSuccessfulExecutions
      : workflow.settings.saveFailedExecutions;
    if (shouldSave) {
      const index = latest.executions.findIndex((item) => item.id === execution.id);
      if (index >= 0) latest.executions[index] = execution;
      else latest.executions.unshift(execution);
      latest.executions = latest.executions.slice(0, 500);
    } else latest.executions = latest.executions.filter((item) => item.id !== execution.id);
    if (currentWorkflow) {
      currentWorkflow.lastRunAt = finishedAt;
      currentWorkflow.lastRunStatus = execution.status;
    }
  });

  if (result.status === "error" && workflow.settings.errorWorkflowId && depth < 3) {
    try {
      const errorExecution = await executeAutomation(repository, vault, actor, policy, workflow.settings.errorWorkflowId, [{
        sourceWorkflowId: workflow.id,
        sourceExecutionId: executionId,
        failedNodeId: result.error?.nodeId,
        errorMessage: result.error?.message || "El workflow falló.",
        failedAt: finishedAt,
      }], "subworkflow", undefined, depth + 1);
      execution.metadata.errorWorkflowExecutionId = errorExecution.id;
      await repository.mutateAutomation((latest) => {
        const stored = latest.executions.find((item) => item.id === execution.id);
        if (stored) stored.metadata.errorWorkflowExecutionId = errorExecution.id;
      });
    } catch {
      // El error original conserva prioridad.
    }
  }
  return execution;
}
