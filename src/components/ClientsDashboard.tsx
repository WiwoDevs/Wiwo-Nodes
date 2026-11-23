/**
 * Tablero de Clientes: mensajes recibidos en el período (por defecto el mes en curso), con selector
 * por día, por mes o por un período personalizado, y el desglose por cliente y por red.
 *
 * Regla (la documentan README y docs/API_CONTRACT.md): cuenta los mensajes ENTRANTES (DMs,
 * comentarios y reseñas) que Metricool trajo a wiwo.sac, por día UTC como Reportes, de los clientes
 * visibles. No cuenta lo cargado a mano desde el Excel (`source: "planilla"`) ni lo que envió la
 * cuenta. Es volumen recibido: incluye spam y ruido; los casos SAC están en Reportes. Con el filtro
 * «En SAC» solo suma las redes marcadas de cada cuenta.
 */
import { useEffect, useMemo, useState } from "react";
import { ChatCircleDots, ChatsCircle, Buildings, TrendUp, WarningCircle } from "@phosphor-icons/react";
import type { BrandAccount, SocialPlatform } from "../types";
import { loadMessageVolume, type MessageVolumeRow } from "../lib/api";
import { platformLabel, SocialPlatformIcon } from "./SocialPlatformIcon";
import { ThinkingOrb } from "./ThinkingOrb";

export type PeriodMode = "day" | "month" | "range";
export type UsageScope = "sac" | "all";

const DAY_MS = 86_400_000;
const formatInteger = new Intl.NumberFormat("es-CL");
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function dayLabel(day: string, withWeekday = false): string {
  const date = new Date(`${day}T00:00:00Z`);
  const base = `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]}`;
  return withWeekday ? `${WEEKDAYS[date.getUTCDay()]} ${base}` : base;
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return `${MONTHS[monthNumber - 1]} ${year}`;
}

/** Período a consultar según el modo; null si el período personalizado no es válido. */
export function periodRange(mode: PeriodMode, day: string, month: string, rangeFrom: string, rangeTo: string): { from: string; to: string } | null {
  if (mode === "day") return day ? { from: day, to: day } : null;
  if (mode === "month") return month ? { from: `${month}-01`, to: lastDayOfMonth(month) } : null;
  if (!rangeFrom || !rangeTo || rangeFrom > rangeTo || daysBetween(rangeFrom, rangeTo) > 366) return null;
  return { from: rangeFrom, to: rangeTo };
}

function periodTitle(mode: PeriodMode, from: string, to: string): string {
  if (mode === "day") return dayLabel(from, true);
  if (mode === "month") return monthLabel(from.slice(0, 7));
  return `${dayLabel(from)} – ${dayLabel(to)} ${to.slice(0, 4)}`;
}

interface ChartBucket { key: string; label: string; detail: string; total: number }

export function ClientsDashboard({
  accounts,
  scope,
  totalsAccounts,
  onTotalsChange,
}: {
  /** Cuentas que entran en el tablero (ya filtradas por uso y por cuenta de Metricool). */
  accounts: BrandAccount[];
  scope: UsageScope;
  /** Cuentas cuyos totales se informan al filtro de cuentas (todas las del alcance, no solo la elegida). */
  totalsAccounts?: BrandAccount[];
  /** Mensajes del período por cuenta (para el filtro de cuentas). */
  onTotalsChange?: (totals: Record<string, number>) => void;
}) {
  const [mode, setMode] = useState<PeriodMode>("month");
  const [day, setDay] = useState(todayUtc);
  const [month, setMonth] = useState(() => todayUtc().slice(0, 7));
  const [rangeFrom, setRangeFrom] = useState(() => `${todayUtc().slice(0, 7)}-01`);
  const [rangeTo, setRangeTo] = useState(todayUtc);
  const [rows, setRows] = useState<MessageVolumeRow[]>([]);
  const [loadedRange, setLoadedRange] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const range = periodRange(mode, day, month, rangeFrom, rangeTo);
  const rangeKey = range ? `${range.from}|${range.to}` : null;
  const isLoading = Boolean(rangeKey) && loadedRange !== rangeKey && !error;

  useEffect(() => {
    if (!range) return undefined;
    const abort = new AbortController();
    setError(null);
    loadMessageVolume(range.from, range.to, abort.signal)
      .then((data) => {
        setRows(data.rows);
        setLoadedRange(`${data.from}|${data.to}`);
      })
      .catch((failure) => {
        if (abort.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : "No se pudieron cargar los mensajes.");
      });
    return () => abort.abort();
    // rangeKey resume el período: el objeto range cambia en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  /** Redes que cuentan por cuenta: con «En SAC», solo las marcadas. */
  const countedChannels = useMemo(() => new Map(accounts.map((account) => [
    account.id,
    new Set<SocialPlatform>(scope === "sac" ? account.sacChannels ?? [] : account.channels.map((channel) => channel.platform)),
  ])), [accounts, scope]);

  const counted = useMemo(
    () => rows.filter((row) => countedChannels.get(row.accountId)?.has(row.channel)),
    [countedChannels, rows],
  );

  // Totales por cuenta para el filtro de cuentas de Metricool: todas las cuentas del alcance.
  const totalsChannels = useMemo(() => new Map((totalsAccounts ?? accounts).map((account) => [
    account.id,
    new Set<SocialPlatform>(scope === "sac" ? account.sacChannels ?? [] : account.channels.map((channel) => channel.platform)),
  ])), [accounts, scope, totalsAccounts]);
  useEffect(() => {
    if (!onTotalsChange || loadedRange !== rangeKey) return;
    const totals: Record<string, number> = {};
    for (const row of rows) {
      if (!totalsChannels.get(row.accountId)?.has(row.channel)) continue;
      totals[row.accountId] = (totals[row.accountId] ?? 0) + row.total;
    }
    onTotalsChange(totals);
  }, [loadedRange, onTotalsChange, rangeKey, rows, totalsChannels]);

  const summary = useMemo(() => {
    let total = 0;
    let dms = 0;
    let comments = 0;
    const byAccount = new Map<string, { total: number; byChannel: Map<SocialPlatform, number> }>();
    const byChannel = new Map<SocialPlatform, number>();
    const byDay = new Map<string, number>();
    for (const row of counted) {
      total += row.total;
      dms += row.dms;
      comments += row.comments;
      const account = byAccount.get(row.accountId) ?? { total: 0, byChannel: new Map() };
      account.total += row.total;
      account.byChannel.set(row.channel, (account.byChannel.get(row.channel) ?? 0) + row.total);
      byAccount.set(row.accountId, account);
      byChannel.set(row.channel, (byChannel.get(row.channel) ?? 0) + row.total);
      byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.total);
    }
    return { total, dms, comments, byAccount, byChannel, byDay };
  }, [counted]);

  const days = range ? daysBetween(range.from, range.to) : 0;
  // Hasta hoy: los días futuros del mes en curso no bajan el promedio.
  const elapsedDays = range ? Math.max(1, daysBetween(range.from, range.to < todayUtc() ? range.to : todayUtc())) : 1;

  /** Barras por día (hasta 62 días) o por mes en períodos largos. */
  const buckets = useMemo<ChartBucket[]>(() => {
    if (!range || days <= 1) return [];
    if (days <= 62) {
      return Array.from({ length: days }, (_, index) => {
        const key = addDays(range.from, index);
        return { key, label: dayLabel(key), detail: dayLabel(key, true), total: summary.byDay.get(key) ?? 0 };
      });
    }
    const months = new Map<string, number>();
    for (let cursor = range.from; cursor <= range.to; cursor = addDays(cursor, 1)) {
      const key = cursor.slice(0, 7);
      months.set(key, (months.get(key) ?? 0) + (summary.byDay.get(cursor) ?? 0));
    }
    return [...months.entries()].map(([key, total]) => {
      const [year, monthNumber] = key.split("-").map(Number) as [number, number];
      return { key, label: `${SHORT_MONTHS[monthNumber - 1]} ${String(year).slice(2)}`, detail: monthLabel(key), total };
    });
  }, [days, range?.from, range?.to, summary.byDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const peak = buckets.reduce<ChartBucket | null>((best, bucket) => (!best || bucket.total > best.total ? bucket : best), null);
  const chartMax = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const tickEvery = Math.max(1, Math.ceil(buckets.length / 8));

  const accountRows = useMemo(() => accounts
    .map((account) => ({ account, data: summary.byAccount.get(account.id) }))
    .filter((item) => item.data && item.data.total > 0)
    .sort((left, right) => right.data!.total - left.data!.total || left.account.name.localeCompare(right.account.name, "es")),
  [accounts, summary.byAccount]);
  const channelColumns = useMemo(
    () => [...summary.byChannel.entries()].sort((left, right) => right[1] - left[1]).map(([channel]) => channel),
    [summary.byChannel],
  );
  const channelMax = Math.max(1, ...summary.byChannel.values());
  const accountsWithMessages = accountRows.length;
  const hoveredBucket = buckets.find((bucket) => bucket.key === hovered);

  return (
    <section className="clients-dashboard" aria-labelledby="clients-dashboard-title">
      <header className="clients-dashboard__header">
        <div>
          <span className="panel-kicker">Mensajes recibidos</span>
          <h2 id="clients-dashboard-title">{range ? periodTitle(mode, range.from, range.to) : "Elige un período"}</h2>
          <p>
            Entrantes sincronizados desde Metricool, por día UTC. {scope === "sac" ? "Solo las redes marcadas «En SAC»." : "Todas las redes de las cuentas visibles."}
          </p>
        </div>
        <div className="clients-period" role="group" aria-label="Período">
          <div className="clients-period__modes" role="radiogroup" aria-label="Tipo de período">
            {([["day", "Día"], ["month", "Mes"], ["range", "Período"]] as const).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={mode === value} className={mode === value ? "is-active" : ""} onClick={() => setMode(value)}>
                {label}
              </button>
            ))}
          </div>
          {mode === "day" ? (
            <label className="clients-period__field"><span className="sr-only">Día</span>
              <input type="date" value={day} max={todayUtc()} onChange={(event) => setDay(event.target.value)} />
            </label>
          ) : mode === "month" ? (
            <label className="clients-period__field"><span className="sr-only">Mes</span>
              <input type="month" value={month} max={todayUtc().slice(0, 7)} onChange={(event) => setMonth(event.target.value)} />
            </label>
          ) : (
            <>
              <label className="clients-period__field"><span className="sr-only">Desde</span>
                <input type="date" value={rangeFrom} max={rangeTo || todayUtc()} onChange={(event) => setRangeFrom(event.target.value)} />
              </label>
              <span className="clients-period__dash" aria-hidden="true">–</span>
              <label className="clients-period__field"><span className="sr-only">Hasta</span>
                <input type="date" value={rangeTo} min={rangeFrom} max={todayUtc()} onChange={(event) => setRangeTo(event.target.value)} />
              </label>
            </>
          )}
        </div>
      </header>

      {!range ? (
        <p className="clients-dashboard__notice" role="alert"><WarningCircle size={16} weight="fill" aria-hidden="true" /> Elige un período válido de hasta un año.</p>
      ) : error ? (
        <p className="clients-dashboard__notice" role="alert"><WarningCircle size={16} weight="fill" aria-hidden="true" /> {error}</p>
      ) : null}

      <div className="clients-stats" aria-busy={isLoading}>
        <div className="clients-stat clients-stat--lead">
          <span><ChatCircleDots size={16} weight="duotone" aria-hidden="true" /> Mensajes recibidos</span>
          <strong>{isLoading ? "—" : formatInteger.format(summary.total)}</strong>
          <small>{isLoading ? "Cargando…" : `${formatInteger.format(summary.dms)} DMs · ${formatInteger.format(summary.comments)} comentarios`}</small>
        </div>
        <div className="clients-stat">
          <span><Buildings size={16} weight="duotone" aria-hidden="true" /> Clientes con mensajes</span>
          <strong>{isLoading ? "—" : formatInteger.format(accountsWithMessages)}</strong>
          <small>{isLoading ? "Cargando…" : `de ${formatInteger.format(accounts.length)} en la vista`}</small>
        </div>
        <div className="clients-stat">
          <span><ChatsCircle size={16} weight="duotone" aria-hidden="true" /> Promedio diario</span>
          <strong>{isLoading ? "—" : formatInteger.format(Math.round(summary.total / elapsedDays))}</strong>
          <small>{isLoading ? "Cargando…" : days === 1 ? "un día" : `en ${formatInteger.format(elapsedDays)} días`}</small>
        </div>
        <div className="clients-stat">
          <span><TrendUp size={16} weight="duotone" aria-hidden="true" /> {days > 62 ? "Mes con más mensajes" : "Día con más mensajes"}</span>
          <strong>{isLoading || !peak || !peak.total ? "—" : formatInteger.format(peak.total)}</strong>
          <small>{isLoading ? "Cargando…" : peak && peak.total ? peak.detail : days === 1 ? "Elige un mes o un período" : "Sin mensajes"}</small>
        </div>
      </div>

      {buckets.length ? (
        <figure className="clients-chart" aria-label={`Mensajes recibidos por ${days > 62 ? "mes" : "día"}`}>
          <div className="clients-chart__plot" onMouseLeave={() => setHovered(null)}>
            <span className="clients-chart__max" aria-hidden="true">{formatInteger.format(chartMax)}</span>
            <div className="clients-chart__bars" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
              {buckets.map((bucket) => (
                <button
                  type="button"
                  key={bucket.key}
                  className={`clients-chart__bar${hovered === bucket.key ? " is-hovered" : ""}`}
                  onMouseEnter={() => setHovered(bucket.key)}
                  onFocus={() => setHovered(bucket.key)}
                  onBlur={() => setHovered(null)}
                  aria-label={`${bucket.detail}: ${formatInteger.format(bucket.total)} mensajes`}
                >
                  <span style={{ height: `${(bucket.total / chartMax) * 100}%` }} />
                </button>
              ))}
            </div>
            {hoveredBucket ? (
              <div className="clients-chart__tooltip" role="status" style={{ left: `${((buckets.indexOf(hoveredBucket) + 0.5) / buckets.length) * 100}%` }}>
                <strong>{formatInteger.format(hoveredBucket.total)}</strong> mensajes<br /><small>{hoveredBucket.detail}</small>
              </div>
            ) : null}
          </div>
          <div className="clients-chart__axis" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
            {buckets.map((bucket, index) => <span key={bucket.key}>{index % tickEvery === 0 ? bucket.label : ""}</span>)}
          </div>
        </figure>
      ) : null}

      <div className="clients-breakdown">
        <section className="clients-breakdown__networks" aria-labelledby="clients-networks-title">
          <h3 id="clients-networks-title">Por red</h3>
          {isLoading ? (
            <p className="clients-breakdown__empty"><ThinkingOrb size="sm" label="" /> Cargando…</p>
          ) : channelColumns.length ? (
            <ul>
              {channelColumns.map((channel) => {
                const value = summary.byChannel.get(channel) ?? 0;
                return (
                  <li key={channel}>
                    <span className="clients-network__name"><SocialPlatformIcon platform={channel} size={15} weight="fill" aria-hidden="true" />{platformLabel(channel)}</span>
                    <span className="clients-network__track" aria-hidden="true"><span style={{ width: `${(value / channelMax) * 100}%` }} /></span>
                    <strong>{formatInteger.format(value)}</strong>
                  </li>
                );
              })}
            </ul>
          ) : <p className="clients-breakdown__empty">Sin mensajes en el período.</p>}
        </section>

        <section className="clients-breakdown__clients" aria-labelledby="clients-by-client-title">
          <h3 id="clients-by-client-title">Por cliente</h3>
          {isLoading ? (
            <p className="clients-breakdown__empty"><ThinkingOrb size="sm" label="" /> Cargando…</p>
          ) : accountRows.length ? (
            <div className="table-scroll clients-breakdown__table" tabIndex={0} aria-label="Mensajes por cliente y red">
              <table className="data-table">
                <caption className="sr-only">Mensajes recibidos por cliente y red en el período</caption>
                <thead>
                  <tr>
                    <th scope="col">Cliente</th>
                    {channelColumns.map((channel) => (
                      <th scope="col" key={channel} className="is-numeric" title={platformLabel(channel)}>
                        <SocialPlatformIcon platform={channel} size={14} weight="fill" aria-hidden="true" />
                        <span className="sr-only">{platformLabel(channel)}</span>
                      </th>
                    ))}
                    <th scope="col" className="is-numeric">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {accountRows.map(({ account, data }) => (
                    <tr key={account.id}>
                      <th scope="row">
                        <span className="clients-breakdown__client">{account.name}</span>
                        {account.accountHandle ? <small>{account.accountHandle}</small> : null}
                      </th>
                      {channelColumns.map((channel) => (
                        <td key={channel} className="is-numeric">{data!.byChannel.get(channel) ? formatInteger.format(data!.byChannel.get(channel)!) : <span className="is-zero">—</span>}</td>
                      ))}
                      <td className="is-numeric"><strong>{formatInteger.format(data!.total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="clients-breakdown__empty">{scope === "sac" && !accounts.some((account) => account.sacChannels?.length) ? "Ninguna cuenta de la vista está marcada «En SAC»." : "Sin mensajes en el período."}</p>}
        </section>
      </div>
    </section>
  );
}
