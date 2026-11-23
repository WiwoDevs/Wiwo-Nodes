/**
 * Thinking Orb de WiwoLab (components/ui/orb.tsx), con los estilos de src/styles/thinking-orb.css.
 * Por pedido del usuario, todos los orbes de wiwo.sac son el orbe volumétrico de la pantalla de carga
 * (`Cargando…`): la esfera líquida sobre su aura oscura, a cualquier tamaño. El aura oscura no es
 * decorado: el orbe se mezcla en `screen` y sin un fondo oscuro detrás se lava en una mancha borrosa
 * (sobre todo en modo claro). El tamaño es el diámetro visible de la esfera; el lienzo de Lab (600 px)
 * se escala para que la esfera ocupe ese diámetro y los brillos se salen del recuadro, como en Lab.
 * El orbe del login es otro (WiwoThinkingOrb, de WiWO Ops) y no cambia.
 */
import type { CSSProperties } from "react";

/**
 * Diámetro visible de la esfera, en px. xs/sm/md conservan el tamaño de los antiguos orbes en línea.
 * `fab` es el orbe flotante del asistente: grande, con su aura, igual al de `Cargando…`.
 */
const SIZE_PX = { xs: 12, sm: 16, md: 24, hero: 34, fab: 40, lg: 64, xl: 136 } as const;
/** Proporción esfera / escenario del orbe de Lab (la esfera mide ~390 de un escenario que se escala a 600). */
const BODY_RATIO = 0.65;
const ORB_CANVAS = 600;
/** En los orbes chicos, proporción de la esfera dentro de la bola oscura recortada. */
const SMALL_BODY = 0.78;

const SPARKS = [
  { sx: "70%", sy: "18%", size: 18, color: "rgba(248, 250, 215, .92)", speed: "5600ms", delay: "-900ms" },
  { sx: "25%", sy: "72%", size: 13, color: "rgba(66, 66, 255, .92)", speed: "6800ms", delay: "-2400ms" },
  { sx: "79%", sy: "68%", size: 22, color: "rgba(59, 255, 0, .9)", speed: "6200ms", delay: "-1800ms" },
  { sx: "34%", sy: "24%", size: 11, color: "rgba(248, 250, 215, .72)", speed: "7400ms", delay: "-3100ms" },
] as const;

export type OrbState = "idle" | "listening" | "thinking" | "generating" | "routing" | "success" | "error" | "retry";

const STATE_LABEL: Record<OrbState, string> = {
  idle: "En espera",
  listening: "Escuchando",
  thinking: "Pensando",
  generating: "Generando",
  routing: "Coordinando",
  success: "Listo",
  error: "Error",
  retry: "Reintentando",
};

export function ThinkingOrb({
  size = "md",
  state = "thinking",
  aura = true,
  className,
  label,
}: {
  size?: keyof typeof SIZE_PX;
  state?: OrbState;
  /** Aura oscura propia. Solo `OrbLoader` la apaga, porque pone la suya (más grande) alrededor. */
  aura?: boolean;
  className?: string;
  /** Texto para lectores de pantalla; vacío lo oculta (cuando el texto visible ya lo dice). */
  label?: string;
}) {
  const a11yLabel = label ?? STATE_LABEL[state];
  const diameter = SIZE_PX[size];
  const tier = size === "lg" || size === "xl" || size === "fab" ? "large" : "small";
  // Los orbes chicos son una esfera oscura recortada (la esfera de Lab ocupa ~78% de ella, con sus
  // brillos dentro): fuera del aura los brillos se lavaban en un halo borroso, sobre todo en modo claro.
  const body = tier === "small" ? diameter * SMALL_BODY : diameter;
  return (
    <span
      role={a11yLabel ? "status" : undefined}
      aria-label={a11yLabel || undefined}
      aria-hidden={a11yLabel ? undefined : "true"}
      className={`aura-orb aura-orb--${tier} ${aura ? "wiwo-orb-aura" : ""} ${className ?? ""}`}
      style={{ width: diameter, height: diameter, "--orb-d": `${diameter}px` } as CSSProperties}
    >
      <span
        data-thinking-state={state}
        className="wiwo-orb-stage wiwo-orb-stage--bare aura-orb__stage"
        style={{ "--orb-fit": body / BODY_RATIO / ORB_CANVAS } as CSSProperties}
      >
        <span className="wiwo-orb-canvas" aria-hidden="true">
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
            <span className="orb-core" />
            <span className="orb-glint" />
          </span>
          <span className="orb-particle" />
          <span className="orb-particle" />
          <span className="orb-particle" />
          {SPARKS.map((spark) => (
            <span
              key={`${spark.sx}-${spark.sy}`}
              className="orb-spark"
              style={{
                "--sx": spark.sx,
                "--sy": spark.sy,
                "--spark-size": `${spark.size}px`,
                "--spark-color": spark.color,
                "--spark-speed": spark.speed,
                "--spark-delay": spark.delay,
              } as CSSProperties}
            />
          ))}
        </span>
      </span>
    </span>
  );
}

/**
 * Pantalla de carga de WiwoLab (components/app-shell.tsx): orbe volumétrico dentro de su aura y el texto
 * debajo. `compact` es la versión para paneles (orbe más chico, con su propia aura).
 */
export function OrbLoader({ label = "Cargando…", detail, compact = false, className }: {
  label?: string;
  detail?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`orb-loader ${compact ? "orb-loader--compact" : ""} ${className ?? ""}`} role="status" aria-live="polite" aria-busy="true">
      {compact ? (
        <ThinkingOrb size="lg" state="thinking" label="" />
      ) : (
        <div className="wiwo-orb-aura orb-loader__aura">
          <ThinkingOrb size="xl" state="thinking" aura={false} label="" />
        </div>
      )}
      <p className="orb-loader__label">{label}</p>
      {detail ? <small className="orb-loader__detail">{detail}</small> : null}
    </div>
  );
}

/** Orbe pequeño para botones y textos en curso (Lab: `<ThinkingOrb size="xs" state="generating" />`). */
export function BusyOrb({ size = "sm" }: { size?: "xs" | "sm" }) {
  return <ThinkingOrb size={size} state="generating" label="" className="busy-orb" />;
}
