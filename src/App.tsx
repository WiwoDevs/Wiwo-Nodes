import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  Bell,
  Buildings,
  CaretDown,
  ChartLineUp,
  ChatCircleDots,
  ChatsCircle,
  CheckCircle,
  ClockCounterClockwise,
  FlowArrow,
  GearSix,
  GitBranch,
  House,
  Key,
  Lightning,
  LockSimple,
  MagnifyingGlass,
  Play,
  Question,
  SidebarSimple,
  SquaresFour,
  TestTube,
  UserCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { AccountsView } from "./components/AccountsView";
import { DashboardView } from "./components/DashboardView";
import { InteractionDetailPanel } from "./components/InteractionDetailPanel";
import { InteractionsView } from "./components/InteractionsView";
import { ManualManagementView } from "./components/ManualManagementView";
import { SettingsView } from "./components/SettingsView";
import type { WorkflowEditorStatus } from "./components/WorkflowCanvas";
import wiwoNodesLogo from "./assets/wiwo-nodes-logo.png";
import type { AutomationSection } from "./components/AutomationPlatform";
import {
  addInteractionInternalNote,
  addBrandResource,
  connectBrandQaWorkbook,
  connectBrandWorkbook,
  createBrand,
  deactivateBrand,
  deleteInteractionDraft,
  disconnectMetricoolAccount,
  downloadBrandWorkbook,
  downloadBrandQaTemplate,
  downloadExport,
  evaluateSacProtocol,
  loadInboxData,
  loadInteractionDetail,
  loadManualAccountPosts,
  loadManualPostComments,
  loadOperationalData,
  listExecutions,
  openApiSession,
  retryExecution,
  reconcileReplyDelivery,
  removeBrandResource,
  runWorkflow,
  saveAutomationSettings,
  saveInteractionReply,
  saveMetricoolAccountCredentials,
  setAccountAutomation,
  setWorkflowEnabled,
  syncMetricool,
  updateBrand,
  updateInteractionAssignment,
  updateInteractionStatus,
  validateCurrentWorkflow,
  saveWorkflowGraph,
  type OperationalData,
  type RunResult,
  type WorkflowValidation,
} from "./lib/api";
import type { BrandAccount, BrandAdminInput, BrandResourceKind, Interaction, InteractionDetail, ManualPostSummary, ReplyDelivery } from "./types";

const WorkflowCanvas = lazy(() =>
  import("./components/WorkflowCanvas").then((module) => ({ default: module.WorkflowCanvas })),
);
const AutomationPlatform = lazy(() =>
  import("./components/AutomationPlatform").then((module) => ({ default: module.AutomationPlatform })),
);

type ViewId = "platform-home" | "automations" | "automation-executions" | "templates" | "credentials" | "workflow" | "dashboard" | "interactions" | "manual-inbox" | "accounts" | "settings";
type EditorTab = "editor" | "executions" | "evaluations";

const navigation = [
  { id: "platform-home" as const, label: "Inicio", icon: House, group: "Operación SAC" },
  { id: "interactions" as const, label: "Bandeja SAC", icon: ChatCircleDots, badge: "0", group: "Operación SAC" },
  { id: "manual-inbox" as const, label: "Gestión manual", icon: ChatsCircle, group: "Operación SAC" },
  { id: "dashboard" as const, label: "Resumen SAC", icon: ChartLineUp, group: "Operación SAC" },
  { id: "workflow" as const, label: "Flujo SAC", icon: GitBranch, group: "Operación SAC" },
  { id: "accounts" as const, label: "Cuentas", icon: Buildings, badge: "0", group: "Operación SAC" },
  { id: "automations" as const, label: "Automatización", icon: Lightning, group: "Automatización" },
  { id: "automation-executions" as const, label: "Ejecuciones", icon: ClockCounterClockwise, group: "Automatización" },
  { id: "templates" as const, label: "Plantillas", icon: SquaresFour, group: "Automatización" },
  { id: "credentials" as const, label: "Credenciales", icon: Key, group: "Automatización" },
  { id: "settings" as const, label: "Configuración", icon: GearSix, group: "Sistema" },
];

const editorTabs: { id: EditorTab; label: string }[] = [
  { id: "editor", label: "Editor" },
  { id: "executions", label: "Ejecuciones" },
  { id: "evaluations", label: "Evaluaciones" },
];

const pageTitles: Record<ViewId, { title: string; description: string }> = {
  "platform-home": {
    title: "Centro de operaciones SAC",
    description: "Mensajes, cuentas y automatizaciones en un solo lugar",
  },
  automations: {
    title: "Automatizaciones",
    description: "Diseña, publica y administra workflows",
  },
  "automation-executions": {
    title: "Ejecuciones",
    description: "Trazabilidad, errores y datos de cada recorrido",
  },
  templates: {
    title: "Plantillas",
    description: "Bases reutilizables para nuevos procesos",
  },
  credentials: {
    title: "Credenciales y variables",
    description: "Accesos cifrados y configuración reutilizable",
  },
  workflow: {
    title: "SAC Multicuenta · Metricool",
    description: "Captura, registro y respuesta con guardrails",
  },
  dashboard: {
    title: "Resumen operativo",
    description: "Rendimiento de las 20 marcas en un solo lugar",
  },
  interactions: {
    title: "Conversaciones",
    description: "Una bandeja por persona con todo su contexto",
  },
  "manual-inbox": {
    title: "Gestión manual por cuenta",
    description: "Mensajes, comentarios y contexto de publicación en un solo espacio",
  },
  accounts: {
    title: "Cuentas conectadas",
    description: "Marcas, canales y estado de sincronización",
  },
  settings: {
    title: "Configuración",
    description: "Integración, seguridad y políticas de respuesta",
  },
};

const emptyOperationalData: OperationalData = {
  actor: {
    userId: "api-unavailable",
    displayName: "API no conectada",
    tenantId: "pending",
    role: "viewer",
    brandIds: "all",
  },
  accounts: [],
  interactions: [],
  kpis: [],
  brandPerformance: [],
  recentInteractions: [],
  automationSettings: {
    automaticRepliesEnabled: false,
    humanReviewForSensitiveCases: true,
    pauseOnNegativeSentiment: true,
    confidenceThreshold: 82,
    pollingIntervalMinutes: 5,
  },
  workflow: {
    id: "workflow-sac-metricool",
    name: "SAC multicuenta · Metricool",
    enabled: false,
    version: 1,
    publishedVersion: 1,
    pollIntervalMinutes: 5,
    autoReplyEnabled: false,
    autoReplyAccountIds: [],
    minimumConfidence: 0.82,
    requireHumanFor: ["reclamo", "crisis", "legal", "datos_personales"],
    businessHoursOnly: false,
    nodes: [],
    edges: [],
  },
  statusReasons: {
    pending: [],
    escalated: [
      { code: "specialist_required", label: "Requiere especialista" },
      { code: "other", label: "Otro motivo", noteRequired: true },
    ],
    resolved: [
      { code: "answered", label: "Consulta respondida" },
      { code: "other", label: "Otro motivo", noteRequired: true },
    ],
  },
  integrations: [],
  environmentChecks: [],
  requirements: [],
  inboxSync: {
    enabled: false,
    intervalMinutes: 5,
  },
};

function ExecutionPanel({
  executions,
  isLoading,
  onRetry,
}: {
  executions: RunResult[];
  isLoading: boolean;
  onRetry: (executionId: string) => void;
}) {
  if (isLoading) {
    return <WorkflowLoading />;
  }
  if (!executions.length) {
    return (
      <section className="empty-state compact">
        <ArrowsClockwise size={28} weight="duotone" />
        <h2>Aún no hay ejecuciones persistidas</h2>
        <p>Usa “Ejecutar flujo” para procesar las cuentas; el historial sobrevivirá a nuevas sesiones.</p>
      </section>
    );
  }

  const result = executions[0];
  return (
    <section className="execution-history">
      <div className="execution-list">
        {executions.map((execution) => (
          <article key={execution.executionId} className={`execution-row status-${execution.status}`}>
            <div className={`status-icon ${execution.status === "success" ? "success" : "warning"}`}>
              {execution.status === "success" ? <CheckCircle size={20} weight="fill" /> : <WarningCircle size={20} weight="fill" />}
            </div>
            <div>
              <strong>{execution.kind === "sync" ? "Sincronización Metricool" : "Ejecución del workflow"}</strong>
              <small>{execution.startedAt ? new Date(execution.startedAt).toLocaleString("es-CL") : execution.executionId}</small>
            </div>
            <span className={`status-pill ${execution.status === "success" ? "success" : "warning"}`}>{execution.status}</span>
            <span className="execution-version">v{execution.workflowVersion ?? 1}</span>
            <button className="button secondary" type="button" onClick={() => onRetry(execution.executionId)}>Reintentar</button>
          </article>
        ))}
      </div>
      <section className="execution-detail">
        <header>
          <div className="status-icon success"><CheckCircle size={22} weight="fill" /></div>
          <div><span>Última ejecución</span><h2>{result.executionId}</h2></div>
          <span className="status-pill success">{result.status}</span>
        </header>
        <div className="execution-metrics">
          <div><span>Procesadas</span><strong>{result.processed}</strong></div>
          <div><span>Nuevas</span><strong>{result.newInteractions}</strong></div>
          <div><span>Autorrepuestas</span><strong>{result.autoReplied}</strong></div>
          <div><span>Derivadas</span><strong>{result.escalated}</strong></div>
          <div><span>Duración</span><strong>{(result.durationMs / 1000).toFixed(1)}s</strong></div>
        </div>
        <ol className="run-log">
          {(result.auditTrail ?? []).map((step) => (
            <li key={step.id} className={`run-step-${step.status}`}>
              {step.status === "failed" ? <WarningCircle size={16} weight="fill" /> : <CheckCircle size={16} weight="fill" />}
              <span><strong>{step.node}</strong> · {step.detail}</span>
              <time>{step.count ?? "—"}</time>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}

function EvaluationPanel({ validation, version, publishedVersion }: { validation: WorkflowValidation | null; version: number; publishedVersion: number }) {
  const valid = validation?.valid ?? false;
  return (
    <section className="evaluation-grid">
      <article>
        <div className="evaluation-score">{valid ? "OK" : validation?.errors ?? "—"}</div>
        <div><span>Integridad del grafo</span><p>{valid ? "Nodos, conexiones y rutas obligatorias validados." : "Corrige los errores antes de publicar."}</p></div>
      </article>
      <article>
        <div className="evaluation-score">{version === publishedVersion ? "OK" : "1"}</div>
        <div><span>Control de versiones</span><p>Borrador v{version}; producción v{publishedVersion}.</p></div>
      </article>
      <article>
        <div className="evaluation-score">{validation?.warnings ?? "—"}</div>
        <div><span>Advertencias</span><p>La API bloquea la publicación cuando existe cualquier error.</p></div>
      </article>
      {validation?.issues.map((issue) => <article key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? "workflow"}`}><WarningCircle size={22} /><div><span>{issue.code}</span><p>{issue.message}</p></div></article>)}
    </section>
  );
}

function WorkflowLoading() {
  return (
    <section className="workflow-loading" role="status" aria-live="polite">
      <ArrowsClockwise className="spin" size={24} />
      <span>Cargando editor del workflow…</span>
    </section>
  );
}

function suggestedDraft(interaction: Interaction): string {
  if (interaction.responseText?.trim()) return interaction.responseText;
  const firstName = interaction.customerName.split(/\s+/)[0] || "Hola";
  if (interaction.sentiment === "negative" || interaction.priority !== "normal") {
    return `${firstName}, gracias por escribirnos. Dejamos tu caso registrado para que el equipo SAC lo revise y te responda con el detalle correcto.`;
  }
  if (interaction.kind === "comment") {
    return `${firstName}, gracias por comentar. Te dejamos la información revisada por nuestro equipo para responderte correctamente.`;
  }
  if (interaction.kind === "review") {
    return `${firstName}, gracias por compartir tu experiencia con ${interaction.brandName}. El equipo revisó tu comentario y preparó esta respuesta para aprobación.`;
  }
  return `${firstName}, gracias por escribirnos. Revisamos tu consulta y te respondemos por este mismo canal.`;
}

export function App() {
  const [view, setView] = useState<ViewId>("platform-home");
  const [editorTab, setEditorTab] = useState<EditorTab>("editor");
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [executions, setExecutions] = useState<RunResult[]>([]);
  const [isLoadingExecutions, setLoadingExecutions] = useState(false);
  const [workflowValidation, setWorkflowValidation] = useState<WorkflowValidation | null>(null);
  const [workflowEditorStatus, setWorkflowEditorStatus] = useState<WorkflowEditorStatus>("locked");
  const [operationalData, setOperationalData] = useState<OperationalData | null>(null);
  const [isLoadingData, setLoadingData] = useState(true);
  const [isRefreshingInbox, setRefreshingInbox] = useState(false);
  const [lastInboxRefreshAt, setLastInboxRefreshAt] = useState<string | undefined>();
  const [inboxRefreshIssue, setInboxRefreshIssue] = useState<string | null>(null);
  const [connectionIssue, setConnectionIssue] = useState<string | null>(null);
  const [accessKey, setAccessKey] = useState("");
  const [isOpeningSession, setOpeningSession] = useState(false);
  const [isMutatingInteraction, setMutatingInteraction] = useState(false);
  const [isSavingBrand, setSavingBrand] = useState(false);
  const [isSavingAccount, setSavingAccount] = useState(false);
  const [isSavingWorkbook, setSavingWorkbook] = useState(false);
  const [isLoadingDetail, setLoadingDetail] = useState(false);
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(null);
  const [selectedInteractionDetail, setSelectedInteractionDetail] = useState<InteractionDetail | null>(null);
  const [detailPresentation, setDetailPresentation] = useState<"panel" | "embedded">("panel");
  const [manualAccountId, setManualAccountId] = useState<string | null>(null);
  const [manualPostSummaries, setManualPostSummaries] = useState<ManualPostSummary[]>([]);
  const [manualPostsAccountId, setManualPostsAccountId] = useState<string | null>(null);
  const [selectedManualPostKey, setSelectedManualPostKey] = useState<string | null>(null);
  const [manualPostComments, setManualPostComments] = useState<Interaction[]>([]);
  const [manualPostCommentsPostKey, setManualPostCommentsPostKey] = useState<string | null>(null);
  const [manualPostCommentsReloadToken, setManualPostCommentsReloadToken] = useState(0);
  const [isRefreshingManualPosts, setRefreshingManualPosts] = useState(false);
  const [isRefreshingManualPostComments, setRefreshingManualPostComments] = useState(false);
  const [manualCommentsIssue, setManualCommentsIssue] = useState<string | null>(null);
  const [manualDraftDirty, setManualDraftDirty] = useState(false);
  const [isSavingSettings, setSavingSettings] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "warning"; title: string; detail: string } | null>(null);
  const inboxRefreshPromise = useRef<Promise<boolean> | null>(null);
  const detailRequestSequence = useRef(0);
  const manualCommentsRequestSequence = useRef(0);
  const manualPostCommentsRequestSequence = useRef(0);
  const selectedInteractionIdRef = useRef<string | null>(null);
  const showPlatformToast = useCallback((payload: { tone: "success" | "warning"; title: string; detail: string }) => setToast(payload), []);

  const page = pageTitles[view];
  const navItems = useMemo(
    () =>
      navigation.map((item) => {
        if (item.id === "interactions") {
          const pending = operationalData?.interactions.filter((interaction) => interaction.status === "pending" || interaction.status === "needs_review").length;
          return { ...item, badge: operationalData ? String(pending) : "…" };
        }
        if (item.id === "accounts") {
          const withAlerts = operationalData?.accounts.filter((account) => account.health !== "healthy").length;
          return { ...item, badge: operationalData ? String(withAlerts) : "…" };
        }
        return item;
      }),
    [operationalData],
  );
  const activeNav = useMemo(() => navItems.find((item) => item.id === view), [navItems, view]);
  const visibleData = operationalData ?? emptyOperationalData;
  const selectedManualAccount = visibleData.accounts.find((account) => account.id === manualAccountId);
  const manualInteractions = useMemo(() => {
    if (!manualAccountId) return [];
    return visibleData.interactions.filter((interaction) => interaction.accountId === manualAccountId);
  }, [manualAccountId, visibleData.interactions]);
  const selectedContactKey = selectedInteractionDetail?.contactKey
    ?? visibleData.interactions.find((interaction) => interaction.id === selectedInteractionId)?.contactKey
    ?? null;
  const roleRank = { viewer: 0, agent: 1, supervisor: 2, admin: 3 } as const;
  const actorRank = roleRank[visibleData.actor.role];
  const canOperate = !connectionIssue && actorRank >= roleRank.agent;
  const canSupervise = !connectionIssue && actorRank >= roleRank.supervisor;
  const canAdmin = !connectionIssue && actorRank >= roleRank.admin;
  const isActive = visibleData.workflow.enabled;
  const platformSection = ({
    "platform-home": "home",
    automations: "workflows",
    "automation-executions": "executions",
    templates: "templates",
    credentials: "credentials",
  } as Partial<Record<ViewId, AutomationSection>>)[view];

  const refreshInboxData = useCallback((showError = false): Promise<boolean> => {
    if (inboxRefreshPromise.current) return inboxRefreshPromise.current;

    setRefreshingInbox(true);
    const request = (async () => {
      try {
        const data = await loadInboxData();
        setOperationalData((current) => current ? {
          ...current,
          accounts: data.accounts,
          interactions: data.interactions,
          kpis: data.kpis,
          brandPerformance: data.brandPerformance,
          recentInteractions: data.interactions.slice(0, 5),
          workflow: data.workflow,
          automationSettings: data.automationSettings,
          inboxSync: data.inboxSync,
        } : current);
        setLastInboxRefreshAt(data.loadedAt);
        setInboxRefreshIssue(null);
        return true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "No se pudo actualizar la bandeja.";
        setInboxRefreshIssue(detail);
        if (showError) {
          setToast({ tone: "warning", title: "No se pudo actualizar la bandeja", detail });
        }
        return false;
      } finally {
        inboxRefreshPromise.current = null;
        setRefreshingInbox(false);
      }
    })();
    inboxRefreshPromise.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    document.title = `${page.title} | WIWO.Nodes`;
  }, [page.title]);

  useEffect(() => {
    void refreshOperationalData();
  }, []);

  useEffect(() => {
    if (!(["interactions", "manual-inbox"] as ViewId[]).includes(view) || isLoadingData || connectionIssue) return;

    const refreshWhenAvailable = () => {
      if (
        document.visibilityState === "visible"
        && navigator.onLine
        && !isRunning
        && !isMutatingInteraction
      ) {
        void refreshInboxData(false);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshWhenAvailable();
    };

    refreshWhenAvailable();
    const intervalId = window.setInterval(refreshWhenAvailable, 30_000);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", refreshWhenAvailable);
    window.addEventListener("online", refreshWhenAvailable);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", refreshWhenAvailable);
      window.removeEventListener("online", refreshWhenAvailable);
    };
  }, [connectionIssue, isLoadingData, isMutatingInteraction, isRunning, refreshInboxData, view]);

  useEffect(() => {
    if (view !== "manual-inbox" || !manualAccountId || !selectedManualAccount || connectionIssue) return;
    const requestSequence = ++manualCommentsRequestSequence.current;
    let cancelled = false;
    setRefreshingManualPosts(true);
    void loadManualAccountPosts(manualAccountId, selectedManualAccount.name)
      .then((posts) => {
        if (cancelled || manualCommentsRequestSequence.current !== requestSequence) return;
        setManualPostSummaries(posts);
        setManualPostsAccountId(manualAccountId);
        setManualCommentsIssue(null);
      })
      .catch((error) => {
        if (cancelled || manualCommentsRequestSequence.current !== requestSequence) return;
        setManualCommentsIssue(error instanceof Error ? error.message : "No se pudieron cargar las publicaciones.");
      })
      .finally(() => {
        if (!cancelled && manualCommentsRequestSequence.current === requestSequence) {
          setRefreshingManualPosts(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionIssue, lastInboxRefreshAt, manualAccountId, selectedManualAccount?.name, view]);

  useEffect(() => {
    if (
      view !== "manual-inbox"
      || !selectedManualPostKey
      || !selectedManualAccount
      || connectionIssue
    ) return;
    const requestSequence = ++manualPostCommentsRequestSequence.current;
    let cancelled = false;
    setRefreshingManualPostComments(true);
    void loadManualPostComments(selectedManualPostKey, selectedManualAccount.name)
      .then((comments) => {
        if (cancelled || manualPostCommentsRequestSequence.current !== requestSequence) return;
        setManualPostComments(comments);
        setManualPostCommentsPostKey(selectedManualPostKey);
        setManualCommentsIssue(null);

        const activeInteractionId = selectedInteractionIdRef.current;
        const activeStillPending = comments.some((comment) => comment.id === activeInteractionId);
        if (!manualDraftDirty && !activeStillPending && comments[0]) {
          void openInteractionDetail(comments[0], "embedded");
        }
      })
      .catch((error) => {
        if (cancelled || manualPostCommentsRequestSequence.current !== requestSequence) return;
        setManualCommentsIssue(error instanceof Error ? error.message : "No se pudieron cargar los comentarios pendientes.");
      })
      .finally(() => {
        if (!cancelled && manualPostCommentsRequestSequence.current === requestSequence) {
          setRefreshingManualPostComments(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionIssue, lastInboxRefreshAt, manualPostCommentsReloadToken, selectedManualAccount?.name, selectedManualPostKey, view]);

  useEffect(() => {
    if (view !== "workflow") return;
    if (editorTab === "executions") void refreshExecutions();
    if (editorTab === "evaluations") void refreshWorkflowValidation();
  }, [view, editorTab]);

  useEffect(() => {
    const accounts = operationalData?.accounts ?? [];
    if (accounts.length === 0) {
      if (manualAccountId !== null) setManualAccountId(null);
      return;
    }
    if (manualAccountId && accounts.some((account) => account.id === manualAccountId)) return;
    const withActivity = accounts.find((account) =>
      operationalData?.interactions.some((interaction) => interaction.accountId === account.id));
    setManualAccountId((withActivity ?? accounts[0]!).id);
  }, [manualAccountId, operationalData?.accounts, operationalData?.interactions]);

  async function refreshExecutions() {
    setLoadingExecutions(true);
    try {
      const history = await listExecutions();
      setExecutions(history);
    } catch (error) {
      setToast({ tone: "warning", title: "No se pudo cargar el historial", detail: error instanceof Error ? error.message : "Revisa la API." });
    } finally {
      setLoadingExecutions(false);
    }
  }

  async function refreshWorkflowValidation() {
    try {
      setWorkflowValidation(await validateCurrentWorkflow());
    } catch (error) {
      setToast({ tone: "warning", title: "No se pudo validar el workflow", detail: error instanceof Error ? error.message : "Revisa la API." });
    }
  }

  async function handleRetryExecution(executionId: string) {
    if (isRunning) return;
    setIsRunning(true);
    try {
      const result = await retryExecution(executionId);
      await Promise.all([refreshExecutions(), refreshOperationalData()]);
      setToast({ tone: "success", title: "Ejecución reintentada", detail: `Nueva ejecución ${result.executionId}` });
    } catch (error) {
      setToast({ tone: "warning", title: "No se pudo reintentar", detail: error instanceof Error ? error.message : "Revisa la API." });
    } finally {
      setIsRunning(false);
    }
  }

  async function handleSaveWorkflowGraph(
    nodes: OperationalData["workflow"]["nodes"],
    edges: OperationalData["workflow"]["edges"],
  ): Promise<boolean> {
    if (!operationalData) return false;
    try {
      const workflow = await saveWorkflowGraph({ ...operationalData.workflow, nodes, edges });
      setOperationalData((current) => current ? { ...current, workflow } : current);
      setToast({ tone: "success", title: `Borrador v${workflow.version} guardado`, detail: "Valídalo y publícalo antes de habilitar autoenvío." });
      return true;
    } catch (error) {
      setToast({ tone: "warning", title: "No se pudo guardar el canvas", detail: error instanceof Error ? error.message : "Revisa la API." });
      return false;
    }
  }

  async function refreshOperationalData() {
    setLoadingData(true);
    try {
      const data = await loadOperationalData();
      setOperationalData(data);
      setLastInboxRefreshAt(new Date().toISOString());
      setInboxRefreshIssue(null);
      setConnectionIssue(null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "La API real no respondió.";
      setOperationalData((current) => current ?? emptyOperationalData);
      setConnectionIssue(detail);
      setToast({
        tone: "warning",
        title: "API real pendiente de conexión",
        detail,
      });
    } finally {
      setLoadingData(false);
    }
  }

  async function connectSecureSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessKey.trim() || isOpeningSession) return;
    setOpeningSession(true);
    try {
      await openApiSession(accessKey.trim());
      setAccessKey("");
      await refreshOperationalData();
      setToast({ tone: "success", title: "Sesión segura iniciada", detail: "La clave no quedó guardada en el navegador." });
    } catch (error) {
      setToast({ tone: "warning", title: "No se pudo iniciar sesión", detail: error instanceof Error ? error.message : "Clave inválida." });
    } finally {
      setOpeningSession(false);
    }
  }

  async function execute(action: "run" | "sync") {
    if (isRunning) return;
    setIsRunning(true);
    setEditorTab("editor");
    setView("workflow");
    try {
      const result = action === "run" ? await runWorkflow() : await syncMetricool();
      setExecutions((current) => [result, ...current.filter((item) => item.executionId !== result.executionId)]);
      if (action === "sync") await refreshOperationalData();
      setToast({
        tone: "success",
        title: action === "run" ? "Flujo completado" : "Metricool sincronizado",
        detail: `${result.newInteractions} nuevas · ${result.autoReplied} respondidas · ${result.escalated} derivadas`,
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "La ejecución no pudo completarse",
        detail: error instanceof Error ? error.message : "Revisa la conexión de la API real.",
      });
    } finally {
      setIsRunning(false);
    }
  }

  async function refreshInboxNow() {
    if (isRunning || isMutatingInteraction) return;
    setIsRunning(true);
    try {
      if (inboxRefreshPromise.current) await inboxRefreshPromise.current;
      const result = await syncMetricool();
      setExecutions((current) => [result, ...current.filter((item) => item.executionId !== result.executionId)]);
      const refreshed = await refreshInboxData(false);
      if (!refreshed) {
        setToast({
          tone: "warning",
          title: "Metricool se sincronizó, pero la vista no se actualizó",
          detail: "La bandeja conserva los datos anteriores. Intenta actualizar nuevamente.",
        });
        return;
      }
      setToast({
        tone: "success",
        title: "Bandeja actualizada",
        detail: `${result.newInteractions} nuevas · ${result.processed} procesadas`,
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo actualizar desde Metricool",
        detail: error instanceof Error ? error.message : "Revisa la conexión de la API real.",
      });
    } finally {
      setIsRunning(false);
    }
  }

  async function exportExcel() {
    try {
      await downloadExport();
      setToast({ tone: "success", title: "Excel generado", detail: "La descarga incluye detalle y resumen por marca." });
    } catch {
      setToast({
        tone: "warning",
        title: "Inicia la API para exportar",
        detail: "El Excel se genera desde la API real cuando la integración está conectada.",
      });
    }
  }

  async function openInteractionDetail(
    interaction: Interaction,
    presentation: "panel" | "embedded" = "panel",
  ) {
    const requestSequence = ++detailRequestSequence.current;
    selectedInteractionIdRef.current = interaction.id;
    setSelectedInteractionId(interaction.id);
    setDetailPresentation(presentation);
    setSelectedInteractionDetail(null);
    setLoadingDetail(true);
    try {
      const nextDetail = await loadInteractionDetail(interaction.id);
      if (detailRequestSequence.current !== requestSequence) return;
      setSelectedInteractionDetail(nextDetail);
    } catch (error) {
      if (detailRequestSequence.current !== requestSequence) return;
      setToast({
        tone: "warning",
        title: "No se pudo abrir la conversación",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
    } finally {
      if (detailRequestSequence.current === requestSequence) setLoadingDetail(false);
    }
  }

  async function refreshInteractionDetail(expectedInteractionId = selectedInteractionIdRef.current) {
    const interactionId = expectedInteractionId;
    if (!interactionId || selectedInteractionIdRef.current !== interactionId) return;
    const requestSequence = ++detailRequestSequence.current;
    const nextDetail = await loadInteractionDetail(interactionId);
    if (
      detailRequestSequence.current === requestSequence
      && selectedInteractionIdRef.current === interactionId
    ) {
      setSelectedInteractionDetail(nextDetail);
    }
  }

  function closeInteractionDetail() {
    detailRequestSequence.current += 1;
    selectedInteractionIdRef.current = null;
    setLoadingDetail(false);
    setSelectedInteractionId(null);
    setSelectedInteractionDetail(null);
  }

  async function createDraft(interaction: Interaction) {
    if (isMutatingInteraction) return;
    setMutatingInteraction(true);
    try {
      await saveInteractionReply(interaction.id, suggestedDraft(interaction), "draft", interaction.version ?? 1);
      await refreshOperationalData();
      if (selectedInteractionIdRef.current === interaction.id) await refreshInteractionDetail(interaction.id);
      setToast({
        tone: "success",
        title: "Borrador guardado",
        detail: `${interaction.brandName} · ${interaction.customerHandle}`,
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo guardar el borrador",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
    } finally {
      setMutatingInteraction(false);
    }
  }

  async function createDrafts(interactions: Interaction[]) {
    if (isMutatingInteraction || interactions.length === 0) return;
    setMutatingInteraction(true);
    try {
      await Promise.all(
        interactions.map((interaction) =>
          saveInteractionReply(interaction.id, suggestedDraft(interaction), "draft", interaction.version ?? 1),
        ),
      );
      await refreshOperationalData();
      const selectedId = selectedInteractionIdRef.current;
      if (selectedId && interactions.some((interaction) => interaction.id === selectedId)) {
        await refreshInteractionDetail(selectedId);
      }
      setToast({
        tone: "success",
        title: `${interactions.length} borradores guardados`,
        detail: "Quedaron registrados en backend para revisión humana.",
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudieron guardar todos los borradores",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
    } finally {
      setMutatingInteraction(false);
    }
  }

  async function processSacProtocol(interactions?: Interaction[]) {
    if (isMutatingInteraction) return;
    setMutatingInteraction(true);
    try {
      const result = await evaluateSacProtocol(interactions?.map((interaction) => interaction.id));
      await refreshOperationalData();
      if (selectedInteractionIdRef.current) await refreshInteractionDetail(selectedInteractionIdRef.current);
      setToast({
        tone: result.queueSkippedCapacity ? "warning" : "success",
        title: `${result.evaluated} casos procesados por SAC v1`,
        detail: `${result.reconciledTeamResponses} ya respondidos por el equipo · ${result.drafted} borradores · ${result.escalated} revisiones humanas · ${result.queuedAutoReplies} respuestas en cola${result.queueSkippedCapacity ? ` · ${result.queueSkippedCapacity} retenidas por capacidad` : ""}`,
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo ejecutar el protocolo SAC",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
    } finally {
      setMutatingInteraction(false);
    }
  }

  async function resolveInteraction(interaction: Interaction, reasonCode: string, reasonNote?: string) {
    if (isMutatingInteraction || isRunning) return false;
    setMutatingInteraction(true);
    try {
      await updateInteractionStatus(
        interaction.id,
        "resolved",
        reasonCode,
        reasonNote,
        interaction.version ?? 1,
      );
      await refreshOperationalData();
      if (selectedInteractionIdRef.current === interaction.id) await refreshInteractionDetail(interaction.id);
      setToast({
        tone: "success",
        title: "Interacción resuelta",
        detail: `${interaction.brandName} · ${interaction.customerHandle}`,
      });
      return true;
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo resolver la interacción",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
      return false;
    } finally {
      setMutatingInteraction(false);
    }
  }

  async function saveDetailDraft(detail: InteractionDetail, text: string) {
    if (isMutatingInteraction || isRunning) return;
    setMutatingInteraction(true);
    try {
      await saveInteractionReply(detail.id, text, "draft", detail.version);
      await refreshOperationalData();
      await refreshInteractionDetail(detail.id);
      setToast({
        tone: "success",
        title: "Borrador actualizado",
        detail: `${detail.brandName} · ${detail.customerHandle}`,
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo guardar el borrador",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
      throw error;
    } finally {
      setMutatingInteraction(false);
    }
  }

  async function clearDetailDraft(detail: InteractionDetail) {
    if (isMutatingInteraction) return;
    setMutatingInteraction(true);
    try {
      await deleteInteractionDraft(detail.id, detail.version);
      await refreshOperationalData();
      await refreshInteractionDetail(detail.id);
      setToast({
        tone: "success",
        title: "Borrador eliminado",
        detail: "Solo se borró el texto local. El mensaje original del cliente permanece intacto.",
      });
    } catch (error) {
      await refreshInteractionDetail(detail.id).catch(() => undefined);
      setToast({
        tone: "warning",
        title: "No se pudo borrar el borrador",
        detail: error instanceof Error ? error.message : "Actualiza el caso e inténtalo nuevamente.",
      });
    } finally {
      setMutatingInteraction(false);
    }
  }

  async function sendDetailReply(detail: InteractionDetail, text: string) {
    if (isMutatingInteraction || isRunning) return false;
    setMutatingInteraction(true);
    try {
      await saveInteractionReply(detail.id, text, "send", detail.version);
      await refreshOperationalData();
      await refreshInteractionDetail(detail.id);
      setToast({
        tone: "success",
        title: "Respuesta procesada",
        detail: `${detail.brandName} · envío confirmado y auditado.`,
      });
      return true;
    } catch (error) {
      await refreshInteractionDetail(detail.id).catch(() => undefined);
      setToast({
        tone: "warning",
        title: "La respuesta no fue confirmada",
        detail: error instanceof Error ? error.message : "Revisa los permisos y la conexión con Metricool; el texto permanece disponible para volver a intentarlo.",
      });
      return false;
    } finally {
      setMutatingInteraction(false);
    }
  }

  async function reconcileDetailDelivery(
    detail: InteractionDetail,
    delivery: ReplyDelivery,
    outcome: "sent" | "failed" | "cancelled",
    note: string,
  ) {
    if (isMutatingInteraction) return;
    setMutatingInteraction(true);
    try {
      await reconcileReplyDelivery(delivery.id, outcome, delivery.version, note);
      await refreshOperationalData();
      await refreshInteractionDetail(detail.id);
      setToast({
        tone: "success",
        title: "Entrega conciliada",
        detail: outcome === "sent"
          ? `${detail.brandName} · confirmada como enviada.`
          : `${detail.brandName} · marcada como no enviada.`,
      });
    } catch (error) {
      await refreshInteractionDetail(detail.id).catch(() => undefined);
      setToast({
        tone: "warning",
        title: "No se pudo conciliar la entrega",
        detail: error instanceof Error ? error.message : "Actualiza el caso e inténtalo nuevamente.",
      });
    } finally {
      setMutatingInteraction(false);
    }
  }

  async function escalateInteraction(detail: InteractionDetail, reasonCode: string, reasonNote?: string) {
    if (isMutatingInteraction || isRunning) return false;
    setMutatingInteraction(true);
    try {
      await updateInteractionStatus(
        detail.id,
        "escalated",
        reasonCode,
        reasonNote,
        detail.version,
      );
      await refreshOperationalData();
      await refreshInteractionDetail(detail.id);
      setToast({
        tone: "success",
        title: "Caso escalado",
        detail: `${detail.brandName} · ${detail.customerHandle}`,
      });
      return true;
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo escalar el caso",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
      return false;
    } finally {
      setMutatingInteraction(false);
    }
  }

  async function changeInteractionAssignment(detail: InteractionDetail) {
    if (isMutatingInteraction || isRunning) return;
    setMutatingInteraction(true);
    const action = detail.assignedTo ? "release" : "claim";
    try {
      await updateInteractionAssignment(detail.id, detail.version, action);
      await refreshOperationalData();
      await refreshInteractionDetail(detail.id);
      setToast({
        tone: "success",
        title: action === "claim" ? "Caso asignado" : "Caso liberado",
        detail: action === "claim" ? "Quedó asignado al usuario de la sesión." : "Volvió a la cola sin asignación.",
      });
    } catch (error) {
      await refreshInteractionDetail(detail.id).catch(() => undefined);
      setToast({
        tone: "warning",
        title: "No se pudo cambiar la asignación",
        detail: error instanceof Error ? error.message : "Recarga el caso e intenta nuevamente.",
      });
    } finally {
      setMutatingInteraction(false);
    }
  }

  async function addInternalNote(detail: InteractionDetail, text: string): Promise<boolean> {
    if (isMutatingInteraction) return false;
    setMutatingInteraction(true);
    try {
      await addInteractionInternalNote(detail.id, text, detail.version);
      await refreshOperationalData();
      await refreshInteractionDetail(detail.id);
      setToast({
        tone: "success",
        title: "Nota interna guardada",
        detail: "La nota es visible dentro de SAC Flow y no se envía a Metricool.",
      });
      return true;
    } catch (error) {
      await refreshInteractionDetail(detail.id).catch(() => undefined);
      setToast({
        tone: "warning",
        title: "No se pudo guardar la nota",
        detail: error instanceof Error ? error.message : "Recarga el caso e intenta nuevamente.",
      });
      return false;
    } finally {
      setMutatingInteraction(false);
    }
  }

  async function saveSettings(settings: OperationalData["automationSettings"]) {
    if (isSavingSettings) return;
    setSavingSettings(true);
    try {
      await saveAutomationSettings(settings, visibleData.workflow.autoReplyAccountIds);
      await refreshOperationalData();
      setToast({
        tone: "success",
        title: "Reglas guardadas",
        detail: "El workflow del backend quedó actualizado.",
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudieron guardar las reglas",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function toggleAccountAutomation(accountId: string, enabled: boolean) {
    if (isSavingSettings) return;
    setSavingSettings(true);
    try {
      await setAccountAutomation(accountId, enabled, visibleData.workflow);
      await refreshOperationalData();
      setToast({
        tone: "success",
        title: enabled ? "Cuenta agregada a automatización" : "Cuenta pausada",
        detail: "La allowlist del workflow fue actualizada en backend.",
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo cambiar la automatización",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function toggleWorkflowActive() {
    if (isSavingSettings) return;
    setSavingSettings(true);
    try {
      const workflow = await setWorkflowEnabled(!isActive);
      setOperationalData((current) => current ? { ...current, workflow } : current);
      setToast({
        tone: "success",
        title: workflow.enabled ? "Workflow SAC activado" : "Workflow SAC pausado",
        detail: `El estado real quedó guardado en backend como borrador v${workflow.version}.`,
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo cambiar el estado",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
    } finally {
      setSavingSettings(false);
    }
  }

  async function createBrandAccount(input: BrandAdminInput) {
    if (isSavingBrand) return;
    setSavingBrand(true);
    try {
      await createBrand(input);
      await refreshOperationalData();
      setToast({
        tone: "success",
        title: `Marca creada: ${input.name}`,
        detail: "La cuenta interna quedó lista para guardar su referencia Metricool.",
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo crear la marca",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
      throw error;
    } finally {
      setSavingBrand(false);
    }
  }

  async function updateBrandAccount(account: BrandAccount, input: BrandAdminInput) {
    if (isSavingBrand) return;
    setSavingBrand(true);
    try {
      await updateBrand(account.brandId ?? account.id, input);
      await refreshOperationalData();
      setToast({
        tone: "success",
        title: `Marca actualizada: ${input.name}`,
        detail: "Los cambios quedaron guardados en backend sin tocar Metricool.",
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo actualizar la marca",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
      throw error;
    } finally {
      setSavingBrand(false);
    }
  }

  async function deactivateBrandAccount(account: BrandAccount) {
    if (isSavingBrand) return;
    setSavingBrand(true);
    try {
      await deactivateBrand(account.brandId ?? account.id);
      await refreshOperationalData();
      setToast({
        tone: "success",
        title: `${account.name} desactivada`,
        detail: "No se borró historial; se retiró de automatización y de referencias Metricool persistidas.",
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo desactivar la marca",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
      throw error;
    } finally {
      setSavingBrand(false);
    }
  }

  async function saveAccountMetricoolCredentials(
    account: BrandAccount,
    credentials: {
      userId: string;
      blogId: string;
      instagramProvider: "INSTAGRAMBUSINESS" | "INSTAGRAM";
    },
  ) {
    if (isSavingAccount) return;
    setSavingAccount(true);
    try {
      await saveMetricoolAccountCredentials(account.id, credentials);
      await refreshOperationalData();
      setToast({
        tone: "success",
        title: `Referencia guardada para ${account.name}`,
        detail: "El userId, blogId y método de conexión quedaron persistidos sin exponer el token al frontend.",
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo guardar la referencia Metricool",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
      throw error;
    } finally {
      setSavingAccount(false);
    }
  }

  async function disconnectAccountMetricool(account: BrandAccount) {
    if (isSavingAccount) return;
    setSavingAccount(true);
    try {
      await disconnectMetricoolAccount(account.id);
      await refreshOperationalData();
      setToast({
        tone: "success",
        title: `${account.name} desconectada`,
        detail: "Se quitó la referencia guardada y la cuenta salió de la allowlist de auto-respuesta.",
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo desconectar la cuenta",
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
      throw error;
    } finally {
      setSavingAccount(false);
    }
  }

  async function saveBrandWorkbook(account: BrandAccount, spreadsheetUrl: string) {
    if (isSavingWorkbook) return;
    setSavingWorkbook(true);
    try {
      const workbook = await connectBrandWorkbook(account.brandId ?? account.id, spreadsheetUrl);
      await refreshOperationalData();
      setToast({
        tone: "success",
        title: `Excel validado para ${account.name}`,
        detail: `${workbook.dataRows} registros · ${workbook.headers.length} columnas · formato estricto activo.`,
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo conectar el Excel",
        detail: error instanceof Error ? error.message : "Revisa el enlace y el formato.",
      });
      throw error;
    } finally {
      setSavingWorkbook(false);
    }
  }

  async function downloadWorkbookCopy(account: BrandAccount) {
    try {
      await downloadBrandWorkbook(account.brandId ?? account.id, account.name);
      setToast({
        tone: "success",
        title: `Copia de ${account.name} generada`,
        detail: "Se preservó la estructura original y solo se agregaron registros no duplicados.",
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo generar la copia",
        detail: error instanceof Error ? error.message : "Revisa el Excel conectado.",
      });
    }
  }

  async function saveBrandQaWorkbook(account: BrandAccount, spreadsheetUrl: string) {
    if (isSavingWorkbook) return;
    setSavingWorkbook(true);
    try {
      const workbook = await connectBrandQaWorkbook(account.brandId ?? account.id, spreadsheetUrl);
      await refreshOperationalData();
      setToast({
        tone: "success",
        title: `QA aprobado para ${account.name}`,
        detail: `${workbook.approvedRows} respuestas aprobadas quedaron disponibles para recomendaciones IA.`,
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo conectar el Excel QA",
        detail: error instanceof Error ? error.message : "Revisa el enlace y el formato QA.",
      });
      throw error;
    } finally {
      setSavingWorkbook(false);
    }
  }

  async function downloadQaTemplate(account: BrandAccount) {
    try {
      await downloadBrandQaTemplate(account.brandId ?? account.id, account.name);
      setToast({
        tone: "success",
        title: "Plantilla QA descargada",
        detail: "Incluye columnas, listas y reglas para respuestas aprobadas por marca.",
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo descargar la plantilla QA",
        detail: error instanceof Error ? error.message : "Revisa la API local.",
      });
    }
  }

  async function createBrandResource(account: BrandAccount, input: { name: string; url: string; kind: BrandResourceKind }) {
    if (isSavingWorkbook) return;
    setSavingWorkbook(true);
    try {
      await addBrandResource(account.brandId ?? account.id, input);
      await refreshOperationalData();
      setToast({ tone: "success", title: "Archivo agregado", detail: `${input.name} quedó ordenado dentro de ${account.name}.` });
    } catch (error) {
      setToast({ tone: "warning", title: "No se pudo agregar el archivo", detail: error instanceof Error ? error.message : "Revisa el enlace." });
      throw error;
    } finally {
      setSavingWorkbook(false);
    }
  }

  async function deleteBrandResource(account: BrandAccount, resourceId: string) {
    if (isSavingWorkbook) return;
    setSavingWorkbook(true);
    try {
      await removeBrandResource(account.brandId ?? account.id, resourceId);
      await refreshOperationalData();
      setToast({ tone: "success", title: "Archivo retirado", detail: "Se eliminó el enlace interno; el archivo de origen no fue modificado." });
    } catch (error) {
      setToast({ tone: "warning", title: "No se pudo retirar el archivo", detail: error instanceof Error ? error.message : "Actualiza la cuenta." });
      throw error;
    } finally {
      setSavingWorkbook(false);
    }
  }

  async function syncSingleAccount(account: BrandAccount) {
    if (isRunning || isMutatingInteraction) return;
    setIsRunning(true);
    try {
      const result = await syncMetricool([account.id]);
      await refreshOperationalData();
      setToast({
        tone: "success",
        title: `${account.name} sincronizada`,
        detail: `${result.newInteractions} nuevas · ${result.escalated} derivadas`,
      });
    } catch (error) {
      setToast({
        tone: "warning",
        title: `No se pudo sincronizar ${account.name}`,
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
    } finally {
      setIsRunning(false);
    }
  }

  function navigateToView(destination: ViewId) {
    if (
      view === "manual-inbox"
      && destination !== view
      && manualDraftDirty
      && !window.confirm("Hay una respuesta manual sin guardar. ¿Salir y descartar esos cambios locales?")
    ) {
      return;
    }
    if (view === "manual-inbox" && destination !== view) {
      setManualDraftDirty(false);
      closeInteractionDetail();
    } else if (destination === "manual-inbox" && view !== destination) {
      closeInteractionDetail();
    }
    setView(destination);
  }

  return (
    <div className={`app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <aside className="app-sidebar">
        <div className="brand-lockup">
          <span className="brand-mark"><FlowArrow size={24} weight="bold" /></span>
          <span className="brand-copy"><strong>WIWO.Nodes</strong><small>SAC Automation</small></span>
          <button className="icon-button sidebar-toggle" onClick={() => setSidebarCollapsed((value) => !value)} aria-label="Contraer menú">
            <SidebarSimple size={18} />
          </button>
        </div>

        <nav className="primary-nav" aria-label="Navegación principal">
          {["Operación SAC", "Automatización", "Sistema"].map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-section-label">{group}</span>
              {navItems.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                return (
                  <button key={item.id} className={view === item.id ? "is-active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => navigateToView(item.id)} title={item.label}>
                    <Icon size={19} weight={view === item.id ? "fill" : "regular"} />
                    <span>{item.label}</span>
                    {item.badge ? <small>{item.badge}</small> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-project">
          <span className="nav-section-label">Proyecto</span>
          <button>
            <span className="project-avatar">M</span>
            <span><strong>MGC · Operaciones</strong><small>{isLoadingData ? "Cargando espacio" : `${visibleData.accounts.length} marcas · SAC principal`}</small></span>
            <CaretDown size={14} />
          </button>
        </div>

        <div className="sidebar-footer">
          <button title="Ayuda"><Question size={19} /><span>Ayuda y documentación</span></button>
          <button title={`Perfil · ${visibleData.actor.role}`}><UserCircle size={20} /><span>{visibleData.actor.displayName}</span><i className="online-dot" /></button>
        </div>
      </aside>

      <main className="app-main" id="main-content">
        <header className="topbar">
          <div className="topbar-wordmark">
            <img src={wiwoNodesLogo} alt="WIWO.Nodes" />
          </div>
          <div className="page-heading">
            <div className="breadcrumb"><span>{activeNav?.label}</span><span>/</span><strong>Operación SAC</strong></div>
            <div>
              <h1>{page.title}</h1>
              <p>{page.description}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Buscar conversaciones" onClick={() => navigateToView("interactions")}><MagnifyingGlass size={19} /></button>
            <button className="icon-button notification-button" aria-label={`Abrir pendientes SAC: ${visibleData.interactions.filter((interaction) => interaction.status === "pending" || interaction.status === "needs_review").length}`} onClick={() => navigateToView("interactions")}><Bell size={19} />{visibleData.interactions.some((interaction) => interaction.status === "pending" || interaction.status === "needs_review") ? <span /> : null}</button>
            {view === "workflow" ? (
              <>
                <div className="workflow-state">
                  <span>{isActive ? "Activo" : "Pausado"}</span>
                  <button
                    className={`switch ${isActive ? "is-on" : ""}`}
                    aria-pressed={isActive}
                    onClick={() => void toggleWorkflowActive()}
                    disabled={!canSupervise || isSavingSettings}
                    aria-label={isActive ? "Pausar workflow SAC" : "Activar workflow SAC"}
                    title={!canSupervise ? "Requiere rol supervisor o administrador" : undefined}
                  ><span /></button>
                </div>
                <button className="button secondary test-button" onClick={() => execute("sync")} disabled={isRunning || !canOperate} title={!canOperate ? "Requiere rol agente o superior" : undefined}>
                  <TestTube size={17} /> Probar
                </button>
                <button className="button primary" onClick={() => execute("run")} disabled={isRunning || !canOperate} title={!canOperate ? "Requiere rol agente o superior" : undefined}>
                  {isRunning ? <ArrowsClockwise className="spin" size={17} /> : <Play size={17} weight="fill" />}
                  {isRunning ? "Ejecutando" : "Ejecutar flujo"}
                </button>
              </>
            ) : null}
          </div>
        </header>

        {connectionIssue ? (
          <section className="api-connection-banner" role="status" aria-live="polite">
            <span><WarningCircle size={21} weight="fill" /></span>
            <div>
              <strong>Acceso seguro requerido</strong>
              <p>Ingresa la clave del sitio una vez. Se convierte en una cookie HttpOnly y no se almacena en JavaScript.</p>
              <small>{connectionIssue}</small>
            </div>
            <form className="api-session-form" onSubmit={connectSecureSession}>
              <label>
                <span className="sr-only">Clave de acceso del sitio</span>
                <input
                  type="password"
                  value={accessKey}
                  onChange={(event) => setAccessKey(event.target.value)}
                  placeholder="Clave de acceso del sitio"
                  autoComplete="current-password"
                  minLength={16}
                  required
                />
              </label>
              <button className="button secondary" type="submit" disabled={isOpeningSession || !accessKey.trim()}>
                {isOpeningSession ? <ArrowsClockwise className="spin" size={16} /> : <Key size={16} />}
                Acceder
              </button>
            </form>
          </section>
        ) : null}

        {view === "workflow" ? (
          <section className="workflow-page">
            <div className="editor-tabs" role="tablist" aria-label="Secciones del workflow">
              {editorTabs.map((tab) => (
                <button key={tab.id} role="tab" aria-selected={editorTab === tab.id} className={editorTab === tab.id ? "is-active" : ""} onClick={() => setEditorTab(tab.id)}>
                  {tab.label}
                  {tab.id === "executions" && executions.length ? <span>{executions.length}</span> : null}
                </button>
              ))}
              <div className={`autosave-status is-${workflowEditorStatus}`} aria-live="polite">
                {workflowEditorStatus === "saving" ? (
                  <ArrowsClockwise className="spin" size={15} />
                ) : workflowEditorStatus === "locked" ? (
                  <LockSimple size={15} />
                ) : workflowEditorStatus === "error" ? (
                  <WarningCircle size={15} weight="fill" />
                ) : (
                  <CheckCircle size={15} weight="fill" />
                )}
                {({
                  locked: "Solo lectura",
                  editing: "Edición activa",
                  saving: "Guardando...",
                  saved: "Cambios guardados",
                  error: "Error al guardar",
                } as Record<WorkflowEditorStatus, string>)[workflowEditorStatus]}
              </div>
            </div>
            <div className="workflow-tab-content">
              {editorTab === "editor" ? (
                <Suspense fallback={<WorkflowLoading />}>
                  <WorkflowCanvas
                    workflow={visibleData.workflow}
                    canEdit={canSupervise}
                    onSaveGraph={handleSaveWorkflowGraph}
                    onStatusChange={setWorkflowEditorStatus}
                  />
                </Suspense>
              ) : null}
              {editorTab === "executions" ? <ExecutionPanel executions={executions} isLoading={isLoadingExecutions} onRetry={handleRetryExecution} /> : null}
              {editorTab === "evaluations" ? (
                <EvaluationPanel
                  validation={workflowValidation}
                  version={visibleData.workflow.version}
                  publishedVersion={visibleData.workflow.publishedVersion}
                />
              ) : null}
            </div>
          </section>
        ) : null}

        {platformSection ? (
          <Suspense fallback={<section className="platform-loading"><ArrowsClockwise className="spin" size={24} /><strong>Cargando Automation Studio</strong></section>}>
            <AutomationPlatform
              section={platformSection}
              canAdmin={canAdmin}
              canOperate={canOperate}
              canSupervise={canSupervise}
              accounts={visibleData.accounts}
              interactions={visibleData.interactions}
              sacWorkflow={visibleData.workflow}
              isOperationalLoading={isLoadingData}
              onNavigate={(destination) => setView(destination)}
              onOpenInteraction={openInteractionDetail}
              onToast={showPlatformToast}
            />
          </Suspense>
        ) : null}

        {view === "dashboard" ? (
          <div className="content-page">
            <DashboardView
              kpis={visibleData.kpis}
              brandPerformance={visibleData.brandPerformance}
              recentInteractions={visibleData.recentInteractions}
              isRefreshing={isRunning}
              canSync={canOperate}
              canExport={canSupervise}
              onRefresh={() => execute("sync")}
              onExport={exportExcel}
              onViewAllAccounts={() => setView("accounts")}
              onViewAllInteractions={() => setView("interactions")}
              onSelectBrand={() => setView("accounts")}
              onOpenInteraction={openInteractionDetail}
            />
          </div>
        ) : null}
        {view === "interactions" ? (
          <div className="content-page">
            <InteractionsView
              interactions={visibleData.interactions}
              accounts={visibleData.accounts}
              canWrite={canOperate}
              canSync={canOperate}
              canExport={canSupervise}
              isRefreshing={isRunning || isMutatingInteraction || isRefreshingInbox}
              lastUpdatedAt={lastInboxRefreshAt}
              refreshIssue={inboxRefreshIssue}
              inboxSync={visibleData.inboxSync}
              onRefresh={refreshInboxNow}
              onProcessProtocol={() => processSacProtocol()}
              onExport={exportExcel}
              onOpenInteraction={openInteractionDetail}
              onSendAutomaticResponse={createDraft}
              onSendAutomaticResponses={createDrafts}
              onResolveInteraction={(interaction) => { void resolveInteraction(interaction, "answered"); }}
            />
          </div>
        ) : null}
        {view === "manual-inbox" ? (
          <div className="content-page content-page--manual-inbox">
            <ManualManagementView
              accounts={visibleData.accounts}
              interactions={manualInteractions}
              selectedAccountId={manualAccountId}
              selectedInteractionId={selectedInteractionId}
              selectedContactKey={selectedContactKey}
              detail={selectedInteractionDetail}
              isLoadingDetail={isLoadingDetail}
              isSaving={isMutatingInteraction || isRunning}
              isRefreshing={isRunning || isRefreshingInbox || isRefreshingManualPosts || isRefreshingManualPostComments}
              postSummaries={manualPostsAccountId === manualAccountId ? manualPostSummaries : []}
              selectedPostKey={selectedManualPostKey}
              postComments={manualPostComments}
              postCommentsPostKey={manualPostCommentsPostKey}
              isLoadingPosts={isRefreshingManualPosts && manualPostsAccountId !== manualAccountId}
              isLoadingPostComments={isRefreshingManualPostComments && manualPostCommentsPostKey !== selectedManualPostKey}
              postCommentsError={manualCommentsIssue}
              canWrite={canOperate}
              canRefresh={canOperate}
              lastUpdatedAt={lastInboxRefreshAt}
              refreshIssue={manualCommentsIssue || inboxRefreshIssue}
              statusReasons={visibleData.statusReasons}
              onSelectAccount={(account) => {
                closeInteractionDetail();
                setManualDraftDirty(false);
                manualCommentsRequestSequence.current += 1;
                manualPostCommentsRequestSequence.current += 1;
                setManualPostSummaries([]);
                setManualPostsAccountId(null);
                setSelectedManualPostKey(null);
                setManualPostComments([]);
                setManualPostCommentsPostKey(null);
                setManualCommentsIssue(null);
                setManualAccountId(account.id);
              }}
              onSelectInteraction={(interaction) => openInteractionDetail(interaction, "embedded")}
              onSelectPost={(post) => {
                if (post.postKey === selectedManualPostKey) return;
                closeInteractionDetail();
                setManualDraftDirty(false);
                manualPostCommentsRequestSequence.current += 1;
                setSelectedManualPostKey(post.postKey);
                setManualPostComments([]);
                setManualPostCommentsPostKey(null);
                setManualCommentsIssue(null);
              }}
              onClearSelection={() => {
                closeInteractionDetail();
                setManualDraftDirty(false);
                manualPostCommentsRequestSequence.current += 1;
                setSelectedManualPostKey(null);
                setManualPostComments([]);
                setManualPostCommentsPostKey(null);
                setManualCommentsIssue(null);
              }}
              onRetryPostComments={() => {
                setManualCommentsIssue(null);
                setManualPostCommentsReloadToken((current) => current + 1);
              }}
              onRefreshAccount={syncSingleAccount}
              onSaveDraft={saveDetailDraft}
              onSendReply={sendDetailReply}
              onResolve={resolveInteraction}
              onEscalate={escalateInteraction}
              onChangeAssignment={changeInteractionAssignment}
              onDraftDirtyChange={setManualDraftDirty}
            />
          </div>
        ) : null}
        {view === "accounts" ? (
          <div className="content-page">
            <AccountsView
              accounts={visibleData.accounts}
              canAdmin={canAdmin}
              canSync={canOperate}
              isSavingBrand={isSavingBrand}
              isSavingAccount={isSavingAccount}
              isSavingWorkbook={isSavingWorkbook}
              onCreateBrand={createBrandAccount}
              onUpdateBrand={updateBrandAccount}
              onDeactivateBrand={deactivateBrandAccount}
              onSyncAccount={syncSingleAccount}
              onSaveMetricoolAccount={saveAccountMetricoolCredentials}
              onDisconnectMetricoolAccount={disconnectAccountMetricool}
              onSaveBrandWorkbook={saveBrandWorkbook}
              onDownloadBrandWorkbook={downloadWorkbookCopy}
              onSaveBrandQaWorkbook={saveBrandQaWorkbook}
              onDownloadBrandQaTemplate={downloadQaTemplate}
              onAddBrandResource={createBrandResource}
              onDeleteBrandResource={deleteBrandResource}
              onToggleAutomation={(account, enabled) =>
                toggleAccountAutomation(account.id, enabled)
              }
            />
          </div>
        ) : null}
        {view === "settings" ? (
          <div className="content-page">
            <SettingsView
              isRunningDiagnostics={isRunning}
              isSaving={isSavingSettings}
              canRunDiagnostics={canOperate}
              canConfigureIntegrations={canAdmin}
              canEditSettings={canSupervise}
              canEnableAutomaticReplies={canAdmin}
              automationSettings={visibleData.automationSettings}
              integrations={visibleData.integrations}
              environmentChecks={visibleData.environmentChecks}
              requirements={visibleData.requirements}
              onRunDiagnostics={() => execute("sync")}
              onConfigureIntegration={(integration) =>
                setToast({ tone: "warning", title: `Configurar ${integration.name}`, detail: integration.detail })
              }
              onSaveAutomationSettings={saveSettings}
              onOpenRequirement={(requirement) =>
                setToast({ tone: requirement.complete ? "success" : "warning", title: requirement.label, detail: requirement.description })
              }
            />
          </div>
        ) : null}
      </main>

      {detailPresentation === "panel" ? (
        <InteractionDetailPanel
          detail={selectedInteractionDetail}
          actor={visibleData.actor}
          statusReasons={visibleData.statusReasons}
          isLoading={isLoadingDetail}
          isSaving={isMutatingInteraction || isRunning}
          onClose={view === "manual-inbox"
            ? () => setDetailPresentation("embedded")
            : closeInteractionDetail}
          onSaveDraft={saveDetailDraft}
          onDeleteDraft={clearDetailDraft}
          onSendReply={async (detail, text) => { await sendDetailReply(detail, text); }}
          onReconcileDelivery={reconcileDetailDelivery}
          onResolve={async (detail, reasonCode, reasonNote) => { await resolveInteraction(detail, reasonCode, reasonNote); }}
          onEscalate={async (detail, reasonCode, reasonNote) => { await escalateInteraction(detail, reasonCode, reasonNote); }}
          onChangeAssignment={changeInteractionAssignment}
          onAddInternalNote={addInternalNote}
        />
      ) : null}

      {toast ? (
        <div className={`app-toast ${toast.tone}`} role="status">
          {toast.tone === "success" ? <CheckCircle size={22} weight="fill" /> : <WarningCircle size={22} weight="fill" />}
          <div><strong>{toast.title}</strong><span>{toast.detail}</span></div>
          <button className="icon-button" onClick={() => setToast(null)} aria-label="Cerrar aviso">×</button>
        </div>
      ) : null}
    </div>
  );
}
