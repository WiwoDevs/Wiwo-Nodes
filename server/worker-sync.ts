import type { WorkflowJob } from "./types.js";

/**
 * Cuánto espera el worker la respuesta de POST /api/sync. Una sincronización del portafolio
 * tarda ~2-3 min (a veces más); con 120 s el worker cortaba casi todas y las reintentaba.
 * El fetch de Node corta igual a los 300 s esperando cabeceras, así que se queda justo debajo:
 * si la API sigue trabajando, el reintento recibe SYNC_IN_PROGRESS o la respuesta guardada
 * por la clave de idempotencia.
 */
export const SYNC_REQUEST_TIMEOUT_MS = 290_000;

export type SyncJobOutcome =
  | { kind: "completed"; runId?: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; message: string };

interface SyncResponsePayload {
  data?: { run?: { id?: string } };
  error?: { code?: string; message?: string };
}

/** Las sincronizaciones programadas del portafolio llevan scheduleKey "sac:<workflow>:<bloque>". */
export function isScheduledPortfolioSync(job: Pick<WorkflowJob, "scheduleKey">): boolean {
  return Boolean(job.scheduleKey?.startsWith("sac:"));
}

/**
 * Traduce la respuesta de la API a lo que el worker hace con el trabajo. Si ya hay una
 * sincronización en curso, la programada se da por cubierta (la que corre lee el mismo
 * portafolio y la próxima llega en el siguiente intervalo) en vez de reintentarla hasta
 * que muera y aparezca como "trabajo fallido".
 */
export function classifySyncResponse(
  job: Pick<WorkflowJob, "scheduleKey">,
  status: number,
  payload: SyncResponsePayload | undefined,
): SyncJobOutcome {
  if (status >= 200 && status < 300) return { kind: "completed", runId: payload?.data?.run?.id };
  if (status === 409 && payload?.error?.code === "SYNC_IN_PROGRESS" && isScheduledPortfolioSync(job)) {
    return { kind: "skipped", reason: "SYNC_IN_PROGRESS" };
  }
  return { kind: "failed", message: payload?.error?.message || `API de sincronización respondió ${status}.` };
}
