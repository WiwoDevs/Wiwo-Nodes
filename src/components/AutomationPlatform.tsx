import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  ArrowRight,
  ArrowsClockwise,
  ArrowSquareOut,
  BracketsCurly,
  Buildings,
  ChatCircleDots,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Database,
  DotsThree,
  DownloadSimple,
  FlowArrow,
  Globe,
  GearSix,
  UploadSimple,
  Key,
  Lightning,
  LockKey,
  MagnifyingGlass,
  Play,
  Plus,
  ShieldCheck,
  SquaresFour,
  Stack,
  Trash,
  UserFocus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  createPlatformCredential,
  createPlatformWorkflow,
  duplicatePlatformWorkflow,
  downloadPlatformWorkflow,
  loadAutomationCatalog,
  loadAutomationPlatform,
  loadAutomationTemplates,
  importPlatformWorkflow,
  publishPlatformWorkflow,
  loadOperationalJobs,
  retryOperationalJob,
  retryPlatformExecution,
  rollbackPlatformWorkflow,
  runPlatformWorkflow,
  savePlatformWorkflow,
  setPlatformWorkflowActive,
  upsertPlatformVariable,
  updatePlatformCredential,
  validatePlatformWorkflow,
  type AutomationExecution,
  type AutomationNode,
  type AutomationNodeDefinition,
  type AutomationPlatformState,
  type AutomationTemplate,
  type AutomationValidation,
  type AutomationWorkflow,
  type OperationalJob,
  type PlatformMeta,
} from "../lib/platform-api";
import type { ApiWorkflow } from "../lib/api";
import type { BrandAccount, Interaction } from "../types";
import { interactionKindLabel, SocialPlatformIcon } from "./SocialPlatformIcon";
import { ContentContext } from "./ContentContext";

export type AutomationSection = "home" | "workflows" | "executions" | "templates" | "credentials";
export type AutomationHomeDestination = "platform-home" | "automations" | "automation-executions" | "workflow" | "dashboard" | "interactions" | "accounts";

type ToastPayload = { tone: "success" | "warning"; title: string; detail: string };
type AutomationPlatformProps = {
  section: AutomationSection;
  canAdmin: boolean;
  canOperate: boolean;
  canSupervise: boolean;
  accounts: BrandAccount[];
  interactions: Interaction[];
  sacWorkflow: ApiWorkflow;
  isOperationalLoading: boolean;
  onNavigate: (destination: AutomationHomeDestination) => void;
  onOpenInteraction: (interaction: Interaction) => void;
  onToast: (payload: ToastPayload) => void;
};
type PlatformNodeData = {
  automationNode: AutomationNode;
  definition?: AutomationNodeDefinition;
};

const groupLabels: Record<AutomationNodeDefinition["group"], string> = {
  trigger: "Disparadores",
  action: "Acciones",
  flow: "Control de flujo",
  transform: "Transformación",
  data: "Datos",
  sac: "SAC Flow",
};

const groupIcons = {
  trigger: Lightning,
  action: Globe,
  flow: FlowArrow,
  transform: BracketsCurly,
  data: Database,
  sac: Stack,
};

function formatDate(value?: string): string {
  if (!value) return "Sin ejecuciones";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status?: AutomationExecution["status"]): string {
  return ({ success: "Correcta", error: "Con error", queued: "En cola", running: "Ejecutando", waiting: "En espera", canceled: "Cancelada" } as Record<string, string>)[status || ""] || "Sin ejecutar";
}

function durationLabel(execution: AutomationExecution): string {
  if (!execution.finishedAt) return "En curso";
  const duration = Math.max(0, Date.parse(execution.finishedAt) - Date.parse(execution.startedAt));
  return duration < 1_000 ? `${duration} ms` : `${(duration / 1_000).toFixed(1)} s`;
}

function interactionStatusLabel(status: Interaction["status"]): string {
  return ({
    pending: "Pendiente",
    needs_review: "Revisión",
    automated: "Automatizada",
    answered_by_team: "Respondida por el equipo",
    resolved: "Resuelta",
  } as const)[status];
}

function interactionPriorityLabel(priority: Interaction["priority"]): string {
  return ({ normal: "Normal", high: "Alta", urgent: "Urgente" } as const)[priority];
}

function accountHealthLabel(health: BrandAccount["health"]): string {
  return ({ healthy: "Operativa", attention: "Revisar", disconnected: "Desconectada" } as const)[health];
}

const PlatformCanvasNode = memo(({ data, selected }: NodeProps<Node<PlatformNodeData>>) => {
  const definition = data.definition;
  const Icon = definition ? groupIcons[definition.group] : Stack;
  return (
    <div className={`platform-canvas-node ${selected ? "is-selected" : ""} ${data.automationNode.disabled ? "is-disabled" : ""}`} style={{ "--node-color": definition?.color || "#4b46f5" } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="platform-node-handle" />
      <span className="platform-node-icon"><Icon size={20} weight="duotone" /></span>
      <span className="platform-node-copy">
        <small>{definition ? groupLabels[definition.group] : "Nodo"}</small>
        <strong>{data.automationNode.name}</strong>
        <em>{definition?.name || data.automationNode.type}</em>
      </span>
      {definition?.status === "beta" ? <span className="platform-beta">BETA</span> : null}
      <Handle type="source" position={Position.Right} className="platform-node-handle" />
    </div>
  );
});

PlatformCanvasNode.displayName = "PlatformCanvasNode";
const platformNodeTypes = { platform: PlatformCanvasNode };

function StateBadge({ status }: { status?: AutomationExecution["status"] }) {
  const success = status === "success";
  const error = status === "error";
  return <span className={`platform-status ${success ? "success" : error ? "error" : "neutral"}`}>{success ? <CheckCircle weight="fill" /> : error ? <WarningCircle weight="fill" /> : <Clock weight="fill" />}{statusLabel(status)}</span>;
}

function EmptyPlatform({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return <section className="platform-empty"><span><SquaresFour size={28} weight="duotone" /></span><h2>{title}</h2><p>{copy}</p>{action}</section>;
}

function OperationalJobsPanel({
  jobs,
  workflows,
  isLoading,
  error,
  canAdmin,
  retryingJobId,
  onRefresh,
  onRetry,
}: {
  jobs: OperationalJob[];
  workflows: AutomationWorkflow[];
  isLoading: boolean;
  error: string | null;
  canAdmin: boolean;
  retryingJobId: string | null;
  onRefresh: () => Promise<void>;
  onRetry: (job: OperationalJob) => Promise<void>;
}) {
  const blockedCount = jobs.filter((job) => job.status === "dead").length;
  const deferredCount = jobs.length - blockedCount;
  const workflowNames = new Map(workflows.map((workflow) => [workflow.id, workflow.name]));

  return (
    <section className="operational-jobs" aria-labelledby="operational-jobs-title" aria-busy={isLoading}>
      <header>
        <div className="operational-jobs-heading">
          <span className={blockedCount ? "is-warning" : "is-ready"}>
            {blockedCount ? <WarningCircle size={22} weight="fill" /> : <CheckCircle size={22} weight="fill" />}
          </span>
          <div>
            <h2 id="operational-jobs-title">Cola operativa</h2>
            <p>Trabajos que requieren supervisión o esperan otro intento.</p>
          </div>
        </div>
        <div className="operational-jobs-summary" aria-label="Resumen de la cola operativa">
          <span><strong>{blockedCount}</strong> bloqueados</span>
          <span><strong>{deferredCount}</strong> en espera</span>
          <button className="icon-button" aria-label="Actualizar cola operativa" onClick={() => void onRefresh()} disabled={isLoading}>
            <ArrowsClockwise className={isLoading ? "spin" : undefined} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="operational-jobs-state is-error" role="alert">
          <WarningCircle size={20} weight="fill" />
          <span><strong>No se pudo actualizar la cola</strong><small>{error}</small></span>
          <button className="button secondary" onClick={() => void onRefresh()}>Volver a intentar</button>
        </div>
      ) : null}
      {isLoading && !jobs.length ? (
        <div className="operational-jobs-state" role="status" aria-live="polite">
          <ArrowsClockwise className="spin" size={20} />
          <span><strong>Cargando cola operativa</strong><small>Consultando fallos y reintentos durables.</small></span>
        </div>
      ) : !jobs.length ? (
        error ? null : <div className="operational-jobs-state is-empty">
          <CheckCircle size={22} weight="fill" />
          <span><strong>Sin trabajos bloqueados</strong><small>No hay fallos pendientes de intervención.</small></span>
        </div>
      ) : (
        <div className="operational-jobs-table-wrap">
          <table className="operational-jobs-table">
            <thead>
              <tr><th>Estado</th><th>Trabajo</th><th>Intentos</th><th>Próxima acción</th><th>Último error</th><th><span className="sr-only">Acciones</span></th></tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const workflowName = job.workflowId ? workflowNames.get(job.workflowId) : undefined;
                const title = job.kind === "sync" ? "Sincronización SAC" : workflowName || "Automatización";
                return (
                  <tr key={job.id}>
                    <td><span className={`operational-job-status ${job.status}`}>
                      {job.status === "dead" ? <WarningCircle weight="fill" /> : <Clock weight="fill" />}
                      {job.status === "dead" ? "Bloqueado" : "En espera"}
                    </span></td>
                    <td><strong>{title}</strong><small title={job.id}>{job.kind === "sync" ? job.scheduleKey : job.triggerMode || "programada"}</small></td>
                    <td><strong>{job.attempts} de {job.maxAttempts}</strong><small>{job.status === "dead" ? "Límite alcanzado" : "Espera programada"}</small></td>
                    <td><strong>{job.status === "dead" ? "Revisión manual" : formatDate(job.nextAttemptAt)}</strong><small>Actualizado {formatDate(job.updatedAt)}</small></td>
                    <td><p title={job.lastError}>{job.lastError || "Sin detalle disponible."}</p></td>
                    <td>{canAdmin ? (
                      <button className="button secondary operational-job-retry" disabled={retryingJobId === job.id} onClick={() => void onRetry(job)}>
                        <ArrowsClockwise className={retryingJobId === job.id ? "spin" : undefined} />
                        {retryingJobId === job.id ? "Programando" : "Reintentar ahora"}
                      </button>
                    ) : <span className="operational-job-restricted"><LockKey /> Solo administrador</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WorkflowStudio({
  initialWorkflow,
  definitions,
  credentials,
  workflows,
  canAdmin,
  canOperate,
  onBack,
  onChanged,
  onToast,
}: {
  initialWorkflow: AutomationWorkflow;
  definitions: AutomationNodeDefinition[];
  credentials: AutomationPlatformState["credentials"];
  workflows: AutomationWorkflow[];
  canAdmin: boolean;
  canOperate: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onToast: (payload: ToastPayload) => void;
}) {
  const definitionMap = useMemo(() => new Map(definitions.map((item) => [item.type, item])), [definitions]);
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);
  const [isRunning, setRunning] = useState(false);
  const [validation, setValidation] = useState<AutomationValidation | null>(null);
  const [lastExecution, setLastExecution] = useState<AutomationExecution | null>(null);

  const initialNodes = useMemo<Node<PlatformNodeData>[]>(() => workflow.nodes.map((node) => ({
    id: node.id,
    type: "platform",
    position: node.position,
    data: { automationNode: node, definition: definitionMap.get(node.type) },
  })), [definitionMap, workflow.nodes]);
  const initialEdges = useMemo<Edge[]>(() => workflow.connections.map((connection) => ({
    id: connection.id,
    source: connection.sourceNode,
    target: connection.targetNode,
    sourceHandle: connection.sourceOutput,
    targetHandle: connection.targetInput,
    type: "smoothstep",
    animated: true,
  })), [workflow.connections]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setWorkflow(initialWorkflow);
    setNodes(initialWorkflow.nodes.map((node) => ({ id: node.id, type: "platform", position: node.position, data: { automationNode: node, definition: definitionMap.get(node.type) } })));
    setEdges(initialWorkflow.connections.map((connection) => ({ id: connection.id, source: connection.sourceNode, target: connection.targetNode, type: "smoothstep", animated: true })));
    setSelectedNodeId(null);
  }, [definitionMap, initialWorkflow, setEdges, setNodes]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedDefinition = selectedNode?.data.definition;
  const InspectorIcon = selectedDefinition ? groupIcons[selectedDefinition.group] : FlowArrow;
  const groups = useMemo(() => {
    const filtered = definitions.filter((definition) => `${definition.name} ${definition.description}`.toLocaleLowerCase("es-CL").includes(search.toLocaleLowerCase("es-CL")));
    return Object.entries(groupLabels).map(([group, label]) => ({ group, label, items: filtered.filter((item) => item.group === group) })).filter((section) => section.items.length);
  }, [definitions, search]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID(), type: "smoothstep", animated: true }, current));
  }, [setEdges]);

  function addNode(definition: AutomationNodeDefinition) {
    if (!canAdmin || !definition.executable) return;
    const node: AutomationNode = {
      id: crypto.randomUUID(),
      name: definition.name,
      type: definition.type,
      typeVersion: definition.version,
      position: { x: 180 + (nodes.length % 4) * 260, y: 140 + Math.floor(nodes.length / 4) * 150 },
      parameters: Object.fromEntries(definition.parameters.filter((parameter) => parameter.default !== undefined).map((parameter) => [parameter.key, parameter.default])),
    };
    setNodes((current) => [...current, { id: node.id, type: "platform", position: node.position, data: { automationNode: node, definition } }]);
    setSelectedNodeId(node.id);
  }

  function updateSelectedNode(patch: Partial<AutomationNode>) {
    if (!selectedNodeId) return;
    setNodes((current) => current.map((node) => node.id === selectedNodeId ? { ...node, data: { ...node.data, automationNode: { ...node.data.automationNode, ...patch } } } : node));
  }

  function removeSelectedNode() {
    if (!selectedNodeId || !canAdmin) return;
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) => current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId));
    setSelectedNodeId(null);
  }

  function materializeWorkflow(): AutomationWorkflow {
    return {
      ...workflow,
      nodes: nodes.map((node) => ({ ...node.data.automationNode, position: node.position })),
      connections: edges.filter((edge) => edge.source && edge.target).map((edge) => ({
        id: edge.id,
        sourceNode: edge.source,
        sourceOutput: edge.sourceHandle || "main",
        targetNode: edge.target,
        targetInput: edge.targetHandle || "main",
      })),
    };
  }

  async function save() {
    if (!canAdmin) return;
    setSaving(true);
    try {
      const saved = await savePlatformWorkflow(materializeWorkflow());
      setWorkflow(saved);
      const result = await validatePlatformWorkflow(saved.id);
      setValidation(result);
      await onChanged();
      onToast({ tone: result.valid ? "success" : "warning", title: "Workflow guardado", detail: result.valid ? `Versión ${saved.version} lista para publicar.` : `${result.errors} errores y ${result.warnings} advertencias.` });
    } catch (error) {
      onToast({ tone: "warning", title: "No se pudo guardar", detail: error instanceof Error ? error.message : "Error desconocido." });
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    if (!canOperate) return;
    setRunning(true);
    try {
      const execution = await runPlatformWorkflow(workflow.id);
      setLastExecution(execution);
      await onChanged();
      onToast({ tone: execution.status === "success" ? "success" : "warning", title: execution.status === "success" ? "Ejecución correcta" : "La ejecución terminó con error", detail: `${execution.nodeRuns.length} nodos procesados · ${execution.output.length} items de salida.` });
    } catch (error) {
      onToast({ tone: "warning", title: "No se pudo ejecutar", detail: error instanceof Error ? error.message : "Error desconocido." });
    } finally {
      setRunning(false);
    }
  }

  async function publish() {
    if (!canAdmin) return;
    try {
      const published = await publishPlatformWorkflow(workflow.id);
      setWorkflow(published);
      await onChanged();
      onToast({ tone: "success", title: "Versión publicada", detail: `La versión ${published.publishedVersion} quedó disponible para activación.` });
    } catch (error) {
      onToast({ tone: "warning", title: "No se pudo publicar", detail: error instanceof Error ? error.message : "Corrige el workflow." });
    }
  }

  async function rollback() {
    if (!canAdmin || workflow.publishedVersion < 1) return;
    try {
      const restored = await rollbackPlatformWorkflow(workflow.id, workflow.publishedVersion);
      setWorkflow(restored);
      await onChanged();
      onToast({ tone: "success", title: "Rollback preparado", detail: `La versión publicada ${workflow.publishedVersion} se restauró como borrador v${restored.version}.` });
    } catch (error) {
      onToast({ tone: "warning", title: "No se pudo restaurar", detail: error instanceof Error ? error.message : "Error desconocido." });
    }
  }

  async function toggleActive() {
    if (!canAdmin) return;
    try {
      const updated = await setPlatformWorkflowActive(workflow.id, !workflow.active);
      setWorkflow(updated);
      await onChanged();
    } catch (error) {
      onToast({ tone: "warning", title: "No se pudo cambiar el estado", detail: error instanceof Error ? error.message : "Corrige y publica el workflow." });
    }
  }

  return (
    <section className="platform-studio">
      <header className="studio-toolbar">
        <button className="icon-button" onClick={onBack} aria-label="Volver a workflows"><X size={18} /></button>
        <div className="studio-title"><small>Automatizaciones / Editor</small><input aria-label="Nombre del workflow" value={workflow.name} disabled={!canAdmin} onChange={(event) => setWorkflow((current) => ({ ...current, name: event.target.value }))} /></div>
        <span className="studio-version">Borrador v{workflow.version} · Publicada v{workflow.publishedVersion}</span>
        <div className="studio-actions">
          <label className="studio-active"><span>{workflow.active ? "Activo" : "Inactivo"}</span><button className={`switch ${workflow.active ? "is-on" : ""}`} aria-pressed={workflow.active} onClick={toggleActive} disabled={!canAdmin}><span /></button></label>
          <button className="button secondary" onClick={save} disabled={!canAdmin || isSaving}>{isSaving ? <ArrowsClockwise className="spin" /> : <Check />} Guardar</button>
          <button className="button secondary restore-button" onClick={rollback} disabled={!canAdmin || workflow.publishedVersion < 1} title="Restaurar la versión publicada"><ArrowsClockwise /><span>Restaurar</span></button>
          <button className="button secondary" onClick={publish} disabled={!canAdmin}>Publicar</button>
          <button className="button primary" onClick={run} disabled={!canOperate || isRunning}>{isRunning ? <ArrowsClockwise className="spin" /> : <Play weight="fill" />} Ejecutar</button>
        </div>
      </header>
      <div className="studio-workspace">
        <aside className="node-library">
          <div className="node-library-heading"><strong>Nodos</strong><small>{definitions.filter((item) => item.executable).length} disponibles</small></div>
          <label className="platform-search"><MagnifyingGlass /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nodo" /></label>
          <div className="node-library-list">
            {groups.map((section) => <section key={section.group}><h3>{section.label}</h3>{section.items.map((definition) => { const Icon = groupIcons[definition.group]; return <button key={definition.type} disabled={!canAdmin || !definition.executable} onClick={() => addNode(definition)} title={definition.description}><span style={{ background: `${definition.color}16`, color: definition.color }}><Icon size={17} weight="duotone" /></span><span><strong>{definition.name}</strong><small>{definition.description}</small></span><Plus /></button>; })}</section>)}
          </div>
        </aside>
        <div className="platform-canvas" aria-label="Editor visual de automatizaciones">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_, node) => setSelectedNodeId(node.id)} onPaneClick={() => setSelectedNodeId(null)} nodeTypes={platformNodeTypes} defaultViewport={{ x: 28, y: 16, zoom: 0.62 }} minZoom={0.25} maxZoom={1.8} deleteKeyCode={canAdmin ? ["Backspace", "Delete"] : null}>
            <Background variant={BackgroundVariant.Dots} color="#c6d3eb" gap={22} size={1.3} />
            <Controls showInteractive={false} />
          </ReactFlow>
          <div className="canvas-safety-note"><ShieldCheck weight="fill" /> Externos bloqueados · Metricool en solo lectura</div>
          {lastExecution ? <div className={`canvas-run-result ${lastExecution.status}`}><StateBadge status={lastExecution.status} /><span>{lastExecution.nodeRuns.length} nodos · {lastExecution.output.length} items</span><button onClick={() => setLastExecution(null)} aria-label="Cerrar resultado"><X /></button></div> : null}
        </div>
        {selectedNode && selectedDefinition ? (
          <aside className="node-inspector">
            <header><span style={{ background: `${selectedDefinition.color}16`, color: selectedDefinition.color }}><InspectorIcon size={20} weight="duotone" /></span><div><small>{groupLabels[selectedDefinition.group]}</small><strong>{selectedDefinition.name}</strong></div><button className="icon-button" aria-label="Cerrar inspector" onClick={() => setSelectedNodeId(null)}><X /></button></header>
            <div className="inspector-scroll">
              <label className="platform-field"><span>Nombre del nodo</span><input value={selectedNode.data.automationNode.name} disabled={!canAdmin} onChange={(event) => updateSelectedNode({ name: event.target.value })} /></label>
              {selectedDefinition.parameters.map((parameter) => {
                const value = selectedNode.data.automationNode.parameters[parameter.key] ?? parameter.default ?? "";
                const update = (next: unknown) => updateSelectedNode({ parameters: { ...selectedNode.data.automationNode.parameters, [parameter.key]: next } });
                if (parameter.type === "boolean") return <label className="platform-check" key={parameter.key}><input type="checkbox" checked={Boolean(value)} disabled={!canAdmin} onChange={(event) => update(event.target.checked)} /><span><strong>{parameter.label}</strong><small>{parameter.description}</small></span></label>;
                if (parameter.type === "select") return <label className="platform-field" key={parameter.key}><span>{parameter.label}</span><select value={String(value)} disabled={!canAdmin} onChange={(event) => update(event.target.value)}>{parameter.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
                if (parameter.type === "credential") return <label className="platform-field" key={parameter.key}><span>{parameter.label}</span><select value={selectedNode.data.automationNode.credentialId || ""} disabled={!canAdmin} onChange={(event) => updateSelectedNode({ credentialId: event.target.value || undefined })}><option value="">Seleccionar credencial</option>{credentials.filter((credential) => !selectedDefinition.credentialTypes?.length || selectedDefinition.credentialTypes.includes(credential.type)).map((credential) => <option key={credential.id} value={credential.id}>{credential.name} · {credential.configured ? "lista" : "sin configurar"}</option>)}</select></label>;
                if (parameter.type === "workflow") return <label className="platform-field" key={parameter.key}><span>{parameter.label}</span><select value={String(value)} disabled={!canAdmin} onChange={(event) => update(event.target.value)}><option value="">Seleccionar workflow</option>{workflows.filter((item) => item.id !== workflow.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
                return <label className="platform-field" key={parameter.key}><span>{parameter.label}{parameter.required ? " *" : ""}</span>{parameter.type === "json" ? <textarea rows={5} value={typeof value === "string" ? value : JSON.stringify(value, null, 2)} disabled={!canAdmin} onChange={(event) => { try { update(JSON.parse(event.target.value)); } catch { update(event.target.value); } }} /> : <input type={parameter.secret ? "password" : parameter.type === "number" ? "number" : "text"} value={String(value)} disabled={!canAdmin} onChange={(event) => update(parameter.type === "number" ? Number(event.target.value) : event.target.value)} />}{parameter.description ? <small>{parameter.description}</small> : null}</label>;
              })}
              <label className="platform-check"><input type="checkbox" checked={Boolean(selectedNode.data.automationNode.continueOnFail)} disabled={!canAdmin} onChange={(event) => updateSelectedNode({ continueOnFail: event.target.checked })} /><span><strong>Continuar al fallar</strong><small>Registra el error y permite que el flujo continúe.</small></span></label>
              <label className="platform-check"><input type="checkbox" checked={Boolean(selectedNode.data.automationNode.disabled)} disabled={!canAdmin} onChange={(event) => updateSelectedNode({ disabled: event.target.checked })} /><span><strong>Nodo desactivado</strong><small>Se omite durante la ejecución.</small></span></label>
            </div>
            <footer><button className="button danger-quiet" disabled={!canAdmin} onClick={removeSelectedNode}><Trash /> Eliminar nodo</button></footer>
          </aside>
        ) : (
          <aside className="node-inspector workflow-settings-panel"><header><span><GearSix size={20} weight="duotone" /></span><div><small>Workflow</small><strong>Configuración</strong></div></header><div className="inspector-scroll"><div className="inspector-empty-intro"><FlowArrow size={25} weight="duotone" /><span><strong>Selecciona un nodo</strong><small>Edita sus parámetros y comportamiento.</small></span></div>{validation ? <div className={`validation-summary ${validation.valid ? "valid" : "invalid"}`}>{validation.valid ? <CheckCircle /> : <WarningCircle />}<span><strong>{validation.valid ? "Workflow válido" : `${validation.errors} errores`}</strong><small>{validation.warnings} advertencias</small></span></div> : null}<h3>Ajustes de ejecución</h3><label className="platform-field"><span>Zona horaria</span><input disabled={!canAdmin} value={workflow.settings.timezone} onChange={(event) => setWorkflow((current) => ({ ...current, settings: { ...current.settings, timezone: event.target.value } }))} /></label><label className="platform-field"><span>Timeout en segundos</span><input type="number" min="1" max="86400" disabled={!canAdmin} value={workflow.settings.executionTimeoutSeconds} onChange={(event) => setWorkflow((current) => ({ ...current, settings: { ...current.settings, executionTimeoutSeconds: Number(event.target.value) } }))} /></label><label className="platform-field"><span>Concurrencia máxima</span><input type="number" min="1" max="100" disabled={!canAdmin} value={workflow.settings.concurrency} onChange={(event) => setWorkflow((current) => ({ ...current, settings: { ...current.settings, concurrency: Number(event.target.value) } }))} /></label><label className="platform-field"><span>Workflow de error</span><select disabled={!canAdmin} value={workflow.settings.errorWorkflowId || ""} onChange={(event) => setWorkflow((current) => ({ ...current, settings: { ...current.settings, errorWorkflowId: event.target.value || undefined } }))}><option value="">Sin workflow de error</option>{workflows.filter((item) => item.id !== workflow.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="platform-check"><input type="checkbox" disabled={!canAdmin} checked={workflow.settings.saveSuccessfulExecutions} onChange={(event) => setWorkflow((current) => ({ ...current, settings: { ...current.settings, saveSuccessfulExecutions: event.target.checked } }))} /><span><strong>Guardar ejecuciones correctas</strong><small>Conserva datos y recorrido para auditoría.</small></span></label><label className="platform-check"><input type="checkbox" disabled={!canAdmin} checked={workflow.settings.saveFailedExecutions} onChange={(event) => setWorkflow((current) => ({ ...current, settings: { ...current.settings, saveFailedExecutions: event.target.checked } }))} /><span><strong>Guardar ejecuciones fallidas</strong><small>Recomendado para diagnóstico y retry.</small></span></label></div></aside>
        )}
      </div>
    </section>
  );
}

export function AutomationPlatform({
  section,
  canAdmin,
  canOperate,
  canSupervise,
  accounts,
  interactions,
  sacWorkflow,
  isOperationalLoading,
  onNavigate,
  onOpenInteraction,
  onToast,
}: AutomationPlatformProps) {
  const [state, setState] = useState<AutomationPlatformState | null>(null);
  const [meta, setMeta] = useState<PlatformMeta | null>(null);
  const [definitions, setDefinitions] = useState<AutomationNodeDefinition[]>([]);
  const [templates, setTemplates] = useState<AutomationTemplate[]>([]);
  const [credentialTypes, setCredentialTypes] = useState<Array<{ type: string; name: string; description?: string; fields: string[] }>>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isLoading, setLoading] = useState(true);
  const [isCreating, setCreating] = useState(false);
  const [credentialName, setCredentialName] = useState("");
  const [credentialType, setCredentialType] = useState("httpBearerAuth");
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [editingCredentialId, setEditingCredentialId] = useState<string | null>(null);
  const [variableKey, setVariableKey] = useState("");
  const [variableValue, setVariableValue] = useState("");
  const [variableSecret, setVariableSecret] = useState(false);
  const [operationalJobs, setOperationalJobs] = useState<OperationalJob[]>([]);
  const [operationalJobsError, setOperationalJobsError] = useState<string | null>(null);
  const [isLoadingOperationalJobs, setLoadingOperationalJobs] = useState(false);
  const [hasLoadedOperationalJobs, setHasLoadedOperationalJobs] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const operationalJobsRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    const platform = await loadAutomationPlatform();
    setState(platform.state);
    setMeta(platform.meta);
  }, []);

  const refreshOperationalJobs = useCallback(async () => {
    const requestId = ++operationalJobsRequestRef.current;
    if (!canSupervise) {
      setOperationalJobs([]);
      setOperationalJobsError(null);
      setLoadingOperationalJobs(false);
      setHasLoadedOperationalJobs(false);
      return;
    }
    setLoadingOperationalJobs(true);
    setOperationalJobsError(null);
    try {
      const jobs = await loadOperationalJobs();
      if (requestId === operationalJobsRequestRef.current) setOperationalJobs(jobs);
    } catch (error) {
      if (requestId === operationalJobsRequestRef.current) setOperationalJobsError(error instanceof Error ? error.message : "Error desconocido.");
    } finally {
      if (requestId === operationalJobsRequestRef.current) {
        setLoadingOperationalJobs(false);
        setHasLoadedOperationalJobs(true);
      }
    }
  }, [canSupervise]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([loadAutomationPlatform(), loadAutomationCatalog(), loadAutomationTemplates()])
      .then(([platform, catalog, loadedTemplates]) => {
        if (!mounted) return;
        setState(platform.state);
        setMeta(platform.meta);
        setDefinitions(catalog.nodes);
        setCredentialTypes(catalog.credentialTypes);
        setTemplates(loadedTemplates);
      })
      .catch((error) => mounted && onToast({ tone: "warning", title: "No se pudo cargar Automation Studio", detail: error instanceof Error ? error.message : "Error desconocido." }))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [onToast]);

  useEffect(() => {
    if (section !== "workflows") setSelectedWorkflowId(null);
  }, [section]);

  useEffect(() => {
    if (section !== "executions") return undefined;
    void refreshOperationalJobs();
    return () => { operationalJobsRequestRef.current += 1; };
  }, [refreshOperationalJobs, section]);

  const filteredWorkflows = useMemo(() => (state?.workflows || []).filter((workflow) => !workflow.archived && `${workflow.name} ${workflow.description} ${workflow.tags.join(" ")}`.toLocaleLowerCase("es-CL").includes(search.toLocaleLowerCase("es-CL"))), [search, state?.workflows]);
  const selectedWorkflow = state?.workflows.find((workflow) => workflow.id === selectedWorkflowId);
  const selectedExecution = state?.executions.find((execution) => execution.id === selectedExecutionId) || state?.executions[0];
  const projectId = state?.projects[0]?.id;
  const selectedCredentialType = credentialTypes.find((item) => item.type === credentialType);

  if (isLoading || !state) return <section className="platform-loading" role="status" aria-live="polite" aria-busy="true"><ArrowsClockwise className="spin" size={24} /><strong>Cargando centro SAC</strong><span>Preparando operación, automatizaciones y credenciales.</span></section>;

  if (selectedWorkflow && section === "workflows") return <WorkflowStudio initialWorkflow={selectedWorkflow} definitions={definitions} credentials={state.credentials} workflows={state.workflows} canAdmin={canAdmin} canOperate={canOperate} onBack={() => setSelectedWorkflowId(null)} onChanged={refresh} onToast={onToast} />;

  async function createWorkflow(templateId?: string) {
    if (!canAdmin || !projectId) return;
    setCreating(true);
    try {
      const template = templates.find((item) => item.id === templateId);
      const created = await createPlatformWorkflow({ projectId, name: template ? `${template.name} · copia` : "Workflow sin título", description: template?.description, templateId });
      await refresh();
      setSelectedWorkflowId(created.id);
    } catch (error) {
      onToast({ tone: "warning", title: "No se pudo crear el workflow", detail: error instanceof Error ? error.message : "Error desconocido." });
    } finally {
      setCreating(false);
    }
  }

  async function duplicate(id: string) {
    try {
      const created = await duplicatePlatformWorkflow(id);
      await refresh();
      setSelectedWorkflowId(created.id);
    } catch (error) {
      onToast({ tone: "warning", title: "No se pudo duplicar", detail: error instanceof Error ? error.message : "Error desconocido." });
    }
  }

  async function importWorkflow(file?: File) {
    if (!file || !projectId || !canAdmin) return;
    try {
      if (file.size > 2_000_000) throw new Error("El archivo supera el límite de 2 MB.");
      const decoded = JSON.parse(await file.text()) as { workflow?: Partial<AutomationWorkflow> } & Partial<AutomationWorkflow>;
      const candidate = decoded.workflow || decoded;
      if (!candidate.name || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.connections) || !candidate.settings) throw new Error("El archivo no contiene un workflow compatible.");
      const imported = await importPlatformWorkflow({
        projectId,
        name: `${candidate.name} · importado`,
        description: candidate.description,
        nodes: candidate.nodes,
        connections: candidate.connections,
        settings: candidate.settings,
      });
      await refresh();
      setSelectedWorkflowId(imported.id);
      onToast({ tone: "success", title: "Workflow importado", detail: "IDs y credenciales fueron neutralizados; valida antes de publicar." });
    } catch (error) {
      onToast({ tone: "warning", title: "No se pudo importar", detail: error instanceof Error ? error.message : "Archivo inválido." });
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function retryOperational(job: OperationalJob) {
    if (!canAdmin || retryingJobId) return;
    const confirmed = window.confirm("¿Programar otro intento ahora? El contador de intentos se reiniciará. Confirma que la causa del fallo ya fue corregida.");
    if (!confirmed) return;
    setRetryingJobId(job.id);
    try {
      await retryOperationalJob(job.id);
      await refreshOperationalJobs();
      onToast({ tone: "success", title: "Reintento programado", detail: "El trabajo volverá a procesarse en el próximo ciclo." });
    } catch (error) {
      onToast({ tone: "warning", title: "No se pudo reencolar", detail: error instanceof Error ? error.message : "Error desconocido." });
      await refreshOperationalJobs();
    } finally {
      setRetryingJobId(null);
    }
  }

  if (section === "home") {
    const attention = interactions.filter((interaction) => interaction.status === "pending" || interaction.status === "needs_review");
    const review = attention.filter((interaction) => interaction.status === "needs_review");
    const unassigned = attention.filter((interaction) => !interaction.assignee && !interaction.assignedTo);
    const waitingOverHour = attention.filter((interaction) => Date.now() - Date.parse(interaction.receivedAt) > 60 * 60 * 1_000);
    const accountsWithAlerts = accounts.filter((account) => account.health !== "healthy");
    const priorityRank = { urgent: 0, high: 1, normal: 2 } as const;
    const topQueue = [...attention]
      .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority] || Date.parse(left.receivedAt) - Date.parse(right.receivedAt))
      .slice(0, 5);
    const active = state.workflows.filter((workflow) => workflow.active && !workflow.archived).length;
    const successful = state.executions.filter((execution) => execution.status === "success").length;
    const successRate = state.executions.length ? Math.round(successful / state.executions.length * 100) : null;
    return <div className="platform-page platform-home" aria-busy={isOperationalLoading}>
      <section className="sac-home-intro" aria-labelledby="sac-home-title">
        <div className="sac-home-intro__copy">
          <span className="eyebrow"><ChatCircleDots weight="fill" /> SAC multicuenta</span>
          <h2 id="sac-home-title">Lo que necesita atención, primero.</h2>
          <p>Prioriza DMs y comentarios, revisa las cuentas con alertas y mantén el flujo SAC bajo control desde un solo lugar.</p>
          <div className="sac-home-actions">
            <button className="button primary" onClick={() => onNavigate("interactions")}><ChatCircleDots weight="fill" /> Abrir bandeja SAC</button>
            <button className="button secondary" onClick={() => onNavigate("accounts")}><Buildings /> Ver estado de cuentas</button>
          </div>
        </div>
        <div className="sac-home-status" aria-label="Estado del espacio">
          <span className={meta?.demoMode ? "is-neutral" : "is-ready"}><i />{meta?.demoMode ? "Entorno aislado" : "API real"}</span>
          <span className={sacWorkflow.enabled ? "is-ready" : "is-warning"}><i />Flujo SAC {sacWorkflow.enabled ? "activo" : "pausado"}</span>
          <span className={meta?.metricoolMutationsDisabled ? "is-neutral" : "is-warning"}><ShieldCheck weight="fill" />{meta?.metricoolMutationsDisabled ? "Metricool protegido" : "Envíos habilitados"}</span>
          {isOperationalLoading ? <span role="status" aria-live="polite"><ArrowsClockwise className="spin" />Actualizando operación</span> : null}
        </div>
      </section>

      <section className="sac-home-kpis" aria-label="Prioridades operativas">
        <button onClick={() => onNavigate("interactions")} className={attention.length ? "is-warning" : "is-ready"}>
          <span><ChatCircleDots weight="duotone" /> Por atender</span><strong>{attention.length}</strong><small>{waitingOverHour.length ? `${waitingOverHour.length} hace más de 1 h` : "Sin esperas prolongadas"}</small><ArrowRight />
        </button>
        <button onClick={() => onNavigate("interactions")} className={review.length ? "is-warning" : "is-ready"}>
          <span><UserFocus weight="duotone" /> Revisión humana</span><strong>{review.length}</strong><small>{review.length ? "Requieren una decisión" : "Sin revisiones pendientes"}</small><ArrowRight />
        </button>
        <button onClick={() => onNavigate("interactions")} className={unassigned.length ? "is-warning" : "is-ready"}>
          <span><UserFocus weight="duotone" /> Sin asignar</span><strong>{unassigned.length}</strong><small>{unassigned.length ? "Disponibles para tomar" : "Todo tiene responsable"}</small><ArrowRight />
        </button>
        <button onClick={() => onNavigate("accounts")} className={accountsWithAlerts.length ? "is-warning" : "is-ready"}>
          <span><Buildings weight="duotone" /> Cuentas con alertas</span><strong>{accountsWithAlerts.length}</strong><small>{accountsWithAlerts.length ? `de ${accounts.length} conectadas` : `${accounts.length} operativas`}</small><ArrowRight />
        </button>
      </section>

      <div className="sac-home-operations">
        <section className="sac-home-panel sac-queue-panel">
          <header><div><span className="panel-kicker">Cola priorizada</span><h3>Conversaciones que requieren acción</h3><p>Urgencia, revisión y antigüedad ordenadas para decidir qué atender ahora.</p></div><button className="text-button" onClick={() => onNavigate("interactions")}>Ver bandeja <ArrowRight /></button></header>
          <div className="sac-queue-list">
            {topQueue.map((interaction) => <button key={interaction.id} onClick={() => onOpenInteraction(interaction)}>
              <span className="sac-queue-avatar">{interaction.brandInitials}</span>
              <span className="sac-queue-copy"><span><strong>{interaction.customerName}</strong><small>{interaction.brandName}</small></span><p><ContentContext text={interaction.preview} context={interaction.contentContext} compact /></p><small><SocialPlatformIcon platform={interaction.platform} weight="fill" />{interactionKindLabel(interaction.kind)}<i />{interaction.receivedAtLabel}</small></span>
              <span className="sac-queue-state"><em className={`priority-${interaction.priority}`}>{interactionPriorityLabel(interaction.priority)}</em><small>{interactionStatusLabel(interaction.status)}</small></span>
              <ArrowRight className="sac-queue-arrow" />
            </button>)}
            {!topQueue.length ? <div className="sac-panel-empty"><CheckCircle weight="fill" /><span><strong>Cola al día</strong><small>No hay conversaciones pendientes o en revisión.</small></span></div> : null}
          </div>
        </section>

        <div className="sac-home-side-stack">
          <section className="sac-home-panel sac-account-panel">
            <header><div><span className="panel-kicker">Salud de cuentas</span><h3>{accountsWithAlerts.length ? "Requieren revisión" : "Todas operativas"}</h3></div><button className="icon-button" aria-label="Abrir cuentas" onClick={() => onNavigate("accounts")}><ArrowRight /></button></header>
            <div className="sac-account-list">
              {(accountsWithAlerts.length ? accountsWithAlerts : accounts.slice(0, 3)).slice(0, 4).map((account) => <button key={account.id} onClick={() => onNavigate("accounts")}>
                <span className="sac-account-avatar">{account.initials}</span><span><strong>{account.name}</strong><small>{account.healthDetail}</small></span><em className={`health-${account.health}`}><i />{accountHealthLabel(account.health)}</em>
              </button>)}
              {!accounts.length ? <div className="sac-panel-empty compact"><Buildings /><span><strong>Sin cuentas todavía</strong><small>Conecta las cuentas cuando estén disponibles.</small></span></div> : null}
            </div>
          </section>

          <section className="sac-home-panel sac-flow-panel">
            <header><div><span className="panel-kicker">Flujo SAC</span><h3>{sacWorkflow.name}</h3></div><span className={`sac-flow-state ${sacWorkflow.enabled ? "is-active" : ""}`}><i />{sacWorkflow.enabled ? "Activo" : "Pausado"}</span></header>
            <dl><div><dt>Frecuencia</dt><dd>Cada {sacWorkflow.pollIntervalMinutes} min</dd></div><div><dt>Revisión sensible</dt><dd>{sacWorkflow.requireHumanFor.length} categorías</dd></div><div><dt>Respuesta automática</dt><dd>{meta?.metricoolMutationsDisabled ? "Bloqueada en desarrollo" : sacWorkflow.autoReplyEnabled ? "Habilitada" : "Desactivada"}</dd></div></dl>
            <button className="button secondary" onClick={() => onNavigate("workflow")}><FlowArrow /> Abrir flujo SAC</button>
          </section>
        </div>
      </div>

      <section className="sac-home-panel sac-automation-overview">
        <header><div><span className="panel-kicker">Automatización avanzada</span><h3>Recursos del motor</h3><p>Gestiona procesos generales sin perder de vista la operación SAC.</p></div><button className="button secondary" onClick={() => onNavigate("automations")}>Gestionar automatizaciones <ArrowRight /></button></header>
        <div className="sac-automation-grid">
          <div><span className="sac-resource-summary"><strong>{state.workflows.filter((item) => !item.archived).length}</strong><small>automatizaciones<br />{active} activas</small></span><div className="workflow-compact-list">{state.workflows.filter((item) => !item.archived).slice(0, 3).map((workflow) => <button key={workflow.id} onClick={() => { setSelectedWorkflowId(workflow.id); onNavigate("automations"); }}><span className="workflow-list-icon"><FlowArrow /></span><span><strong>{workflow.name}</strong><small>v{workflow.version} · {workflow.nodes.length} nodos</small></span><StateBadge status={workflow.lastRunStatus} /></button>)}</div></div>
          <div><span className="sac-resource-summary"><strong>{successRate === null ? "Sin datos" : `${successRate}%`}</strong><small>éxito reciente<br />{state.executions.length ? `${state.executions.length} ejecuciones` : "sin ejecuciones"}</small></span><div className="execution-compact-list">{state.executions.slice(0, 3).map((execution) => <button key={execution.id} onClick={() => { setSelectedExecutionId(execution.id); onNavigate("automation-executions"); }}><StateBadge status={execution.status} /><span><strong>{state.workflows.find((item) => item.id === execution.workflowId)?.name || execution.workflowId}</strong><small>{execution.mode} · {durationLabel(execution)}</small></span><time>{formatDate(execution.startedAt)}</time></button>)}{!state.executions.length ? <p className="empty-inline">La actividad técnica aparecerá después de la primera ejecución.</p> : null}</div></div>
        </div>
      </section>
    </div>;
  }

  if (section === "workflows") return <div className="platform-page"><div className="platform-page-tools"><label className="platform-search wide"><MagnifyingGlass /><input aria-label="Buscar workflows" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, descripción o etiqueta" /></label><div><input ref={importInputRef} className="sr-only" type="file" accept="application/json,.json" aria-label="Importar workflow JSON" onChange={(event) => importWorkflow(event.target.files?.[0])} /><button className="button secondary" disabled={!canAdmin} onClick={() => importInputRef.current?.click()}><UploadSimple /> Importar</button><button className="button primary" disabled={!canAdmin || isCreating} onClick={() => createWorkflow()}><Plus /> Nuevo workflow</button></div></div>{filteredWorkflows.length ? <section className="workflow-table"><header><span>Nombre</span><span>Estado</span><span>Versión</span><span>Última ejecución</span><span /></header>{filteredWorkflows.map((workflow) => <article key={workflow.id} onDoubleClick={() => setSelectedWorkflowId(workflow.id)}><button className="workflow-name-cell" onClick={() => setSelectedWorkflowId(workflow.id)}><span className="workflow-list-icon"><FlowArrow /></span><span><strong>{workflow.name}</strong><small>{workflow.description || "Sin descripción"}</small></span></button><span className={`active-label ${workflow.active ? "active" : ""}`}><i />{workflow.active ? "Activo" : "Inactivo"}</span><span className="version-cell">v{workflow.version}<small>pub. {workflow.publishedVersion}</small></span><span><StateBadge status={workflow.lastRunStatus} /><small className="table-date">{formatDate(workflow.lastRunAt)}</small></span><span className="row-menu"><button onClick={() => duplicate(workflow.id)} disabled={!canAdmin} title="Duplicar"><Copy /></button><button onClick={() => downloadPlatformWorkflow(workflow.id, workflow.name)} disabled={!canAdmin} title="Exportar"><DownloadSimple /></button><button onClick={() => setSelectedWorkflowId(workflow.id)} title="Abrir"><ArrowSquareOut /></button></span></article>)}</section> : <EmptyPlatform title="No encontramos workflows" copy="Cambia la búsqueda o crea una automatización nueva." action={<button className="button primary" onClick={() => createWorkflow()}><Plus /> Crear workflow</button>} />}</div>;

  if (section === "executions") return (
    <div className="platform-page execution-page">
      {canSupervise ? (
        <OperationalJobsPanel
          jobs={operationalJobs}
          workflows={state.workflows}
          isLoading={!hasLoadedOperationalJobs || isLoadingOperationalJobs}
          error={operationalJobsError}
          canAdmin={canAdmin}
          retryingJobId={retryingJobId}
          onRefresh={refreshOperationalJobs}
          onRetry={retryOperational}
        />
      ) : null}
      <div className="execution-workspace">
        <div className="execution-master">
          <header>
            <div><h2>Historial de ejecuciones</h2><p>{state.executions.length} registros conservados</p></div>
            <button className="icon-button" aria-label="Actualizar ejecuciones" onClick={() => void refresh()}><ArrowsClockwise /></button>
          </header>
          {state.executions.map((execution) => (
            <button key={execution.id} className={selectedExecution?.id === execution.id ? "is-active" : ""} onClick={() => setSelectedExecutionId(execution.id)}>
              <StateBadge status={execution.status} />
              <span><strong>{state.workflows.find((item) => item.id === execution.workflowId)?.name || execution.workflowId}</strong><small>{execution.mode} · v{execution.workflowVersion}</small></span>
              <time>{formatDate(execution.startedAt)}</time>
            </button>
          ))}
          {!state.executions.length ? <EmptyPlatform title="Sin ejecuciones" copy="Las ejecuciones manuales, programadas y webhook aparecerán aquí." /> : null}
        </div>
        {selectedExecution ? (
          <section className="execution-inspect">
            <header>
              <div><StateBadge status={selectedExecution.status} /><h2>{state.workflows.find((item) => item.id === selectedExecution.workflowId)?.name}</h2><p>{selectedExecution.id}</p></div>
              <button className="button secondary" onClick={async () => {
                try {
                  await retryPlatformExecution(selectedExecution.id);
                  await refresh();
                  onToast({ tone: "success", title: "Reintento completado", detail: "Se creó una nueva ejecución enlazada al registro original." });
                } catch (error) {
                  onToast({ tone: "warning", title: "No se pudo reintentar", detail: error instanceof Error ? error.message : "Error desconocido." });
                }
              }} disabled={!canOperate}><ArrowsClockwise /> Reintentar</button>
            </header>
            <div className="execution-facts">
              <span><small>Inicio</small><strong>{formatDate(selectedExecution.startedAt)}</strong></span>
              <span><small>Duración</small><strong>{durationLabel(selectedExecution)}</strong></span>
              <span><small>Modo</small><strong>{selectedExecution.mode}</strong></span>
              <span><small>Salida</small><strong>{selectedExecution.output.length} items</strong></span>
            </div>
            <h3>Recorrido por nodos</h3>
            <ol className="platform-run-log">
              {selectedExecution.nodeRuns.map((run, index) => (
                <li key={`${run.nodeId}-${index}`} className={run.status}>
                  <span>{run.status === "success" ? <Check /> : <WarningCircle />}</span>
                  <div><strong>{run.nodeName}</strong><small>{run.nodeType} · {run.itemsIn} entrada · {run.itemsOut} salida</small>{run.error ? <p>{run.error}</p> : null}</div>
                  <time>{Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt))} ms</time>
                </li>
              ))}
            </ol>
            <details className="execution-data"><summary>Ver datos de salida</summary><pre>{JSON.stringify(selectedExecution.output, null, 2)}</pre></details>
          </section>
        ) : <EmptyPlatform title="Selecciona una ejecución" copy="Revisa el recorrido, tiempos, errores y datos de salida." />}
      </div>
    </div>
  );

  if (section === "templates") return <div className="platform-page"><section className="template-intro"><div><span className="eyebrow"><SquaresFour weight="fill" /> Biblioteca</span><h2>Empieza con una base probada</h2><p>Plantillas originales para webhooks, tratamiento de datos y operación SAC.</p></div><span>{templates.length} plantillas</span></section><div className="template-grid">{templates.map((template) => <article key={template.id}><span className="template-icon"><FlowArrow size={22} weight="duotone" /></span><div className="template-tags"><span>{template.category}</span>{template.featured ? <span>Recomendada</span> : null}</div><h3>{template.name}</h3><p>{template.description}</p><div className="template-diagram">{template.workflow.nodes.slice(0, 5).map((node, index) => <span key={node.id}>{index ? <i /> : null}<b /></span>)}</div><footer><span>{template.workflow.nodes.length} nodos · {template.workflow.connections.length} conexiones</span><button className="button secondary" onClick={() => createWorkflow(template.id)} disabled={!canAdmin || isCreating}>Usar plantilla</button></footer></article>)}</div></div>;

  return <div className="platform-page credentials-page"><section className="credential-column"><header><div><h2>Credenciales</h2><p>Secretos cifrados y aislados por proyecto.</p></div><LockKey size={24} /></header><div className="resource-list">{state.credentials.map((credential) => <article key={credential.id}><span className={`resource-icon ${credential.configured ? "ready" : "pending"}`}><Key /></span><span><strong>{credential.name}</strong><small>{credential.type} · {credential.dataKeys.length ? credential.dataKeys.join(", ") : "sin datos"}</small></span><span className={`configured-label ${credential.configured ? "ready" : ""}`}>{credential.configured ? "Configurada" : "Pendiente"}</span><button className="icon-button" title="Configurar" onClick={() => { setEditingCredentialId(credential.id); setCredentialName(credential.name); setCredentialType(credential.type); setCredentialValues({}); }}><DotsThree /></button></article>)}</div><form className="resource-form" onSubmit={async (event) => { event.preventDefault(); if (!projectId || !credentialName.trim()) return; try { const data = Object.fromEntries(Object.entries(credentialValues).filter(([, value]) => value.trim())); if (editingCredentialId) await updatePlatformCredential(editingCredentialId, { name: credentialName.trim(), ...(Object.keys(data).length ? { data } : {}) }); else await createPlatformCredential({ projectId, name: credentialName.trim(), type: credentialType, ...(Object.keys(data).length ? { data } : {}) }); setCredentialName(""); setCredentialValues({}); setEditingCredentialId(null); await refresh(); onToast({ tone: "success", title: editingCredentialId ? "Credencial actualizada" : "Credencial creada", detail: Object.keys(data).length ? "Los valores quedaron cifrados y no volverán al navegador." : "Se guardó sin secretos y sin contactar servicios externos." }); } catch (error) { onToast({ tone: "warning", title: "No se pudo guardar", detail: error instanceof Error ? error.message : "Error desconocido." }); } }}><h3>{editingCredentialId ? "Actualizar credencial" : "Nueva credencial"}</h3><label className="platform-field"><span>Nombre</span><input value={credentialName} onChange={(event) => setCredentialName(event.target.value)} placeholder="Ej. API de operaciones" /></label><label className="platform-field"><span>Tipo</span><select value={credentialType} disabled={Boolean(editingCredentialId)} onChange={(event) => { setCredentialType(event.target.value); setCredentialValues({}); }}>{credentialTypes.map((type) => <option key={type.type} value={type.type}>{type.name}</option>)}</select></label>{selectedCredentialType?.fields.map((field) => <label className="platform-field" key={field}><span>{field}</span><input autoComplete="new-password" type={/(password|secret|token|key)/i.test(field) ? "password" : "text"} value={credentialValues[field] || ""} onChange={(event) => setCredentialValues((current) => ({ ...current, [field]: event.target.value }))} placeholder={editingCredentialId ? "Dejar vacío para conservar" : ""} /></label>)}<p><ShieldCheck /> Guardar no prueba ni usa la credencial contra servicios externos.</p><button className="button primary" disabled={!canAdmin}>{editingCredentialId ? "Actualizar credencial" : "Crear credencial"}</button>{editingCredentialId ? <button className="button secondary" type="button" onClick={() => { setEditingCredentialId(null); setCredentialName(""); setCredentialValues({}); }}>Cancelar</button> : null}</form></section><section className="credential-column"><header><div><h2>Variables</h2><p>Valores reutilizables y secretos protegidos.</p></div><BracketsCurly size={24} /></header><div className="resource-list">{state.variables.map((variable) => <article key={variable.id}><span className={`resource-icon ${variable.secret ? "secret" : "ready"}`}>{variable.secret ? <LockKey /> : <BracketsCurly />}</span><span><strong>{variable.key}</strong><small>{variable.secret ? "•••••••• · secreto cifrado" : variable.value}</small></span><span className="configured-label ready">{variable.secret ? "Secreta" : "Visible"}</span></article>)}</div><form className="resource-form" onSubmit={async (event) => { event.preventDefault(); if (!projectId || !variableKey.trim()) return; try { await upsertPlatformVariable({ projectId, key: variableKey, value: variableValue, secret: variableSecret }); setVariableKey(""); setVariableValue(""); await refresh(); onToast({ tone: "success", title: "Variable guardada", detail: variableSecret ? "El valor quedó cifrado en reposo." : "La variable ya está disponible en expresiones." }); } catch (error) { onToast({ tone: "warning", title: "No se pudo guardar", detail: error instanceof Error ? error.message : "Error desconocido." }); } }}><h3>Nueva variable</h3><label className="platform-field"><span>Clave</span><input value={variableKey} onChange={(event) => setVariableKey(event.target.value.toUpperCase())} placeholder="DEFAULT_REGION" /></label><label className="platform-field"><span>Valor</span><input type={variableSecret ? "password" : "text"} value={variableValue} onChange={(event) => setVariableValue(event.target.value)} /></label><label className="platform-check"><input type="checkbox" checked={variableSecret} onChange={(event) => setVariableSecret(event.target.checked)} /><span><strong>Guardar como secreto</strong><small>No se volverá a mostrar en la interfaz.</small></span></label><button className="button primary" disabled={!canAdmin}>Guardar variable</button></form></section><aside className="security-rail"><ShieldCheck size={28} weight="fill" /><h3>Controles activos</h3><ul><li><Check /> AES-256-GCM en credenciales</li><li><Check /> Redacción en logs y ejecuciones</li><li><Check /> Límite por proyecto y rol</li><li><Check /> Salidas HTTP bloqueadas</li><li><Check /> Metricool en solo lectura</li></ul><small>{meta?.externalNodesDisabled && meta.metricoolMutationsDisabled ? "Modo desarrollo protegido" : "Revisa las políticas del entorno"}</small></aside></div>;
}
