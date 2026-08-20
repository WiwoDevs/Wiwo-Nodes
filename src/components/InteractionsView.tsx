import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  Check,
  CheckCircle,
  Export,
  FunnelSimple,
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

type FilterValue<T extends string> = T | "all";
type AssignmentFilter = "all" | "assigned" | "unassigned";
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
}: InteractionsViewProps) {
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState<FilterValue<SocialPlatform>>("all");
  const [kindFilter, setKindFilter] = useState<FilterValue<InteractionKind>>("all");
  const [statusFilter, setStatusFilter] = useState<FilterValue<InteractionStatus>>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all");
  const [selectedContactKeys, setSelectedContactKeys] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const availablePlatforms = useMemo(() => {
    const connected = new Set([
      ...accounts.flatMap((account) => account.channels.map((channel) => channel.platform)),
      ...interactions.map((interaction) => interaction.platform),
    ]);
    return SOCIAL_PLATFORM_OPTIONS.filter((option) => connected.has(option.id));
  }, [accounts, interactions]);

  const filteredInteractions = useMemo(() => {
    const normalizedQuery = normalize(query.trim());

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
        || (assignmentFilter === "assigned" ? Boolean(interaction.assignedTo) : !interaction.assignedTo);

      return matchesQuery && matchesAccount && matchesPlatform && matchesKind && matchesStatus && matchesAssignment;
    });
  }, [accountFilter, assignmentFilter, interactions, kindFilter, platformFilter, query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredInteractions.length / PAGE_SIZE));
  const visibleInteractions = filteredInteractions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filteredMessageCount = filteredInteractions.reduce(
    (total, interaction) => total + (interaction.conversationSummary?.messageCount ?? 1),
    0,
  );

  useEffect(() => {
    setPage(1);
  }, [accountFilter, assignmentFilter, kindFilter, platformFilter, query, statusFilter]);

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
    assignmentFilter !== "all";

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
    setAccountFilter("all");
    setPlatformFilter("all");
    setKindFilter("all");
    setStatusFilter("all");
    setAssignmentFilter("all");
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
            <ArrowClockwise
              className={isRefreshing ? "button__icon button__icon--spinning" : "button__icon"}
              size={17}
              weight="bold"
              aria-hidden="true"
            />
            {isRefreshing ? "Actualizando" : "Actualizar ahora"}
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => onExport?.(filteredInteractions)}
            disabled={!canExport || filteredInteractions.length === 0}
            title={!canExport ? "Requiere rol supervisor o administrador" : undefined}
          >
            <Export className="button__icon" size={17} weight="bold" aria-hidden="true" />
            Exportar vista
          </button>
        </div>
      </header>

      <div className="filter-bar" role="search" aria-label="Buscar y filtrar conversaciones">
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

        <label className="filter-field">
          <span className="filter-field__label">Cuenta</span>
          <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
            <option value="all">Todas las cuentas</option>
            {accounts.map((account) => (
              <option value={account.id} key={account.id}>{account.name}</option>
            ))}
          </select>
        </label>

        <label className="filter-field">
          <span className="filter-field__label">Asignación</span>
          <select
            value={assignmentFilter}
            onChange={(event) => setAssignmentFilter(event.target.value as AssignmentFilter)}
          >
            <option value="all">Todos los casos</option>
            <option value="unassigned">Sin asignar</option>
            <option value="assigned">Asignados</option>
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
          <button className="button button--ghost" type="button" onClick={() => setSelectedContactKeys(new Set())}>
            Cancelar selección
          </button>
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
            <strong>No encontramos conversaciones</strong>
            <p>Prueba otra búsqueda o limpia los filtros activos.</p>
            <button className="button button--secondary" type="button" onClick={clearFilters}>
              Limpiar filtros
            </button>
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
