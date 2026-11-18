/**
 * Thinking Orb de WiwoLab (components/ui/orb.tsx), con los estilos de src/styles/thinking-orb.css.
 * Tamaños xs/sm/md: orbe en línea (botones, filas). lg/xl: orbe volumétrico (paneles y pantallas de carga).
 * El orbe del login es otro (WiwoThinkingOrb, de WiWO Ops) y no cambia.
 */
import type { CSSProperties } from "react";

const SIZE_PX = { xs: 12, sm: 16, md: 24, lg: 40, xl: 72 } as const;
const STAGE_PX = { md: 84, lg: 112, xl: 208 } as const;
const ORB_CANVAS = 600;

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
  variant = "auto",
  bare = false,
  className,
  label,
}: {
  size?: keyof typeof SIZE_PX;
  state?: OrbState;
  variant?: "auto" | "inline" | "stage";
  bare?: boolean;
  className?: string;
  /** Texto para lectores de pantalla; vacío lo oculta (cuando el texto visible ya lo dice). */
  label?: string;
}) {
  const a11yLabel = label ?? STATE_LABEL[state];
  const useStage = variant === "stage" || (variant === "auto" && (size === "lg" || size === "xl"));

  if (useStage) {
    const px = STAGE_PX[size === "lg" || size === "xl" ? size : "md"];
    return (
      <span
        role={a11yLabel ? "status" : undefined}
        aria-label={a11yLabel || undefined}
        aria-hidden={a11yLabel ? undefined : "true"}
        data-thinking-state={state}
        className={`wiwo-orb-stage ${bare ? "wiwo-orb-stage--bare" : ""} ${className ?? ""}`}
        style={{ width: px, height: px, "--orb-fit": px / ORB_CANVAS } as CSSProperties}
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
    );
  }

  const px = SIZE_PX[size];
  const stateClass = state === "thinking" ? "" : `wiwo-orb--${state}`;
  return (
    <span
      role={a11yLabel ? "status" : undefined}
      aria-label={a11yLabel || undefined}
      aria-hidden={a11yLabel ? undefined : "true"}
      className={`wiwo-orb ${stateClass} ${className ?? ""}`}
      style={{ width: px, height: px }}
    />
  );
}

/**
 * Pantalla de carga de WiwoLab (components/app-shell.tsx): orbe volumétrico dentro de su aura y el texto
 * debajo. `compact` es la versión para paneles (orbe más chico, sin aura).
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
        <ThinkingOrb size="lg" state="thinking" bare label="" />
      ) : (
        <div className="wiwo-orb-aura orb-loader__aura">
          <ThinkingOrb size="xl" state="thinking" bare label="" />
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
