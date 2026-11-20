import { useEffect, useMemo, useState } from "react";
import { deadlineLabel, isExpired, needsAction, replyDeadline } from "../lib/reply-window";
import { AccountFilter } from "./AccountFilter";
import { useMinuteTick } from "../lib/use-minute-tick";
import {
  ArrowClockwise,
  Check,
  CheckCircle,
  Export,
  FunnelSimple,
  HandGrabbing,
  MagnifyingGlass,
  PaperPlaneTilt,
  Robot,
  UserFocus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type {
  BrandAccount,
  InboxSyncStatus,
  Interaction,
  InteractionKind,
  InteractionStatus,
  SocialPlatform,
} from "../types";
import {
  interactionKindLabel,
  platformLabel,
  SOCIAL_PLATFORM_OPTIONS,
  SocialPlatformIcon,
} from "./SocialPlatformIcon";
import { ContentContext } from "./ContentContext";
import { BusyOrb } from "./ThinkingOrb";

type FilterValue<T extends string> = T | "all";
/** `user:<userId>` filtra por responsable; solo Supervisor/Admin (canFilterByPerson). */
export type AssignmentFilter = "all" | "assigned" | "unassigned" | "mine" | `user:${string}`;
/**
 * Plazo de respuesta de Meta: por defecto se ocultan los casos vencidos (histórico).
 * `actionable` deja solo lo por atender (sin responder o en revisión) dentro de plazo,
 * lo mismo que cuenta el panel Equipo del Inicio.
 */
type DeadlineFilter = "hide_expired" | "actionable" | "expired" | "all";

/** Filtros recordados por navegador (no la búsqueda): al volver, la bandeja queda como estaba. */
const FILTERS_STORAGE_KEY = "wiwo-nodes.inbox-filters.v1";
type StoredFilters = {
  account?: string;
  assignment?: AssignmentFilter;
  platform?: string;
  kind?: string;
  status?: string;
  deadline?: DeadlineFilter;
};

function readStoredFilters(): StoredFilters {
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return parsed && typeof parsed === "object" ? parsed as StoredFilters : {};
  } catch {
    return {};
  }
}

function writeStoredFilters(filters: StoredFilters): void {
  try {
    window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): la bandeja funciona igual, solo no recuerda.
  }
}

const ASSIGNMENT_VALUES: AssignmentFilter[] = ["all", "assigned", "unassigned", "mine"];
const DEADLINE_VALUES: DeadlineFilter[] = ["hide_expired", "actionable", "expired", "all"];
const PERSON_PREFIX = "user:";

function personFilterUserId(filter: AssignmentFilter): string | undefined {
  return filter.startsWith(PERSON_PREFIX) ? filter.slice(PERSON_PREFIX.length) : undefined;
}

/** Un filtro por otra persona solo vale para quien puede verlo; si no, vuelve a "todos". */
function validAssignment(value: unknown, canFilterByPerson: boolean): AssignmentFilter | undefined {
  if (typeof value !== "string") return undefined;
  if ((ASSIGNMENT_VALUES as string[]).includes(value)) return value as AssignmentFilter;
  return canFilterByPerson && value.startsWith(PERSON_PREFIX) && value.length > PERSON_PREFIX.length
    ? value as AssignmentFilter
    : undefined;
}
const PAGE_SIZE = 50;

export interface InteractionsViewProps {
  interactions: Interaction[];
  accounts: BrandAccount[];
  isRefreshing?: boolean;
  canWrite?: boolean;
  canSync?: boolean;
  canExport?: boolean;
  lastUpdatedAt?: string;
  refreshIssue?: string | null;
  inboxSync?: InboxSyncStatus;
  onRefresh?: () => void | Promise<void>;
  onProcessProtocol?: () => void | Promise<void>;
  onExport?: (interactions: Interaction[]) => void;
  onOpenInteraction?: (interaction: Interaction) => void;
  onSendAutomaticResponse?: (interaction: Interaction) => void | Promise<void>;
  onSendAutomaticResponses?: (interactions: Interaction[]) => void | Promise<void>;
  onResolveInteraction?: (interaction: Interaction) => void | Promise<void>;
  /** Archivar como histórico los casos fuera de plazo (permiso inbox.archive_expired). */
  canArchiveExpired?: boolean;
  onArchiveExpired?: (scope: { accountId?: string; type?: "dm" | "comment" }) => void | Promise<void>;
  /** Persona en sesión, para el filtro "Mis casos". */
  currentUserId?: string;
  /** Puede filtrar por otra persona responsable (Supervisor/Admin: metrics.read o inbox.assign_others). */
  canFilterByPerson?: boolean;
  /**
   * Filtro pedido desde el panel Equipo del Inicio: deja solo esa asignación y los casos por
   * atender en plazo, sin los demás filtros. Se aplica una vez y se avisa con onFocusApplied.
   */
  focus?: { assignment: AssignmentFilter; label?: string };
  onFocusApplied?: () => void;
  /** Puede tomarse casos (permiso inbox.assign). */
  canAssign?: boolean;
  /** Asigna a la persona el caso indicado y lo abre. */
  onTakeNext?: (interaction: Interaction) => void | Promise<void>;
  /** Orden visible (filtros y orden aplicados), para pasar al caso siguiente desde el detalle. */
  onVisibleOrderChange?: (interactions: Interaction[]) => void;
  /** Puede marcar mensajes como caso o ruido para el reporte (permiso inbox.triage). */
  canTriage?: boolean;
  /** Marca en lote las conversaciones elegidas como caso o ruido para el reporte. */
  onBulkTriage?: (contactKeys: string[], esCasoSac: boolean) => boolean | Promise<boolean>;
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase("es-CL")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function shortDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sin fecha";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function syncRunLabel(status?: InboxSyncStatus["lastRunStatus"]): string {
  if (status === "success") return "correcta";
  if (status === "partial") return "parcial";
  if (status === "failed") return "fallida";
  return "sin ejecuciones";
}

function responseLabel(status: InteractionStatus) {
  if (status === "automated") return "Respuesta automática";
  if (status === "answered_by_team") return "Respondido por el equipo";
  if (status === "needs_review") return "Revisión humana";
  if (status === "resolved") return "Resuelto";
  return "Sin responder";
}

function automationRouteLabel(interaction: Interaction): string | undefined {
  const route = interaction.automation?.effectiveRoute;
  if (!route) return undefined;
  if (route === "auto_reply") return "Elegible para auto-respuesta";
  if (route === "draft") return "Borrador seguro";
  if (route === "human_review") return "Revisión obligatoria";
  if (route === "quarantine") return "Cuarentena";
  return "Sin acción";
}

function contactIdentity(interaction: Interaction): string {
  return interaction.contactKey || interaction.id;
}

function includesKind(interaction: Interaction, kind: InteractionKind): boolean {
  const summary = interaction.conversationSummary;
  if (!summary) return interaction.kind === kind;
  if (kind === "dm") return summary.dmCount > 0;
  if (kind === "comment") return summary.commentCount > 0;
  return summary.reviewCount > 0;
}

function presentKinds(interaction: Interaction): string {
  const summary = interaction.conversationSummary;
  if (!summary) return interactionKindLabel(interaction.kind);
  return [
    summary.dmCount ? `${summary.dmCount} DM${summary.dmCount === 1 ? "" : "s"}` : "",
    summary.commentCount ? `${summary.commentCount} comentario${summary.commentCount === 1 ? "" : "s"}` : "",
    summary.reviewCount ? `${summary.reviewCount} reseña${summary.reviewCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
}

function PlatformMark({ platform }: { platform: SocialPlatform }) {
  return <SocialPlatformIcon platform={platform} size={16} weight="fill" aria-hidden="true" />;
}

function StatusMark({ status }: { status: InteractionStatus }) {
  const props = { size: 15, weight: "fill" as const, "aria-hidden": true };
  if (status === "automated") return <Robot {...props} />;
  if (status === "answered_by_team") return <CheckCircle {...props} />;
  if (status === "needs_review") return <UserFocus {...props} />;
  if (status === "resolved") return <CheckCircle {...props} />;
  return <WarningCircle {...props} />;
}


export function InteractionsView({
  interactions,
  accounts,
  isRefreshing = false,
  canWrite = true,
  canSync = true,
  canExport = true,
  lastUpdatedAt,
  refreshIssue = null,
  inboxSync,
  onRefresh,
  onProcessProtocol,
  onExport,
  onOpenInteraction,
  onSendAutomaticResponse,
  onSendAutomaticResponses,
  onResolveInteraction,
  canArchiveExpired = false,
  onArchiveExpired,
  currentUserId,
  canFilterByPerson = false,
  focus,
  onFocusApplied,
  canAssign = false,
  onTakeNext,
  onVisibleOrderChange,
  canTriage = false,
  onBulkTriage,
}: InteractionsViewProps) {
  const [stored] = useState(readStoredFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  // La búsqueda filtra ~11.000 filas: se aplica cuando la persona deja de escribir.
  const [searchQuery, setSearchQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState(stored.account || "all");
  const [platformFilter, setPlatformFilter] = useState<FilterValue<SocialPlatform>>((stored.platform as FilterValue<SocialPlatform>) || "all");
  const [kindFilter, setKindFilter] = useState<FilterValue<InteractionKind>>((stored.kind as FilterValue<InteractionKind>) || "all");
  const [statusFilter, setStatusFilter] = useState<FilterValue<InteractionStatus>>((stored.status as FilterValue<InteractionStatus>) || "all");
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>(
    () => validAssignment(stored.assignment, canFilterByPerson) ?? "all",
  );
  // Nombre de la persona pedida desde el Inicio, por si ya no le quedan casos visibles.
  const [focusLabel, setFocusLabel] = useState<{ assignment: AssignmentFilter; label: string }>();
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>(
    stored.deadline && DEADLINE_VALUES.includes(stored.deadline) ? stored.deadline : "hide_expired",
  );

  useEffect(() => {
    if (!focus) return;
    const assignment = validAssignment(focus.assignment, canFilterByPerson);
    if (assignment) {
      setQuery("");
      setSearchQuery("");
      setAccountFilter("all");
      setPlatformFilter("all");
      setKindFilter("all");
      setStatusFilter("all");
      setAssignmentFilter(assignment);
      setDeadlineFilter("actionable");
      setFocusLabel(focus.label ? { assignment, label: focus.label } : undefined);
    }
    onFocusApplied?.();
  }, [canFilterByPerson, focus, onFocusApplied]);

  // Sin permiso para ver a otras personas (cambio de rol), el filtro por responsable se quita.
  useEffect(() => {
    if (!canFilterByPerson && personFilterUserId(assignmentFilter)) setAssignmentFilter("all");
  }, [assignmentFilter, canFilterByPerson]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchQuery(query), 200);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    writeStoredFilters({
      account: accountFilter,
      assignment: assignmentFilter,
      platform: platformFilter,
      kind: kindFilter,
      status: statusFilter,
      deadline: deadlineFilter,
    });
  }, [accountFilter, assignmentFilter, deadlineFilter, kindFilter, platformFilter, statusFilter]);

  // Una cuenta recordada que ya no está (desactivada, sin acceso) vuelve a "todas".
  useEffect(() => {
    if (accountFilter !== "all" && accounts.length && !accounts.some((account) => account.id === accountFilter)) {
      setAccountFilter("all");
    }
  }, [accountFilter, accounts]);
  const [selectedContactKeys, setSelectedContactKeys] = useState<Set<string>>(() => new Set());
  // Referencia de tiempo para los plazos; se renueva con cada actualización de la bandeja.
  // Los plazos vencen solos: se recalcula con cada cambio y cada minuto.
  const minuteTick = useMinuteTick();
  const now = useMemo(() => Date.now(), [interactions, minuteTick]);
  const [page, setPage] = useState(1);
  const availablePlatforms = useMemo(() => {
    const connected = new Set([
      ...accounts.flatMap((account) => account.channels.map((channel) => channel.platform)),
      ...interactions.map((interaction) => interaction.platform),
    ]);
    return SOCIAL_PLATFORM_OPTIONS.filter((option) => connected.has(option.id));
  }, [accounts, interactions]);

  const filteredInteractions = useMemo(() => {
    const normalizedQuery = normalize(searchQuery.trim());
    const personUserId = personFilterUserId(assignmentFilter);

    return interactions.filter((interaction) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        normalize(
          `${interaction.brandName} ${interaction.customerName} ${interaction.customerHandle} ${interaction.preview} ${interaction.assignee ?? ""}`,
        ).includes(normalizedQuery);
      const matchesAccount = accountFilter === "all" || interaction.accountId === accountFilter;
      const matchesPlatform = platformFilter === "all" || interaction.platform === platformFilter;
      const matchesKind = kindFilter === "all" || includesKind(interaction, kindFilter);
      const matchesStatus = statusFilter === "all" || interaction.status === statusFilter;
      const matchesAssignment = assignmentFilter === "all"
        || (assignmentFilter === "mine"
          ? Boolean(currentUserId) && interaction.assignedTo?.userId === currentUserId
          : personUserId
            ? interaction.assignedTo?.userId === personUserId
            : assignmentFilter === "assigned" ? Boolean(interaction.assignedTo) : !interaction.assignedTo);
      const expired = isExpired(interaction, now);
      const matchesDeadline = deadlineFilter === "all"
        || (deadlineFilter === "expired" ? expired
          : deadlineFilter === "actionable" ? needsAction(interaction) && !expired
            : !expired);

      return matchesQuery && matchesAccount && matchesPlatform && matchesKind && matchesStatus && matchesAssignment && matchesDeadline;
    })
      // Primero lo que requiere acción y, dentro de eso, lo que vence antes (sin plazo al
      // final); el resto mantiene el orden del servidor (actividad más reciente primero).
      .map((interaction, index) => ({
        interaction,
        index,
        actionable: needsAction(interaction),
        deadline: needsAction(interaction) && !isExpired(interaction, now) ? replyDeadline(interaction) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY,
      }))
      .sort((left, right) =>
        Number(right.actionable) - Number(left.actionable)
        || left.deadline - right.deadline
        || left.index - right.index)
      .map(({ interaction }) => interaction);
  }, [accountFilter, assignmentFilter, currentUserId, deadlineFilter, interactions, kindFilter, now, platformFilter, searchQuery, statusFilter]);

  useEffect(() => {
    onVisibleOrderChange?.(filteredInteractions);
  }, [filteredInteractions, onVisibleOrderChange]);

  /** Personas con casos asignados, para el filtro por responsable (Supervisor/Admin). */
  const assigneeOptions = useMemo(() => {
    if (!canFilterByPerson) return [];
    const people = new Map<string, string>();
    for (const interaction of interactions) {
      if (interaction.assignedTo && interaction.assignedTo.userId !== currentUserId) {
        people.set(interaction.assignedTo.userId, interaction.assignedTo.displayName);
      }
    }
    const selected = personFilterUserId(assignmentFilter);
    if (selected && !people.has(selected)) {
      people.set(selected, selected === currentUserId
        ? "Tú"
        : focusLabel?.assignment === assignmentFilter ? focusLabel.label : "Persona sin casos visibles");
    }
    return [...people].map(([userId, displayName]) => ({ userId, displayName }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "es"));
  }, [assignmentFilter, canFilterByPerson, currentUserId, focusLabel, interactions]);
  const selectedPersonId = personFilterUserId(assignmentFilter);
  const selectedPersonName = selectedPersonId
    ? assigneeOptions.find((option) => option.userId === selectedPersonId)?.displayName
    : undefined;

  /** Casos por atender en plazo por cuenta (para el filtro de cuenta). */
  const inWindowCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const interaction of interactions) {
      if (needsAction(interaction) && !isExpired(interaction, now)) counts[interaction.accountId] = (counts[interaction.accountId] ?? 0) + 1;
    }
    return counts;
  }, [interactions, now]);

  /** Siguiente caso para tomar: sin asignar, por atender, en plazo, el que vence antes. */
  const nextToTake = useMemo(() => filteredInteractions.find((interaction) =>
    needsAction(interaction) && !isExpired(interaction, now) && !interaction.assignedTo && interaction.version !== undefined),
  [filteredInteractions, now]);

  // Casos fuera de plazo con los demás filtros aplicados (para el aviso y el archivado).
  const expiredInScope = useMemo(() => interactions.filter((interaction) =>
    isExpired(interaction, now)
    && (accountFilter === "all" || interaction.accountId === accountFilter)
    && (kindFilter === "all" || includesKind(interaction, kindFilter))).length,
  [accountFilter, interactions, kindFilter, now]);

  const totalPages = Math.max(1, Math.ceil(filteredInteractions.length / PAGE_SIZE));
  const visibleInteractions = filteredInteractions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filteredMessageCount = filteredInteractions.reduce(
    (total, interaction) => total + (interaction.conversationSummary?.messageCount ?? 1),
    0,
  );

  useEffect(() => {
    setPage(1);
  }, [accountFilter, assignmentFilter, deadlineFilter, kindFilter, platformFilter, searchQuery, statusFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    const availableContactKeys = new Set(interactions.map(contactIdentity));
    setSelectedContactKeys((current) => {
      const next = new Set([...current].filter((key) => availableContactKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [interactions]);

  const eligibleVisibleInteractions = visibleInteractions.filter(
    (interaction) => canWrite
      && interaction.status === "pending"
      && interaction.conversationSummary?.hasReplyTarget !== false,
  );
  const selectedInteractions = interactions.filter((interaction) => selectedContactKeys.has(contactIdentity(interaction)));
  const allEligibleSelected =
    eligibleVisibleInteractions.length > 0 &&
    eligibleVisibleInteractions.every((interaction) => selectedContactKeys.has(contactIdentity(interaction)));
  const hasActiveFilters =
    query.length > 0 ||
    accountFilter !== "all" ||
    platformFilter !== "all" ||
    kindFilter !== "all" ||
    statusFilter !== "all" ||
    assignmentFilter !== "all" ||
    deadlineFilter !== "hide_expired";
  const activeFilterCount = [
    accountFilter !== "all",
    assignmentFilter !== "all",
    platformFilter !== "all",
    kindFilter !== "all",
    statusFilter !== "all",
    deadlineFilter !== "hide_expired",
  ].filter(Boolean).length;

  const toggleSelection = (contactKey: string) => {
    setSelectedContactKeys((current) => {
      const next = new Set(current);
      if (next.has(contactKey)) next.delete(contactKey);
      else next.add(contactKey);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedContactKeys((current) => {
      const next = new Set(current);
      eligibleVisibleInteractions.forEach((interaction) => {
        const contactKey = contactIdentity(interaction);
        if (allEligibleSelected) next.delete(contactKey);
        else next.add(contactKey);
      });
      return next;
    });
  };

  const sendAutomaticResponse = (interaction: Interaction) => {
    if (interaction.conversationSummary?.hasReplyTarget === false) return;
    setSelectedContactKeys((current) => {
      const next = new Set(current);
      next.delete(contactIdentity(interaction));
      return next;
    });
    void onSendAutomaticResponse?.(interaction);
  };

  const sendBulkAutomaticResponses = () => {
    const eligible = selectedInteractions.filter((interaction) =>
      canWrite
      && interaction.status === "pending"
      && interaction.conversationSummary?.hasReplyTarget !== false);
    if (eligible.length === 0) return;

    setSelectedContactKeys(new Set());
    void onSendAutomaticResponses?.(eligible);
  };

  const resolveInteraction = (interaction: Interaction) => {
    void onResolveInteraction?.(interaction);
  };

  const clearFilters = () => {
    setQuery("");
    setSearchQuery("");
    setAccountFilter("all");
    setPlatformFilter("all");
    setKindFilter("all");
    setStatusFilter("all");
    setAssignmentFilter("all");
    setDeadlineFilter("hide_expired");
  };

  return (
    <section className="app-view interactions-view" aria-labelledby="interactions-title">
      <header className="view-header">
        <div className="view-header__copy">
          <p className="view-header__eyebrow">Bandeja multicuenta</p>
          <h1 id="interactions-title" className="view-header__title">Conversaciones</h1>
          <p className="view-header__description">
            Una fila por persona reúne sus mensajes, comentarios y reseñas para responder con todo el contexto.
          </p>
        </div>

        <div className="view-header__actions" aria-label="Acciones de conversaciones">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void onProcessProtocol?.()}
            disabled={isRefreshing || !canWrite}
            title={!canWrite ? "Requiere rol agente o superior" : "Evalúa pendientes sin escribir en Metricool"}
          >
            <Robot size={17} weight="bold" aria-hidden="true" />
            Protocolo SAC
          </button>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void onRefresh?.()}
            disabled={isRefreshing || !canSync}
            title={!canSync ? "Requiere rol agente o superior" : "Consulta Metricool y vuelve a leer la bandeja sin salir de esta vista"}
            aria-busy={isRefreshing}
          >
            {isRefreshing ? <BusyOrb /> : <ArrowClockwise className="button__icon" size={17} weight="bold" aria-hidden="true" />}
            {isRefreshing ? "Actualizando" : "Actualizar ahora"}
          </button>
          {onTakeNext && canAssign ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => { if (nextToTake) void onTakeNext(nextToTake); }}
              disabled={!canAssign || !nextToTake || isRefreshing}
              title={!canAssign
                ? "Tu rol no permite tomar casos"
                : nextToTake
                  ? `Te asigna y abre ${nextToTake.customerName} (${deadlineLabel(nextToTake, now) ?? "sin plazo"})`
                  : "No hay casos en plazo sin asignar con estos filtros"}
            >
              <HandGrabbing size={17} weight="bold" aria-hidden="true" />
              Tomar siguiente
            </button>
          ) : null}
          {canExport ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => onExport?.(filteredInteractions)}
              disabled={filteredInteractions.length === 0}
            >
              <Export className="button__icon" size={17} weight="bold" aria-hidden="true" />
              Exportar vista
            </button>
          ) : null}
        </div>
      </header>

      <button
        className="button button--secondary filters-toggle"
        type="button"
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen((current) => !current)}
      >
        <FunnelSimple size={16} weight="bold" aria-hidden="true" />
        {filtersOpen ? "Ocultar filtros" : `Filtros${activeFilterCount ? ` (${activeFilterCount})` : ""}`}
      </button>

      <div className={`filter-bar${filtersOpen ? " is-open" : ""}`} role="search" aria-label="Buscar y filtrar conversaciones">
        <label className="search-field">
          <span className="sr-only">Buscar conversaciones</span>
          <MagnifyingGlass className="search-field__icon" size={18} aria-hidden="true" />
          <input
            className="search-field__input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar persona, marca o último mensaje"
          />
          {query ? (
            <button
              className="icon-button search-field__clear"
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => setQuery("")}
            >
              <X size={16} weight="bold" aria-hidden="true" />
            </button>
          ) : null}
        </label>

        <div className="filter-field">
          <span className="filter-field__label">Cuenta</span>
          <AccountFilter accounts={accounts} value={accountFilter} onChange={setAccountFilter} inWindowCounts={inWindowCounts} />
        </div>

        <label className="filter-field">
          <span className="filter-field__label">Asignación</span>
          <select
            value={assignmentFilter}
            onChange={(event) => setAssignmentFilter(event.target.value as AssignmentFilter)}
          >
            <option value="all">Todos los casos</option>
            {currentUserId ? <option value="mine">Mis casos</option> : null}
            <option value="unassigned">Sin asignar</option>
            <option value="assigned">Asignados</option>
            {assigneeOptions.length ? (
              <optgroup label="Responsable">
                {assigneeOptions.map((option) => (
                  <option key={option.userId} value={`${PERSON_PREFIX}${option.userId}`}>{option.displayName}</option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>

        <label className="filter-field">
          <span className="filter-field__label">Canal</span>
          <select
            value={platformFilter}
            onChange={(event) => setPlatformFilter(event.target.value as FilterValue<SocialPlatform>)}
          >
            <option value="all">Todos</option>
            {availablePlatforms.map((platform) => (
              <option value={platform.id} key={platform.id}>{platform.label}</option>
            ))}
          </select>
        </label>

        <label className="filter-field">
          <span className="filter-field__label">Tipo</span>
          <select
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value as FilterValue<InteractionKind>)}
          >
            <option value="all">Todos</option>
            <option value="dm">DMs</option>
            <option value="comment">Comentarios</option>
            <option value="review">Reseñas</option>
          </select>
        </label>

        <label className="filter-field">
          <span className="filter-field__label">Plazo</span>
          <select
            value={deadlineFilter}
            onChange={(event) => setDeadlineFilter(event.target.value as DeadlineFilter)}
            title="Meta permite responder DMs hasta 7 días y comentarios hasta 24 horas después del último mensaje del cliente"
          >
            <option value="hide_expired">Ocultar vencidas</option>
            <option value="actionable">Por atender en plazo</option>
            <option value="expired">Solo fuera de plazo</option>
            <option value="all">Todas</option>
          </select>
        </label>

        <label className="filter-field">
          <span className="filter-field__label">Estado</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as FilterValue<InteractionStatus>)}
          >
            <option value="all">Todos los estados</option>
            <option value="pending">Sin responder</option>
            <option value="answered_by_team">Respondido por el equipo</option>
            <option value="automated">Respuesta automática</option>
            <option value="needs_review">Revisión humana</option>
            <option value="resolved">Resuelto</option>
          </select>
        </label>

        {hasActiveFilters ? (
          <button className="filter-reset" type="button" onClick={clearFilters}>
            <FunnelSimple size={16} weight="bold" aria-hidden="true" />
            Limpiar
          </button>
        ) : null}
      </div>

      <div className="results-toolbar">
        <p className="results-toolbar__count" aria-live="polite">
          <strong>{filteredInteractions.length}</strong> conversaciones · <strong>{filteredMessageCount}</strong> mensajes
          {selectedPersonName || assignmentFilter === "unassigned" || assignmentFilter === "mine" ? (
            <span className="results-toolbar__chip">
              {selectedPersonName ? `Responsable: ${selectedPersonName}` : assignmentFilter === "mine" ? "Mis casos" : "Sin asignar"}
              {deadlineFilter === "actionable" ? " · por atender en plazo" : ""}
              <button
                type="button"
                className="results-toolbar__chip-clear"
                aria-label="Quitar el filtro de responsable"
                title="Quitar el filtro de responsable"
                onClick={() => {
                  setAssignmentFilter("all");
                  if (deadlineFilter === "actionable") setDeadlineFilter("hide_expired");
                }}
              >
                <X size={12} weight="bold" aria-hidden="true" />
              </button>
            </span>
          ) : null}
          {deadlineFilter === "hide_expired" && expiredInScope ? (
            <button className="results-toolbar__expired" type="button" onClick={() => setDeadlineFilter("expired")}>
              {new Intl.NumberFormat("es-CL").format(expiredInScope)} fuera de plazo ocultas
            </button>
          ) : null}
        </p>
        <div className="results-toolbar__meta">
          <p className="results-toolbar__hint">
            El protocolo solo genera borradores o deriva casos; no envía nada a Metricool.
          </p>
          <p
            className={`results-toolbar__freshness${refreshIssue ? " results-toolbar__freshness--warning" : ""}`}
            title={refreshIssue ?? undefined}
          >
            <span>{refreshIssue ? "Datos con retraso; reintentando" : "Vista automática cada 30 s"}</span>
            {lastUpdatedAt ? (
              <time dateTime={lastUpdatedAt}>Vista actualizada {shortDateTime(lastUpdatedAt)}</time>
            ) : (
              <span>Esperando primera lectura</span>
            )}
            {inboxSync?.enabled ? (
              inboxSync.lastRunAt ? (
                <time dateTime={inboxSync.lastRunAt}>
                  Última sync Metricool {shortDateTime(inboxSync.lastRunAt)} ({syncRunLabel(inboxSync.lastRunStatus)})
                </time>
              ) : (
                <span>Metricool cada {inboxSync.intervalMinutes} min, sin ejecución confirmada</span>
              )
            ) : (
              <span>Sync programada de Metricool desactivada</span>
            )}
          </p>
        </div>
      </div>

      {selectedContactKeys.size > 0 ? (
        <div className="selection-bar" role="region" aria-label="Acciones para conversaciones seleccionadas">
          <span className="selection-bar__count">
            <Check size={16} weight="bold" aria-hidden="true" />
            {selectedContactKeys.size} conversaciones seleccionadas
          </span>
          <button className="button button--primary" type="button" onClick={sendBulkAutomaticResponses}>
            <Robot size={17} weight="bold" aria-hidden="true" />
            Crear borradores
          </button>
          {canTriage && onBulkTriage ? (
            <button
              className="button button--secondary"
              type="button"
              title="No cuentan como casos en el reporte mensual (reacciones, menciones, spam)"
              onClick={async () => {
                if (await onBulkTriage([...selectedContactKeys], false)) setSelectedContactKeys(new Set());
              }}
            >
              No es caso (ruido)
            </button>
          ) : null}
          <button className="button button--ghost" type="button" onClick={() => setSelectedContactKeys(new Set())}>
            Cancelar selección
          </button>
        </div>
      ) : null}

      {deadlineFilter === "expired" && expiredInScope > 0 ? (
        <div className="expired-banner" role="note">
          <span>
            <strong>{new Intl.NumberFormat("es-CL").format(expiredInScope)} casos fuera del plazo de respuesta.</strong>
            {" "}Meta ya no garantiza que se puedan responder; igual puedes abrir uno e intentarlo.
            {canArchiveExpired ? " Archivarlos los cierra como histórico en wiwo.sac (no borra nada en Metricool) y deja los casos sensibles para revisión humana." : ""}
          </span>
          {canArchiveExpired && onArchiveExpired ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void onArchiveExpired({
                ...(accountFilter !== "all" ? { accountId: accountFilter } : {}),
                ...(kindFilter === "dm" || kindFilter === "comment" ? { type: kindFilter } : {}),
              })}
            >
              Archivar fuera de plazo
            </button>
          ) : null}
        </div>
      ) : null}

      <article className="panel interactions-panel">
        {filteredInteractions.length > 0 ? (
          <div className="table-scroll" tabIndex={0} aria-label="Listado de conversaciones">
            <table className="data-table interactions-table">
              <caption className="sr-only">Conversaciones filtradas de las plataformas conectadas</caption>
              <thead>
                <tr>
                  <th scope="col" className="selection-column">
                    <input
                      type="checkbox"
                      checked={allEligibleSelected}
                      onChange={toggleAllVisible}
                      aria-label="Seleccionar todas las conversaciones sin responder visibles"
                    />
                  </th>
                  <th scope="col">Conversación</th>
                  <th scope="col">Cuenta</th>
                  <th scope="col">Canal</th>
                  <th scope="col">Última actividad</th>
                  <th scope="col">Respuesta</th>
                  <th scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleInteractions.map((interaction) => {
                  const contactKey = contactIdentity(interaction);
                  const hasReplyTarget = interaction.conversationSummary?.hasReplyTarget !== false;
                  const isEligible = canWrite && interaction.status === "pending" && hasReplyTarget;
                  const isSelected = selectedContactKeys.has(contactKey);

                  return (
                    <tr
                      key={contactKey}
                      className={isSelected ? "data-table__row data-table__row--selected" : "data-table__row"}
                    >
                      <td className="selection-column">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!isEligible}
                          onChange={() => toggleSelection(contactKey)}
                          aria-label={`Seleccionar conversación con ${interaction.customerName}`}
                        />
                      </td>
                      <td>
                        <button
                          className="conversation-cell"
                          type="button"
                          onClick={() => onOpenInteraction?.(interaction)}
                        >
                          <span className="conversation-cell__contact">
                            <strong>{interaction.customerName}</strong>
                            <small>{interaction.customerHandle}</small>
                            <small className="conversation-cell__count">
                              {interaction.conversationSummary?.messageCount ?? 1}{" "}
                              {(interaction.conversationSummary?.messageCount ?? 1) === 1 ? "mensaje" : "mensajes"}
                            </small>
                            {(interaction.conversationSummary?.pendingCount ?? 0) > 0 ? (
                              <small className="conversation-cell__pending">
                                {interaction.conversationSummary?.pendingCount}{" "}
                                {interaction.conversationSummary?.pendingCount === 1 ? "pendiente" : "pendientes"}
                              </small>
                            ) : null}
                          </span>
                          <span className="conversation-cell__preview">
                            {interaction.conversationSummary?.latestDirection === "outbound" ? <strong>Equipo: </strong> : null}
                            <ContentContext text={interaction.preview} context={interaction.contentContext} compact />
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="brand-cell brand-cell--compact">
                          <span className="brand-avatar brand-avatar--small" aria-hidden="true">
                            {interaction.brandInitials}
                          </span>
                          <span className="brand-cell__copy">
                            <strong>{interaction.brandName}</strong>
                            {interaction.assignee ? <small>Responsable: {interaction.assignee}</small> : null}
                             {interaction.priority !== "normal" ? (
                              <small className={`priority-label priority-label--${interaction.priority}`}>
                                {interaction.priority === "urgent" ? "Urgente" : "Prioridad alta"}
                              </small>
                             ) : null}
                            {interaction.conversationSummary?.assignmentConflict ? (
                              <small className="assignment-conflict">Asignación en conflicto</small>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className={`channel-label channel-label--${interaction.platform}`}>
                          <PlatformMark platform={interaction.platform} />
                          <span>
                            {platformLabel(interaction.platform)}
                            <small>{presentKinds(interaction)}</small>
                          </span>
                        </span>
                      </td>
                      <td>
                        <time dateTime={interaction.receivedAt} className="time-label">
                          {interaction.receivedAtLabel}
                        </time>
                      </td>
                      <td>
                        <span className={`status-badge status-badge--${interaction.status}`}>
                          <StatusMark status={interaction.status} />
                          {responseLabel(interaction.status)}
                        </span>
                        {interaction.responseSummary ? (
                          <small className="cell-detail">{interaction.responseSummary}</small>
                        ) : null}
                        {automationRouteLabel(interaction) ? (
                          <small className={`automation-route automation-route--${interaction.automation?.effectiveRoute}`}>
                            {automationRouteLabel(interaction)}
                          </small>
                        ) : null}
                        {needsAction(interaction) && deadlineLabel(interaction, now) ? (
                          <small className={`deadline-label${isExpired(interaction, now) ? " deadline-label--expired" : (replyDeadline(interaction) ?? Infinity) - now < 24 * 60 * 60 * 1_000 ? " deadline-label--soon" : ""}`}>
                            {deadlineLabel(interaction, now)}
                          </small>
                        ) : null}
                      </td>
                      <td className="actions-cell">
                        {interaction.status === "pending" && canWrite && hasReplyTarget ? (
                          <button
                            className="row-action row-action--primary"
                            type="button"
                            onClick={() => sendAutomaticResponse(interaction)}
                          >
                            <PaperPlaneTilt size={15} weight="bold" aria-hidden="true" />
                            Borrador
                          </button>
                        ) : interaction.status === "needs_review" ? (
                          <button
                            className="row-action"
                            type="button"
                            onClick={() => onOpenInteraction?.(interaction)}
                          >
                            <UserFocus size={15} weight="bold" aria-hidden="true" />
                            Revisar
                          </button>
                        ) : interaction.status === "automated" && canWrite && hasReplyTarget ? (
                          <button
                            className="row-action"
                            type="button"
                            onClick={() => resolveInteraction(interaction)}
                          >
                            <CheckCircle size={15} weight="bold" aria-hidden="true" />
                            Resolver
                          </button>
                        ) : (
                          <button
                            className="row-action"
                            type="button"
                            onClick={() => onOpenInteraction?.(interaction)}
                          >
                            Abrir
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state empty-state--large">
            <MagnifyingGlass size={28} weight="duotone" aria-hidden="true" />
            {hasActiveFilters ? (
              <>
                <strong>No encontramos conversaciones</strong>
                <p>Prueba otra búsqueda o limpia los filtros activos.</p>
                <button className="button button--secondary" type="button" onClick={clearFilters}>
                  Limpiar filtros
                </button>
              </>
            ) : (
              <>
                <strong>Aún no hay conversaciones</strong>
                <p>Aparecerán aquí después de la próxima sincronización con Metricool.</p>
              </>
            )}
          </div>
        )}
      </article>
      {filteredInteractions.length > PAGE_SIZE ? (
        <nav className="table-pagination" aria-label="Paginación de conversaciones">
          <button className="button button--secondary" type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>
            Anterior
          </button>
          <span>Página <strong>{page}</strong> de {totalPages} · {PAGE_SIZE} conversaciones por página</span>
          <button className="button button--secondary" type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}>
            Siguiente
          </button>
        </nav>
      ) : null}
    </section>
  );
}
