import {
  ArrowClockwise,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChatCircleText,
  CheckCircle,
  Clock,
  Export,
  Robot,
  WarningCircle,
} from "@phosphor-icons/react";
import type {
  BrandPerformance,
  DashboardKpi,
  Interaction,
} from "../types";
import { SocialPlatformIcon } from "./SocialPlatformIcon";
import { ContentContext } from "./ContentContext";

export interface DashboardViewProps {
  kpis: DashboardKpi[];
  brandPerformance: BrandPerformance[];
  recentInteractions: Interaction[];
  brandLimit?: number;
  isRefreshing?: boolean;
  canSync?: boolean;
  canExport?: boolean;
  onRefresh?: () => void;
  onExport?: () => void;
  onSelectBrand?: (accountId: string) => void;
  onOpenInteraction?: (interaction: Interaction) => void;
  onViewAllAccounts?: () => void;
  onViewAllInteractions?: () => void;
}

const formatInteger = new Intl.NumberFormat("es-CL");

function KpiIcon({ id }: Pick<DashboardKpi, "id">) {
  const iconProps = { size: 21, weight: "duotone" as const, "aria-hidden": true };

  if (id === "interactions") return <ChatCircleText {...iconProps} />;
  if (id === "pending") return <WarningCircle {...iconProps} />;
  if (id === "automation") return <Robot {...iconProps} />;
  return <Clock {...iconProps} />;
}

function PlatformIcon({ platform }: Pick<Interaction, "platform">) {
  return <SocialPlatformIcon platform={platform} size={16} weight="fill" aria-hidden="true" />;
}

function responseLabel(status: Interaction["status"]) {
  if (status === "automated") return "Respuesta automática";
  if (status === "answered_by_team") return "Respondido por el equipo";
  if (status === "needs_review") return "Revisión humana";
  if (status === "resolved") return "Resuelto";
  return "Sin responder";
}

export function DashboardView({
  kpis,
  brandPerformance,
  recentInteractions,
  brandLimit = 8,
  isRefreshing = false,
  canSync = true,
  canExport = true,
  onRefresh,
  onExport,
  onSelectBrand,
  onOpenInteraction,
  onViewAllAccounts,
  onViewAllInteractions,
}: DashboardViewProps) {
  const visibleBrands = brandPerformance.slice(0, brandLimit);

  return (
    <section className="app-view dashboard-view" aria-labelledby="dashboard-title">
      <header className="view-header">
        <div className="view-header__copy">
          <p className="view-header__eyebrow">Vista general</p>
          <h1 id="dashboard-title" className="view-header__title">
            Operación de atención al cliente
          </h1>
          <p className="view-header__description">
            Mensajes, comentarios, menciones y reseñas de todas las cuentas conectadas en un solo lugar.
          </p>
        </div>

        <div className="view-header__actions" aria-label="Acciones del resumen">
          <button
            className="button button--secondary"
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing || !canSync}
            title={!canSync ? "Requiere rol agente o superior" : undefined}
          >
            <ArrowClockwise
              className={isRefreshing ? "button__icon button__icon--spinning" : "button__icon"}
              size={17}
              weight="bold"
              aria-hidden="true"
            />
            {isRefreshing ? "Actualizando" : "Actualizar"}
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={onExport}
            disabled={!canExport}
            title={!canExport ? "Requiere rol supervisor o administrador" : undefined}
          >
            <Export className="button__icon" size={17} weight="bold" aria-hidden="true" />
            Exportar Excel
          </button>
        </div>
      </header>

      <div className="kpi-grid" aria-label="Indicadores principales">
        {kpis.map((kpi) => (
          <article className={`kpi-card kpi-card--${kpi.id}`} key={kpi.id}>
            <div className="kpi-card__topline">
              <span className="kpi-card__icon">
                <KpiIcon id={kpi.id} />
              </span>
              <span className={`trend trend--${kpi.trend}`}>
                {kpi.trend === "up" ? (
                  <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
                ) : kpi.trend === "down" ? (
                  <ArrowDownRight size={14} weight="bold" aria-hidden="true" />
                ) : null}
                {kpi.change}
              </span>
            </div>
            <p className="kpi-card__value">{kpi.value}</p>
            <h2 className="kpi-card__label">{kpi.label}</h2>
            <p className="kpi-card__detail">{kpi.detail}</p>
          </article>
        ))}
      </div>

      <div className="dashboard-grid">
        <article className="panel performance-panel">
          <header className="panel__header">
            <div>
              <h2 className="panel__title">Rendimiento por marca</h2>
              <p className="panel__description">
                Volumen y cobertura automática de las cuentas con mayor actividad.
              </p>
            </div>
            <button className="text-button" type="button" onClick={onViewAllAccounts}>
              Ver cuentas
              <ArrowRight size={15} weight="bold" aria-hidden="true" />
            </button>
          </header>

          <div className="table-scroll" tabIndex={0} aria-label="Tabla de rendimiento por marca">
            <table className="data-table performance-table">
              <caption className="sr-only">Rendimiento de las marcas con mayor actividad</caption>
              <thead>
                <tr>
                  <th scope="col">Marca</th>
                  <th scope="col">Interacciones</th>
                  <th scope="col">Pendientes</th>
                  <th scope="col">Automáticas</th>
                  <th scope="col">Tiempo medio</th>
                  <th scope="col">Tendencia</th>
                </tr>
              </thead>
              <tbody>
                {visibleBrands.map((brand) => (
                  <tr key={brand.accountId}>
                    <td>
                      <button
                        className="brand-cell brand-cell--button"
                        type="button"
                        onClick={() => onSelectBrand?.(brand.accountId)}
                        aria-label={`Abrir cuenta ${brand.brandName}`}
                      >
                        <span className="brand-avatar" aria-hidden="true">
                          {brand.initials}
                        </span>
                        <span className="brand-cell__copy">
                          <strong>{brand.brandName}</strong>
                          <small>{brand.handle}</small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <strong className="numeric-value">
                        {formatInteger.format(brand.totalInteractions)}
                      </strong>
                      <small className="cell-detail">
                        {formatInteger.format(brand.directMessages)} DMs, {formatInteger.format(brand.comments)} comentarios, {formatInteger.format(brand.reviews)} reseñas
                      </small>
                    </td>
                    <td>
                      <span className={brand.pending > 30 ? "numeric-value numeric-value--warning" : "numeric-value"}>
                        {brand.pending}
                      </span>
                    </td>
                    <td>
                      <span className="numeric-value">{brand.automaticResponseRate}%</span>
                    </td>
                    <td>
                      <span className="numeric-value">{brand.averageResponseMinutes} min</span>
                    </td>
                    <td>
                      <span
                        className={`trend trend--${brand.changePercent >= 0 ? "up" : "down"}`}
                        aria-label={`${Math.abs(brand.changePercent)} por ciento ${brand.changePercent >= 0 ? "de aumento" : "de disminución"}`}
                      >
                        {brand.changePercent >= 0 ? (
                          <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
                        ) : (
                          <ArrowDownRight size={14} weight="bold" aria-hidden="true" />
                        )}
                        {brand.changePercent >= 0 ? "+" : ""}{brand.changePercent}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="panel activity-panel" aria-labelledby="recent-activity-title">
          <header className="panel__header">
            <div>
              <h2 id="recent-activity-title" className="panel__title">Actividad reciente</h2>
              <p className="panel__description">Últimas entradas procesadas por Metricool.</p>
            </div>
          </header>

          {recentInteractions.length > 0 ? (
            <ol className="activity-list">
              {recentInteractions.map((interaction) => (
                <li className="activity-list__item" key={interaction.id}>
                  <button
                    className="activity-item"
                    type="button"
                    onClick={() => onOpenInteraction?.(interaction)}
                    aria-label={`Abrir interacción de ${interaction.customerName} en ${interaction.brandName}`}
                  >
                    <span className={`activity-item__platform activity-item__platform--${interaction.platform}`}>
                      <PlatformIcon platform={interaction.platform} />
                    </span>
                    <span className="activity-item__content">
                      <span className="activity-item__meta">
                        <strong>{interaction.brandName}</strong>
                        <small>{interaction.receivedAtLabel}</small>
                      </span>
                      <span className="activity-item__preview">
                        <ContentContext text={interaction.preview} context={interaction.contentContext} compact />
                      </span>
                      <span className={`status-badge status-badge--${interaction.status}`}>
                        {interaction.status === "resolved" || interaction.status === "answered_by_team" ? (
                          <CheckCircle size={14} weight="fill" aria-hidden="true" />
                        ) : interaction.status === "automated" ? (
                          <Robot size={14} weight="fill" aria-hidden="true" />
                        ) : null}
                        {responseLabel(interaction.status)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty-state">
              <CheckCircle size={25} weight="duotone" aria-hidden="true" />
              <strong>No hay actividad reciente</strong>
              <p>Las nuevas interacciones aparecerán después de la próxima sincronización.</p>
            </div>
          )}

          <footer className="panel__footer">
            <button className="text-button text-button--wide" type="button" onClick={onViewAllInteractions}>
              Ver todas las interacciones
              <ArrowRight size={15} weight="bold" aria-hidden="true" />
            </button>
          </footer>
        </aside>
      </div>
    </section>
  );
}
