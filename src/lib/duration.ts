/**
 * Formato legible de duraciones para las vistas operativas.
 *
 * Un agente lee "3 h 20 min" de un vistazo; "200 min" obliga a dividir mentalmente.
 * La unidad se elige según la magnitud y nunca se muestra más de dos niveles, para que
 * la cifra siga siendo comparable de una fila a otra.
 */

/** Convierte minutos en una etiqueta corta: "45 min", "3 h 20 min", "2 d 4 h". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "Sin datos";
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;

  const totalMinutes = Math.round(minutes);
  const hours = Math.floor(totalMinutes / 60);
  const restMinutes = totalMinutes % 60;
  if (hours < 24) {
    return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

/** Versión larga para descripciones y tooltips: "3 horas 20 minutos". */
export function describeMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "sin datos";
  if (minutes < 60) {
    const value = Math.round(minutes);
    return `${value} ${value === 1 ? "minuto" : "minutos"}`;
  }
  const hours = Math.round(minutes / 60 * 10) / 10;
  if (hours < 48) return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.round(minutes / 1440 * 10) / 10;
  return `${days} ${days === 1 ? "día" : "días"}`;
}
