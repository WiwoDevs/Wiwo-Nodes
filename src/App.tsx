import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  Bell,
  Buildings,
  ChartLineUp,
  PresentationChart,
  ChatCircleDots,
  ChatCircleText,
  ChatsCircle,
  CheckCircle,
  ClockCounterClockwise,
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
import { ReportsView } from "./components/ReportsView";
import { InteractionDetailPanel } from "./components/InteractionDetailPanel";
import { InteractionsView, type InteractionsViewProps } from "./components/InteractionsView";
import { ManualManagementView } from "./components/ManualManagementView";
import { SettingsView } from "./components/SettingsView";
import { UsersRolesView } from "./components/UsersRolesView";
import { can, type Permission } from "./lib/permissions";
import { isExpired, needsAction } from "./lib/reply-window";
import { ProfileMenu } from "./components/ProfileMenu";
import { ExportDialog, type ExportFilters } from "./components/ExportDialog";
import type { WorkflowEditorStatus } from "./components/WorkflowCanvas";
import type { AutomationSection } from "./components/AutomationPlatform";
import {
  addInteractionInternalNote,
  INBOX_STREAM_URL,
  loadInboxChanges,
  markContactsTriage,
  setInteractionTriage,
  addBrandResource,
  connectBrandQaWorkbook,
  connectBrandWorkbook,
  createBrand,
  deactivateBrand,
  liveSyncAccount,
  setBrandVisibility,
  importMetricoolBrands,
  archiveExpiredInteractions,
  discardNoiseInteractions,
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
import { useSidebarMode } from "./lib/sidebar";
import { playToastSound } from "./lib/brand-sounds";
import { SoundToggle } from "./components/SoundToggle";
import { HelpAssistant } from "./components/HelpAssistant";
import type { BrandAccount, BrandAdminInput, BrandResourceKind, Interaction, InteractionDetail, ManualPostSummary, MetricoolInstagramProvider, ReplyDelivery, SessionActor } from "./types";
import { confirmAction } from "./lib/confirm";
import { useMinuteTick } from "./lib/use-minute-tick";
import { ConfirmHost } from "./components/ConfirmHost";
import { OrbLoader, BusyOrb } from "./components/ThinkingOrb";

const WorkflowCanvas = lazy(() =>
  import("./components/WorkflowCanvas").then((module) => ({ default: module.WorkflowCanvas })),
);
const AutomationPlatform = lazy(() =>
  import("./components/AutomationPlatform").then((module) => ({ default: module.AutomationPlatform })),
);

type ViewId = "platform-home" | "automations" | "automation-executions" | "templates" | "credentials" | "workflow" | "dashboard" | "reports" | "interactions" | "manual-dms" | "manual-comments" | "accounts" | "users" | "settings";
type EditorTab = "editor" | "executions" | "evaluations";

/** Vistas de respuesta por cuenta. Comparten componente y difieren solo en la superficie. */
const MANUAL_VIEWS = ["manual-dms", "manual-comments"] as const;
type ManualViewId = (typeof MANUAL_VIEWS)[number];

function isManualView(value: ViewId): value is ManualViewId {
  return (MANUAL_VIEWS as readonly string[]).includes(value);
}

/**
 * Red de seguridad: descarga completa cada 10 minutos (cambios hechos fuera de la API, como
 * el despachador automático del worker). Lo demás llega en vivo.
 */
const INBOX_FULL_RELOAD_MS = 10 * 60_000;
/** Sin avisos en vivo (proxy que los retiene), se pregunta por cambios cada 10 s. */
const INBOX_FALLBACK_POLL_MS = 10_000;
/** Cada cuánto se lee en Metricool la cuenta abierta en Gestión DMs/comentarios. */
const LIVE_SYNC_INTERVAL_MS = 15_000;

/** Reemplaza las filas que cambiaron (por persona) y agrega las nuevas al principio. */
function mergeInboxRows(current: Interaction[], changed: Interaction[]): Interaction[] {
  const byKey = new Map(changed.map((row) => [row.contactKey, row]));
  const merged = current.map((row) => {
    const next = row.contactKey ? byKey.get(row.contactKey) : undefined;
    if (!next) return row;
    byKey.delete(row.contactKey!);
    return next;
  });
  return byKey.size ? [...byKey.values(), ...merged] : merged;
}

const navigation = [
  { id: "platform-home" as const, label: "Inicio", icon: House, group: "Operación SAC" },
  { id: "interactions" as const, label: "Bandeja SAC", icon: ChatCircleDots, badge: "0", group: "Operación SAC" },
  { id: "manual-dms" as const, label: "Gestión DMs", icon: ChatsCircle, group: "Operación SAC" },
  { id: "manual-comments" as const, label: "Gestión comentarios", railLabel: "Gestión comen\u00ADtarios", icon: ChatCircleText, group: "Operación SAC" },
  { id: "dashboard" as const, label: "Resumen SAC", icon: ChartLineUp, group: "Operación SAC" },
  { id: "reports" as const, label: "Reportes", icon: PresentationChart, group: "Operación SAC" },
  { id: "workflow" as const, label: "Flujo SAC", icon: GitBranch, group: "Operación SAC" },
  { id: "accounts" as const, label: "Cuentas", icon: Buildings, badge: "0", group: "Operación SAC" },
  // railLabel: guiones suaves (\\u00AD) donde partir las palabras más anchas que el riel; no
  // depende del diccionario de guionado del navegador.
  { id: "automations" as const, label: "Automatización", railLabel: "Automati\u00ADzación", icon: Lightning, group: "Automatización" },
  { id: "automation-executions" as const, label: "Ejecuciones", railLabel: "Ejecu\u00ADciones", icon: ClockCounterClockwise, group: "Automatización" },
  { id: "templates" as const, label: "Plantillas", icon: SquaresFour, group: "Automatización" },
  { id: "credentials" as const, label: "Credenciales", railLabel: "Creden\u00ADciales", icon: Key, group: "Automatización", adminOnly: true },
  { id: "users" as const, label: "Usuarios", icon: UsersThree, group: "Sistema", adminOnly: true },
  { id: "settings" as const, label: "Configuración", railLabel: "Configu\u00ADración", icon: GearSix, group: "Sistema" },
];

/**
 * Permisos que muestran cada sección del menú (basta uno). Las que no aparecen aquí las ve
 * todo rol; Credenciales y Usuarios son solo de Admin. Ocultar ordena la pantalla: el
 * servidor vuelve a validar cada acción.
 */
const VIEW_PERMISSIONS: Partial<Record<ViewId, Permission[]>> = {
  dashboard: ["metrics.read"],
  reports: ["metrics.read"],
  workflow: ["workflow.edit", "workflow.publish"],
  accounts: ["brands.manage", "metrics.read"],
  automations: ["automations.edit"],
  "automation-executions": ["automations.edit"],
  templates: ["automations.edit"],
  settings: ["workflow.edit"],
};

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
  reports: {
    title: "Reportes",
    description: "Cifras del informe SAC mensual por marca",
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
    description: "Quién entra a wiwo.sac y qué puede hacer",
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
    <section className="workflow-loading">
      <OrbLoader />
    </section>
  );
}

/** Igual que greetingName del servidor: solo saluda con algo que parezca un nombre real. */
function draftGreetingName(interaction: Interaction): string | undefined {
  const name = interaction.customerName.trim();
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return undefined;
  const handle = interaction.customerHandle.trim().replace(/^@/, "").toLowerCase();
  if (handle && name.toLowerCase() === handle) return undefined;
  const first = words[0]!;
  return /^\p{L}[\p{L}'’-]*$/u.test(first) ? first : undefined;
}

function suggestedDraft(interaction: Interaction): string {
  if (interaction.responseText?.trim()) return interaction.responseText;
  const name = draftGreetingName(interaction);
  const opening = (rest: string) => (name ? `${name}, ${rest}` : `${rest.charAt(0).toUpperCase()}${rest.slice(1)}`);
  if (interaction.sentiment === "negative" || interaction.priority !== "normal") {
    return opening("gracias por escribirnos. Dejamos tu caso registrado para que el equipo SAC lo revise y te responda con el detalle correcto.");
  }
  if (interaction.kind === "comment") {
    return opening("gracias por comentar. Te dejamos la información revisada por nuestro equipo para responderte correctamente.");
  }
  if (interaction.kind === "review") {
    return opening(`gracias por compartir tu experiencia con ${interaction.brandName}. El equipo revisó tu comentario y preparó esta respuesta para aprobación.`);
  }
  return opening("gracias por escribirnos. Revisamos tu consulta y te respondemos por este mismo canal.");
}

/** Aviso flotante. `sound`: true hace sonar un éxito (proceso lento); false silencia un fallo de fondo. */
type AppToast = { tone: "success" | "warning"; title: string; detail: string; sound?: boolean };

export function App({ onSignOut, sessionActor }: {
  onSignOut?: () => Promise<void>;
  /** Usuario ya validado por el inicio de sesión: se muestra mientras cargan los datos. */
  sessionActor?: SessionActor | null;
} = {}) {
  const [view, setView] = useState<ViewId>("platform-home");
  // Filtro que el panel Equipo del Inicio pide a la Bandeja SAC (persona o sin asignar).
  const [inboxFocus, setInboxFocus] = useState<InteractionsViewProps["focus"]>();
  const clearInboxFocus = useCallback(() => setInboxFocus(undefined), []);
  const [editorTab, setEditorTab] = useState<EditorTab>("editor");
  const { isCollapsed: isSidebarCollapsed, toggleSidebar } = useSidebarMode();
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
  const [toast, setToast] = useState<AppToast | null>(null);
  const inboxRefreshPromise = useRef<Promise<boolean> | null>(null);
  const detailRequestSequence = useRef(0);
  const manualCommentsRequestSequence = useRef(0);
  const manualPostCommentsRequestSequence = useRef(0);
  const selectedInteractionIdRef = useRef<string | null>(null);
  const showPlatformToast = useCallback((payload: AppToast) => setToast(payload), []);

  const page = pageTitles[view];
  // Credenciales y variables solo para admin; el servidor tampoco las entrega a otros roles.
  const navActor = operationalData?.actor ?? sessionActor;
  const navIsAdmin = navActor?.role === "admin";
  /** La persona en sesión puede abrir esta sección (menú, accesos directos y navegación). */
  const canSeeView = useCallback((destination: ViewId): boolean => {
    if (!navActor) return destination === "platform-home";
    if (navActor.role === "admin") return true;
    if (navigation.some((item) => item.id === destination && "adminOnly" in item)) return false;
    const required = VIEW_PERMISSIONS[destination];
    return !required || required.some((permission) => can(navActor, permission));
  }, [navActor]);
  // Los plazos de Meta vencen solos: un reloj por minuto recalcula los contadores "en plazo".
  const minuteTick = useMinuteTick();
  // Por atender en plazo, igual que el Inicio: lo vencido ya no es trabajo del día y la Bandeja lo
  // oculta por defecto, así que tampoco cuenta en el menú ni en la campana.
  const inWindowPending = useMemo(
    () => operationalData?.interactions.filter((interaction) => needsAction(interaction) && !isExpired(interaction, minuteTick)).length,
    [operationalData, minuteTick],
  );
  const navItems = useMemo(
    () =>
      navigation.filter((item) => canSeeView(item.id)).map((item) => {
        if (item.id === "interactions") {
          return { ...item, badge: inWindowPending === undefined ? "…" : String(inWindowPending) };
        }
        if (item.id === "accounts") {
          const withAlerts = operationalData?.accounts.filter((account) =>
            account.brandActive !== false && account.accountActive !== false && account.health !== "healthy").length;
          return { ...item, badge: operationalData ? String(withAlerts) : "…" };
        }
        return item;
      }),
    [canSeeView, operationalData, inWindowPending],
  );
  // Si la sección abierta deja de estar permitida (cambio de rol, sesión nueva), vuelve a Inicio.
  useEffect(() => {
    if (navActor && !canSeeView(view)) setView("platform-home");
  }, [canSeeView, navActor, view]);
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
  /** Marcas visibles para la carga manual de TikTok/LinkedIn, por nombre. */
  const manualImportBrands = useMemo(
    () => operationalAccounts
      .map((account) => ({ brandId: account.brandId ?? account.id, name: account.name, handle: account.accountHandle }))
      .sort((left, right) => left.name.localeCompare(right.name, "es")),
    [operationalAccounts],
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
  // Persona del caso abierto: si cambia en vivo, se refresca su detalle.
  const selectedContactKeyRef = useRef<string | null>(null);
  selectedContactKeyRef.current = selectedContactKey;
  // Estado actual para la vista en vivo (sus callbacks no se recrean en cada render).
  const chatFollowRef = useRef({ manual: false, draftDirty: false, presentation: "panel" as "panel" | "embedded" });
  chatFollowRef.current = { manual: isManualView(view), draftDirty: manualDraftDirty, presentation: detailPresentation };
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
  const canImportRecords = allowed("records.import");
  const canAdmin = !connectionIssue && visibleData.actor.role === "admin";
  // Ocultar o mostrar clientes: solo el admin principal del servidor, no uno asignado en la app.
  const canHideBrands = canAdmin && visibleData.actor.masterAdmin === true;
  // Supervisor/Admin ven la carga del equipo y pueden filtrar la bandeja por otra persona.
  const canSeeTeam = canAdmin || canReadMetrics || allowed("inbox.assign_others");

  /**
   * Gestión DMs/comentarios en vivo: mientras la vista está abierta y visible, se lee en
   * Metricool la cuenta abierta cada 15 s (el servidor la limita a una vez cada 10 s por cuenta
   * aunque la miren varias personas). Lo nuevo llega a la pantalla por el aviso en vivo de la
   * bandeja, que también refresca la conversación abierta.
   */
  const [liveCheckedAt, setLiveCheckedAt] = useState<string | null>(null);
  const liveSyncBusyRef = useRef(false);
  const liveAccountId = isManualView(view) && canSync && !connectionIssue ? selectedManualAccount?.id : undefined;
  const liveSurface = view === "manual-comments" ? "comments" : "conversations";
  useEffect(() => {
    setLiveCheckedAt(null);
    if (!liveAccountId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible" || !navigator.onLine || liveSyncBusyRef.current) return;
      liveSyncBusyRef.current = true;
      try {
        const result = await liveSyncAccount(liveAccountId, liveSurface);
        if (!cancelled) setLiveCheckedAt(result.checkedAt ?? result.lastAt ?? new Date().toISOString());
      } catch {
        // Sin red o Metricool ocupado: el próximo intento vuelve a probar, sin avisos molestos.
      } finally {
        liveSyncBusyRef.current = false;
      }
    };
    void tick();
    const intervalId = window.setInterval(() => void tick(), LIVE_SYNC_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [liveAccountId, liveSurface]);
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
  /**
   * Aplica solo lo que cambió desde la última revisión vista: las filas de esas personas se
   * reemplazan y todos los contadores (Inicio, Bandeja, Gestión) se recalculan al instante.
   * Si el servidor no puede decir qué cambió, o pasó la red de seguridad, se recarga completa.
   */
  const inboxChangesRun = useRef<Promise<void> | null>(null);
  const inboxChangesAgain = useRef(false);
  const syncInboxChanges = useCallback(async (): Promise<void> => {
    if (inboxChangesRun.current) {
      inboxChangesAgain.current = true;
      return inboxChangesRun.current;
    }
    const run = (async () => {
      const since = inboxRevisionRef.current;
      const stale = Date.now() - lastFullInboxLoadRef.current > INBOX_FULL_RELOAD_MS;
      if (!since || stale) {
        await refreshInboxData(false);
        return;
      }
      try {
        const changes = await loadInboxChanges(since);
        if (changes.full) {
          await refreshInboxData(false);
          return;
        }
        const at = new Date().toISOString();
        if (changes.interactions.length) {
          setOperationalData((current) => current ? {
            ...current,
            interactions: mergeInboxRows(current.interactions, changes.interactions),
          } : current);
          setLastInboxRefreshAt(at);
          const openKey = selectedContactKeyRef.current;
          const openId = selectedInteractionIdRef.current;
          const openRow = openKey ? changes.interactions.find((row) => row.contactKey === openKey) : undefined;
          if (openId && openRow) {
            // En Gestión DMs/comentarios el chat sigue al cliente: si escribió de nuevo, se pasa a
            // su mensaje nuevo (salvo que haya texto sin enviar, que no se pierde). Si no, se
            // refresca la conversación abierta (p. ej. para mostrar la respuesta del chatbot).
            const follow = chatFollowRef.current;
            if (follow.manual && !follow.draftDirty && openRow.kind === "dm" && openRow.id !== openId && openRow.direction === "inbound") {
              void openInteractionDetail({ id: openRow.id }, follow.presentation);
            } else {
              void refreshInteractionDetail(openId);
            }
          }
        }
        inboxRevisionRef.current = changes.revision;
        setInboxCheckedAt(at);
        setInboxRefreshIssue(null);
      } catch {
        // Sin red o API ocupada: el próximo aviso (o la consulta de respaldo) vuelve a intentar.
      }
    })();
    inboxChangesRun.current = run;
    try {
      await run;
    } finally {
      inboxChangesRun.current = null;
      if (inboxChangesAgain.current) {
        inboxChangesAgain.current = false;
        void syncInboxChangesRef.current();
      }
    }
  }, [refreshInboxData]);
  const syncInboxChangesRef = useRef(syncInboxChanges);
  syncInboxChangesRef.current = syncInboxChanges;

  useEffect(() => {
    if (!toast) return;
    // Soundbranding: el aviso de un proceso lento o de una acción fallida suena (src/lib/brand-sounds.ts).
    playToastSound(toast);
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
    document.title = `${newInboxCount ? `(${newInboxCount}) ` : ""}${page.title} | wiwo.sac`;
  }, [newInboxCount, page.title]);

  useEffect(() => {
    void refreshOperationalData();
  }, []);

  /**
   * Bandeja en vivo, en todas las vistas: el servidor avisa cada cambio por una conexión
   * abierta y se piden solo esos contactos. Si la conexión no llega (un proxy la retiene), se
   * pregunta cada 10 s. Con la pestaña oculta se cierra todo y al volver se pone al día.
   */
  const hasOperationalData = Boolean(operationalData);
  useEffect(() => {
    if (!hasOperationalData || connectionIssue) return;
    let source: EventSource | null = null;
    let lastEventAt = 0;
    let pollId: number | undefined;

    const syncIfVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void syncInboxChangesRef.current();
    };
    const open = () => {
      if (source || typeof EventSource === "undefined" || document.visibilityState !== "visible") return;
      source = new EventSource(INBOX_STREAM_URL);
      source.addEventListener("revision", (event) => {
        lastEventAt = Date.now();
        try {
          const { revision } = JSON.parse((event as MessageEvent<string>).data) as { revision?: string };
          if (revision && revision !== inboxRevisionRef.current) void syncInboxChangesRef.current();
        } catch {
          syncIfVisible();
        }
      });
      // Latido del servidor cada 25 s: la conexión sigue viva aunque no haya cambios.
      source.addEventListener("ping", () => { lastEventAt = Date.now(); });
      source.onopen = () => { lastEventAt = Date.now(); };
    };
    const close = () => {
      source?.close();
      source = null;
    };
    // Respaldo: si no hay conexión en vivo abierta y reciente, se pregunta por cambios.
    pollId = window.setInterval(() => {
      const liveOk = source?.readyState === 1 && Date.now() - lastEventAt < 60_000;
      if (!liveOk) syncIfVisible();
    }, INBOX_FALLBACK_POLL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        open();
        syncIfVisible();
      } else {
        close();
      }
    };

    open();
    syncIfVisible();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", syncIfVisible);
    return () => {
      close();
      window.clearInterval(pollId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", syncIfVisible);
    };
  }, [connectionIssue, hasOperationalData]);


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
      setToast({ tone: "warning", sound: false, title: "No se pudo cargar el historial", detail: error instanceof Error ? error.message : "Revisa la API." });
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
        message: "Se cierran en wiwo.sac con el motivo «Fuera de plazo de respuesta». No se borra ni se envía nada a Metricool, "
          + "y se pueden reabrir cambiando su estado."
          + (preview.skippedSensitive ? `\n\n${format(preview.skippedSensitive)} casos sensibles quedan sin archivar para revisión humana.` : ""),
        confirmLabel: "Archivar",
      });
      if (!confirmed) return;
      const result = await archiveExpiredInteractions({ ...scope, dryRun: false });
      setToast({
        tone: "success", sound: true,
        title: "Casos archivados",
        detail: `${format(result.archived)} casos fuera de plazo quedaron como histórico.${result.skippedSensitive ? ` ${format(result.skippedSensitive)} sensibles siguen en revisión.` : ""}`,
      });
      await refreshInboxData(true);
    } catch (error) {
      setToast({ tone: "warning", title: "No se pudo archivar", detail: error instanceof Error ? error.message : "Error desconocido." });
    }
  }

  /**
   * Descarta en lote lo señalado como spam: primero cuenta, una persona confirma y recién
   * entonces se cierran los casos como «Spam o contenido no válido». No toca Metricool.
   */
  async function discardNoise(scope: { accountId?: string; type?: "dm" | "comment"; postKey?: string }) {
    try {
      const preview = await discardNoiseInteractions({ ...scope, dryRun: true });
      if (!preview.eligible) {
        setToast({
          tone: "warning",
          title: "Nada para descartar",
          detail: preview.skippedSensitive
            ? `Los ${preview.skippedSensitive} casos con posible spam son sensibles y quedan para revisión humana.`
            : "No hay casos abiertos con posible spam en este alcance.",
        });
        return;
      }
      const format = new Intl.NumberFormat("es-CL").format;
      const byRules = preview.byOrigin.reglas ?? 0;
      const byAi = preview.byOrigin.ia ?? 0;
      const origin = [
        byRules ? `${format(byRules)} detectados por reglas (texto repetido, el mismo texto desde varias cuentas, solo etiquetas o spam promocional)` : "",
        byAi ? `${format(byAi)} sugeridos por la IA` : "",
      ].filter(Boolean).join(" y ");
      const confirmed = await confirmAction({
        title: `¿Descartar ${format(preview.eligible)} casos como spam?`,
        message: `${origin}.\n\nSe cierran en wiwo.sac con el motivo «Spam o contenido no válido» y no cuentan como casos en el reporte. `
          + "El comentario sigue publicado en la red: no se borra ni se envía nada a Metricool. Cada caso se puede reabrir."
          + (preview.skippedSensitive ? `\n\n${format(preview.skippedSensitive)} casos sensibles quedan sin descartar para revisión humana.` : ""),
        confirmLabel: "Descartar spam",
        tone: "danger",
      });
      if (!confirmed) return;
      const result = await discardNoiseInteractions({ ...scope, dryRun: false });
      setToast({
        tone: "success", sound: true,
        title: "Spam descartado",
        detail: `${format(result.discarded)} casos quedaron cerrados como spam.${result.skippedSensitive ? ` ${format(result.skippedSensitive)} sensibles siguen en revisión.` : ""}`,
      });
      await refreshInboxData(true);
    } catch (error) {
      setToast({ tone: "warning", title: "No se pudo descartar", detail: error instanceof Error ? error.message : "Error desconocido." });
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
    if (canSeeView("workflow")) setView("workflow");
    try {
      const result = action === "run" ? await runWorkflow() : await syncMetricool();
      setExecutions((current) => [result, ...current.filter((item) => item.executionId !== result.executionId)]);
      if (action === "sync") await refreshOperationalData();
      setToast({
        tone: "success", sound: true,
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
        tone: "success", sound: true,
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
    setToast({ tone: "success", sound: true, title: "Excel generado", detail: "La descarga incluye detalle y resumen por marca." });
  }

  async function openInteractionDetail(
    interaction: Pick<Interaction, "id">,
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
      await syncInboxChanges();
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
      await syncInboxChanges();
      const selectedId = selectedInteractionIdRef.current;
      if (selectedId && interactions.some((interaction) => interaction.id === selectedId)) {
        await refreshInteractionDetail(selectedId);
      }
      setToast({
        tone: "success", sound: true,
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
      await syncInboxChanges();
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
      await syncInboxChanges();
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
      await syncInboxChanges();
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
      await syncInboxChanges();
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
    // Un DM ya respondido sigue abierto como un chat: el mensaje nuevo va a la misma conversación.
    const followUp = detail.kind === "dm" && detail.direction === "inbound" && detail.status === "answered_by_team";
    try {
      await saveInteractionReply(detail.id, text, "send", detail.version, { followUp });
      await syncInboxChanges();
      await refreshInteractionDetail(detail.id);
      setToast({
        tone: "success",
        title: followUp ? "Mensaje enviado" : "Respuesta procesada",
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
      await syncInboxChanges();
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
      await syncInboxChanges();
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

  /**
   * Vuelve a pendiente el mensaje del cliente (el caso cerrado o el último mensaje entrante
   * de esa conversación) y lo deja seleccionado para responderlo.
   */
  async function reopenInteraction(interactionId: string) {
    if (isMutatingInteraction || isRunning) return false;
    setMutatingInteraction(true);
    try {
      const current = await loadInteractionDetail(interactionId);
      await updateInteractionStatus(interactionId, "pending", "reopened", undefined, current.version);
      await syncInboxChanges();
      await openInteractionDetail({ id: interactionId }, detailPresentation);
      setToast({
        tone: "success",
        title: "Caso reabierto",
        detail: "Volvió a pendiente: ya puedes responderlo.",
      });
      return true;
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo reabrir el caso",
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
      void syncInboxChanges();
    } catch (error) {
      setToast({
        tone: "warning",
        title: "No se pudo tomar el caso",
        detail: error instanceof Error ? `${error.message} Actualiza la bandeja e intenta con el siguiente.` : "Actualiza la bandeja e intenta nuevamente.",
      });
      void syncInboxChanges();
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
      await syncInboxChanges();
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

  /** Marca a mano si el mensaje cuenta como caso SAC en el reporte mensual. */
  async function setReportTriage(detail: InteractionDetail, esCasoSac: boolean | null, requiereDerivacion: boolean) {
    if (isMutatingInteraction) return;
    setMutatingInteraction(true);
    try {
      await setInteractionTriage(detail.id, detail.version, esCasoSac, requiereDerivacion);
      await refreshInteractionDetail(detail.id);
      setToast({
        tone: "success",
        title: esCasoSac === null ? "Vuelve a la clasificación automática" : esCasoSac ? "Marcado como caso SAC" : "Marcado como ruido",
        detail: "Cambia cómo cuenta en el reporte mensual; el caso y Metricool no se modifican.",
      });
    } catch (error) {
      await refreshInteractionDetail(detail.id).catch(() => undefined);
      setToast({ tone: "warning", title: "No se pudo guardar la marca", detail: error instanceof Error ? error.message : "Recarga el caso e intenta nuevamente." });
    } finally {
      setMutatingInteraction(false);
    }
  }

  /** Marca en lote las conversaciones elegidas en la Bandeja. */
  async function bulkReportTriage(contactKeys: string[], esCasoSac: boolean) {
    const confirmed = await confirmAction({
      title: `¿Marcar ${contactKeys.length} conversaciones como ${esCasoSac ? "caso SAC" : "ruido"}?`,
      message: `Todos sus mensajes entrantes contarán como ${esCasoSac ? "casos" : "ruido (no casos)"} en el reporte mensual. Los mensajes que alguien ya marcó a mano no se cambian. No modifica los casos ni Metricool.`,
      confirmLabel: esCasoSac ? "Marcar como caso" : "Marcar como ruido",
    });
    if (!confirmed) return false;
    try {
      const result = await markContactsTriage(contactKeys, esCasoSac);
      setToast({ tone: "success", sound: true, title: result.updated === 1 ? "1 mensaje marcado" : `${result.updated} mensajes marcados`, detail: `De ${result.contacts} ${result.contacts === 1 ? "conversación" : "conversaciones"}, como ${esCasoSac ? "caso SAC" : "ruido"} para el reporte.` });
      return true;
    } catch (error) {
      setToast({ tone: "warning", title: "No se pudo marcar en lote", detail: error instanceof Error ? error.message : "Intenta nuevamente." });
      return false;
    }
  }

  async function addInternalNote(detail: InteractionDetail, text: string): Promise<boolean> {
    if (isMutatingInteraction) return false;
    setMutatingInteraction(true);
    try {
      await addInteractionInternalNote(detail.id, text, detail.version);
      await syncInboxChanges();
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
      ? { tone: "warning", title: `No se pudieron ocultar ${failed.length} marca(s)`, detail: failed.join(", ") }
      : { tone: "success", sound: true, title: `${accounts.length} marca(s) oculta(s)`, detail: "No se borró historial; dejan de sincronizar y de aparecer en la operación, Reportes y MetriQ." });
  }

  /** Oculta o vuelve a mostrar un cliente (solo admin principal). */
  async function setBrandAccountHidden(account: BrandAccount, hidden: boolean) {
    if (isSavingBrand) return;
    setSavingBrand(true);
    try {
      await setBrandVisibility(account.brandId ?? account.id, hidden);
      await refreshOperationalData();
      setToast(hidden
        ? {
          tone: "success",
          title: `${account.name} quedó oculto`,
          detail: "Deja de sincronizar y sale de la bandeja, Reportes y MetriQ. Su historial se conserva para cuando vuelvas a mostrarlo.",
        }
        : {
          tone: "success",
          title: `${account.name} está visible de nuevo`,
          detail: "Vuelve a la operación, Reportes y MetriQ; la próxima sincronización lo pone al día.",
        });
    } catch (error) {
      setToast({
        tone: "warning",
        title: hidden ? "No se pudo ocultar el cliente" : "No se pudo mostrar el cliente",
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
        tone: "success", sound: true,
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
        tone: "success", sound: true,
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

  /** "Actualizar cuenta" en Gestión DMs/comentarios: la lectura en vivo, sin esperar la completa. */
  async function refreshManualAccount(account: BrandAccount) {
    if (liveSyncBusyRef.current) return;
    liveSyncBusyRef.current = true;
    setIsRunning(true);
    try {
      const result = await liveSyncAccount(account.id, view === "manual-comments" ? "comments" : "conversations");
      setLiveCheckedAt(result.checkedAt ?? result.lastAt ?? new Date().toISOString());
      await syncInboxChanges();
      if (result.created) {
        setToast({ tone: "success", sound: true, title: `${account.name} al día`, detail: `${result.created} mensaje(s) nuevo(s).` });
      }
    } catch (error) {
      setToast({
        tone: "warning",
        title: `No se pudo actualizar ${account.name}`,
        detail: error instanceof Error ? error.message : "Revisa la API real.",
      });
    } finally {
      liveSyncBusyRef.current = false;
      setIsRunning(false);
    }
  }

  async function navigateToView(destination: ViewId) {
    if (!canSeeView(destination)) return;
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
          <span className="brand-mark" role="img" aria-label="wiwo" />
          <span className="brand-copy"><strong>Operación SAC</strong><small>{isLoadingData ? "Cargando espacio" : `MGC · ${operationalAccounts.length} marcas`}</small></span>
          <button className="icon-button sidebar-toggle" onClick={toggleSidebar} aria-label="Contraer menú" title="Contraer menú" aria-expanded={!isSidebarCollapsed}>
            <SidebarSimple size={18} />
          </button>
        </div>

        <nav className="primary-nav" aria-label="Navegación principal">
          {["Operación SAC", "Automatización", "Sistema"].map((group) => {
            const items = navItems.filter((item) => item.group === group);
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group}>
                <span className="nav-section-label">{group}</span>
                {items.map((item) => {
                  const Icon = item.icon;
                  const isCurrent = view === item.id;
                  return (
                    <button key={item.id} className={isCurrent ? "is-active" : ""} aria-current={isCurrent ? "page" : undefined} onClick={() => navigateToView(item.id)} title={item.label}>
                      <Icon size={19} weight={isCurrent ? "fill" : "regular"} />
                      <span className="nav-label">{item.label}</span>
                      <span className="nav-micro" aria-hidden="true">{"railLabel" in item ? item.railLabel : item.label}</span>
                      {item.badge && item.badge !== "0" ? <small>{item.badge}</small> : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-rail-toggle">
          <button className="icon-button" onClick={toggleSidebar} aria-label="Expandir menú" title="Expandir menú" aria-expanded={!isSidebarCollapsed}>
            <SidebarSimple size={18} />
          </button>
        </div>
      </aside>

      <main className="app-main" id="main-content">
        <header className="topbar">
          <div className="topbar-wordmark">
            <span className="wiwo-logo" role="img" aria-label="wiwo.sac" />
          </div>
          <div className="page-heading">
            <div className="breadcrumb"><span>{activeNav?.label}</span><span>/</span><strong>Operación SAC</strong></div>
            <div>
              <h1>{page.title}</h1>
              <p>{page.description}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <HelpAssistant view={view} viewTitle={page.title} />
            <SoundToggle />
            <button className="icon-button theme-toggle" aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"} title={theme === "dark" ? "Modo claro" : "Modo oscuro"} onClick={toggleTheme}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
            <button className="icon-button" aria-label="Buscar conversaciones" onClick={() => navigateToView("interactions")}><MagnifyingGlass size={19} /></button>
            <button className="icon-button notification-button" aria-label={`Abrir pendientes SAC en plazo: ${inWindowPending ?? 0}`} title="Pendientes en plazo" onClick={() => navigateToView("interactions")}><Bell size={19} />{inWindowPending ? <span /> : null}</button>
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
                  {isRunning ? <BusyOrb /> : <Play size={17} weight="fill" />}
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
                {isOpeningSession ? <BusyOrb /> : <Key size={16} />}
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
                  <BusyOrb />
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
          <Suspense fallback={<section className="platform-loading"><OrbLoader /></section>}>
            <AutomationPlatform
              section={platformSection}
              canAdmin={canEditAutomations}
              canOperate={canRunAutomations}
              canSupervise={canReadMetrics}
              accounts={operationalAccounts}
              interactions={visibleData.interactions}
              sacWorkflow={visibleData.workflow}
              isOperationalLoading={isLoadingData}
              onNavigate={(destination) => { if (canSeeView(destination)) setView(destination); }}
              canOpen={canSeeView}
              homeRole={visibleData.actor.role === "admin" ? "admin" : canSeeTeam ? "supervisor" : "agent"}
              currentUserId={visibleData.actor.userId}
              onTakeNext={allowed("inbox.assign") ? takeNextCase : undefined}
              inboxSync={visibleData.inboxSync}
              automaticRepliesEnabled={visibleData.automationSettings.automaticRepliesEnabled}
              onOpenInteraction={openInteractionDetail}
              onOpenTeamMember={canSeeTeam ? (member) => {
                if (!canSeeView("interactions")) return;
                setInboxFocus({
                  assignment: !member ? "unassigned" : member.userId === visibleData.actor.userId ? "mine" : `user:${member.userId}`,
                  label: member?.displayName,
                });
                setView("interactions");
              } : undefined}
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
              onViewAllAccounts={() => { if (canSeeView("accounts")) setView("accounts"); }}
              onViewAllInteractions={() => setView("interactions")}
              onSelectBrand={() => { if (canSeeView("accounts")) setView("accounts"); }}
              onOpenInteraction={openInteractionDetail}
            />
          </div>
        ) : null}
        {view === "reports" ? (
          <div className="content-page">
            <ReportsView
              canExport={canExport}
              canImportRecords={canImportRecords}
              importBrands={manualImportBrands}
              inboxSync={visibleData.inboxSync}
              onToast={setToast}
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
              canFilterByPerson={canSeeTeam}
              focus={inboxFocus}
              onFocusApplied={clearInboxFocus}
              canAssign={allowed("inbox.assign")}
              onTakeNext={takeNextCase}
              onVisibleOrderChange={rememberInboxOrder}
              canTriage={allowed("inbox.triage")}
              onBulkTriage={bulkReportTriage}
              canDiscardNoise={allowed("inbox.triage") && allowed("inbox.assign_others")}
              onDiscardNoise={discardNoise}
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
              canDiscardNoise={allowed("inbox.triage") && allowed("inbox.assign_others")}
              onDiscardNoise={discardNoise}
              canWrite={canOperate}
              canRefresh={canSync}
              currentUserId={visibleData.actor.userId}
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
              onRefreshAccount={refreshManualAccount}
              liveCheckedAt={canSync ? liveCheckedAt : undefined}
              onSaveDraft={saveDetailDraft}
              onSendReply={sendDetailReply}
              onResolve={resolveInteraction}
              onEscalate={escalateInteraction}
              onReopen={allowed("inbox.triage") ? reopenInteraction : undefined}
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
              canHide={canHideBrands}
              onSetBrandHidden={canHideBrands ? setBrandAccountHidden : undefined}
              onImportMetricoolBrands={importBrandsFromMetricool}
              onDeactivateBrands={canHideBrands ? deactivateBrandAccounts : undefined}
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
          onReopen={reopenInteraction}
          onChangeAssignment={changeInteractionAssignment}
          onAddInternalNote={addInternalNote}
          onSetTriage={setReportTriage}
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
