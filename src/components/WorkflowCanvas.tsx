import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  addEdge,
  applyEdgeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  ArrowsClockwise,
  BezierCurve,
  BracketsCurly,
  Brain,
  ChatCircleDots,
  CheckCircle,
  Clock,
  Database,
  FileXls,
  FloppyDisk,
  Funnel,
  GitBranch,
  InstagramLogo,
  LineSegment,
  ListChecks,
  LockSimple,
  MicrosoftExcelLogo,
  PaperPlaneTilt,
  PencilSimple,
  Robot,
  Stack,
  Trash,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type {
  ApiWorkflow,
  ApiWorkflowConnectorType,
  ApiWorkflowEdge,
  ApiWorkflowNode,
} from "../lib/api";

type NodeTone = "indigo" | "violet" | "green" | "blue" | "rose" | "slate";

export type WorkflowNodeData = {
  nodeId: string;
  title: string;
  eyebrow: string;
  detail?: string;
  tone: NodeTone;
  icon: string;
  badge?: string;
  enabled?: boolean;
};

type WorkflowCanvasProps = {
  workflow?: ApiWorkflow;
  canEdit?: boolean;
  onSaveGraph?: (nodes: ApiWorkflowNode[], edges: ApiWorkflowEdge[]) => boolean | Promise<boolean>;
  onSelectionChange?: (node: WorkflowNodeData | null) => void;
  onStatusChange?: (status: WorkflowEditorStatus) => void;
};

export type WorkflowEditorStatus = "locked" | "editing" | "saving" | "saved" | "error";

const connectorOptions: Array<{
  value: ApiWorkflowConnectorType;
  label: string;
  description: string;
  icon: typeof BezierCurve;
}> = [
  { value: "bezier", label: "Curvo", description: "Curva flexible para rodear grupos de nodos.", icon: BezierCurve },
  { value: "straight", label: "Recto", description: "Recorrido directo entre dos nodos.", icon: LineSegment },
  { value: "smoothstep", label: "Ortogonal", description: "Ángulos rectos suavizados para ordenar el diagrama.", icon: GitBranch },
];

const iconMap = {
  clock: Clock,
  users: UsersThree,
  branch: GitBranch,
  instagram: InstagramLogo,
  chat: ChatCircleDots,
  stack: Stack,
  normalize: BracketsCurly,
  database: Database,
  excel: MicrosoftExcelLogo,
  aggregate: Funnel,
  brain: Brain,
  rules: ListChecks,
  robot: Robot,
  confidence: CheckCircle,
  send: PaperPlaneTilt,
  human: UsersThree,
  error: WarningCircle,
  sync: ArrowsClockwise,
  file: FileXls,
};

const WorkflowNode = memo(({ data, selected }: NodeProps<Node<WorkflowNodeData>>) => {
  const Icon = iconMap[data.icon as keyof typeof iconMap] ?? Stack;

  return (
    <div
      className={`workflow-node tone-${data.tone} ${selected ? "is-selected" : ""}`}
    >
      <Handle className="node-handle" type="target" position={Position.Left} />
      <div className="node-icon-wrap">
        <Icon aria-hidden="true" size={20} weight="duotone" />
      </div>
      <div className="node-copy">
        <span className="node-eyebrow">{data.eyebrow}</span>
        <strong>{data.title}</strong>
        {data.detail ? <small>{data.detail}</small> : null}
      </div>
      {data.badge ? <span className="node-badge">{data.badge}</span> : null}
      <Handle className="node-handle" type="source" position={Position.Right} />
    </div>
  );
});

WorkflowNode.displayName = "WorkflowNode";

const nodeTypes = { workflow: WorkflowNode };

const baseNodes: Node<WorkflowNodeData>[] = [
  {
    id: "schedule",
    type: "workflow",
    position: { x: 24, y: 272 },
    data: {
      nodeId: "schedule",
      eyebrow: "DISPARADOR",
      title: "Cada 2 minutos",
      detail: "Polling seguro",
      tone: "indigo",
      icon: "clock",
    },
  },
  {
    id: "accounts",
    type: "workflow",
    position: { x: 235, y: 272 },
    data: {
      nodeId: "accounts",
      eyebrow: "CONFIGURACIÓN",
      title: "Cuentas autorizadas",
      detail: "7 plataformas de Metricool Inbox",
      tone: "violet",
      icon: "users",
    },
  },
  {
    id: "loop",
    type: "workflow",
    position: { x: 446, y: 272 },
    data: {
      nodeId: "loop",
      eyebrow: "CONTROL",
      title: "Procesar por cuenta",
      detail: "Límite de concurrencia: 3",
      tone: "slate",
      icon: "branch",
    },
  },
  {
    id: "dms",
    type: "workflow",
    position: { x: 657, y: 190 },
    data: {
      nodeId: "dms",
      eyebrow: "METRICOOL API",
      title: "Traer mensajes",
      detail: "Conversaciones y DMs",
      tone: "indigo",
      icon: "instagram",
    },
  },
  {
    id: "comments",
    type: "workflow",
    position: { x: 657, y: 355 },
    data: {
      nodeId: "comments",
      eyebrow: "METRICOOL API",
      title: "Traer comentarios",
      detail: "Posts, videos y menciones",
      tone: "indigo",
      icon: "chat",
    },
  },
  {
    id: "reviews",
    type: "workflow",
    position: { x: 657, y: 500 },
    data: {
      nodeId: "reviews",
      eyebrow: "METRICOOL API",
      title: "Traer reseñas",
      detail: "Google Business Profile",
      tone: "indigo",
      icon: "chat",
    },
  },
  {
    id: "merge",
    type: "workflow",
    position: { x: 868, y: 272 },
    data: {
      nodeId: "merge",
      eyebrow: "UNIFICAR",
      title: "Unificar interacciones",
      detail: "Un formato común",
      tone: "blue",
      icon: "stack",
    },
  },
  {
    id: "normalize",
    type: "workflow",
    position: { x: 1079, y: 190 },
    data: {
      nodeId: "normalize",
      eyebrow: "TRANSFORMACIÓN",
      title: "Normalizar campos",
      detail: "Marca, canal y conversación",
      tone: "slate",
      icon: "normalize",
    },
  },
  {
    id: "dedupe",
    type: "workflow",
    position: { x: 868, y: 500 },
    data: {
      nodeId: "dedupe",
      eyebrow: "MEMORIA",
      title: "Evitar duplicados",
      detail: "ID externo + timestamp",
      tone: "violet",
      icon: "database",
    },
  },
  {
    id: "excelRows",
    type: "workflow",
    position: { x: 1290, y: 190 },
    data: {
      nodeId: "excelRows",
      eyebrow: "EXCEL",
      title: "Registrar interacciones",
      detail: "Una fila por interacción",
      tone: "green",
      icon: "excel",
    },
  },
  {
    id: "aggregate",
    type: "workflow",
    position: { x: 1501, y: 190 },
    data: {
      nodeId: "aggregate",
      eyebrow: "MÉTRICAS",
      title: "Recuento por cuenta",
      detail: "Volumen, SLA y estado",
      tone: "green",
      icon: "aggregate",
    },
  },
  {
    id: "classifier",
    type: "workflow",
    position: { x: 1079, y: 500 },
    data: {
      nodeId: "classifier",
      eyebrow: "CLASIFICACIÓN",
      title: "Intención y riesgo",
      detail: "FAQ, venta, reclamo o crisis",
      tone: "violet",
      icon: "brain",
    },
  },
  {
    id: "faq",
    type: "workflow",
    position: { x: 1290, y: 500 },
    data: {
      nodeId: "faq",
      eyebrow: "REGLAS SAC",
      title: "¿Puede responder?",
      detail: "Política por marca",
      tone: "blue",
      icon: "rules",
    },
  },
  {
    id: "generate",
    type: "workflow",
    position: { x: 1501, y: 405 },
    data: {
      nodeId: "generate",
      eyebrow: "ASISTENTE",
      title: "Redactar respuesta",
      detail: "Tono y base de conocimiento",
      tone: "violet",
      icon: "robot",
    },
  },
  {
    id: "confidence",
    type: "workflow",
    position: { x: 1712, y: 405 },
    data: {
      nodeId: "confidence",
      eyebrow: "GUARDRAIL",
      title: "Confianza ≥ 90%",
      detail: "Sin reclamos ni datos sensibles",
      tone: "green",
      icon: "confidence",
    },
  },
  {
    id: "reply",
    type: "workflow",
    position: { x: 1923, y: 325 },
    data: {
      nodeId: "reply",
      eyebrow: "METRICOOL API",
      title: "Enviar respuesta",
      detail: "Según capacidad de cada canal",
      tone: "indigo",
      icon: "send",
    },
  },
  {
    id: "human",
    type: "workflow",
    position: { x: 1501, y: 565 },
    data: {
      nodeId: "human",
      eyebrow: "REVISIÓN",
      title: "Derivar a agente",
      detail: "Cola priorizada y contexto",
      tone: "blue",
      icon: "human",
    },
  },
  {
    id: "pending",
    type: "workflow",
    position: { x: 1712, y: 565 },
    data: {
      nodeId: "pending",
      eyebrow: "ESTADO",
      title: "Marcar pendiente",
      detail: "Con trazabilidad completa",
      tone: "slate",
      icon: "file",
    },
  },
  {
    id: "errors",
    type: "workflow",
    position: { x: 1923, y: 565 },
    data: {
      nodeId: "errors",
      eyebrow: "CONTROL DE ERRORES",
      title: "Reintentos y alertas",
      detail: "Backoff + registro técnico",
      tone: "blue",
      icon: "error",
    },
  },
];

const makeEdge = (
  source: string,
  target: string,
  connectorType: ApiWorkflowConnectorType = "smoothstep",
  id = `${source}-${target}`,
  label?: string,
): Edge => ({
  id,
  source,
  target,
  type: connectorType === "bezier" ? "default" : connectorType,
  label,
  animated: false,
  interactionWidth: 20,
  style: { stroke: "#aeb5cc", strokeWidth: 1.65 },
});

const baseEdges: Edge[] = [
  makeEdge("schedule", "accounts"),
  makeEdge("accounts", "loop"),
  makeEdge("loop", "dms"),
  makeEdge("loop", "comments"),
  makeEdge("loop", "reviews"),
  makeEdge("dms", "merge"),
  makeEdge("comments", "merge"),
  makeEdge("reviews", "merge"),
  makeEdge("merge", "normalize"),
  makeEdge("normalize", "dedupe"),
  makeEdge("dedupe", "excelRows"),
  makeEdge("dedupe", "aggregate"),
  makeEdge("excelRows", "classifier"),
  makeEdge("aggregate", "classifier"),
  makeEdge("classifier", "faq"),
  makeEdge("faq", "generate"),
  makeEdge("faq", "human"),
  makeEdge("generate", "confidence"),
  makeEdge("confidence", "reply"),
  makeEdge("confidence", "human"),
  makeEdge("human", "pending"),
  makeEdge("merge", "errors"),
];

function Inspector({
  node,
  editable,
  onClose,
  onSave,
}: {
  node: WorkflowNodeData;
  editable: boolean;
  onClose: () => void;
  onSave: (enabled: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(node.enabled !== false);

  return (
    <aside className="node-inspector" aria-label={`Configurar ${node.title}`}>
      <header className="inspector-header">
        <div className={`inspector-icon tone-${node.tone}`}>
          {(() => {
            const Icon = iconMap[node.icon as keyof typeof iconMap] ?? Stack;
            return <Icon aria-hidden="true" size={21} weight="duotone" />;
          })()}
        </div>
        <div>
          <span>{node.eyebrow}</span>
          <h2>{node.title}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar configuración">
          <X size={18} />
        </button>
      </header>

      <div className="inspector-body">
        <div className="field-row field-row-inline">
          <div>
            <label htmlFor="node-enabled">Nodo habilitado</label>
            <p>Se ejecutará cuando el flujo esté activo.</p>
          </div>
          <button
            id="node-enabled"
            type="button"
            className={`switch ${enabled ? "is-on" : ""}`}
            aria-pressed={enabled}
            disabled={!editable}
            onClick={() => setEnabled((value) => !value)}
          >
            <span />
          </button>
        </div>

        <div className="field-row">
          <label htmlFor="credential">Credencial</label>
          <select id="credential" defaultValue="metricool-main" disabled={!editable}>
            <option value="metricool-main">Metricool · Cuenta principal</option>
          </select>
          <small>Las claves viven solo en el servidor, nunca en el navegador.</small>
        </div>

        <div className="field-row">
          <label htmlFor="account-scope">Alcance</label>
          <select id="account-scope" defaultValue="all" disabled={!editable}>
            <option value="all">Todas las marcas activas (20)</option>
            <option value="selected">Solo marcas seleccionadas</option>
          </select>
        </div>

        <div className="field-row">
          <label htmlFor="node-note">Nota operativa</label>
          <textarea id="node-note" defaultValue={node.detail} rows={3} disabled={!editable} />
        </div>

        <div className="inspector-check">
          <CheckCircle size={18} weight="fill" />
          <div>
            <strong>Configuración válida</strong>
            <span>Lista para una prueba controlada con la API real.</span>
          </div>
        </div>
      </div>

      <footer className="inspector-footer">
        {editable ? (
          <>
            <button className="button secondary" type="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="button primary" type="button" onClick={() => onSave(enabled)}>
              Guardar nodo
            </button>
          </>
        ) : (
          <button className="button secondary" type="button" onClick={onClose}>
            Cerrar
          </button>
        )}
      </footer>
    </aside>
  );
}

function workflowNodes(workflow: ApiWorkflow | undefined): Node<WorkflowNodeData>[] {
  const visualById = new Map(baseNodes.map((node) => [node.id, node]));
  if (!workflow?.nodes.length) {
    return baseNodes.map((node) => ({
      ...node,
      deletable: false,
      data: { ...node.data, enabled: true },
    }));
  }
  return workflow.nodes.map((apiNode, index) => {
    const visual = visualById.get(apiNode.id) ?? baseNodes[index % baseNodes.length];
    return {
      id: apiNode.id,
      type: "workflow",
      deletable: false,
      position: apiNode.position,
      data: {
        ...visual.data,
        nodeId: apiNode.id,
        title: apiNode.label,
        enabled: apiNode.enabled,
        detail: apiNode.enabled ? visual.data.detail : "Nodo desactivado",
      },
    };
  });
}

function workflowEdges(workflow: ApiWorkflow | undefined): Edge[] {
  if (!workflow?.edges.length) return baseEdges.map((edge) => ({ ...edge }));
  return workflow.edges.map((edge) => makeEdge(
    edge.source,
    edge.target,
    edge.connectorType ?? "smoothstep",
    edge.id,
    edge.label,
  ));
}

function connectorTypeFromEdge(edge: Edge): ApiWorkflowConnectorType {
  if (edge.type === "straight") return "straight";
  if (edge.type === "smoothstep") return "smoothstep";
  return "bezier";
}

function connectionLineType(connectorType: ApiWorkflowConnectorType): ConnectionLineType {
  if (connectorType === "straight") return ConnectionLineType.Straight;
  if (connectorType === "smoothstep") return ConnectionLineType.SmoothStep;
  return ConnectionLineType.Bezier;
}

function apiNodesFromCanvas(workflow: ApiWorkflow, nodes: Node<WorkflowNodeData>[]): ApiWorkflowNode[] {
  const canvasNodes = new Map(nodes.map((node) => [node.id, node]));
  return workflow.nodes.map((node) => {
    const canvasNode = canvasNodes.get(node.id);
    if (!canvasNode) return node;
    return {
      ...node,
      enabled: canvasNode.data.enabled !== false,
      position: canvasNode.position,
    };
  });
}

function apiEdgesFromCanvas(edges: Edge[]): ApiWorkflowEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(typeof edge.label === "string" && edge.label.trim() ? { label: edge.label } : {}),
    connectorType: connectorTypeFromEdge(edge),
  }));
}

export function WorkflowCanvas({
  workflow,
  canEdit = false,
  onSaveGraph,
  onSelectionChange,
  onStatusChange,
}: WorkflowCanvasProps) {
  const [selectedNode, setSelectedNode] = useState<WorkflowNodeData | null>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [newConnectorType, setNewConnectorType] = useState<ApiWorkflowConnectorType>("smoothstep");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editorStatus, setEditorStatus] = useState<WorkflowEditorStatus>("locked");
  const [nodes, setNodes, onNodesChange] = useNodesState(workflowNodes(workflow));
  const [edges, setEdges] = useEdgesState(workflowEdges(workflow));

  useEffect(() => {
    setNodes(workflowNodes(workflow));
    setEdges(workflowEdges(workflow));
    setSelectedEdgeIds([]);
  }, [workflow, setEdges, setNodes]);

  useEffect(() => {
    if (canEdit || !isEditing) return;
    setIsEditing(false);
    setEditorStatus("locked");
  }, [canEdit, isEditing]);

  useEffect(() => {
    onStatusChange?.(editorStatus);
  }, [editorStatus, onStatusChange]);

  useEffect(() => () => onStatusChange?.("locked"), [onStatusChange]);

  const resetCanvas = useCallback(() => {
    setNodes(workflowNodes(workflow));
    setEdges(workflowEdges(workflow));
    setSelectedEdgeIds([]);
  }, [setEdges, setNodes, workflow]);

  const persistGraph = useCallback(async (
    nextNodes: Node<WorkflowNodeData>[],
    nextEdges: Edge[],
  ): Promise<boolean> => {
    if (!workflow || !onSaveGraph || !canEdit || isSaving) return false;
    setIsSaving(true);
    setEditorStatus("saving");
    try {
      const saved = await onSaveGraph(
        apiNodesFromCanvas(workflow, nextNodes),
        apiEdgesFromCanvas(nextEdges),
      );
      if (saved === false) {
        resetCanvas();
        setEditorStatus("error");
        return false;
      }
      setEditorStatus("saved");
      return true;
    } catch {
      resetCanvas();
      setEditorStatus("error");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [canEdit, isSaving, onSaveGraph, resetCanvas, workflow]);

  const selectNode = useCallback(
    (_event: React.MouseEvent, node: Node<WorkflowNodeData>) => {
      setSelectedNode(node.data);
      onSelectionChange?.(node.data);
    },
    [onSelectionChange],
  );

  const closeInspector = () => {
    setSelectedNode(null);
    onSelectionChange?.(null);
  };

  const saveNodeEnabled = (enabled: boolean) => {
    if (!selectedNode || !workflow || !isEditing || isSaving) return closeInspector();
    const nextNodes = nodes.map((node) => node.id === selectedNode.nodeId
      ? { ...node, data: { ...node.data, enabled } }
      : node);
    setNodes(nextNodes);
    closeInspector();
    void persistGraph(nextNodes, edges);
  };

  const persistPosition = (_event: MouseEvent | TouchEvent, moved: Node<WorkflowNodeData>) => {
    if (!workflow || !isEditing || isSaving) return;
    const nextNodes = nodes.map((node) => node.id === moved.id ? { ...node, position: moved.position } : node);
    setNodes(nextNodes);
    void persistGraph(nextNodes, edges);
  };

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    const nextEdges = applyEdgeChanges(changes, edges);
    setEdges(nextEdges);
    if (isEditing && !isSaving && changes.some((change) => change.type === "remove")) {
      void persistGraph(nodes, nextEdges);
    }
  }, [edges, isEditing, isSaving, nodes, persistGraph, setEdges]);

  const isValidConnection = useCallback((connection: Connection | Edge) => (
    Boolean(connection.source)
      && Boolean(connection.target)
      && connection.source !== connection.target
      && !edges.some((edge) => edge.source === connection.source && edge.target === connection.target)
  ), [edges]);

  const connectNodes = useCallback((connection: Connection) => {
    if (!isEditing || isSaving || !connection.source || !connection.target || !isValidConnection(connection)) return;
    const newEdge = makeEdge(
      connection.source,
      connection.target,
      newConnectorType,
      `edge-${crypto.randomUUID()}`,
    );
    const nextEdges = addEdge(newEdge, edges);
    setEdges(nextEdges);
    void persistGraph(nodes, nextEdges);
  }, [edges, isEditing, isSaving, isValidConnection, newConnectorType, nodes, persistGraph, setEdges]);

  const selectedConnectorType = useMemo(() => {
    if (!selectedEdgeIds.length) return newConnectorType;
    const selected = edges.filter((edge) => selectedEdgeIds.includes(edge.id));
    const first = selected[0] ? connectorTypeFromEdge(selected[0]) : undefined;
    return first && selected.every((edge) => connectorTypeFromEdge(edge) === first) ? first : undefined;
  }, [edges, newConnectorType, selectedEdgeIds]);

  const changeConnectorType = (connectorType: ApiWorkflowConnectorType) => {
    if (!isEditing || isSaving) return;
    if (!selectedEdgeIds.length) {
      setNewConnectorType(connectorType);
      return;
    }
    const selected = new Set(selectedEdgeIds);
    const nextEdges = edges.map((edge) => selected.has(edge.id)
      ? { ...edge, type: connectorType === "bezier" ? "default" : connectorType }
      : edge);
    setEdges(nextEdges);
    void persistGraph(nodes, nextEdges);
  };

  const applyConnectorTypeToAll = () => {
    if (!isEditing || isSaving) return;
    const connectorType = selectedConnectorType ?? newConnectorType;
    const nextEdges = edges.map((edge) => ({
      ...edge,
      type: connectorType === "bezier" ? "default" : connectorType,
    }));
    setEdges(nextEdges);
    void persistGraph(nodes, nextEdges);
  };

  const deleteSelectedEdges = () => {
    if (!isEditing || isSaving || !selectedEdgeIds.length) return;
    const selected = new Set(selectedEdgeIds);
    const nextEdges = edges.filter((edge) => !selected.has(edge.id));
    setEdges(nextEdges);
    setSelectedEdgeIds([]);
    void persistGraph(nodes, nextEdges);
  };

  const startEditing = () => {
    if (!canEdit || isSaving) return;
    setIsEditing(true);
    setEditorStatus("editing");
  };

  const stopEditing = () => {
    if (isSaving) return;
    setIsEditing(false);
    setSelectedEdgeIds([]);
    setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
    closeInspector();
    setEditorStatus("locked");
  };

  const clearSelection = () => {
    setSelectedEdgeIds([]);
    setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
    closeInspector();
  };

  return (
    <div className={`workflow-canvas-wrap ${isEditing ? "is-editing" : "is-read-only"}`}>
      <div className="canvas-stage-label stage-capture">
        <span>1</span>
        <div>
          <strong>Captura</strong>
          <small>Metricool · 20 marcas</small>
        </div>
      </div>
      <div className="canvas-stage-label stage-data">
        <span>2</span>
        <div>
          <strong>Excel y métricas</strong>
          <small>Registro + recuento</small>
        </div>
      </div>
      <div className="canvas-stage-label stage-reply">
        <span>3</span>
        <div>
          <strong>Respuesta SAC</strong>
          <small>IA con revisión humana</small>
        </div>
      </div>

      <section className={`workflow-editor-toolbar ${isEditing ? "is-editing" : ""}`} aria-label="Controles de edición del flujo">
        <div className={`workflow-editor-mode is-${editorStatus}`} aria-live="polite">
          {isSaving ? <ArrowsClockwise className="spin" size={16} /> : isEditing ? <PencilSimple size={16} /> : <LockSimple size={16} />}
          <span>
            {isSaving
              ? "Guardando..."
              : editorStatus === "error"
                ? "No se pudo guardar"
                : isEditing
                  ? editorStatus === "saved" ? "Cambios guardados" : "Edición activa"
                  : "Solo lectura"}
          </span>
        </div>

        {!isEditing ? (
          <button
            className="button secondary workflow-edit-toggle"
            type="button"
            aria-pressed="false"
            disabled={!canEdit}
            title={canEdit ? "Habilitar movimiento de nodos y edición de conexiones" : "Requiere rol supervisor o administrador"}
            onClick={startEditing}
          >
            <PencilSimple size={16} />
            Editar flujo
          </button>
        ) : (
          <>
            <div className="connector-style-control">
              <span>{selectedEdgeIds.length ? `Conexión seleccionada (${selectedEdgeIds.length})` : "Cable nuevo"}</span>
              <div role="radiogroup" aria-label={selectedEdgeIds.length ? "Trazado de la conexión seleccionada" : "Trazado de conexiones nuevas"}>
                {connectorOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selectedConnectorType === option.value}
                      className={selectedConnectorType === option.value ? "is-active" : ""}
                      title={option.description}
                      disabled={isSaving}
                      onClick={() => changeConnectorType(option.value)}
                    >
                      <Icon size={15} />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="workflow-editor-actions">
              {selectedEdgeIds.length ? (
                <button className="workflow-tool-button is-danger" type="button" onClick={deleteSelectedEdges} disabled={isSaving}>
                  <Trash size={15} />
                  Eliminar
                </button>
              ) : null}
              <button className="workflow-tool-button" type="button" onClick={applyConnectorTypeToAll} disabled={isSaving || !edges.length}>
                Aplicar a todos
              </button>
              <button className="button secondary workflow-edit-toggle" type="button" aria-pressed="true" onClick={stopEditing} disabled={isSaving}>
                <LockSimple size={16} />
                Finalizar edición
              </button>
            </div>
          </>
        )}
      </section>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={connectNodes}
        isValidConnection={isValidConnection}
        onNodeDragStop={persistPosition}
        onNodeClick={selectNode}
        onPaneClick={clearSelection}
        onSelectionChange={({ edges: selectedEdges }) => setSelectedEdgeIds(selectedEdges.map((edge) => edge.id))}
        defaultViewport={{ x: 28, y: 180, zoom: 0.72 }}
        minZoom={0.38}
        maxZoom={1.35}
        nodesDraggable={isEditing && !isSaving}
        nodesConnectable={isEditing && !isSaving}
        edgesReconnectable={false}
        elementsSelectable
        deleteKeyCode={isEditing && !isSaving ? ["Backspace", "Delete"] : null}
        connectionLineType={connectionLineType(newConnectorType)}
        connectionLineStyle={{ stroke: "#4b46f5", strokeWidth: 1.8 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#cbd3eb" gap={20} size={1.15} variant={BackgroundVariant.Dots} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(node) => {
            const tone = (node.data as WorkflowNodeData).tone;
            return {
              indigo: "#4b46f5",
              violet: "#7067f5",
              green: "#2a9f72",
              blue: "#3f7ee8",
              rose: "#c95475",
              slate: "#7a8198",
            }[tone];
          }}
          maskColor="rgba(246, 248, 255, .78)"
        />
      </ReactFlow>

      {selectedNode ? (
        <Inspector
          node={selectedNode}
          editable={isEditing && canEdit && !isSaving}
          onClose={closeInspector}
          onSave={saveNodeEnabled}
        />
      ) : null}
    </div>
  );
}
