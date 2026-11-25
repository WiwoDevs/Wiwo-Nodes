import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowSquareOut,
  Buildings,
  ChatCenteredText,
  ChatCircleDots,
  CheckCircle,
  FunnelSimple,
  ImageSquare,
  MagnifyingGlass,
  NotePencil,
  PaperPlaneTilt,
  Sparkle,
  UserFocus,
  UserPlus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type {
  BrandAccount,
  ConversationMessage,
  Interaction,
  InteractionDetail,
  InteractionKind,
  InteractionPostContext,
  ManualPostSummary,
  SocialPlatform,
  StatusReasonCatalog,
} from "../types";
import {
  interactionKindLabel,
  platformLabel,
  SocialPlatformIcon,
} from "./SocialPlatformIcon";
import { ContentContext } from "./ContentContext";
import { PostThumbnail, safeThumbnailUrl } from "./PostThumbnail";
import { ProfileAvatar } from "./ProfileAvatar";
import { AccountFilter } from "./AccountFilter";
import { confirmAction } from "../lib/confirm";
import { ThinkingOrb, BusyOrb } from "./ThinkingOrb";
import { EmojiPicker } from "./EmojiPicker";
import { AiReplySuggestion } from "./AiReplySuggestion";

type ManualSurfaceId = "all" | `${SocialPlatform}:${InteractionKind}`;
type StatusAction = "resolved" | "escalated";

interface ManualSurfaceTab {
  id: ManualSurfaceId;
  platform?: SocialPlatform;
  kind?: InteractionKind;
  label: string;
  count: number;
}

interface ManualInboxEntry {
  key: string;
  contactKey: string;
  target: Interaction;
  latest: Interaction;
  items: Interaction[];
  postKey?: string;
  postId?: string;
  postSortAt?: string;
  postSortSource?: "published_at" | "latest_comment_at";
  messageCount: number;
  pendingCount: number;
  participantCount?: number;
  postSummary?: ManualPostSummary;
}

export interface ManualManagementViewProps {
  /**
   * Superficie que atiende esta vista. Responder un DM y responder un comentario son
   * trabajos distintos: el primero es una conversación privada por contacto, el segundo
   * es público y se agrupa por publicación. Sin valor, la vista muestra ambas.
   */
  surfaceKind?: "dm" | "comment";
  accounts: BrandAccount[];
  /** Casos por atender de esta superficie por cuenta (en plazo y total), para el selector. */
  pendingCounts?: Record<string, { inWindow: number; total: number }>;
  interactions: Interaction[];
  selectedAccountId: string | null;
  selectedInteractionId?: string | null;
  selectedContactKey?: string | null;
  detail: InteractionDetail | null;
  isLoadingDetail?: boolean;
  isSaving?: boolean;
  isRefreshing?: boolean;
  canWrite?: boolean;
  canRefresh?: boolean;
  /** Persona que usa la vista: su caso asignado se muestra como «Tú». */
  currentUserId?: string;
  lastUpdatedAt?: string;
  refreshIssue?: string | null;
  statusReasons: StatusReasonCatalog;
  onSelectAccount: (account: BrandAccount) => void | Promise<void>;
  onSelectInteraction: (interaction: Interaction) => void | Promise<void>;
  onRefreshAccount?: (account: BrandAccount) => void | Promise<void>;
  /** Última lectura en vivo de esta cuenta en Metricool (cada ~15 s mientras la vista está abierta). */
  liveCheckedAt?: string | null;
  onSaveDraft: (detail: InteractionDetail, text: string) => void | Promise<void>;
  onSendReply: (detail: InteractionDetail, text: string) => boolean | Promise<boolean>;
  onResolve: (detail: InteractionDetail, reasonCode: string, reasonNote?: string) => boolean | Promise<boolean>;
  onEscalate: (detail: InteractionDetail, reasonCode: string, reasonNote?: string) => boolean | Promise<boolean>;
  /** Vuelve a pendiente un caso cerrado (p. ej. por un saludo automático) para poder responderlo. */
  onReopen?: (interactionId: string) => boolean | Promise<boolean>;
  onChangeAssignment: (detail: InteractionDetail) => void | Promise<void>;
  onOpenFullDetail?: (interaction: Interaction) => void | Promise<void>;
  onDraftDirtyChange?: (dirty: boolean) => void;
  postSummaries?: ManualPostSummary[];
  selectedPostKey?: string | null;
  postComments?: Interaction[];
  postCommentsPostKey?: string | null;
  isLoadingPosts?: boolean;
  isLoadingPostComments?: boolean;
  onSelectPost?: (post: ManualPostSummary) => void | Promise<void>;
  onClearSelection?: () => void;
  onRetryPostComments?: () => void;
  postCommentsError?: string | null;
  /** Descartar el spam señalado de una publicación (inbox.triage + inbox.assign_others). */
  canDiscardNoise?: boolean;
  onDiscardNoise?: (scope: { accountId?: string; type?: "dm" | "comment"; postKey?: string }) => void | Promise<void>;
}

const PENDING_STATUSES = new Set(["pending", "needs_review"]);

function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es-CL")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

/** Usuario para mostrar bajo el nombre: no se muestra si es un ID numérico o repite el nombre. */
function visibleHandle(handle: string, name: string): string | undefined {
  const clean = handle.replace(/^@/, "");
  if (!clean || /^\d+$/.test(clean)) return undefined;
  return clean.toLocaleLowerCase("es-CL") === name.replace(/^@/, "").toLocaleLowerCase("es-CL") ? undefined : `@${clean}`;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function safeHttpsUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function surfaceKinds(platform: SocialPlatform): InteractionKind[] {
  if (platform === "instagram" || platform === "facebook") return ["dm", "comment"];
  if (platform === "x") return ["dm"];
  if (platform === "google_business") return ["review"];
  return ["comment"];
}

function surfaceLabel(kind: InteractionKind): string {
  if (kind === "dm") return "DMs";
  if (kind === "comment") return "Comentarios";
  return "Reseñas";
}

function interactionIsPending(interaction: Interaction): boolean {
  return PENDING_STATUSES.has(interaction.status)
    || (interaction.conversationSummary?.pendingCount ?? 0) > 0;
}

function isOpenInboundComment(interaction: Interaction): boolean {
  return interaction.kind === "comment"
    && interaction.direction === "inbound"
    && PENDING_STATUSES.has(interaction.status);
}

function interactionPriority(interaction: Interaction): number {
  if (interaction.priority === "urgent") return 3;
  if (interaction.priority === "high") return 2;
  return 1;
}

function chooseReplyTarget(items: Interaction[]): Interaction {
  const isCommentGroup = items.some((interaction) => interaction.kind === "comment");
  const actionable = items.filter((interaction) =>
    (isCommentGroup ? isOpenInboundComment(interaction) : interactionIsPending(interaction))
    && interaction.conversationSummary?.hasReplyTarget !== false);
  if (isCommentGroup && actionable.length) {
    return [...actionable].sort((left, right) =>
      timestamp(left.receivedAt) - timestamp(right.receivedAt)
      || left.id.localeCompare(right.id))[0]!;
  }
  return [...(actionable.length ? actionable : items)].sort((left, right) =>
    interactionPriority(right) - interactionPriority(left)
    || timestamp(right.receivedAt) - timestamp(left.receivedAt)
    || right.id.localeCompare(left.id))[0]!;
}

function publishedAtFor(context?: InteractionPostContext): string | undefined {
  const value = (context as (InteractionPostContext & { publishedAt?: unknown }) | undefined)?.publishedAt;
  return typeof value === "string" && timestamp(value) > 0 ? value : undefined;
}

function buildEntries(interactions: Interaction[], tab: ManualSurfaceTab): ManualInboxEntry[] {
  const groups = new Map<string, Interaction[]>();
  for (const interaction of interactions) {
    if (tab.platform && interaction.platform !== tab.platform) continue;
    if (tab.kind && interaction.kind !== tab.kind) continue;
    const contactKey = interaction.contactKey || interaction.id;
    const isComment = interaction.kind === "comment";
    const postId = isComment ? interaction.postContext?.postId : undefined;
    const key = isComment
      ? postId ? `post\u0000${interaction.platform}\u0000${postId}` : `${contactKey}\u0000comment\u0000${interaction.id}`
      : contactKey;
    const group = groups.get(key) ?? [];
    group.push(interaction);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, items]) => {
    const ordered = [...items].sort((left, right) =>
      timestamp(right.receivedAt) - timestamp(left.receivedAt)
      || right.id.localeCompare(left.id));
    const latest = ordered[0]!;
    const target = chooseReplyTarget(ordered);
    const publishedAt = target.kind === "comment"
      ? ordered.map((interaction) => publishedAtFor(interaction.postContext)).find(Boolean)
      : undefined;
    return {
      key,
      contactKey: target.contactKey || target.id,
      target,
      latest,
      items: ordered,
      postId: target.kind === "comment" ? target.postContext?.postId : undefined,
      postSortAt: publishedAt ?? latest.receivedAt,
      postSortSource: publishedAt ? ("published_at" as const) : ("latest_comment_at" as const),
      messageCount: Math.max(
        ordered.length,
        ...ordered.map((interaction) => interaction.conversationSummary?.messageCount ?? 1),
      ),
      pendingCount: target.kind === "comment"
        ? ordered.filter(isOpenInboundComment).length
        : Math.max(
          ordered.filter(interactionIsPending).length,
          ...ordered.map((interaction) => interaction.conversationSummary?.pendingCount ?? 0),
        ),
    };
  }).sort((left, right) =>
    timestamp(right.postId ? right.postSortAt ?? right.latest.receivedAt : right.latest.receivedAt)
    - timestamp(left.postId ? left.postSortAt ?? left.latest.receivedAt : left.latest.receivedAt)
    || right.latest.id.localeCompare(left.latest.id));
}

function entriesFromPostSummaries(
  summaries: ManualPostSummary[],
  selectedPostKey: string | null,
  selectedPostComments: Interaction[],
): ManualInboxEntry[] {
  return summaries.map((summary) => {
    const loadedItems = summary.postKey === selectedPostKey ? selectedPostComments : [];
    const seedItems = [summary.replyTarget, summary.latestComment]
      .filter((interaction): interaction is Interaction => Boolean(interaction));
    const uniqueItems = [...new Map(
      [...loadedItems, ...seedItems].map((interaction) => [interaction.id, interaction]),
    ).values()];
    const ordered = [...uniqueItems].sort((left, right) =>
      timestamp(left.receivedAt) - timestamp(right.receivedAt)
      || left.id.localeCompare(right.id));
    const target = summary.replyTarget
      ?? ordered.find(isOpenInboundComment)
      ?? summary.latestComment;
    return {
      key: `post-summary\u0000${summary.postKey}`,
      contactKey: target.contactKey || target.id,
      target,
      latest: summary.latestComment,
      items: ordered,
      postKey: summary.postKey,
      postId: summary.postContext.postId,
      postSortAt: summary.sortAt,
      postSortSource: summary.sortSource,
      messageCount: summary.commentCount,
      pendingCount: summary.pendingCount,
      participantCount: summary.participantCount,
      postSummary: summary,
    };
  }).sort((left, right) =>
    timestamp(right.postSortAt ?? right.latest.receivedAt)
    - timestamp(left.postSortAt ?? left.latest.receivedAt)
    || right.key.localeCompare(left.key));
}

function statusLabel(interaction: Interaction): string {
  if (interaction.status === "automated") return "Respondido";
  if (interaction.status === "answered_by_team") return "Respondido por el equipo";
  if (interaction.status === "needs_review") return "Revisión humana";
  if (interaction.status === "resolved") return "Resuelto";
  return "Pendiente";
}

function priorityLabel(priority: Interaction["priority"]): string {
  if (priority === "urgent") return "Urgente";
  if (priority === "high") return "Alta";
  return "Normal";
}

const CONFIRMED_CONVERSATIONS_KEY = "wiwo-nodes:confirmed-conversations";

function readConfirmedConversations(): Set<string> {
  try {
    const stored = JSON.parse(sessionStorage.getItem(CONFIRMED_CONVERSATIONS_KEY) || "[]");
    return new Set(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function detailIsClosed(detail: InteractionDetail): boolean {
  return detail.direction === "outbound"
    || ["answered_by_team", "automated", "resolved"].includes(detail.status);
}

function timelineFor(detail: InteractionDetail): ConversationMessage[] {
  const postId = detail.postContext?.postId;
  const filtered = detail.conversationHistory.filter((message) => {
    if (message.platform !== detail.platform || message.kind !== detail.kind) return false;
    if (detail.kind !== "comment" || !postId) return true;
    return message.postContext?.postId === postId;
  });
  const includesTarget = filtered.some((message) => message.id === detail.id);
  const messages = includesTarget ? filtered : [
    ...filtered,
    {
      id: detail.id,
      direction: detail.direction,
      text: detail.text,
      createdAt: detail.receivedAt,
      platform: detail.platform,
      kind: detail.kind,
      status: detail.rawStatus,
      contentContext: detail.contentContext,
      postContext: detail.postContext,
    },
  ];
  return messages.sort((left, right) =>
    timestamp(left.createdAt) - timestamp(right.createdAt)
    || left.id.localeCompare(right.id));
}

function PostPreview({ context }: { context?: InteractionPostContext }) {
  const permalink = safeHttpsUrl(context?.permalink);
  const thumbnail = safeThumbnailUrl(context?.thumbnailUrl);
  return (
    <section className={`manual-inbox-post-preview${thumbnail ? "" : " manual-inbox-post-preview--no-media"}`} aria-label="Publicación comentada">
      <div className="manual-inbox-post-preview__media">
        <PostThumbnail url={thumbnail} iconSize={30} />
      </div>
      <div className="manual-inbox-post-preview__copy">
        <span>Publicación original</span>
        <strong>{context?.caption?.trim() || "Vista previa no entregada por Metricool"}</strong>
        <small>
          {context?.publishedAt
            ? `Publicado ${formatDateTime(context.publishedAt)}`
            : "Fecha de publicación no disponible"}
        </small>
      </div>
      {permalink ? (
        <a
          className="manual-inbox-post-preview__link"
          href={permalink}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          <ArrowSquareOut size={16} weight="bold" aria-hidden="true" />
          Abrir publicación
        </a>
      ) : (
        <small className="manual-inbox-post-preview__unavailable">Enlace no disponible</small>
      )}
    </section>
  );
}

export function ManualManagementView({
  accounts,
  pendingCounts,
  interactions,
  selectedAccountId,
  selectedInteractionId = null,
  selectedContactKey = null,
  detail,
  isLoadingDetail = false,
  isSaving = false,
  isRefreshing = false,
  canWrite = true,
  canRefresh = true,
  currentUserId,
  lastUpdatedAt,
  refreshIssue = null,
  statusReasons,
  onSelectAccount,
  onSelectInteraction,
  onRefreshAccount,
  liveCheckedAt,
  onSaveDraft,
  onSendReply,
  onResolve,
  onEscalate,
  onReopen,
  onChangeAssignment,
  onOpenFullDetail,
  onDraftDirtyChange,
  postSummaries,
  selectedPostKey = null,
  postComments = [],
  postCommentsPostKey = null,
  isLoadingPosts = false,
  isLoadingPostComments = false,
  onSelectPost,
  onClearSelection,
  onRetryPostComments,
  postCommentsError = null,
  canDiscardNoise = false,
  onDiscardNoise,
  surfaceKind,
}: ManualManagementViewProps) {
  const [activeSurfaceId, setActiveSurfaceId] = useState<ManualSurfaceId>("all");
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(true);
  const [draftText, setDraftText] = useState("");
  const statusFormRef = useRef<HTMLFormElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  // Conversaciones en las que la persona ya confirmó enviar en esta sesión del navegador.
  const confirmedConversations = useRef<Set<string>>(readConfirmedConversations());
  const rememberConfirmedConversation = (conversation: string) => {
    confirmedConversations.current.add(conversation);
    try {
      sessionStorage.setItem(CONFIRMED_CONVERSATIONS_KEY, JSON.stringify([...confirmedConversations.current].slice(-200)));
    } catch {
      // Sin almacenamiento de sesión: se recuerda solo mientras la vista esté abierta.
    }
  };
  const [isDraftDirty, setDraftDirty] = useState(false);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const activeDetailIdRef = useRef<string | null>(null);
  const draftDirtyRef = useRef(false);

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  // Las reseñas acompañan a los comentarios: ambas son respuestas públicas sobre contenido.
  // Así ninguna superficie queda inalcanzable al separar las vistas.
  const allowedKinds = useMemo<InteractionKind[]>(
    () => surfaceKind === "dm" ? ["dm"]
      : surfaceKind === "comment" ? ["comment", "review"]
        : ["dm", "comment", "review"],
    [surfaceKind],
  );
  const accountInteractions = useMemo(
    () => selectedAccountId
      ? interactions.filter((interaction) => interaction.accountId === selectedAccountId
        && allowedKinds.includes(interaction.kind))
      : [],
    [allowedKinds, interactions, selectedAccountId],
  );
  const visibleDetail = detail?.accountId === selectedAccountId
    && allowedKinds.includes(detail.kind)
    && (activeSurfaceId === "all" || activeSurfaceId === `${detail.platform}:${detail.kind}`)
    ? detail
    : null;

  const surfaceTabs = useMemo<ManualSurfaceTab[]>(() => {
    if (!selectedAccount) return [{ id: "all", label: "Todos", count: 0 }];
    const configuredPlatforms = selectedAccount.channels
      .filter((channel) => channel.status !== "disconnected")
      .map((channel) => channel.platform);
    const platforms = [...new Set([
      ...configuredPlatforms,
      ...accountInteractions.map((interaction) => interaction.platform),
    ])];
    const tabs: ManualSurfaceTab[] = [];
    for (const platform of platforms) {
      for (const kind of surfaceKinds(platform).filter((item) => allowedKinds.includes(item))) {
        const count = kind === "comment" && postSummaries
          ? postSummaries
            .filter((post) => post.accountId === selectedAccount.id && post.platform === platform)
            .reduce((total, post) => total + post.commentCount, 0)
          : accountInteractions.filter((interaction) =>
            interaction.platform === platform && interaction.kind === kind).length;
        tabs.push({
          id: `${platform}:${kind}`,
          platform,
          kind,
          // Con la superficie fija basta el nombre de la red; repetirla sería ruido.
          label: surfaceKind ? platformLabel(platform) : `${platformLabel(platform)} · ${surfaceLabel(kind)}`,
          count,
        });
      }
    }
    return [
      { id: "all", label: "Todos", count: tabs.reduce((total, tab) => total + tab.count, 0) },
      ...tabs,
    ];
  }, [accountInteractions, allowedKinds, postSummaries, selectedAccount, surfaceKind]);

  useEffect(() => {
    setActiveSurfaceId("all");
    setQuery("");
    setOnlyPending(true);
  }, [selectedAccountId]);

  useEffect(() => {
    if (!surfaceTabs.some((tab) => tab.id === activeSurfaceId)) setActiveSurfaceId("all");
  }, [activeSurfaceId, surfaceTabs]);

  const activeTab = surfaceTabs.find((tab) => tab.id === activeSurfaceId) ?? surfaceTabs[0]!;
  // Con la vista fijada en comentarios, incluso "Todos" agrupa por publicación.
  const isCommentSurface = surfaceKind === "comment" || activeTab.kind === "comment";
  const entries = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);
    const matchingPostSummaries = isCommentSurface && postSummaries
      ? postSummaries.filter((post) =>
        post.accountId === selectedAccountId
        && (!activeTab.platform || post.platform === activeTab.platform))
      : undefined;
    const sourceEntries = matchingPostSummaries
      ? entriesFromPostSummaries(
        matchingPostSummaries,
        selectedPostKey,
        postCommentsPostKey === selectedPostKey ? postComments : [],
      )
      : buildEntries(accountInteractions, activeTab);
    return sourceEntries.filter((entry) => {
      if (onlyPending && entry.pendingCount === 0) return false;
      if (!normalizedQuery) return true;
      const searchable = normalizeSearch(entry.items.map((interaction) => [
        interaction.customerName,
        interaction.customerHandle,
        interaction.brandName,
        interaction.preview,
        interaction.postContext?.caption || "",
      ].join(" ")).join(" ") + ` ${entry.postSummary?.postContext.caption ?? ""}`);
      return searchable.includes(normalizedQuery);
    });
  }, [
    accountInteractions,
    activeTab,
    isCommentSurface,
    onlyPending,
    postComments,
    postCommentsPostKey,
    postSummaries,
    query,
    selectedAccountId,
    selectedPostKey,
  ]);

  const selectedListInteraction = accountInteractions.find((interaction) =>
    interaction.id === selectedInteractionId)
    ?? (!isCommentSurface
      ? accountInteractions.find((interaction) =>
        Boolean(selectedContactKey && interaction.contactKey === selectedContactKey))
      : undefined);
  const selectedEntry = entries.find((entry) =>
    entry.items.some((interaction) => interaction.id === selectedInteractionId)
    || Boolean(entry.postKey && selectedPostKey && entry.postKey === selectedPostKey)
    || Boolean(!entry.postId && selectedContactKey
      && entry.items.some((interaction) => interaction.contactKey === selectedContactKey)));
  const selectedContext = visibleDetail?.postContext
    ?? selectedListInteraction?.postContext
    ?? selectedEntry?.postSummary?.postContext
    ?? selectedEntry?.target.postContext;
  const selectedPendingComments = useMemo(() => {
    if (!isCommentSurface || !selectedEntry) return [];
    const source = selectedEntry.postKey
      && postCommentsPostKey === selectedEntry.postKey
      ? postComments
      : selectedEntry.items;
    // Primero lo que hay que responder, del más antiguo al más reciente; el posible spam al final.
    return source
      .filter(isOpenInboundComment)
      .sort((left, right) =>
        Number(Boolean(left.noise)) - Number(Boolean(right.noise))
        || timestamp(left.receivedAt) - timestamp(right.receivedAt)
        || left.id.localeCompare(right.id));
  }, [isCommentSurface, postComments, postCommentsPostKey, selectedEntry]);
  const selectedPermalink = safeHttpsUrl(selectedContext?.permalink);
  const selectedPostThumbnail = safeThumbnailUrl(selectedContext?.thumbnailUrl);
  const selectedNoiseCount = selectedPendingComments.filter((comment) => comment.noise).length;
  const selectedCommentIsOpen = !isCommentSurface
    || Boolean(visibleDetail && selectedPendingComments.some((comment) => comment.id === visibleDetail.id));
  const postOrderDetail = entries.some((entry) => entry.postSortSource === "latest_comment_at")
    ? "ordenadas por último comentario"
    : "más nuevas primero";
  const timeline = useMemo(
    () => visibleDetail ? timelineFor(visibleDetail) : [],
    [visibleDetail],
  );
  const timelineListRef = useRef<HTMLOListElement>(null);
  // Como cualquier chat: al abrir, el mensaje que se responde queda al pie de la vista
  // (lo anterior arriba, al alcance del scroll), en vez de empezar por el más antiguo.
  useLayoutEffect(() => {
    const list = timelineListRef.current;
    if (!list) return;
    const align = () => {
      const target = list.querySelector<HTMLElement>(".is-target");
      // En pantallas angostas el historial no tiene scroll propio (se desplaza la página): se
      // lleva a la vista el mensaje que se responde.
      if (list.scrollHeight <= list.clientHeight + 1) {
        (target ?? list.lastElementChild as HTMLElement | null)?.scrollIntoView({ block: "center" });
        return;
      }
      if (!target) {
        list.scrollTop = list.scrollHeight;
        return;
      }
      list.scrollTop += target.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom + 12;
    };
    align();
    if (typeof ResizeObserver === "undefined") return;
    // El compositor y los adjuntos terminan de medirse después y cambian el alto visible:
    // se reajusta un momento, salvo que el operador ya haya movido el historial.
    let operatorMoved = false;
    const stopFollowing = () => { operatorMoved = true; };
    const observer = new ResizeObserver(() => { if (!operatorMoved) align(); });
    observer.observe(list);
    for (const message of Array.from(list.children)) observer.observe(message);
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of events) list.addEventListener(event, stopFollowing, { passive: true });
    const timer = window.setTimeout(() => observer.disconnect(), 2_000);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      for (const event of events) list.removeEventListener(event, stopFollowing);
    };
  }, [visibleDetail?.id, timeline.length]);
  const aiRecommendation = visibleDetail?.automation?.proposal?.text?.trim() || "";
  const caseClosed = visibleDetail ? detailIsClosed(visibleDetail) : true;
  // Un DM ya respondido sigue abierto como un chat: se puede mandar otro mensaje a la misma
  // conversación sin esperar a que el cliente escriba. Resolver, escalar y borradores siguen
  // siendo para casos abiertos; un caso resuelto se reabre antes.
  const followUpOpen = Boolean(visibleDetail
    && visibleDetail.kind === "dm"
    && visibleDetail.direction === "inbound"
    && visibleDetail.status === "answered_by_team");
  const composerLocked = caseClosed && !followUpOpen;
  // Si lo seleccionado es el mensaje de la cuenta, "Reabrir" vuelve a pendiente el último
  // mensaje del cliente de esa conversación.
  const reopenTargetId = visibleDetail && caseClosed
    ? visibleDetail.direction === "inbound"
      ? visibleDetail.id
      : timeline.filter((message) => message.direction === "inbound").at(-1)?.id
    : undefined;
  const latestDelivery = visibleDetail?.deliveries[0];
  const deliveryBlocksSend = latestDelivery
    ? ["pending", "sending", "uncertain"].includes(latestDelivery.status)
    : false;
  const providerReplyWindowMs = !visibleDetail
    || !["instagram", "facebook"].includes(visibleDetail.platform)
    || visibleDetail.kind === "review"
    ? undefined
    : visibleDetail.kind === "comment" ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
  const providerReplyDeadline = visibleDetail && providerReplyWindowMs !== undefined
    ? Date.parse(visibleDetail.receivedAt) + providerReplyWindowMs
    : Number.NaN;
  const providerReplyWindowExpired = Boolean(
    visibleDetail
    && providerReplyWindowMs !== undefined
    && (!Number.isFinite(providerReplyDeadline) || Date.now() > providerReplyDeadline),
  );

  const setDirty = (value: boolean) => {
    draftDirtyRef.current = value;
    setDraftDirty(value);
    onDraftDirtyChange?.(value);
  };

  useEffect(() => {
    const nextId = visibleDetail?.id ?? null;
    const changedDetail = nextId !== activeDetailIdRef.current;
    if (visibleDetail && (changedDetail || !draftDirtyRef.current)) {
      // La recomendación debe ser una ayuda explícita, no un borrador implícito. En un caso ya
      // respondido, `responseText` es lo que se envió: el compositor queda vacío para seguir
      // escribiendo, nunca con el mensaje anterior listo para mandarse dos veces.
      setDraftText(detailIsClosed(visibleDetail) ? "" : visibleDetail.responseText || "");
      setDirty(false);
    } else if (!visibleDetail && !draftDirtyRef.current) {
      setDraftText("");
      setDirty(false);
    }
    if (changedDetail) {
      setStatusAction(null);
      setReasonCode("");
      setReasonNote("");
    }
    activeDetailIdRef.current = nextId;
  }, [aiRecommendation, visibleDetail?.id, visibleDetail?.responseText, visibleDetail?.version]);

  const confirmDiscardDraft = async (): Promise<boolean> => {
    if (!draftDirtyRef.current) return true;
    return confirmAction({
      title: "¿Descartar la respuesta sin guardar?",
      message: "Hay una respuesta sin guardar. Si cambias de selección, se descarta.",
      confirmLabel: "Descartar y cambiar",
      cancelLabel: "Seguir editando",
      tone: "danger",
    });
  };

  const requestAccountChange = async (accountId: string) => {
    const account = accounts.find((item) => item.id === accountId);
    if (!account || account.id === selectedAccountId || !(await confirmDiscardDraft())) return;
    setDirty(false);
    void onSelectAccount(account);
  };

  const requestInteractionChange = async (interaction: Interaction) => {
    if (interaction.id === selectedInteractionId || isSaving || !(await confirmDiscardDraft())) return;
    setDirty(false);
    void onSelectInteraction(interaction);
  };

  const requestEntryChange = async (entry: ManualInboxEntry) => {
    if (entry.postKey && entry.postKey === selectedPostKey) return;
    if (!entry.postKey && entry.target.id === selectedInteractionId) return;
    if (isSaving || !(await confirmDiscardDraft())) return;
    setDirty(false);
    if (entry.postSummary && onSelectPost) {
      void onSelectPost(entry.postSummary);
      return;
    }
    void onSelectInteraction(entry.target);
  };

  const requestSurfaceChange = async (surfaceId: ManualSurfaceId) => {
    if (surfaceId === activeSurfaceId || !(await confirmDiscardDraft())) return;
    setDirty(false);
    setActiveSurfaceId(surfaceId);
  };

  const requestClearSelection = async () => {
    if (!onClearSelection || isSaving || !(await confirmDiscardDraft())) return;
    setDirty(false);
    onClearSelection();
  };

  const updateDraft = (value: string) => {
    setDraftText(value);
    setDirty(true);
  };

  /** Inserta el emoji donde está el cursor (o reemplaza lo seleccionado) y deja el cursor después. */
  const insertEmoji = (emoji: string) => {
    const field = draftRef.current;
    const start = field?.selectionStart ?? draftText.length;
    const end = field?.selectionEnd ?? draftText.length;
    const next = `${draftText.slice(0, start)}${emoji}${draftText.slice(end)}`;
    if (next.length > 10_000) return;
    updateDraft(next);
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      field?.focus({ preventScroll: true });
      field?.setSelectionRange(caret, caret);
    });
  };

  const sendDisabled = !visibleDetail
    || !canWrite
    || isSaving
    || composerLocked
    || deliveryBlocksSend
    || !selectedCommentIsOpen
    || visibleDetail.direction !== "inbound"
    || !draftText.trim();
  /**
   * Envía lo escrito (botón o Ctrl/Cmd + Enter). Como en un chat, la confirmación aparece solo
   * la primera vez que se escribe en cada conversación durante la sesión del navegador; los
   * mensajes siguientes a esa misma persona salen directo (cada envío sigue auditado).
   */
  const sendFromComposer = async () => {
    if (!visibleDetail || sendDisabled) return;
    const text = draftText.trim();
    const conversation = visibleDetail.contactKey || `${visibleDetail.accountId}|${visibleDetail.customerHandle}`;
    if (!confirmedConversations.current.has(conversation)) {
      const confirmed = await confirmAction({
        title: `¿Enviar mensajes a ${visibleDetail.customerName}?`,
        message: "Se envían a esta conversación y cada envío queda auditado. Mientras tengas la sesión abierta, los siguientes mensajes a esta persona saldrán sin volver a preguntar.",
        confirmLabel: "Enviar",
      });
      if (!confirmed) return;
    }
    const sent = await onSendReply(visibleDetail, text);
    if (sent) {
      rememberConfirmedConversation(conversation);
      // Como en un chat: el cuadro queda vacío y listo para el siguiente mensaje.
      setDraftText("");
      setDirty(false);
    }
  };

  const openStatusAction = (action: StatusAction) => {
    const options = statusReasons[action];
    setStatusAction(action);
    setReasonCode(options[0]?.code || "");
    setReasonNote("");
  };

  // Al abrir Resolver/Escalar, el formulario aparece al final del compositor: se lleva a la vista
  // (en pantallas bajas quedaba debajo del borde) y se enfoca el motivo.
  useEffect(() => {
    if (!statusAction) return;
    const form = statusFormRef.current;
    form?.scrollIntoView({ block: "nearest" });
    form?.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true });
  }, [statusAction]);

  const statusOptions = statusAction ? statusReasons[statusAction] : [];
  const selectedReason = statusOptions.find((option) => option.code === reasonCode);

  // Cuentas ordenadas por casos en plazo (lo urgente primero), luego por pendientes y nombre.
  const accountOptions = [...accounts]
    .map((account) => ({ account, inWindow: pendingCounts?.[account.id]?.inWindow ?? 0, total: pendingCounts?.[account.id]?.total ?? 0 }))
    .sort((left, right) => right.inWindow - left.inWindow || right.total - left.total || left.account.name.localeCompare(right.account.name, "es"));
  // Selector con búsqueda, como el de la Bandeja SAC: número verde = casos en plazo; debajo, los vencidos.
  const accountInWindowCounts = Object.fromEntries(accountOptions.map(({ account, inWindow }) => [account.id, inWindow]));
  const accountExtraDetail = Object.fromEntries(accountOptions.map(({ account, inWindow, total }) => [
    account.id,
    pendingCounts
      ? [inWindow ? null : "sin casos en plazo", total > inWindow ? `${total - inWindow} vencidos` : null].filter(Boolean).join(" · ")
      : "",
  ]));

  return (
    <section className="manual-inbox-view" aria-labelledby="manual-inbox-title">
      <header className="manual-inbox-header">
        <div className="manual-inbox-header__copy">
          <p>Operación humana por cuenta</p>
          <h1 id="manual-inbox-title">
            {surfaceKind === "dm" ? "Gestión de DMs"
              : surfaceKind === "comment" ? "Gestión de comentarios"
                : "Gestión manual"}
          </h1>
          <span>
            {surfaceKind === "dm"
              ? "Conversaciones privadas agrupadas por contacto, con su historial completo."
              : surfaceKind === "comment"
                ? "Comentarios y reseñas agrupados por publicación, con el contexto del post."
                : "Revisa el contexto completo y confirma cada respuesta antes de enviarla."}
          </span>
        </div>
        <div className="manual-inbox-account-picker">
          <AccountFilter
            accounts={accounts}
            value={selectedAccountId ?? ""}
            onChange={(id) => requestAccountChange(id)}
            inWindowCounts={accountInWindowCounts}
            extraDetail={accountExtraDetail}
            countLabel="Casos en plazo"
            hideAll
            sortByCount
            disabled={accounts.length === 0 || isSaving}
            label="Cuenta"
          />
          {selectedAccount && onRefreshAccount && canRefresh ? (
            <button
              className="manual-inbox-refresh"
              type="button"
              onClick={() => void onRefreshAccount(selectedAccount)}
              disabled={!canRefresh || isRefreshing || isSaving}
              aria-busy={isRefreshing}
              title={!canRefresh ? "Requiere permisos de operación" : "Leer ahora los mensajes nuevos de esta cuenta (se hace solo cada 15 s)"}
            >
              {isRefreshing ? <BusyOrb /> : <ArrowClockwise size={17} weight="bold" aria-hidden="true" />}
              {isRefreshing ? "Actualizando" : "Actualizar cuenta"}
            </button>
          ) : null}
          <div className="manual-inbox-refresh-status" aria-live="polite">
            {liveCheckedAt ? (
              <small className="manual-inbox-live" title="La cuenta abierta se lee en Metricool cada 15 segundos; lo nuevo aparece solo.">
                <i aria-hidden="true" />En vivo · revisado {new Date(liveCheckedAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </small>
            ) : lastUpdatedAt ? <small>Vista actualizada: {formatDateTime(lastUpdatedAt)}</small> : null}
            {refreshIssue ? <small className="is-warning"><WarningCircle size={14} weight="fill" aria-hidden="true" />{refreshIssue}</small> : null}
          </div>
        </div>
      </header>

      {!selectedAccount ? (
        <div className="manual-inbox-required-state">
          <Buildings size={34} weight="duotone" aria-hidden="true" />
          <strong>Selecciona una cuenta para comenzar</strong>
          <p>La separación por cuenta evita mezclar conversaciones, marcas y destinos de respuesta.</p>
        </div>
      ) : (
        <>
          <nav className="manual-inbox-surfaces" aria-label="Superficies de atención" role="tablist">
            {surfaceTabs.map((tab, index) => {
              const tabDomId = `manual-inbox-tab-${tab.id.replace(":", "-")}`;
              return (
                <button
                  id={tabDomId}
                  className={`manual-inbox-surface${tab.id === activeSurfaceId ? " is-active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeSurfaceId}
                  aria-controls="manual-inbox-tabpanel"
                  tabIndex={tab.id === activeSurfaceId ? 0 : -1}
                  key={tab.id}
                  onClick={() => requestSurfaceChange(tab.id)}
                  onKeyDown={(event) => {
                    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                    const targetIndex = event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? surfaceTabs.length - 1
                        : direction
                          ? (index + direction + surfaceTabs.length) % surfaceTabs.length
                          : index;
                    if (!direction && event.key !== "Home" && event.key !== "End") return;
                    event.preventDefault();
                    const nextTab = surfaceTabs[targetIndex];
                    if (!nextTab) return;
                    requestSurfaceChange(nextTab.id);
                    document.getElementById(`manual-inbox-tab-${nextTab.id.replace(":", "-")}`)?.focus();
                  }}
                >
                  {tab.platform ? (
                    <SocialPlatformIcon platform={tab.platform} size={16} weight="fill" aria-hidden="true" />
                  ) : (
                    <ChatCircleDots size={16} weight="duotone" aria-hidden="true" />
                  )}
                  <span>{tab.label}</span>
                  <small>{tab.count}</small>
                </button>
              );
            })}
          </nav>

          <div
            id="manual-inbox-tabpanel"
            className={`manual-inbox-grid${selectedEntry || visibleDetail ? " has-selection" : ""}`}
            role="tabpanel"
            aria-labelledby={`manual-inbox-tab-${activeTab.id.replace(":", "-")}`}
          >
            <aside className="manual-inbox-column manual-inbox-column--contacts" aria-label="Conversaciones de la cuenta">
              <header className="manual-inbox-column__header">
                <div>
                  <strong>{selectedAccount.name}</strong>
                  <small>
                    {isLoadingPosts && isCommentSurface
                      ? "Cargando publicaciones"
                      : isCommentSurface
                        ? `${countLabel(entries.length, "publicación", "publicaciones")} · ${postOrderDetail}`
                        : `${countLabel(entries.length, "conversación", "conversaciones")} visibles`}
                  </small>
                </div>
                {/* Etiqueta corta (cabe en la columna); el detalle completo queda en el tooltip. */}
                <span className={`manual-inbox-health manual-inbox-health--${selectedAccount.health}`} title={selectedAccount.healthDetail}>
                  {selectedAccount.health === "healthy" ? "Operativa" : selectedAccount.health === "attention" ? "Requiere atención" : "Desconectada"}
                </span>
              </header>

              <div className="manual-inbox-contact-tools">
                <label className="manual-inbox-search">
                  <MagnifyingGlass size={16} aria-hidden="true" />
                  <span className="manual-inbox-sr-only">Buscar publicaciones, personas o mensajes</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={activeTab.kind === "comment" ? "Buscar publicaciones" : "Buscar persona o mensaje"}
                    aria-label={activeTab.kind === "comment" ? "Buscar publicaciones" : "Buscar persona o mensaje"}
                  />
                </label>
                <button
                  className={`manual-inbox-pending-filter${onlyPending ? " is-active" : ""}`}
                  type="button"
                  aria-pressed={onlyPending}
                  onClick={() => setOnlyPending((current) => !current)}
                >
                  <FunnelSimple size={15} weight="bold" aria-hidden="true" />
                  Solo pendientes
                </button>
              </div>

              <div className="manual-inbox-contact-list" aria-busy={isLoadingPosts && isCommentSurface}>
                {isLoadingPosts && isCommentSurface ? (
                  <div className="manual-inbox-loading" role="status">
                    <ThinkingOrb size="lg" className="loading-orb" label="" />
                    <strong>Cargando publicaciones</strong>
                    <p>Ordenaremos los posts del más nuevo al más antiguo.</p>
                  </div>
                ) : entries.map((entry) => {
                  const selected = entry.items.some((interaction) => interaction.id === selectedInteractionId)
                    || Boolean(entry.postKey && selectedPostKey && entry.postKey === selectedPostKey)
                    || Boolean(!entry.postId && selectedContactKey
                      && entry.items.some((interaction) => interaction.contactKey === selectedContactKey));
                  const postContext = entry.postSummary?.postContext ?? entry.target.postContext;
                  const postThumbnail = entry.postId ? safeThumbnailUrl(postContext?.thumbnailUrl) : undefined;
                  const entryTitle = entry.postId
                    ? postContext?.caption?.trim() || `Publicación ${entry.postId}`
                    : entry.target.customerName;
                  const entrySubtitle = entry.postId
                    ? `${countLabel(entry.messageCount, "comentario", "comentarios")} · ${countLabel(entry.participantCount ?? new Set(entry.items.map((item) => item.customerHandle)).size, "persona", "personas")}`
                    : visibleHandle(entry.target.customerHandle, entry.target.customerName);
                  const entryDateTime = entry.postId ? entry.postSortAt ?? entry.latest.receivedAt : entry.latest.receivedAt;
                  const entryDateLabel = entry.postId
                    ? `${entry.postSortSource === "published_at" ? "Publicado" : "Actividad"} ${formatDateTime(entryDateTime)}`
                    : entry.latest.receivedAtLabel;
                  return (
                    <button
                      className={`manual-inbox-contact${entry.postId ? " is-post-card" : ""}${selected ? " is-selected" : ""}`}
                      type="button"
                      key={entry.key}
                      onClick={() => requestEntryChange(entry)}
                      disabled={isSaving}
                      aria-current={selected ? "true" : undefined}
                      aria-label={entry.postId
                        ? `${entryTitle}. ${countLabel(entry.pendingCount, "comentario", "comentarios")} sin responder de ${entry.messageCount}`
                        : undefined}
                      title={entry.postId && entry.postSortSource === "latest_comment_at"
                        ? "Metricool no entregó la fecha de publicación; ordenado por el comentario más reciente."
                        : undefined}
                    >
                      <span className={`manual-inbox-contact__avatar${entry.postId ? " is-post" : ""}`} aria-hidden="true">
                        {entry.postId ? (
                          <PostThumbnail url={postThumbnail} />
                        ) : (
                          <ProfileAvatar
                            url={entry.target.customerAvatarUrl}
                            initials={entry.target.customerName.slice(0, 2).toLocaleUpperCase("es-CL")}
                          />
                        )}
                      </span>
                      <span className="manual-inbox-contact__body">
                        <span className="manual-inbox-contact__topline">
                          <strong>{entryTitle}</strong>
                          <time dateTime={entryDateTime}>{entryDateLabel}</time>
                        </span>
                        {entrySubtitle ? <small>{entrySubtitle}</small> : null}
                        <p>
                          {entry.postId
                            ? <b>{entry.latest.customerName}: </b>
                            : (entry.latest.conversationSummary?.latestDirection ?? entry.latest.direction) === "outbound" ? <b>Equipo: </b> : null}
                          <ContentContext text={entry.latest.preview} context={entry.latest.contentContext} compact />
                        </p>
                        <span className="manual-inbox-contact__meta">
                          <span>
                            <SocialPlatformIcon platform={entry.target.platform} size={14} weight="fill" aria-hidden="true" />
                            {entry.postId ? platformLabel(entry.target.platform) : interactionKindLabel(entry.target.kind)}
                          </span>
                          {/* En un post el total de comentarios ya está en la línea de arriba. */}
                          {entry.postId ? null : <span>{countLabel(entry.messageCount, "mensaje", "mensajes")}</span>}
                          {entry.postId
                            ? <em>{entry.pendingCount} sin responder</em>
                            : entry.pendingCount ? <em>{countLabel(entry.pendingCount, "pendiente", "pendientes")}</em> : null}
                          {entry.postSummary?.noisePendingCount ? (
                            <em className="manual-inbox-noise" title="Comentarios abiertos con texto repetido, el mismo texto desde varias cuentas, solo etiquetas o spam">
                              {entry.postSummary.noisePendingCount} posible spam
                            </em>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {!isLoadingPosts && entries.length === 0 ? (
                  <div className="manual-inbox-empty">
                    <CheckCircle size={28} weight="duotone" aria-hidden="true" />
                    <strong>{isCommentSurface ? "No hay publicaciones para este filtro" : "No hay conversaciones para este filtro"}</strong>
                    <p>{isCommentSurface
                      ? "Prueba otra cuenta, búsqueda o muestra también los posts sin pendientes."
                      : "Prueba otra superficie, búsqueda o muestra también las respondidas."}</p>
                  </div>
                ) : null}
              </div>
            </aside>

            <section className="manual-inbox-column manual-inbox-column--conversation" aria-label="Conversación y respuesta manual">
              {isLoadingDetail || (isCommentSurface && isLoadingPostComments) ? (
                <div className="manual-inbox-loading" role="status">
                  <ThinkingOrb size="lg" className="loading-orb" label="" />
                  <strong>{isCommentSurface ? "Cargando comentarios del post" : "Cargando conversación exacta"}</strong>
                  <p>{isCommentSurface
                    ? "Estamos reuniendo únicamente los comentarios abiertos de esta publicación."
                    : "Las acciones permanecen bloqueadas hasta validar el caso y su versión."}</p>
                </div>
              ) : visibleDetail ? (
                <>
                  <header className="manual-inbox-conversation-header">
                    {onClearSelection ? (
                      <button className="manual-inbox-mobile-back" type="button" onClick={requestClearSelection}>
                        <ArrowLeft size={16} weight="bold" aria-hidden="true" />
                        Volver
                      </button>
                    ) : null}
                    <div className="manual-inbox-conversation-header__identity">
                      <span className={`manual-inbox-conversation-header__avatar${isCommentSurface && selectedPostThumbnail ? " has-media" : ""}`} aria-hidden="true">
                        {isCommentSurface
                          ? <PostThumbnail url={selectedPostThumbnail} />
                          : (
                            <ProfileAvatar
                              url={visibleDetail.customerAvatarUrl ?? selectedEntry?.target.customerAvatarUrl}
                              initials={visibleDetail.customerName.slice(0, 2).toLocaleUpperCase("es-CL")}
                            />
                          )}
                      </span>
                      {/* En comentarios el texto del post ya está en su tarjeta de la izquierda: aquí solo
                          cuántos quedan y en qué orden se atienden. */}
                      <div>
                        <strong aria-live={isCommentSurface ? "polite" : undefined}>{isCommentSurface
                          ? selectedPendingComments.length
                            ? `${selectedPendingComments.length} sin responder`
                            : "Publicación al día"
                          : visibleDetail.customerName}</strong>
                        <small>{isCommentSurface
                          ? `${platformLabel(visibleDetail.platform)} · los más antiguos primero`
                          : [visibleHandle(visibleDetail.customerHandle, visibleDetail.customerName), platformLabel(visibleDetail.platform)].filter(Boolean).join(" · ")}</small>
                      </div>
                    </div>
                    <div className="manual-inbox-conversation-header__actions">
                      <ManualOwnerChip
                        owners={isCommentSurface
                          ? [visibleDetail, ...selectedPendingComments].map((interaction) => interaction.assignedTo)
                          : [visibleDetail.assignedTo]}
                        currentUserId={currentUserId}
                        scope={isCommentSurface ? "post" : "chat"}
                      />
                      {isCommentSurface ? (
                        <>
                          {canDiscardNoise && onDiscardNoise && selectedEntry?.postKey && selectedNoiseCount ? (
                            <button
                              type="button"
                              className="manual-inbox-discard-noise"
                              disabled={isSaving}
                              onClick={() => void onDiscardNoise({ accountId: selectedEntry.target.accountId, type: "comment", postKey: selectedEntry.postKey })}
                              title="Cierra como spam los comentarios señalados de esta publicación; no borra nada en la red"
                            >
                              Descartar spam ({selectedNoiseCount})
                            </button>
                          ) : null}
                          {selectedPermalink ? (
                            <a
                              className="manual-inbox-post-link"
                              href={selectedPermalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              referrerPolicy="no-referrer"
                              title={selectedContext?.publishedAt ? `Publicado ${formatDateTime(selectedContext.publishedAt)}` : "Abre la publicación en la red social"}
                            >
                              <ArrowSquareOut size={15} weight="bold" aria-hidden="true" />
                              Abrir publicación
                            </a>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <span className={`manual-inbox-status manual-inbox-status--${visibleDetail.status}`}>
                            {statusLabel(visibleDetail)}
                          </span>
                          <button
                            type="button"
                            onClick={() => void onChangeAssignment(visibleDetail)}
                            disabled={!canWrite || isSaving || caseClosed}
                          >
                            <UserPlus size={15} weight="bold" aria-hidden="true" />
                            {visibleDetail.assignedTo ? "Liberar" : "Asignarme"}
                          </button>
                        </>
                      )}
                      {onOpenFullDetail ? (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!(await confirmDiscardDraft())) return;
                            setDirty(false);
                            void onOpenFullDetail(visibleDetail);
                          }}
                          disabled={isSaving}
                        >
                          <ArrowSquareOut size={15} weight="bold" aria-hidden="true" />
                          Detalle completo
                        </button>
                      ) : null}
                    </div>
                  </header>

                  {/* La tarjeta con el texto del post solo queda donde no hay lista de publicaciones
                      (un comentario abierto desde DMs); en Gestión comentarios ya está a la izquierda. */}
                  {!isCommentSurface && selectedContext && (visibleDetail.kind === "comment" || selectedListInteraction?.kind === "comment") ? (
                    <PostPreview context={selectedContext} />
                  ) : null}

                  {isCommentSurface && selectedEntry ? (
                    <section className="manual-inbox-exact-comments" aria-label="Comentarios sin responder de la publicación">
                      {selectedPendingComments.length ? (
                        <ol aria-label="Comentarios sin responder, del más antiguo al más reciente">
                          {selectedPendingComments.map((interaction) => {
                            const selected = interaction.id === visibleDetail.id;
                            const handle = interaction.customerHandle.replace(/^@/, "");
                            // El usuario solo se repite si dice algo distinto del nombre (no un ID numérico).
                            const showHandle = Boolean(handle)
                              && !/^\d+$/.test(handle)
                              && handle.toLocaleLowerCase("es-CL") !== interaction.customerName.replace(/^@/, "").toLocaleLowerCase("es-CL");
                            const owner = interaction.assignedTo
                              ? interaction.assignedTo.userId === currentUserId ? "Tú" : interaction.assignedTo.displayName
                              : undefined;
                            const flagged = interaction.status === "needs_review" || interaction.priority === "urgent";
                            const flagLabel = [
                              interaction.status === "needs_review" ? "Revisión humana" : null,
                              `prioridad ${priorityLabel(interaction.priority).toLocaleLowerCase("es-CL")}`,
                            ].filter(Boolean).join(" · ");
                            return (
                              <li key={interaction.id}>
                                <button
                                  className={selected ? "is-selected" : ""}
                                  type="button"
                                  onClick={() => requestInteractionChange(interaction)}
                                  disabled={isSaving}
                                  aria-current={selected ? "true" : undefined}
                                  aria-label={`${interaction.customerName}${selected ? ", respondiendo" : ""}. ${flagLabel}${owner ? `. A cargo: ${owner}` : ""}`}
                                >
                                  <span className="manual-inbox-comment__avatar" aria-hidden="true">
                                    {interaction.customerName.slice(0, 2).toLocaleUpperCase("es-CL")}
                                  </span>
                                  <span className="manual-inbox-comment__body">
                                    <span className="manual-inbox-comment__topline">
                                      <strong>{interaction.customerName}</strong>
                                      {showHandle ? <small className="manual-inbox-comment__handle">@{handle}</small> : null}
                                      <span className="manual-inbox-comment__marks">
                                        {flagged ? (
                                          <span className="manual-inbox-comment__flag" title={flagLabel} aria-hidden="true">
                                            <UserFocus size={14} weight="fill" />
                                          </span>
                                        ) : null}
                                        {owner ? <span className="manual-inbox-comment__owner" title={`A cargo: ${owner}`} aria-hidden="true">{owner}</span> : null}
                                        <time dateTime={interaction.receivedAt}>{formatDateTime(interaction.receivedAt)}</time>
                                      </span>
                                    </span>
                                    <p><ContentContext text={interaction.preview} context={interaction.contentContext} compact /></p>
                                    {interaction.noise ? (
                                      <small className={`manual-inbox-comment__noise manual-inbox-comment__noise--${interaction.noise.origen}`}>
                                        {interaction.noise.origen === "ia" ? interaction.noise.label : `Posible spam · ${interaction.noise.label.charAt(0).toLowerCase()}${interaction.noise.label.slice(1)}`}
                                      </small>
                                    ) : null}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <div className="manual-inbox-comments-empty" role="status">
                          <CheckCircle size={25} weight="duotone" aria-hidden="true" />
                          <strong>Esta publicación está al día</strong>
                          <p>No quedan comentarios abiertos por responder.</p>
                        </div>
                      )}
                    </section>
                  ) : null}

                  {!isCommentSurface ? (
                    <section className="manual-inbox-timeline" aria-label="Historial del chat">
                    <header>
                      <div>
                        <ChatCenteredText size={18} weight="duotone" aria-hidden="true" />
                        <strong>Historial del chat</strong>
                      </div>
                      <small title={`Caso ${visibleDetail.id}`}>{timeline.length} mensajes</small>
                    </header>
                    <ol ref={timelineListRef}>
                      {timeline.map((message) => (
                        <li
                          className={`manual-inbox-message manual-inbox-message--${message.direction}${message.id === visibleDetail.id ? " is-target" : ""}`}
                          key={message.id}
                        >
                          <div>
                            <strong>{message.direction === "inbound" ? visibleDetail.customerName : `${selectedAccount.name} · Equipo`}</strong>
                            <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
                          </div>
                          <ContentContext text={message.text} context={message.contentContext} />
                          {message.id === visibleDetail.id ? <small>Respuesta dirigida a este caso exacto</small> : null}
                        </li>
                      ))}
                    </ol>
                    </section>
                  ) : null}

                  <section className="manual-inbox-composer" aria-label="Compositor de respuesta humana">
                    {isCommentSurface ? (
                      // Estado y asignación son del comentario que se responde (no del post): viven aquí,
                      // junto a quién se responde, y la acción queda ligada a su ID y versión.
                      <div className="manual-inbox-reply-target manual-inbox-reply-target--comment" aria-live="polite">
                        <span className="manual-inbox-reply-target__who">
                          Respondiendo a <strong>{visibleDetail.customerName}</strong>
                        </span>
                        <span className={`manual-inbox-status manual-inbox-status--${visibleDetail.status}`}>
                          {statusLabel(visibleDetail)}
                        </span>
                        <button
                          type="button"
                          className="manual-inbox-reply-target__assign"
                          onClick={() => void onChangeAssignment(visibleDetail)}
                          disabled={!canWrite || isSaving || caseClosed}
                        >
                          <UserPlus size={14} weight="bold" aria-hidden="true" />
                          {visibleDetail.assignedTo ? "Liberar" : "Asignarme"}
                        </button>
                        <span className="manual-inbox-reply-target__quote">
                          <ContentContext text={visibleDetail.text} context={visibleDetail.contentContext} compact />
                        </span>
                      </div>
                    ) : null}
                    {/* Compacta: una línea de etiqueta y una de texto, para no quitarle alto al historial. */}
                    <AiReplySuggestion
                      variant="compact"
                      interactionId={visibleDetail.id}
                      accountId={visibleDetail.accountId}
                      active={!caseClosed && visibleDetail.direction === "inbound"}
                      ruleText={aiRecommendation}
                      ruleGrounded={visibleDetail.automation?.knowledge.status === "approved"}
                      ruleSourceCount={visibleDetail.automation?.knowledge.sourceIds.length ?? 0}
                      disabled={!canWrite || isSaving}
                      onUse={updateDraft}
                    />

                    <label htmlFor="manual-inbox-draft">Respuesta personal</label>
                    {deliveryBlocksSend ? (
                      <p className="manual-inbox-delivery-warning" role="alert">
                        <WarningCircle size={16} weight="duotone" aria-hidden="true" />
                        Ya existe una entrega {latestDelivery?.status === "uncertain" ? "sin confirmar" : "en curso"}. Verifícala antes de intentar otra respuesta.
                      </p>
                    ) : providerReplyWindowExpired ? (
                      <p className="manual-inbox-deadline-warning">
                        <WarningCircle size={16} weight="duotone" aria-hidden="true" />
                        Fuera del plazo recomendado de Meta. Puedes intentar responder manualmente, pero la plataforma podría rechazar la entrega.
                      </p>
                    ) : null}
                    {!isDraftDirty && draftText.trim() && !detailIsClosed(visibleDetail) && draftText === (visibleDetail.responseText ?? "") ? (
                      <p className="manual-inbox-saved-draft">Borrador guardado del caso: revísalo o reemplázalo antes de enviar.</p>
                    ) : null}
                    <div className="manual-inbox-composer__field">
                    <textarea
                      ref={draftRef}
                      id="manual-inbox-draft"
                      value={draftText}
                      onChange={(event) => updateDraft(event.target.value)}
                      onKeyDown={(event) => {
                        // Ctrl/Cmd + Enter envía (con la misma confirmación); Enter solo, salto de línea.
                        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          void sendFromComposer();
                        }
                      }}
                      rows={3}
                      maxLength={10_000}
                      disabled={!canWrite || isSaving || composerLocked}
                      placeholder={followUpOpen
                        ? "Escribe otro mensaje para esta conversación (Ctrl + Enter para enviar)"
                        : "Escribe una respuesta humana para este caso"}
                    />
                    <EmojiPicker onPick={insertEmoji} disabled={!canWrite || isSaving || composerLocked} />
                    </div>
                    {/* Solo avisa cuando hay algo sin guardar; el estado "sincronizado" no aporta. */}
                    <small className={`manual-inbox-draft-state${isDraftDirty ? " is-dirty" : ""}`} aria-live="polite">
                      {isDraftDirty ? "Cambios locales sin guardar; se pedirá confirmación antes de cambiar de caso." : ""}
                    </small>

                    {caseClosed ? (
                      <p className="manual-inbox-closed-note">
                        {followUpOpen
                          ? "Ya está respondido. Puedes seguir escribiendo: va a la misma conversación."
                          : "Este caso ya no requiere respuesta."}
                        {onReopen && reopenTargetId ? (
                          <button
                            type="button"
                            className="text-button"
                            disabled={isSaving}
                            onClick={async () => {
                              const confirmed = await confirmAction({
                                title: "¿Reabrir este caso?",
                                message: "El último mensaje del cliente vuelve a pendiente para que puedas responderlo. Queda registrado quién lo reabrió.",
                                confirmLabel: "Reabrir",
                              });
                              if (confirmed) await onReopen(reopenTargetId);
                            }}
                          >
                            <ArrowCounterClockwise size={14} weight="bold" aria-hidden="true" />
                            Reabrir caso
                          </button>
                        ) : null}
                      </p>
                    ) : null}

                    <div className="manual-inbox-composer__actions">
                      <button
                        type="button"
                        onClick={() => openStatusAction("escalated")}
                        disabled={!canWrite || isSaving || caseClosed}
                      >
                        <UserFocus size={16} weight="bold" aria-hidden="true" />
                        Escalar
                      </button>
                      <button
                        type="button"
                        onClick={() => openStatusAction("resolved")}
                        disabled={!canWrite || isSaving || caseClosed}
                      >
                        <CheckCircle size={16} weight="bold" aria-hidden="true" />
                        Resolver
                      </button>
                      <button
                        className="manual-inbox-composer__save"
                        type="button"
                        onClick={async () => {
                          if (!draftText.trim()) return;
                          try {
                            await onSaveDraft(visibleDetail, draftText.trim());
                            setDirty(false);
                          } catch {
                            // El callback superior comunica el error; se conserva el texto local.
                          }
                        }}
                        disabled={!canWrite || isSaving || caseClosed || !draftText.trim()}
                      >
                        <NotePencil size={16} weight="bold" aria-hidden="true" />
                        Guardar borrador
                      </button>
                      <button
                        className="manual-inbox-composer__send"
                        type="button"
                        onClick={() => void sendFromComposer()}
                        disabled={sendDisabled}
                      >
                        <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" />
                        Enviar manualmente
                      </button>
                    </div>

                    {statusAction ? (
                      <form
                        ref={statusFormRef}
                        className="manual-inbox-status-form"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          if (!reasonCode || (selectedReason?.noteRequired && !reasonNote.trim())) return;
                          if (draftDirtyRef.current && !(await confirmAction({
                            title: "¿Cambiar el estado sin guardar la respuesta?",
                            message: "La respuesta local no está guardada y se descartará.",
                            confirmLabel: "Continuar",
                            cancelLabel: "Seguir editando",
                            tone: "danger",
                          }))) return;
                          const succeeded = statusAction === "resolved"
                            ? await onResolve(visibleDetail, reasonCode, reasonNote.trim() || undefined)
                            : await onEscalate(visibleDetail, reasonCode, reasonNote.trim() || undefined);
                          if (!succeeded) return;
                          setDirty(false);
                          setStatusAction(null);
                        }}
                      >
                        <header>
                          <strong>{statusAction === "resolved" ? "Resolver caso" : "Escalar caso"}</strong>
                          <button type="button" onClick={() => setStatusAction(null)} aria-label="Cancelar cambio de estado"><X size={15} weight="bold" aria-hidden="true" /></button>
                        </header>
                        <div className="manual-inbox-status-form__field">
                          <label htmlFor="manual-inbox-reason">Motivo</label>
                          <select id="manual-inbox-reason" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} required>
                            {statusOptions.map((option) => <option value={option.code} key={option.code}>{option.label}</option>)}
                          </select>
                        </div>
                        <div className="manual-inbox-status-form__field">
                          <label htmlFor="manual-inbox-reason-note">
                            Nota interna{selectedReason?.noteRequired ? "" : " (opcional)"}
                          </label>
                          <textarea
                            id="manual-inbox-reason-note"
                            value={reasonNote}
                            onChange={(event) => setReasonNote(event.target.value)}
                            rows={1}
                            maxLength={500}
                            required={selectedReason?.noteRequired}
                            placeholder={selectedReason?.noteRequired ? "Explica el motivo" : "Agrega contexto para el equipo"}
                          />
                        </div>
                        <button
                          className="manual-inbox-status-form__submit"
                          type="submit"
                          disabled={isSaving || !reasonCode || Boolean(selectedReason?.noteRequired && !reasonNote.trim())}
                        >
                          Confirmar
                        </button>
                      </form>
                    ) : null}
                  </section>
                </>
              ) : (
                <div className="manual-inbox-empty manual-inbox-empty--conversation">
                  {isCommentSurface && selectedPostKey && postCommentsError ? (
                    <>
                      <WarningCircle size={34} weight="duotone" aria-hidden="true" />
                      <strong>No se pudieron cargar los comentarios</strong>
                      <p>{postCommentsError}</p>
                      {onRetryPostComments ? <button type="button" onClick={onRetryPostComments}>Reintentar</button> : null}
                    </>
                  ) : (
                    <>
                      {isCommentSurface ? <ImageSquare size={34} weight="duotone" aria-hidden="true" /> : <ChatCircleDots size={34} weight="duotone" aria-hidden="true" />}
                      <strong>{isCommentSurface ? "Selecciona una publicación" : "Selecciona una conversación"}</strong>
                      <p>{isCommentSurface
                        ? "Verás todos sus comentarios sin responder y podrás elegir el caso exacto."
                        : "El historial y el compositor aparecerán aquí sin abrir otra pantalla."}</p>
                    </>
                  )}
                </div>
              )}
            </section>

          </div>
        </>
      )}
    </section>
  );
}

/**
 * Quién tiene a cargo el chat o la publicación abierta (lo mismo que muestra la Bandeja SAC). En un post
 * reúne a los responsables de sus comentarios abiertos, sin repetir; la persona que usa la vista es «Tú».
 */
function ManualOwnerChip({ owners, currentUserId, scope }: {
  owners: Array<{ userId: string; displayName: string } | undefined>;
  currentUserId?: string;
  scope: "chat" | "post";
}) {
  const unique = [...new Map(owners.filter((owner): owner is { userId: string; displayName: string } => Boolean(owner)).map((owner) => [owner.userId, owner])).values()];
  const names = unique.map((owner) => (owner.userId === currentUserId ? "Tú" : owner.displayName));
  const label = names.length ? names.join(", ") : "Sin asignar";
  const title = names.length
    ? `${scope === "post" ? "Responsables de los comentarios abiertos de este post" : "Responsable actual de este chat"}: ${label}`
    : scope === "post" ? "Nadie tiene a cargo los comentarios abiertos de este post" : "Nadie tiene a cargo este chat";
  return (
    <span className={`manual-inbox-owner${names.length ? "" : " manual-inbox-owner--none"}`} title={title}>
      {names.length ? <UserFocus size={15} weight="duotone" aria-hidden="true" /> : <UserPlus size={15} weight="duotone" aria-hidden="true" />}
      <span className="manual-inbox-owner__label">A cargo:</span>
      <strong>{label}</strong>
    </span>
  );
}
