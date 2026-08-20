import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
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
  accounts: BrandAccount[];
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
  lastUpdatedAt?: string;
  refreshIssue?: string | null;
  statusReasons: StatusReasonCatalog;
  onSelectAccount: (account: BrandAccount) => void | Promise<void>;
  onSelectInteraction: (interaction: Interaction) => void | Promise<void>;
  onRefreshAccount?: (account: BrandAccount) => void | Promise<void>;
  onSaveDraft: (detail: InteractionDetail, text: string) => void | Promise<void>;
  onSendReply: (detail: InteractionDetail, text: string) => boolean | Promise<boolean>;
  onResolve: (detail: InteractionDetail, reasonCode: string, reasonNote?: string) => boolean | Promise<boolean>;
  onEscalate: (detail: InteractionDetail, reasonCode: string, reasonNote?: string) => boolean | Promise<boolean>;
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
  const thumbnail = safeHttpsUrl(context?.thumbnailUrl);
  return (
    <section className={`manual-inbox-post-preview${thumbnail ? "" : " manual-inbox-post-preview--no-media"}`} aria-label="Publicación comentada">
      <div className="manual-inbox-post-preview__media">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <ImageSquare size={30} weight="duotone" aria-hidden="true" />
        )}
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
  lastUpdatedAt,
  refreshIssue = null,
  statusReasons,
  onSelectAccount,
  onSelectInteraction,
  onRefreshAccount,
  onSaveDraft,
  onSendReply,
  onResolve,
  onEscalate,
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
}: ManualManagementViewProps) {
  const [activeSurfaceId, setActiveSurfaceId] = useState<ManualSurfaceId>("all");
  const [query, setQuery] = useState("");
  const [onlyPending, setOnlyPending] = useState(true);
  const [draftText, setDraftText] = useState("");
  const [isDraftDirty, setDraftDirty] = useState(false);
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const activeDetailIdRef = useRef<string | null>(null);
  const draftDirtyRef = useRef(false);

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const accountInteractions = useMemo(
    () => selectedAccountId
      ? interactions.filter((interaction) => interaction.accountId === selectedAccountId)
      : [],
    [interactions, selectedAccountId],
  );
  const visibleDetail = detail?.accountId === selectedAccountId
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
      for (const kind of surfaceKinds(platform)) {
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
          label: `${platformLabel(platform)} · ${surfaceLabel(kind)}`,
          count,
        });
      }
    }
    return [
      { id: "all", label: "Todos", count: tabs.reduce((total, tab) => total + tab.count, 0) },
      ...tabs,
    ];
  }, [accountInteractions, postSummaries, selectedAccount]);

  useEffect(() => {
    setActiveSurfaceId("all");
    setQuery("");
    setOnlyPending(true);
  }, [selectedAccountId]);

  useEffect(() => {
    if (!surfaceTabs.some((tab) => tab.id === activeSurfaceId)) setActiveSurfaceId("all");
  }, [activeSurfaceId, surfaceTabs]);

  const activeTab = surfaceTabs.find((tab) => tab.id === activeSurfaceId) ?? surfaceTabs[0]!;
  const isCommentSurface = activeTab.kind === "comment";
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
    return source
      .filter(isOpenInboundComment)
      .sort((left, right) =>
        timestamp(left.receivedAt) - timestamp(right.receivedAt)
        || left.id.localeCompare(right.id));
  }, [isCommentSurface, postComments, postCommentsPostKey, selectedEntry]);
  const selectedCommentIsOpen = !isCommentSurface
    || Boolean(visibleDetail && selectedPendingComments.some((comment) => comment.id === visibleDetail.id));
  const postOrderDetail = entries.some((entry) => entry.postSortSource === "latest_comment_at")
    ? "fecha faltante: orden por actividad"
    : "más nuevas primero";
  const timeline = useMemo(
    () => visibleDetail ? timelineFor(visibleDetail) : [],
    [visibleDetail],
  );
  const aiRecommendation = visibleDetail?.automation?.proposal?.text?.trim() || "";
  const caseClosed = visibleDetail ? detailIsClosed(visibleDetail) : true;
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
      // La recomendación debe ser una ayuda explícita, no un borrador implícito.
      setDraftText(visibleDetail.responseText || "");
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

  const confirmDiscardDraft = (): boolean => {
    if (!draftDirtyRef.current) return true;
    return window.confirm("Hay una respuesta sin guardar. ¿Descartarla y cambiar de selección?");
  };

  const requestAccountChange = (accountId: string) => {
    const account = accounts.find((item) => item.id === accountId);
    if (!account || account.id === selectedAccountId || !confirmDiscardDraft()) return;
    setDirty(false);
    void onSelectAccount(account);
  };

  const requestInteractionChange = (interaction: Interaction) => {
    if (interaction.id === selectedInteractionId || isSaving || !confirmDiscardDraft()) return;
    setDirty(false);
    void onSelectInteraction(interaction);
  };

  const requestEntryChange = (entry: ManualInboxEntry) => {
    if (entry.postKey && entry.postKey === selectedPostKey) return;
    if (!entry.postKey && entry.target.id === selectedInteractionId) return;
    if (isSaving || !confirmDiscardDraft()) return;
    setDirty(false);
    if (entry.postSummary && onSelectPost) {
      void onSelectPost(entry.postSummary);
      return;
    }
    void onSelectInteraction(entry.target);
  };

  const requestSurfaceChange = (surfaceId: ManualSurfaceId) => {
    if (surfaceId === activeSurfaceId || !confirmDiscardDraft()) return;
    setDirty(false);
    setActiveSurfaceId(surfaceId);
  };

  const requestClearSelection = () => {
    if (!onClearSelection || isSaving || !confirmDiscardDraft()) return;
    setDirty(false);
    onClearSelection();
  };

  const updateDraft = (value: string) => {
    setDraftText(value);
    setDirty(true);
  };

  const openStatusAction = (action: StatusAction) => {
    const options = statusReasons[action];
    setStatusAction(action);
    setReasonCode(options[0]?.code || "");
    setReasonNote("");
  };

  const statusOptions = statusAction ? statusReasons[statusAction] : [];
  const selectedReason = statusOptions.find((option) => option.code === reasonCode);

  return (
    <section className="manual-inbox-view" aria-labelledby="manual-inbox-title">
      <header className="manual-inbox-header">
        <div className="manual-inbox-header__copy">
          <p>Operación humana por cuenta</p>
          <h1 id="manual-inbox-title">Gestión manual</h1>
          <span>Revisa el contexto completo y confirma cada respuesta antes de enviarla.</span>
        </div>
        <div className="manual-inbox-account-picker">
          <label htmlFor="manual-inbox-account">Cuenta obligatoria</label>
          <select
            id="manual-inbox-account"
            value={selectedAccountId ?? ""}
            onChange={(event) => requestAccountChange(event.target.value)}
            disabled={accounts.length === 0 || isSaving}
            required
          >
            <option value="" disabled>Selecciona una cuenta</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.accountHandle || account.channels[0]?.username || account.id}
              </option>
            ))}
          </select>
          {selectedAccount && onRefreshAccount ? (
            <button
              className="manual-inbox-refresh"
              type="button"
              onClick={() => void onRefreshAccount(selectedAccount)}
              disabled={!canRefresh || isRefreshing || isSaving}
              aria-busy={isRefreshing}
              title={!canRefresh ? "Requiere permisos de operación" : "Sincronizar únicamente esta cuenta"}
            >
              <ArrowClockwise size={17} weight="bold" aria-hidden="true" />
              {isRefreshing ? "Actualizando" : "Actualizar cuenta"}
            </button>
          ) : null}
          <div className="manual-inbox-refresh-status" aria-live="polite">
            {lastUpdatedAt ? <small>Vista actualizada: {formatDateTime(lastUpdatedAt)}</small> : null}
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
                <span className={`manual-inbox-health manual-inbox-health--${selectedAccount.health}`}>
                  {selectedAccount.healthDetail}
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
                    <ArrowClockwise size={24} weight="duotone" aria-hidden="true" />
                    <strong>Cargando publicaciones</strong>
                    <p>Ordenaremos los posts del más nuevo al más antiguo.</p>
                  </div>
                ) : entries.map((entry) => {
                  const selected = entry.items.some((interaction) => interaction.id === selectedInteractionId)
                    || Boolean(entry.postKey && selectedPostKey && entry.postKey === selectedPostKey)
                    || Boolean(!entry.postId && selectedContactKey
                      && entry.items.some((interaction) => interaction.contactKey === selectedContactKey));
                  const postContext = entry.postSummary?.postContext ?? entry.target.postContext;
                  const postThumbnail = entry.postId ? safeHttpsUrl(postContext?.thumbnailUrl) : undefined;
                  const entryTitle = entry.postId
                    ? postContext?.caption?.trim() || `Publicación ${entry.postId}`
                    : entry.target.customerName;
                  const entrySubtitle = entry.postId
                    ? `${countLabel(entry.messageCount, "comentario", "comentarios")} · ${countLabel(entry.participantCount ?? new Set(entry.items.map((item) => item.customerHandle)).size, "persona", "personas")}`
                    : entry.target.customerHandle;
                  const entryDateTime = entry.postId ? entry.postSortAt ?? entry.latest.receivedAt : entry.latest.receivedAt;
                  const entryDateLabel = entry.postId
                    ? `${entry.postSortSource === "published_at" ? "Publicado" : "Actividad"} ${formatDateTime(entryDateTime)}`
                    : entry.latest.receivedAtLabel;
                  return (
                    <button
                      className={`manual-inbox-contact${selected ? " is-selected" : ""}`}
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
                        {postThumbnail ? (
                          <img src={postThumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
                        ) : entry.postId ? (
                          <ImageSquare size={20} weight="duotone" aria-hidden="true" />
                        ) : (
                          entry.target.customerName.slice(0, 2).toLocaleUpperCase("es-CL")
                        )}
                      </span>
                      <span className="manual-inbox-contact__body">
                        <span className="manual-inbox-contact__topline">
                          <strong>{entryTitle}</strong>
                          <time dateTime={entryDateTime}>{entryDateLabel}</time>
                        </span>
                        <small>{entrySubtitle}</small>
                        <p>
                          {entry.postId
                            ? <b>{entry.latest.customerName}: </b>
                            : (entry.latest.conversationSummary?.latestDirection ?? entry.latest.direction) === "outbound" ? <b>Equipo: </b> : null}
                          <ContentContext text={entry.latest.preview} context={entry.latest.contentContext} compact />
                        </p>
                        <span className="manual-inbox-contact__meta">
                          <span>
                            <SocialPlatformIcon platform={entry.target.platform} size={14} weight="fill" aria-hidden="true" />
                            {interactionKindLabel(entry.target.kind)}
                          </span>
                          <span>{entry.postId
                            ? countLabel(entry.messageCount, "comentario", "comentarios")
                            : countLabel(entry.messageCount, "mensaje", "mensajes")}</span>
                          {entry.postId
                            ? <em>{entry.pendingCount} sin responder</em>
                            : entry.pendingCount ? <em>{entry.pendingCount} pendientes</em> : null}
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
                  <ArrowClockwise size={27} weight="duotone" aria-hidden="true" />
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
                      <span className="manual-inbox-conversation-header__avatar" aria-hidden="true">
                        {isCommentSurface ? <ImageSquare size={20} weight="duotone" /> : visibleDetail.customerName.slice(0, 2).toLocaleUpperCase("es-CL")}
                      </span>
                      <div>
                        <strong>{isCommentSurface ? "Comentarios de la publicación" : visibleDetail.customerName}</strong>
                        <small>{isCommentSurface
                          ? `${selectedPendingComments.length} sin responder · ${platformLabel(visibleDetail.platform)} · caso seleccionado: ${visibleDetail.customerName}`
                          : `${visibleDetail.customerHandle} · ${platformLabel(visibleDetail.platform)}`}</small>
                      </div>
                    </div>
                    <div className="manual-inbox-conversation-header__actions">
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
                      {onOpenFullDetail ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (!confirmDiscardDraft()) return;
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

                  {selectedContext && (isCommentSurface || visibleDetail.kind === "comment" || selectedListInteraction?.kind === "comment") ? (
                    <PostPreview context={selectedContext} />
                  ) : null}

                  {isCommentSurface && selectedEntry ? (
                    <section className="manual-inbox-exact-comments" aria-label="Comentarios exactos de la publicación">
                      <header>
                        <div>
                          <strong>Comentarios sin responder</strong>
                          <small>Del más antiguo al más reciente para proteger el SLA.</small>
                        </div>
                        <span aria-live="polite">{selectedPendingComments.length} pendientes</span>
                      </header>
                      {selectedPendingComments.length ? (
                        <ol aria-label="Comentarios abiertos, del más antiguo al más reciente">
                          {selectedPendingComments.map((interaction) => {
                            const selected = interaction.id === visibleDetail.id;
                            return (
                              <li key={interaction.id}>
                                <button
                                  className={selected ? "is-selected" : ""}
                                  type="button"
                                  onClick={() => requestInteractionChange(interaction)}
                                  disabled={isSaving}
                                  aria-current={selected ? "true" : undefined}
                                >
                                  <span className="manual-inbox-comment__avatar" aria-hidden="true">
                                    {interaction.customerName.slice(0, 2).toLocaleUpperCase("es-CL")}
                                  </span>
                                  <span className="manual-inbox-comment__body">
                                    <span className="manual-inbox-comment__topline">
                                      <strong>{interaction.customerName}</strong>
                                      <time dateTime={interaction.receivedAt}>{formatDateTime(interaction.receivedAt)}</time>
                                    </span>
                                    <small>
                                      {interaction.customerHandle} · {statusLabel(interaction)} · prioridad {priorityLabel(interaction.priority).toLocaleLowerCase("es-CL")}
                                      {interaction.assignedTo?.displayName ? ` · ${interaction.assignedTo.displayName}` : " · sin asignar"}
                                    </small>
                                    <p><ContentContext text={interaction.preview} context={interaction.contentContext} compact /></p>
                                    <em>{selected ? "Seleccionado para responder" : "Seleccionar y responder"}</em>
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
                      <small>{timeline.length} mensajes · selección {visibleDetail.id}</small>
                    </header>
                    <ol>
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
                      <div className="manual-inbox-reply-target" aria-live="polite">
                        <strong>Respondiendo a {visibleDetail.customerName}</strong>
                        <ContentContext text={visibleDetail.text} context={visibleDetail.contentContext} />
                      </div>
                    ) : null}
                    <div className="manual-inbox-recommendation">
                      <span><Sparkle size={17} weight="fill" aria-hidden="true" /></span>
                      <div>
                        <strong>Recomendación IA</strong>
                        <small>
                          {visibleDetail.automation?.knowledge.status === "approved"
                            ? "Basada en QA aprobado por la marca"
                            : "Sugerencia para revisión humana; no se enviará automáticamente"}
                        </small>
                        <p>{aiRecommendation || "No hay recomendación disponible para este caso."}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateDraft(aiRecommendation)}
                        disabled={!canWrite || isSaving || caseClosed || !aiRecommendation}
                      >
                        Usar sugerencia
                      </button>
                    </div>

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
                    <textarea
                      id="manual-inbox-draft"
                      value={draftText}
                      onChange={(event) => updateDraft(event.target.value)}
                      rows={3}
                      maxLength={10_000}
                      disabled={!canWrite || isSaving || caseClosed}
                      placeholder="Escribe una respuesta humana para este caso"
                    />
                    <small className={`manual-inbox-draft-state${isDraftDirty ? " is-dirty" : ""}`} aria-live="polite">
                      {isDraftDirty
                        ? "Cambios locales sin guardar; se pedirá confirmación antes de cambiar de caso."
                        : "Borrador sincronizado con el caso seleccionado."}
                    </small>

                    {caseClosed ? (
                      <p className="manual-inbox-closed-note">Este caso ya no requiere respuesta.</p>
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
                        onClick={async () => {
                          const text = draftText.trim();
                          if (!text) return;
                          const confirmed = window.confirm(
                            `¿Enviar esta respuesta manual a ${visibleDetail.customerName}? La acción se realizará sobre el caso exacto seleccionado.`,
                          );
                          if (!confirmed) return;
                          const sent = await onSendReply(visibleDetail, text);
                          if (sent) setDirty(false);
                        }}
                        disabled={!canWrite || isSaving || caseClosed || deliveryBlocksSend || !selectedCommentIsOpen || visibleDetail.direction !== "inbound" || !draftText.trim()}
                      >
                        <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" />
                        Enviar manualmente
                      </button>
                    </div>

                    {statusAction ? (
                      <form
                        className="manual-inbox-status-form"
                        onSubmit={async (event) => {
                          event.preventDefault();
                          if (!reasonCode || (selectedReason?.noteRequired && !reasonNote.trim())) return;
                          if (draftDirtyRef.current && !window.confirm("La respuesta local no está guardada. ¿Continuar con el cambio de estado?")) return;
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
                        <label htmlFor="manual-inbox-reason">Motivo</label>
                        <select id="manual-inbox-reason" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} required>
                          {statusOptions.map((option) => <option value={option.code} key={option.code}>{option.label}</option>)}
                        </select>
                        <label htmlFor="manual-inbox-reason-note">Nota interna</label>
                        <textarea
                          id="manual-inbox-reason-note"
                          value={reasonNote}
                          onChange={(event) => setReasonNote(event.target.value)}
                          rows={2}
                          maxLength={500}
                          required={selectedReason?.noteRequired}
                          placeholder={selectedReason?.noteRequired ? "Explica el motivo" : "Opcional"}
                        />
                        <button type="submit" disabled={isSaving || !reasonCode || Boolean(selectedReason?.noteRequired && !reasonNote.trim())}>
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
