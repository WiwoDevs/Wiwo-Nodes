/**
 * Orbe WIWO (Thinking Orb) con la misma anatomía que WiWO Ops. Los estilos viven en
 * src/styles/wiwo-orb.css; el tamaño se controla con --orbe-ancho.
 */
import type { CSSProperties } from "react";

const SPARKS = [
  { sx: "70%", sy: "18%", size: 6, color: "rgba(248, 250, 215, .92)", speed: "5600ms", delay: "-900ms" },
  { sx: "25%", sy: "72%", size: 4, color: "rgba(66, 66, 255, .92)", speed: "6800ms", delay: "-2400ms" },
  { sx: "79%", sy: "68%", size: 8, color: "rgba(59, 255, 0, .9)", speed: "6200ms", delay: "-1800ms" },
  { sx: "34%", sy: "24%", size: 3, color: "rgba(248, 250, 215, .72)", speed: "7400ms", delay: "-3100ms" },
];

export function WiwoThinkingOrb({ width }: { width: string }) {
  return (
    <span aria-hidden="true" className="orbe-wiwo orbe-marca" style={{ "--orbe-ancho": width } as CSSProperties}>
      <span className="orbe-escenario">
        <span className="orb-state-field">
          <span className="orb-state-ring" />
          <span className="orb-state-ring alt" />
          <span className="orb-scan-line" />
          <span className="orb-output-trail one" />
          <span className="orb-output-trail two" />
          <span className="orb-output-trail three" />
          <span className="orb-success-burst" />
          <span className="orb-retry-notch" />
        </span>
        <span className="wiwo-thinking-orb">
          <span className="orb-pulse" />
          <span className="orb-pulse" />
          <span className="orb-pulse" />
          <span className="orb-liquid-veil" />
          <span className="orb-caustic" />
          <span className="orb-light-field" />
          <span className="orb-aurora orb-aurora-one" />
          <span className="orb-aurora orb-aurora-two" />
          <span className="orb-aurora orb-aurora-three" />
          <span className="orb-rim" />
          <span className="orb-core" />
          <span className="orb-glint" />
        </span>
        <span className="orb-particle orb-particle-uno" />
        <span className="orb-particle orb-particle-dos" />
        <span className="orb-particle orb-particle-tres" />
        {SPARKS.map((spark) => (
          <span
            key={`${spark.sx}-${spark.sy}`}
            className="orb-spark"
            style={{
              "--sx": spark.sx,
              "--sy": spark.sy,
              "--spark-size": `calc(${spark.size} * var(--orbe-u))`,
              "--spark-color": spark.color,
              "--spark-speed": spark.speed,
              "--spark-delay": spark.delay,
            } as CSSProperties}
          />
        ))}
      </span>
    </span>
  );
}
