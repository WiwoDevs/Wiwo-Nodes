export type AutomationNode = {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: { x: number; y: number };
  parameters: Record<string, unknown>;
  credentialId?: string;
  disabled?: boolean;
  notes?: string;
  continueOnFail?: boolean;
  retryOnFail?: boolean;
  maxTries?: number;
};

export type AutomationConnection = {
  id: string;
  sourceNode: string;
  sourceOutput: string;
  targetNode: string;
  targetInput: string;
};

export type AutomationWorkflow = {
  id: string;
  projectId: string;
  folderId?: string;
  name: string;
  description: string;
  active: boolean;
  archived: boolean;
  version: number;
  publishedVersion: number;
  tags: string[];
  nodes: AutomationNode[];
  connections: AutomationConnection[];
  settings: {
    timezone: string;
    executionTimeoutSeconds: number;
    saveSuccessfulExecutions: boolean;
    saveFailedExecutions: boolean;
    errorWorkflowId?: string;
    concurrency: number;
  };
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  lastRunAt?: string;
  lastRunStatus?: AutomationExecution["status"];
};

export type AutomationExecution = {
  id: string;
  workflowId: string;
  projectId: string;
  workflowVersion: number;
  mode: "manual" | "webhook" | "schedule" | "subworkflow" | "retry";
  status: "queued" | "running" | "waiting" | "success" | "error" | "canceled";
  startedAt: string;
  finishedAt?: string;
  requestedBy: string;
  retryOf?: string;
  input: Array<Record<string, unknown>>;
  output: Array<Record<string, unknown>>;
  nodeRuns: Array<{
    nodeId: string;
    nodeName: string;
    nodeType: string;
    status: "success" | "error" | "skipped";
    startedAt: string;
    finishedAt: string;
    itemsIn: number;
    itemsOut: number;
    attempts?: number;
    error?: string;
  }>;
  error?: { nodeId?: string; message: string };
};

export type AutomationNodeDefinition = {
  type: string;
  version: number;
  name: string;
  description: string;
  group: "trigger" | "action" | "flow" | "transform" | "data" | "sac";
  icon: string;
  color: string;
  status: "ready" | "beta";
  executable: boolean;
  trigger: boolean;
  outputs: string[];
  credentialTypes?: string[];
  parameters: Array<{
    key: string;
    label: string;
    type: "string" | "number" | "boolean" | "json" | "select" | "credential" | "workflow";
    required?: boolean;
    secret?: boolean;
    default?: unknown;
    options?: Array<{ label: string; value: string }>;
    description?: string;
  }>;
};

export type AutomationTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  featured: boolean;
  workflow: Pick<AutomationWorkflow, "nodes" | "connections" | "settings" | "tags">;
};

export type AutomationPlatformState = {
  projects: Array<{ id: string; name: string; description: string; type: "personal" | "team"; color: string }>;
  folders: Array<{ id: string; projectId: string; parentId?: string; name: string }>;
  tags: Array<{ id: string; projectId: string; name: string; color: string }>;
  credentials: Array<{ id: string; projectId: string; name: string; type: string; status: "configured" | "unconfigured"; dataKeys: string[]; configured: boolean; updatedAt: string }>;
  variables: Array<{ id: string; projectId: string; key: string; value: string; secret: boolean; updatedAt: string }>;
  workflows: AutomationWorkflow[];
  workflowVersions: Array<{ id: string; workflowId: string; version: number; status: "draft" | "published" | "archived"; createdAt: string; createdBy: string; changeNote?: string }>;
  executions: AutomationExecution[];
};

export type AutomationValidation = {
  valid: boolean;
  errors: number;
  warnings: number;
  issues: Array<{ level: "error" | "warning"; code: string; message: string; nodeId?: string; connectionId?: string }>;
};

export type PlatformMeta = {
  demoMode: boolean;
  externalNodesDisabled: boolean;
  metricoolMutationsDisabled: boolean;
  templates?: number;
  nodeTypes?: number;
};

export type OperationalJobStatus = "queued" | "running" | "retry" | "succeeded" | "dead";

export type OperationalJob = {
  id: string;
  scheduleKey: string;
  kind: "sync" | "automation";
  workflowId?: string;
  triggerMode?: "manual" | "webhook" | "schedule" | "subworkflow" | "retry";
  status: OperationalJobStatus;
  accountIds: string[];
  limit: number;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  runId?: string;
  lastError?: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const PLATFORM_API = `${API_BASE}/platform`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${PLATFORM_API}${path}`, init);
  const payload = await response.json().catch(() => undefined) as { data?: T; error?: { message?: string } } | undefined;
  if (!response.ok) throw new Error(payload?.error?.message || `La plataforma respondió HTTP ${response.status}.`);
  return payload?.data as T;
}

function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
}

function idempotentJson(prefix: string, body: unknown): RequestInit {
  const entropy = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { ...json("POST", body), headers: { "Content-Type": "application/json", "Idempotency-Key": `${prefix}-${entropy}` } };
}

async function coreRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const payload = await response.json().catch(() => undefined) as { data?: T; error?: { message?: string } } | undefined;
  if (!response.ok) throw new Error(payload?.error?.message || `La API respondió HTTP ${response.status}.`);
  return payload?.data as T;
}

export async function loadOperationalJobs(): Promise<OperationalJob[]> {
  const statuses = ["dead", "retry"] as const;
  const groups = await Promise.all(statuses.map((status) => coreRequest<OperationalJob[]>(`/jobs?status=${status}`)));
  return groups.flatMap((group) => Array.isArray(group) ? group : [])
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export async function retryOperationalJob(id: string): Promise<OperationalJob> {
  return coreRequest(`/jobs/${encodeURIComponent(id)}/retry`, idempotentJson("job-retry", {}));
}

export async function loadAutomationPlatform(): Promise<{ state: AutomationPlatformState; meta: PlatformMeta }> {
  const response = await fetch(PLATFORM_API);
  const payload = await response.json() as { data: AutomationPlatformState; meta: PlatformMeta; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `La plataforma respondió HTTP ${response.status}.`);
  return { state: payload.data, meta: payload.meta };
}

export async function loadAutomationCatalog(): Promise<{ nodes: AutomationNodeDefinition[]; credentialTypes: Array<{ type: string; name: string; description?: string; fields: string[] }> }> {
  return request("/catalog");
}

export async function loadAutomationTemplates(): Promise<AutomationTemplate[]> {
  return request("/templates");
}

export async function createPlatformWorkflow(input: { projectId: string; name: string; description?: string; templateId?: string }): Promise<AutomationWorkflow> {
  return request("/workflows", json("POST", input));
}

export async function savePlatformWorkflow(workflow: AutomationWorkflow): Promise<AutomationWorkflow> {
  return request(`/workflows/${encodeURIComponent(workflow.id)}`, json("PUT", {
    name: workflow.name,
    description: workflow.description,
    folderId: workflow.folderId ?? null,
    tags: workflow.tags,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings,
    changeNote: "Edición desde el studio visual.",
  }));
}

export async function validatePlatformWorkflow(id: string): Promise<AutomationValidation> {
  return request(`/workflows/${encodeURIComponent(id)}/validate`, json("POST", {}));
}

export async function publishPlatformWorkflow(id: string): Promise<AutomationWorkflow> {
  return request(`/workflows/${encodeURIComponent(id)}/publish`, json("POST", { changeNote: "Publicación desde el studio visual." }));
}

export async function setPlatformWorkflowActive(id: string, active: boolean): Promise<AutomationWorkflow> {
  return request(`/workflows/${encodeURIComponent(id)}/active`, json("POST", { active }));
}

export async function runPlatformWorkflow(id: string, input: Array<Record<string, unknown>> = [{}]): Promise<AutomationExecution> {
  return request(`/workflows/${encodeURIComponent(id)}/run`, idempotentJson("platform-run", { input }));
}

export async function duplicatePlatformWorkflow(id: string): Promise<AutomationWorkflow> {
  return request(`/workflows/${encodeURIComponent(id)}/duplicate`, json("POST", {}));
}

export async function rollbackPlatformWorkflow(id: string, version: number): Promise<AutomationWorkflow> {
  return request(`/workflows/${encodeURIComponent(id)}/rollback`, json("POST", { version, changeNote: "Rollback desde Automation Studio." }));
}

export async function downloadPlatformWorkflow(id: string, name: string): Promise<void> {
  const response = await fetch(`${PLATFORM_API}/workflows/${encodeURIComponent(id)}/export`);
  if (!response.ok) throw new Error(`No se pudo exportar el workflow: HTTP ${response.status}.`);
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${name.toLocaleLowerCase("es-CL").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workflow"}.json`;
  anchor.click();
  URL.revokeObjectURL(href);
}

export async function importPlatformWorkflow(input: {
  projectId: string;
  name: string;
  description?: string;
  nodes: AutomationNode[];
  connections: AutomationConnection[];
  settings: AutomationWorkflow["settings"];
}): Promise<AutomationWorkflow> {
  return request("/workflows/import", json("POST", input));
}

export async function retryPlatformExecution(id: string): Promise<AutomationExecution> {
  return request(`/executions/${encodeURIComponent(id)}/retry`, idempotentJson("platform-retry", {}));
}

export async function createPlatformCredential(input: { projectId: string; name: string; type: string; data?: Record<string, unknown> }) {
  return request("/credentials", json("POST", input));
}

export async function updatePlatformCredential(id: string, input: { name?: string; data?: Record<string, unknown> }) {
  return request(`/credentials/${encodeURIComponent(id)}`, json("PUT", input));
}

export async function upsertPlatformVariable(input: { projectId: string; key: string; value: string; secret: boolean }) {
  return request("/variables", json("PUT", input));
}
