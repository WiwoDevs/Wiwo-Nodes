import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  Bell,
  Buildings,
  CaretDown,
  ChartLineUp,
  ChatCircleDots,
  ChatCircleText,
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
  Moon,
  Play,
  SidebarSimple,
  SquaresFour,
  UsersThree,
  Sun,
  TestTube,
  WarningCircle,
} from "@phosphor-icons/react";
import { AccountsView } from "./components/AccountsView";
import { DashboardView } from "./components/DashboardView";
import { InteractionDetailPanel } from "./components/InteractionDetailPanel";
import { InteractionsView } from "./components/InteractionsView";
import { ManualManagementView } from "./components/ManualManagementView";
import { SettingsView } from "./components/SettingsView";
import { UsersRolesView } from "./components/UsersRolesView";
import { can, type Permission } from "./lib/permissions";
import { isExpired, needsAction } from "./lib/reply-window";
import { ProfileMenu } from "./components/ProfileMenu";
import { ExportDialog, type ExportFilters } from "./components/ExportDialog";
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
  importMetricoolBrands,
  archiveExpiredInteractions,
  deleteInteractionDraft,
  disconnectMetricoolAccount,
  downloadBrandWorkbook,
  downloadBrandQaTemplate,
  downloadExport,
  evaluateSacProtocol,
  loadInboxData,
  loadInboxRevision,
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
import { useTheme } from "./lib/theme";
import type { BrandAccount, BrandAdminInput, BrandResourceKind, Interaction, InteractionDetail, ManualPostSummary, MetricoolInstagramProvider, ReplyDelivery, SessionActor } from "./types";
import { confirmAction } from "./lib/confirm";
import { ConfirmHost } from "./components/ConfirmHost";

const WorkflowCanvas = lazy(() =>
  import("./components/WorkflowCanvas").then((module) => ({ default: module.WorkflowCanvas })),
);
const AutomationPlatform = lazy(() =>
  import("./components/AutomationPlatform").then((module) => ({ default: module.AutomationPlatform })),
);

type ViewId = "platform-home" | "automations" | "automation-executions" | "templates" | "credentials" | "workflow" | "dashboard" | "interactions" | "manual-dms" | "manual-comments" | "accounts" | "users" | "settings";
type EditorTab = "editor" | "executions" | "evaluations";

/** Vistas de respuesta por cuenta. Comparten componente y difieren solo en la superficie. */
const MANUAL_VIEWS = ["manual-dms", "manual-comments"] as const;
type ManualViewId = (typeof MANUAL_VIEWS)[number];

function isManualView(value: ViewId): value is ManualViewId {
  return (MANUAL_VIEWS as readonly string[]).includes(value);
}

/** Red de seguridad: descarga completa de la bandeja al menos cada 5 minutos. */
const INBOX_FULL_RELOAD_MS = 5 * 60_000;

const navigation = [
  { id: "platform-home" as const, label: "Inicio", icon: House, group: "Operación SAC" },
  { id: "interactions" as const, label: "Bandeja SAC", icon: ChatCircleDots, badge: "0", group: "Operación SAC" },
  { id: "manual-dms" as const, label: "Gestión DMs", icon: ChatsCircle, group: "Operación SAC" },
  { id: "manual-comments" as const, label: "Gestión comentarios", icon: ChatCircleText, group: "Operación SAC" },
  { id: "dashboard" as const, label: "Resumen SAC", icon: ChartLineUp, group: "Operación SAC" },
  { id: "workflow" as const, label: "Flujo SAC", icon: GitBranch, group: "Operación SAC" },
  { id: "accounts" as const, label: "Cuentas", icon: Buildings, badge: "0", group: "Operación SAC" },
  // railLabel: guiones suaves (\\u00AD) donde partir las palabras más anchas que el riel; no
  // depende del diccionario de guionado del navegador.
  { id: "automations" as const, label: "Automatización", railLabel: "Automati\u00ADzación", icon: Lightning, group: "Automatización" },
  { id: "automation-executions" as const, label: "Ejecuciones", icon: ClockCounterClockwise, group: "Automatización" },
  { id: "templates" as const, label: "Plantillas", icon: SquaresFour, group: "Automatización" },
  { id: "credentials" as const, label: "Credenciales", railLabel: "Creden\u00ADciales", icon: Key, group: "Automatización", adminOnly: true },
  { id: "users" as const, label: "Usuarios", icon: UsersThree, group: "Sistema", adminOnly: true },
  { id: "settings" as const, label: "Configuración", railLabel: "Configu\u00ADración", icon: GearSix, group: "Sistema" },
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
    description: "Rendimiento de todas las marcas en un solo lugar",
  },
  interactions: {
    title: "Bandeja SAC",
    description: "Una bandeja por persona con todo su contexto",
  },
  "manual-dms": {
    title: "Gestión de mensajes directos",
    description: "Conversaciones privadas por contacto, con su historial completo",
  },
  "manual-comments": {
    title: "Gestión de comentarios",
    description: "Comentarios agrupados por publicación, con el contexto del post",
  },
  accounts: {
    title: "Cuentas conectadas",
    description: "Marcas, canales y estado de sincronización",
  },
  users: {
    title: "Usuarios y roles",
    description: "Quién entra a Nodes y qué puede hacer",
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

export function App({ onSignOut, sessionActor }: {
  onSignOut?: () => Promise<void>;
  /** Usuario ya validado por el inicio de sesión: se muestra mientras cargan los datos. */
  sessionActor?: SessionActor | null;
} = {}) {
  const [view, setView] = useState<ViewId>("platform-home");
  const [editorTab, setEditorTab] = useState<EditorTab>("editor");
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isExportOpen, setExportOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [isRunning, setIsRunning] = useState(false);
  const [executions, setExecutions] = useState<RunResult[]>([]);
  const [isLoadingExecutions, setLoadingExecutions] = useState(false);
  const [workflowValidation, setWorkflowValidation] = useState<WorkflowValidation | null>(null);
  const [workflowEditorStatus, setWorkflowEditorStatus] = useState<WorkflowEditorStatus>("locked");
  const [operationalData, setOperationalData] = useState<OperationalData | null>(null);
  const [isLoadingData, setLoadingData] = useState(true);
  const [isRefreshingInbox, setRefreshingInbox] = useState(false);
  const [lastInboxRefreshAt, setLastInboxRefreshAt] = useState<string | undefined>();
  // Última vez que la vista confirmó estar al día (con o sin descarga nueva).
  const [inboxCheckedAt, setInboxCheckedAt] = useState<string | undefined>();
  // Revisión del servidor con la que se descargó la bandeja y cuándo fue la descarga completa.
  const inboxRevisionRef = useRef<string | null>(null);
  const lastFullInboxLoadRef = useRef(0);
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
  // Credenciales y variables solo para admin; el servidor tampoco las entrega a otros roles.
  const navIsAdmin = (operationalData?.actor ?? sessionActor)?.role === "admin";
  const navItems = useMemo(
    () =>
      navigation.filter((item) => !("adminOnly" in item) || navIsAdmin).map((item) => {
        if (item.id === "interactions") {
          const pending = operationalData?.interactions.filter((interaction) => interaction.status === "pending" || interaction.status === "needs_review").length;
          return { ...item, badge: operationalData ? String(pending) : "…" };
        }
        if (item.id === "accounts") {
          const withAlerts = operationalData?.accounts.filter((account) =>
            account.brandActive !== false && account.accountActive !== false && account.health !== "healthy").length;
          return { ...item, badge: operationalData ? String(withAlerts) : "…" };
        }
        return item;
      }),
    [navIsAdmin, operationalData],
  );
  const activeNav = useMemo(() => navItems.find((item) => item.id === view), [navItems, view]);
  // Mientras la operación carga (o si falla), el perfil sale de la sesión ya validada y no
  // del marcador "API no conectada".
  const visibleData = operationalData
    ?? (sessionActor ? { ...emptyOperationalData, actor: sessionActor } : emptyOperationalData);
  // Solo marcas operativas: las desactivadas (p. ej. las de ejemplo retiradas en live) no son
  // alertas ni se seleccionan para operar; siguen en Cuentas para poder reactivarlas.
  const operationalAccounts = useMemo(
    () => visibleData.accounts.filter((account) => account.brandActive !== false && account.accountActive !== false),
    [visibleData.accounts],
  );
  const selectedManualAccount = visibleData.accounts.find((account) => account.id === manualAccountId);
  /** Casos por atender por cuenta y superficie: en plazo y total (para el selector de cuenta). */
  const manualPendingCounts = useMemo(() => {
    const counts: Record<"dm" | "comment", Record<string, { inWindow: number; total: number }>> = { dm: {}, comment: {} };
    const now = Date.now();
    for (const interaction of visibleData.interactions) {
      if (!needsAction(interaction) || (interaction.kind !== "dm" && interaction.kind !== "comment")) continue;
      const bucket = counts[interaction.kind][interaction.accountId] ??= { inWindow: 0, total: 0 };
      bucket.total += 1;
      if (!isExpired(interaction, now)) bucket.inWindow += 1;
    }
    return counts;
  }, [visibleData.interactions]);
  // La cuenta inicial la elige la app (la de más trabajo en plazo) una sola vez, cuando llegan
  // los datos; después nunca la cambia sola (no debe mover a nadie a mitad de una respuesta).
  const manualAccountSettled = useRef(false);
  /** Orden visible de la Bandeja SAC (filtros y orden aplicados), para "siguiente caso". */
  const inboxOrderRef = useRef<Interaction[]>([]);
  const rememberInboxOrder = useCallback((interactions: Interaction[]) => { inboxOrderRef.current = interactions; }, []);
  /** Orden de la bandeja al abrir el caso: si se resuelve y sale de la lista, "siguiente" sigue siendo su vecino. */
  const navSnapshotRef = useRef<string[]>([]);
  const manualInteractions = useMemo(() => {
    if (!manualAccountId) return [];
    return visibleData.interactions.filter((interaction) => interaction.accountId === manualAccountId);
  }, [manualAccountId, visibleData.interactions]);
  const selectedContactKey = selectedInteractionDetail?.contactKey
    ?? visibleData.interactions.find((interaction) => interaction.id === selectedInteractionId)?.contactKey
    ?? null;
  // Los controles siguen los permisos del rol; el servidor vuelve a validar cada acción.
  const allowed = (permission: Permission) => !connectionIssue && can(visibleData.actor, permission);
  const canOperate = allowed("inbox.reply");
  const canSync = allowed("sync.run");
  const canExport = allowed("export.xlsx");
  const canEditWorkflow = allowed("workflow.edit");
  const canRunAutomations = allowed("automations.run");
  const canEditAutomations = allowed("automations.edit");
  const canReadMetrics = allowed("metrics.read");
  const canManageBrands = allowed("brands.manage");
  const canAdmin = !connectionIssue && visibleData.actor.role === "admin";
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
        // La revisión se lee antes que los datos: si algo cambia durante la descarga, la
        // próxima consulta verá otra revisión y volverá a cargar (nunca se pierde un cambio).
        const revision = await loadInboxRevision().catch(() => null);
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
        setInboxCheckedAt(data.loadedAt);
        inboxRevisionRef.current = revision;
        lastFullInboxLoadRef.current = Date.now();
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

  /**
   * Consulta barata cada 30 s: solo descarga marcas y contactos si la revisión del servidor
   * cambió (sincronización, respuesta, asignación…) o si pasaron 5 minutos (red de seguridad
   * para cambios hechos fuera de la API, como el despachador de respuestas automáticas).
   */
  const checkInboxForChanges = useCallback(async () => {
    const stale = Date.now() - lastFullInboxLoadRef.current > INBOX_FULL_RELOAD_MS;
    if (!stale && inboxRevisionRef.current) {
      try {
        if (await loadInboxRevision() === inboxRevisionRef.current) {
          setInboxCheckedAt(new Date().toISOString());
          return;
        }
      } catch {
        // Sin revisión no hay cómo saber si cambió: se descarga completa.
      }
    }
    await refreshInboxData(false);
  }, [refreshInboxData]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  // Casos nuevos en plazo desde la última vez que la persona miró una bandeja: "(3) Bandeja SAC".
  const [inboxSeenAt, setInboxSeenAt] = useState(() => Date.now());
  const isInboxView = view === "interactions" || isManualView(view);
  useEffect(() => {
    if (!isInboxView) return;
    const markSeen = () => { if (document.visibilityState === "visible") setInboxSeenAt(Date.now()); };
    markSeen();
    document.addEventListener("visibilitychange", markSeen);
    return () => document.removeEventListener("visibilitychange", markSeen);
  }, [isInboxView, lastInboxRefreshAt]);
  const newInboxCount = useMemo(() => {
    const now = Date.now();
    return visibleData.interactions.filter((interaction) =>
      needsAction(interaction)
      && !isExpired(interaction, now)
      && Date.parse(interaction.latestInboundAt ?? interaction.receivedAt) > inboxSeenAt).length;
  }, [inboxSeenAt, visibleData.interactions]);

  useEffect(() => {
    document.title = `${newInboxCount ? `(${newInboxCount}) ` : ""}${page.title} | WIWO.Nodes`;
  }, [newInboxCount, page.title]);

  useEffect(() => {
    void refreshOperationalData();
  }, []);

  useEffect(() => {
    if (!(view === "interactions" || isManualView(view)) || isLoadingData || connectionIssue) return;

    const refreshWhenAvailable = () => {
      if (
        document.visibilityState === "visible"
        && navigator.onLine
        && !isRunning
        && !isMutatingInteraction
      ) {
        void checkInboxForChanges();
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
  }, [checkInboxForChanges, connectionIssue, isLoadingData, isMutatingInteraction, isRunning, view]);

  useEffect(() => {
    if (view !== "manual-comments" || !manualAccountId || !selectedManualAccount || connectionIssue) return;
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
      view !== "manual-comments"
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
    const accounts = (operationalData?.accounts ?? []).filter((account) =>
      account.brandActive !== false && account.accountActive !== false);
    if (accounts.length === 0) {
      if (manualAccountId !== null) setManualAccountId(null);
      return;
    }
    const current = manualAccountId && accounts.some((account) => account.id === manualAccountId);
    if (current && manualAccountSettled.current) return;
    // Por defecto, la cuenta con más casos en plazo de la superficie que se está viendo (DMs o
    // comentarios), igual que el orden del selector; luego la de más pendientes.
    const surface = view === "manual-comments" ? "comment" : "dm";
    const score = (accountId: string) => {
      const counts = manualPendingCounts[surface][accountId];
      return [counts?.inWindow ?? 0, counts?.total ?? 0] as const;
    };
    const best = [...accounts].sort((left, right) => {
      const [leftWindow, leftTotal] = score(left.id);
      const [rightWindow, rightTotal] = score(right.id);
      return rightWindow - leftWindow || rightTotal - leftTotal;
    })[0]!;
    if (best.id !== manualAccountId) setManualAccountId(best.id);
    if (operationalData?.interactions.length) manualAccountSettled.current = true;
  }, [manualAccountId, manualPendingCounts, operationalData?.accounts, operationalData?.interactions.length, view]);

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

  /** Archiva como histórico los casos fuera de plazo, previa vista previa y confirmación. */
  async function archiveExpired(scope: { accountId?: string; type?: "dm" | "comment" }) {
    try {
      const preview = await archiveExpiredInteractions({ ...scope, dryRun: true });
      if (!preview.eligible) {
        setToast({
          tone: "warning",
          title: "Nada para archivar",
          detail: preview.skippedSensitive
            ? `Los ${preview.skippedSensitive} casos fuera de plazo son sensibles y quedan para revisión humana.`
            : "No hay casos fuera de plazo con estos filtros.",
        });
        return;
      }
      const format = new Intl.NumberFormat("es-CL").format;
      const confirmed = await confirmAction({
        title: `¿Archivar ${format(preview.eligible)} casos fuera de plazo como histórico?`,
        message: "Se cierran en Nodes con el motivo «Fuera de plazo de respuesta». No se borra ni se envía nada a Metricool, "
          + "y se pueden reabrir cambiando su estado."
          + (preview.skippedSensitive ? `\n\n${format(preview.skippedSensitive)} casos sensibles quedan sin archivar para revisión humana.` : ""),
        confirmLabel: "Archivar",
      });
      if (!confirmed) return;
      const result = await archiveExpiredInteractions({ ...scope, dryRun: false });
      setToast({
        tone: "success",
        title: "Casos archivados",
        detail: `${format(result.archived)} casos fuera de plazo quedaron como histórico.${result.skippedSensitive ? ` ${format(result.skippedSensitive)} sensibles siguen en revisión.` : ""}`,
      });
      await refreshInboxData(true);
    } catch (error) {
      setToast({ tone: "warning", title: "No se pudo archivar", detail: error instanceof Error ? error.message : "Error desconocido." });
    }
  }

  async function refreshOperationalData() {
    setLoadingData(true);
    try {
      const revision = await loadInboxRevision().catch(() => null);
      const data = await loadOperationalData();
      setOperationalData(data);
      const loadedAt = new Date().toISOString();
      setLastInboxRefreshAt(loadedAt);
      setInboxCheckedAt(loadedAt);
      inboxRevisionRef.current = revision;
      lastFullInboxLoadRef.current = Date.now();
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

  /** Abre el diálogo de exportación (período y marca). */
  function exportExcel() {
    setExportOpen(true);
  }

  async function runExport(filters: ExportFilters) {
    await downloadExport(filters);
    setToast({ tone: "success", title: "Excel generado", detail: "La descarga incluye detalle y resumen por marca." });
  }

  async function openInteractionDetail(
    interaction: Interaction,
    presentation: "panel" | "embedded" = "panel",
  ) {
    const requestSequence = ++detailRequestSequence.current;
    selectedInteractionIdRef.current = interaction.id;
    if (inboxOrderRef.current.some((candidate) => candidate.id === interaction.id)) {
      navSnapshotRef.current = inboxOrderRef.current.map((candidate) => candidate.id);
    }
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

  /** Asigna a la persona en sesión el caso en plazo que vence antes y lo abre de inmediato. */
  async function takeNextCase(interaction: Interaction) {
    if (isMutatingInteraction || isRunning || interaction.version === undefined) return;
    setMutatingInteraction(true);
    try {
      await updateInteractionAssignment(interaction.id, interaction.version, "claim");
      setToast({ tone: "success", title: "Caso tomado", detail: `${interaction.customerName} quedó asignado a ti.` });
      void openInteractionDetail(interaction);
      void refreshInboxData(false);
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo tomar el caso",
        detail: error instanceof Error ? `${error.message} Actualiza la bandeja e intenta con el siguiente.` : "Actualiza la bandeja e intenta nuevamente.",
      });
      void refreshInboxData(false);
    } finally {
      setMutatingInteraction(false);
    }
  }

  /** Abre el caso anterior o siguiente según el orden visible de la bandeja. */
  function adjacentCase(currentId: string | null, direction: 1 | -1): Interaction | undefined {
    const snapshot = navSnapshotRef.current;
    const visible = new Map(inboxOrderRef.current.map((interaction) => [interaction.id, interaction]));
    let index = currentId ? snapshot.indexOf(currentId) : -1;
    if (index < 0) return undefined;
    for (index += direction; index >= 0 && index < snapshot.length; index += direction) {
      const candidate = visible.get(snapshot[index]!);
      if (candidate) return candidate;
    }
    return undefined;
  }

  function openAdjacentCase(direction: 1 | -1) {
    const target = adjacentCase(selectedInteractionIdRef.current, direction);
    if (target) void openInteractionDetail(target);
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

  async function importBrandsFromMetricool(blogIds: string[], instagramProvider: MetricoolInstagramProvider) {
    const result = await importMetricoolBrands(blogIds, instagramProvider);
    await refreshOperationalData();
    setToast({
      tone: "success",
      title: `${result.created.length} marca(s) importada(s) desde Metricool`,
      detail: result.skipped.length
        ? `${result.skipped.length} omitida(s). Los mensajes llegan con la próxima sincronización.`
        : "Los mensajes llegan con la próxima sincronización.",
    });
    return result;
  }

  async function deactivateBrandAccounts(accounts: BrandAccount[]) {
    const failed: string[] = [];
    for (const account of accounts) {
      try {
        await deactivateBrand(account.brandId ?? account.id);
      } catch {
        failed.push(account.name);
      }
    }
    await refreshOperationalData();
    setToast(failed.length
      ? { tone: "warning", title: `No se pudieron desactivar ${failed.length} marca(s)`, detail: failed.join(", ") }
      : { tone: "success", title: `${accounts.length} marca(s) desactivada(s)`, detail: "No se borró historial; dejan de sincronizar y de aparecer en la operación." });
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
        detail: "No se borró historial; deja de sincronizar y no se volverá a vincular automáticamente.",
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

  async function navigateToView(destination: ViewId) {
    if (
      isManualView(view)
      && destination !== view
      && manualDraftDirty
      && !(await confirmAction({
        title: "¿Salir sin guardar la respuesta?",
        message: "Hay una respuesta manual sin guardar. Si sales, se descartan esos cambios locales.",
        confirmLabel: "Salir y descartar",
        cancelLabel: "Seguir editando",
        tone: "danger",
      }))
    ) {
      return;
    }
    if (isManualView(view) && destination !== view) {
      setManualDraftDirty(false);
      closeInteractionDetail();
    } else if (isManualView(destination) && view !== destination) {
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
                    <span>{"railLabel" in item ? item.railLabel : item.label}</span>
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
            <span><strong>MGC · Operaciones</strong><small>{isLoadingData ? "Cargando espacio" : `${operationalAccounts.length} marcas · SAC principal`}</small></span>
            <CaretDown size={14} />
          </button>
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
            <button className="icon-button theme-toggle" aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"} title={theme === "dark" ? "Modo claro" : "Modo oscuro"} onClick={toggleTheme}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
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
                    disabled={!canEditWorkflow || isSavingSettings}
                    aria-label={isActive ? "Pausar workflow SAC" : "Activar workflow SAC"}
                    title={!canEditWorkflow ? "Tu rol no permite ajustar el flujo SAC" : undefined}
                  ><span /></button>
                </div>
                <button className="button secondary test-button" onClick={() => execute("sync")} disabled={isRunning || !canSync} title={!canSync ? "Tu rol no permite actualizar desde Metricool" : undefined}>
                  <TestTube size={17} /> Probar
                </button>
                <button className="button primary" onClick={() => execute("run")} disabled={isRunning || !canRunAutomations} title={!canRunAutomations ? "Tu rol no permite ejecutar el flujo" : undefined}>
                  {isRunning ? <ArrowsClockwise className="spin" size={17} /> : <Play size={17} weight="fill" />}
                  {isRunning ? "Ejecutando" : "Ejecutar flujo"}
                </button>
              </>
            ) : null}
            <ProfileMenu actor={visibleData.actor} onSignOut={onSignOut} />
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
                    canEdit={canEditWorkflow}
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
              canAdmin={canEditAutomations}
              canOperate={canRunAutomations}
              canSupervise={canReadMetrics}
              accounts={operationalAccounts}
              interactions={visibleData.interactions}
              sacWorkflow={visibleData.workflow}
              isOperationalLoading={isLoadingData}
              onNavigate={(destination) => setView(destination)}
              onOpenInteraction={openInteractionDetail}
              onToast={showPlatformToast}
              userName={visibleData.actor.displayName}
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
              canSync={canSync}
              canExport={canExport}
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
              accounts={operationalAccounts}
              canWrite={canOperate}
              canSync={canSync}
              canExport={canExport}
              isRefreshing={isRunning || isMutatingInteraction || isRefreshingInbox}
              lastUpdatedAt={inboxCheckedAt ?? lastInboxRefreshAt}
              refreshIssue={inboxRefreshIssue}
              inboxSync={visibleData.inboxSync}
              onRefresh={refreshInboxNow}
              onProcessProtocol={() => processSacProtocol()}
              onExport={exportExcel}
              onOpenInteraction={openInteractionDetail}
              onSendAutomaticResponse={createDraft}
              onSendAutomaticResponses={createDrafts}
              onResolveInteraction={(interaction) => { void resolveInteraction(interaction, "answered"); }}
              canArchiveExpired={allowed("inbox.archive_expired")}
              onArchiveExpired={archiveExpired}
              currentUserId={visibleData.actor.userId}
              canAssign={allowed("inbox.assign")}
              onTakeNext={takeNextCase}
              onVisibleOrderChange={rememberInboxOrder}
            />
          </div>
        ) : null}
        {isManualView(view) ? (
          <div className="content-page content-page--manual-inbox">
            <ManualManagementView
              surfaceKind={view === "manual-comments" ? "comment" : "dm"}
              // Solo cuentas operativas: una marca desactivada no debe poder seleccionarse
              // para responder. Sigue apareciendo en Cuentas para poder reactivarla.
              accounts={operationalAccounts}
              pendingCounts={manualPendingCounts[view === "manual-comments" ? "comment" : "dm"]}
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
              canRefresh={canSync}
              lastUpdatedAt={inboxCheckedAt ?? lastInboxRefreshAt}
              refreshIssue={manualCommentsIssue || inboxRefreshIssue}
              statusReasons={visibleData.statusReasons}
              onSelectAccount={(account) => {
                manualAccountSettled.current = true;
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
              canAdmin={canManageBrands}
              canSync={canSync}
              isSavingBrand={isSavingBrand}
              isSavingAccount={isSavingAccount}
              isSavingWorkbook={isSavingWorkbook}
              onCreateBrand={createBrandAccount}
              onUpdateBrand={updateBrandAccount}
              onDeactivateBrand={deactivateBrandAccount}
              onImportMetricoolBrands={importBrandsFromMetricool}
              onDeactivateBrands={deactivateBrandAccounts}
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
        {view === "users" && navIsAdmin ? (
          <div className="content-page">
            <UsersRolesView onToast={showPlatformToast} />
          </div>
        ) : null}
        {view === "settings" ? (
          <div className="content-page">
            <SettingsView
              isRunningDiagnostics={isRunning}
              isSaving={isSavingSettings}
              canRunDiagnostics={canOperate}
              canConfigureIntegrations={canAdmin}
              canEditSettings={canEditWorkflow}
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
      {isExportOpen ? (
        <ExportDialog accounts={visibleData.accounts} onClose={() => setExportOpen(false)} onExport={runExport} />
      ) : null}

      {detailPresentation === "panel" ? (
        <InteractionDetailPanel
          detail={selectedInteractionDetail}
          actor={visibleData.actor}
          statusReasons={visibleData.statusReasons}
          isLoading={isLoadingDetail}
          isSaving={isMutatingInteraction || isRunning}
          onClose={isManualView(view)
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
          onNavigate={view === "interactions" ? openAdjacentCase : undefined}
          navigation={view === "interactions" ? {
            hasPrevious: Boolean(adjacentCase(selectedInteractionId, -1)),
            hasNext: Boolean(adjacentCase(selectedInteractionId, 1)),
          } : undefined}
        />
      ) : null}

      <ConfirmHost />

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
