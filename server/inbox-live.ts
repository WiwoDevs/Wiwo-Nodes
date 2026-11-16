/**
 * Bandeja en vivo: qué casos cambiaron y en qué revisión, y avisos a los navegadores abiertos.
 *
 * Todas las escrituras de casos del proceso de la API (respuestas, borradores, estados,
 * asignaciones, marcas para el reporte, sincronización con Metricool, archivado) pasan por
 * el repositorio. Este módulo envuelve sus métodos de escritura para anotar los ids que
 * cambiaron; cada avance de la revisión guarda esos ids en un registro corto. El navegador
 * pide "lo que cambió desde la revisión X" y recibe solo esos contactos, en vez de volver a
 * descargar la bandeja completa. Los cambios de catálogo (marcas, flujo) o los que no dicen
 * qué casos tocaron se anotan como "todo" y el navegador recarga completo.
 *
 * Los avisos (Server-Sent Events) llevan solo el número de revisión: cada navegador pide el
 * detalle con su propia sesión, así nadie recibe casos de marcas fuera de su alcance.
 */
import { randomUUID } from "node:crypto";
import type { SacFlowRepository } from "./repository-contract.js";

type ChangeSet = string[] | "all";

/** Revisiones que se recuerdan; una más antigua obliga al navegador a recargar completo. */
const MAX_LOG_ENTRIES = 1_000;
/** Un cambio fuera de una solicitud (tarea en segundo plano) avanza la revisión a este plazo. */
const BACKGROUND_FLUSH_MS = 750;
/** Conexiones en vivo simultáneas como máximo (protege la memoria del proceso). */
export const MAX_LIVE_CLIENTS = 300;

export type InboxChanges =
  | { revision: string; full: true }
  | { revision: string; full: false; interactionIds: string[] };

export class InboxChangeLog {
  private readonly prefix = randomUUID().slice(0, 8);
  private counter = 0;
  private readonly log: Array<{ seq: number; ids: ChangeSet }> = [];
  private pending = new Set<string>();
  private pendingAll = false;
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly listeners = new Set<(revision: string) => void>();

  revision(): string {
    return `${this.prefix}-${this.counter}`;
  }

  /** Anota casos cambiados; si nadie avanza la revisión pronto, se avanza sola. */
  record(ids: ChangeSet): void {
    if (ids === "all") this.pendingAll = true;
    else for (const id of ids) this.pending.add(id);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        if (this.pendingAll || this.pending.size) this.bump();
      }, BACKGROUND_FLUSH_MS);
      this.flushTimer.unref?.();
    }
  }

  /** Avanza la revisión con lo anotado hasta ahora y avisa a quien escuche. */
  bump(): string {
    this.counter += 1;
    this.log.push({ seq: this.counter, ids: this.pendingAll ? "all" : [...this.pending] });
    if (this.log.length > MAX_LOG_ENTRIES) this.log.splice(0, this.log.length - MAX_LOG_ENTRIES);
    this.pending = new Set();
    this.pendingAll = false;
    const revision = this.revision();
    for (const listener of this.listeners) {
      try {
        listener(revision);
      } catch {
        // Un aviso fallido no detiene a los demás.
      }
    }
    return revision;
  }

  onBump(listener: (revision: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Casos cambiados después de \`since\`; "full" si es de otro arranque, muy antigua o incluye "todo". */
  changesSince(since: string, maxIds = 2_000): InboxChanges {
    const revision = this.revision();
    const [prefix, rawSeq] = since.split("-");
    const sinceSeq = Number(rawSeq);
    if (prefix !== this.prefix || !Number.isInteger(sinceSeq) || sinceSeq < 0 || sinceSeq > this.counter) {
      return { revision, full: true };
    }
    if (sinceSeq === this.counter) return { revision, full: false, interactionIds: [] };
    const oldest = this.log[0]?.seq ?? this.counter + 1;
    if (sinceSeq + 1 < oldest) return { revision, full: true };
    const ids = new Set<string>();
    for (const entry of this.log) {
      if (entry.seq <= sinceSeq) continue;
      if (entry.ids === "all") return { revision, full: true };
      for (const id of entry.ids) ids.add(id);
      if (ids.size > maxIds) return { revision, full: true };
    }
    return { revision, full: false, interactionIds: [...ids] };
  }

  close(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.listeners.clear();
  }
}

/**
 * Devuelve el repositorio envuelto: sus métodos de escritura anotan qué casos cambiaron. Se
 * envuelve desde afuera (Proxy) y cada método corre sobre el repositorio original, así sus
 * llamadas internas (el JSON implementa `updateInteraction` con `mutate`) no se anotan dos
 * veces ni como "todo".
 */
export function trackInteractionChanges(repository: SacFlowRepository, changeLog: InboxChangeLog): SacFlowRepository {
  const interactionOf = (result: unknown): string[] => {
    const interaction = (result as { interaction?: { id?: string } } | undefined)?.interaction;
    return interaction?.id ? [interaction.id] : [];
  };
  const tracked: Record<string, (args: unknown[], result: unknown) => ChangeSet> = {
    updateInteraction: (args, result) => (result ? [String(args[0])] : []),
    mutateInteractions: (args) => (Array.isArray(args[0]) ? args[0].map(String) : "all"),
    insertInteractions: (_args, result) =>
      ((result as { created?: Array<{ id: string }> } | undefined)?.created ?? []).map((item) => item.id),
    settleReplyDelivery: (_args, result) => interactionOf(result),
    reconcileReplyDelivery: (_args, result) => interactionOf(result),
    // Sin ids conocidos: el navegador recarga la bandeja completa.
    mutate: () => "all",
    mutateCatalog: () => "all",
  };
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      const idsFrom = typeof property === "string" ? tracked[property] : undefined;
      if (!idsFrom) return (value as (...args: unknown[]) => unknown).bind(target);
      return async (...args: unknown[]) => {
        const result = await (value as (...values: unknown[]) => Promise<unknown>).apply(target, args);
        try {
          const ids = idsFrom(args, result);
          if (ids === "all" || ids.length) changeLog.record(ids);
        } catch {
          // Anotar es secundario: la escritura ya se hizo.
        }
        return result;
      };
    },
  });
}
