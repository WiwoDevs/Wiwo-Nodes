import { useEffect, useState } from "react";

/**
 * Cambia cada minuto. Los plazos de Meta (24 h comentarios, 7 días DMs) vencen sin que nadie
 * escriba nada, así que los contadores "en plazo" se recalculan con este reloj.
 */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return tick;
}
