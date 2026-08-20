export type AutomationNodeGroup = "trigger" | "action" | "flow" | "transform" | "data" | "sac";
export type AutomationNodeStatus = "ready" | "beta";
export type AutomationExecutionStatus = "queued" | "running" | "waiting" | "success" | "error" | "canceled";
export type AutomationExecutionMode = "manual" | "webhook" | "schedule" | "subworkflow" | "retry";

export interface AutomationProject {
  id: string;
  name: string;
  description: string;
  type: "personal" | "team";
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationFolder {
  id: string;
  projectId: string;
  parentId?: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationTag {
  id: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface AutomationCredential {
  id: string;
  projectId: string;
  name: string;
  type: string;
  status: "unconfigured" | "configured";
  encryptedData?: string;
  dataKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicAutomationCredential extends Omit<AutomationCredential, "encryptedData"> {
  configured: boolean;
}

export interface AutomationVariable {
  id: string;
  projectId: string;
  key: string;
  value?: string;
  encryptedValue?: string;
  secret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicAutomationVariable extends Omit<AutomationVariable, "encryptedValue"> {
  value: string;
}

export interface AutomationNodeParameterDefinition {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "json" | "select" | "credential" | "workflow";
  required?: boolean;
  secret?: boolean;
  default?: string | number | boolean | Record<string, unknown> | unknown[];
  options?: Array<{ label: string; value: string }>;
  description?: string;
}

export interface AutomationNodeDefinition {
  type: string;
  version: number;
  name: string;
  description: string;
  group: AutomationNodeGroup;
  icon: string;
  color: string;
  status: AutomationNodeStatus;
  executable: boolean;
  trigger: boolean;
  outputs: string[];
  credentialTypes?: string[];
  parameters: AutomationNodeParameterDefinition[];
}

export interface AutomationNode {
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
}

export interface AutomationConnection {
  id: string;
  sourceNode: string;
  sourceOutput: string;
  targetNode: string;
  targetInput: string;
}

export interface AutomationWorkflowSettings {
  timezone: string;
  executionTimeoutSeconds: number;
  saveSuccessfulExecutions: boolean;
  saveFailedExecutions: boolean;
  errorWorkflowId?: string;
  concurrency: number;
}

export interface AutomationWorkflow {
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
  settings: AutomationWorkflowSettings;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  lastRunAt?: string;
  lastRunStatus?: AutomationExecutionStatus;
}

export interface AutomationWorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  status: "draft" | "published" | "archived";
  snapshot: AutomationWorkflow;
  createdAt: string;
  createdBy: string;
  changeNote?: string;
}

export interface AutomationNodeRun {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: "success" | "error" | "skipped";
  startedAt: string;
  finishedAt: string;
  itemsIn: number;
  itemsOut: number;
  attempts?: number;
  outputs: Record<string, Array<Record<string, unknown>>>;
  error?: string;
}

export interface AutomationExecution {
  id: string;
  workflowId: string;
  projectId: string;
  workflowVersion: number;
  mode: AutomationExecutionMode;
  status: AutomationExecutionStatus;
  startedAt: string;
  finishedAt?: string;
  requestedBy: string;
  retryOf?: string;
  input: Array<Record<string, unknown>>;
  output: Array<Record<string, unknown>>;
  nodeRuns: AutomationNodeRun[];
  error?: { nodeId?: string; message: string };
  metadata: Record<string, string | number | boolean>;
}

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  featured: boolean;
  workflow: Pick<AutomationWorkflow, "nodes" | "connections" | "settings" | "tags">;
}

export interface AutomationState {
  projects: AutomationProject[];
  folders: AutomationFolder[];
  tags: AutomationTag[];
  credentials: AutomationCredential[];
  variables: AutomationVariable[];
  workflows: AutomationWorkflow[];
  workflowVersions: AutomationWorkflowVersion[];
  executions: AutomationExecution[];
}

export interface AutomationValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
  connectionId?: string;
}

export interface AutomationValidationResult {
  valid: boolean;
  errors: number;
  warnings: number;
  issues: AutomationValidationIssue[];
}
