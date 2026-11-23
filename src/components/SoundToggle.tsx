import { useSyncExternalStore } from "react";
import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { establecerSonidos, leerSonidosActivos, suscribirSonidos } from "../lib/sonidos-wiwo";

/**
 * Botón de silencio del soundbranding WiWO, junto al cambio de tema (como en MetriQ y Ops).
 * La preferencia es la misma de todas las plataformas WiWO (`localStorage['wiwo-sonidos']`).
 * Etiqueta fija «Silenciar sonidos» y `aria-pressed` para el estado, como pide el kit.
 */
export function SoundToggle() {
  const active = useSyncExternalStore(suscribirSonidos, leerSonidosActivos, () => true);
  return (
    <button
      type="button"
      className="icon-button sound-toggle"
      aria-label="Silenciar sonidos"
      aria-pressed={!active}
      title={active ? "Silenciar sonidos" : "Activar sonidos"}
      onClick={() => establecerSonidos(!active)}
    >
      {active ? <SpeakerHigh size={19} /> : <SpeakerSlash size={19} />}
    </button>
  );
}
