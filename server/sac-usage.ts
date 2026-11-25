/**
 * Marca "En SAC": qué redes de cada cuenta usa hoy el equipo en SAC, y la cuenta de mensajes
 * recibidos del tablero de Clientes.
 *
 * La marca es solo una etiqueta para filtrar (Clientes y su tablero). No oculta nada, no deja de
 * sincronizar y no cambia la bandeja, Reportes ni METRIQ: las cuentas que no se usan en SAC siguen
 * visibles con todo su historial. La edita solo un admin principal, como la visibilidad de clientes.
 */
import type { Brand, CatalogStore, Channel, Interaction } from "./types.js";
import { isImportedHistory } from "./types.js";

/**
 * Cuentas que el equipo indicó que se usan en SAC (noviembre 2026). El calce es por nombre o
 * usuario de la cuenta (sin tildes, mayúsculas ni signos) y por red; nunca por IDs de Metricool.
 * `x` es Twitter. Lo que no calce se informa en el registro de arranque, no se inventa.
 */
export const SAC_USAGE_SEED: ReadonlyArray<{
  cliente: string;
  cuentas: ReadonlyArray<{ nombres: readonly string[]; redes: readonly Channel[]; nota?: string }>;
}> = [
  // En Metricool es «picharaoficial» y hoy no tiene redes conectadas: se marca sola apenas se vincule.
  { cliente: "Pichara", cuentas: [{ nombres: ["pichara", "picharaoficial", "pichara oficial"], redes: ["tiktok"] }] },
  {
    cliente: "Colbún",
    cuentas: [
      { nombres: ["colbun", "energiacolbun"], redes: ["tiktok", "instagram", "facebook", "linkedin", "x", "youtube"] },
      // El segundo perfil de LinkedIn de Colbún es su página de clientes.
      { nombres: ["colbun clientes", "colbun-clientes"], redes: ["linkedin"], nota: "segundo perfil de LinkedIn" },
    ],
  },
  { cliente: "Primeros Pueblos", cuentas: [{ nombres: ["primeros pueblos", "primerospueblos"], redes: ["instagram"] }] },
  { cliente: "Multiplaza Bogotá", cuentas: [{ nombres: ["multiplaza bogota", "multiplazabogota"], redes: ["instagram", "facebook", "tiktok"] }] },
  { cliente: "Converse", cuentas: [{ nombres: ["converse", "conversechile"], redes: ["instagram", "facebook"] }] },
  { cliente: "Umbro", cuentas: [{ nombres: ["umbro", "umbrochile"], redes: ["instagram", "facebook"] }] },
  { cliente: "Fila", cuentas: [{ nombres: ["fila", "fila cl", "filachile"], redes: ["instagram", "facebook"] }] },
  { cliente: "Coliseum", cuentas: [{ nombres: ["coliseum"], redes: ["instagram", "facebook"] }] },
  { cliente: "Steve Madden", cuentas: [{ nombres: ["steve madden", "stevemaddenchile", "stevemaddencl"], redes: ["instagram", "facebook"] }] },
  { cliente: "Anker", cuentas: [{ nombres: ["anker", "ankerchile"], redes: ["instagram", "facebook"] }] },
  { cliente: "Anker Argentina", cuentas: [{ nombres: ["anker argentina", "anker_arg"], redes: ["instagram", "facebook"] }] },
  { cliente: "Vans Colombia", cuentas: [{ nombres: ["vans colombia", "vanscolombia"], redes: ["instagram", "facebook"] }] },
  { cliente: "Truecaller", cuentas: [{ nombres: ["truecaller", "truecaller espanol", "truecaller.co"], redes: ["instagram", "facebook", "tiktok"] }] },
];

/** "Colbún Clientes", "@colbun-clientes" → "colbunclientes". */
export function normalizeAccountName(value: string): string {
  return value
    .toLocaleLowerCase("es-CL")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export interface SacUsageSeedPlan {
  /**
   * Cuentas a marcar y sus redes. Incluye redes aún no conectadas en Metricool (quedan «pendientes»
   * y valen solas cuando se conecten; p. ej. el TikTok de Truecaller, por pedido del usuario).
   */
  matches: Array<{ brandId: string; accountName: string; cliente: string; channels: Channel[] }>;
  /** Lo que no calzó: cliente sin cuenta, o red que la cuenta no tiene conectada en Metricool. */
  unmatched: Array<{ cliente: string; redes: Channel[]; motivo: "sin_cuenta" | "red_no_conectada" }>;
}

/** Calza la lista con el catálogo. Pura: no escribe. Considera solo clientes visibles. */
export function planSacUsageSeed(brands: Brand[]): SacUsageSeedPlan {
  const visible = brands.filter((brand) => brand.active && brand.account.active);
  const matches = new Map<string, SacUsageSeedPlan["matches"][number]>();
  const unmatched: SacUsageSeedPlan["unmatched"] = [];
  for (const entry of SAC_USAGE_SEED) {
    for (const cuenta of entry.cuentas) {
      const wanted = new Set(cuenta.nombres.map(normalizeAccountName));
      const found = visible.filter((brand) =>
        wanted.has(normalizeAccountName(brand.name))
        || wanted.has(normalizeAccountName(brand.account.name))
        || wanted.has(normalizeAccountName(brand.account.handle)));
      if (!found.length) {
        unmatched.push({ cliente: entry.cliente, redes: [...cuenta.redes], motivo: "sin_cuenta" });
        continue;
      }
      const missing = new Set(cuenta.redes);
      for (const brand of found) {
        cuenta.redes.filter((red) => brand.account.channels.includes(red)).forEach((red) => missing.delete(red));
        const channels = [...cuenta.redes];
        const current = matches.get(brand.id);
        matches.set(brand.id, {
          brandId: brand.id,
          accountName: brand.name,
          cliente: entry.cliente,
          channels: [...new Set([...(current?.channels ?? []), ...channels])],
        });
      }
      if (missing.size) unmatched.push({ cliente: entry.cliente, redes: [...missing], motivo: "red_no_conectada" });
    }
  }
  return { matches: [...matches.values()], unmatched };
}

/**
 * Precarga la marca una sola vez: solo si ninguna cuenta la tiene definida (ni siquiera vacía).
 * Después manda lo que edite un admin principal en Clientes, y desmarcar todo no la reactiva.
 */
export function shouldSeedSacUsage(store: Pick<CatalogStore, "brands">): boolean {
  return store.brands.every((brand) => brand.account.sacChannels === undefined);
}

export function applySacUsagePlan(store: Pick<CatalogStore, "brands">, plan: SacUsageSeedPlan): number {
  let marked = 0;
  for (const match of plan.matches) {
    const brand = store.brands.find((item) => item.id === match.brandId);
    if (!brand) continue;
    brand.account.sacChannels = [...match.channels];
    marked += 1;
  }
  return marked;
}

/**
 * Cuentas de la lista que aparecen después de la precarga (p. ej. Pichara, cuando conecte una red y
 * se vincule): se marcan solas si nadie les definió la marca todavía. Lo que un admin principal ya
 * editó en Clientes (aunque sea vacío) no se toca.
 */
export function planSacUsageForNewAccounts(brands: Brand[]): SacUsageSeedPlan["matches"] {
  return planSacUsageSeed(brands).matches.filter((match) =>
    brands.find((brand) => brand.id === match.brandId)?.account.sacChannels === undefined);
}

export interface MessageVolumeRow {
  /** Día UTC (AAAA-MM-DD), como Reportes. */
  date: string;
  brandId: string;
  accountId: string;
  channel: Channel;
  dms: number;
  comments: number;
  reviews: number;
  total: number;
}

/**
 * Mensajes recibidos: interacciones entrantes de clientes visibles creadas entre `from` y `to`
 * (días UTC, inclusive), agrupadas por día, cuenta y red. Excluye `source: "planilla"` (registros
 * cargados a mano desde el Excel: ya se atendieron fuera y su fecha es la de la bitácora) para
 * contar solo lo que llegó por Metricool. Cuenta todo lo entrante, también el spam y el ruido:
 * es volumen recibido, no casos SAC (esos están en Reportes).
 */
export function messageVolumeRows(
  interactions: Interaction[],
  visibleBrandIds: Set<string>,
  from: string,
  to: string,
): MessageVolumeRow[] {
  const rows = new Map<string, MessageVolumeRow>();
  for (const item of interactions) {
    if (item.direction !== "inbound" || item.source === "planilla" || isImportedHistory(item) || !visibleBrandIds.has(item.brandId)) continue;
    const time = Date.parse(item.createdAt);
    if (!Number.isFinite(time)) continue;
    const date = new Date(time).toISOString().slice(0, 10);
    if (date < from || date > to) continue;
    const key = `${date}|${item.accountId}|${item.channel}`;
    const row = rows.get(key) ?? { date, brandId: item.brandId, accountId: item.accountId, channel: item.channel, dms: 0, comments: 0, reviews: 0, total: 0 };
    if (item.type === "dm") row.dms += 1;
    else if (item.type === "comment") row.comments += 1;
    else row.reviews += 1;
    row.total += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => left.date.localeCompare(right.date) || left.accountId.localeCompare(right.accountId));
}
