import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  Brain,
  CheckCircle,
  Code,
  Database,
  FileXls,
  FloppyDisk,
  GearSix,
  HardDrives,
  Key,
  PlugsConnected,
  ShieldCheck,
  SlidersHorizontal,
  WarningCircle,
  Wrench,
  XCircle,
} from "@phosphor-icons/react";
import type {
  AutomationSettings,
  EnvironmentCheck,
  IntegrationKind,
  IntegrationStatus,
  ProjectRequirement,
  ServiceStatus,
} from "../types";
import { BusyOrb } from "./ThinkingOrb";
import { clarityRequirementFromThreshold, thresholdForClarityRequirement, type ClarityRequirement } from "../lib/topic-clarity";

export interface SettingsViewProps {
  integrations: IntegrationStatus[];
  environmentChecks: EnvironmentCheck[];
  automationSettings: AutomationSettings;
  requirements: ProjectRequirement[];
  isRunningDiagnostics?: boolean;
  isSaving?: boolean;
  canRunDiagnostics?: boolean;
  canConfigureIntegrations?: boolean;
  canEditSettings?: boolean;
  canEnableAutomaticReplies?: boolean;
  onConfigureIntegration?: (integration: IntegrationStatus) => void;
  onRunDiagnostics?: () => void;
  onSaveAutomationSettings?: (settings: AutomationSettings) => void | Promise<void>;
  onOpenRequirement?: (requirement: ProjectRequirement) => void;
}

function serviceStatusLabel(status: ServiceStatus) {
  if (status === "ready") return "Disponible";
  if (status === "needs_action") return "Requiere acción";
  return "Sin conexión";
}

function ServiceStatusIcon({ status }: { status: ServiceStatus }) {
  const props = { size: 16, weight: "fill" as const, "aria-hidden": true };
  if (status === "ready") return <CheckCircle {...props} />;
  if (status === "needs_action") return <WarningCircle {...props} />;
  return <XCircle {...props} />;
}

function IntegrationIcon({ kind }: { kind: IntegrationKind }) {
  const props = { size: 22, weight: "duotone" as const, "aria-hidden": true };
  if (kind === "metricool") return <PlugsConnected {...props} />;
  if (kind === "excel") return <FileXls {...props} />;
  if (kind === "automation") return <Brain {...props} />;
  return <Database {...props} />;
}

function EnvironmentIcon({ kind }: Pick<EnvironmentCheck, "kind">) {
  const props = { size: 19, weight: "duotone" as const, "aria-hidden": true };
  if (kind === "frontend") return <Code {...props} />;
  if (kind === "api") return <HardDrives {...props} />;
  if (kind === "worker") return <GearSix {...props} />;
  return <Database {...props} />;
}

export function SettingsView({
  integrations,
  environmentChecks,
  automationSettings,
  requirements,
  isRunningDiagnostics = false,
  isSaving = false,
  canRunDiagnostics = true,
  canConfigureIntegrations = true,
  canEditSettings = true,
  canEnableAutomaticReplies = true,
  onConfigureIntegration,
  onRunDiagnostics,
  onSaveAutomationSettings,
  onOpenRequirement,
}: SettingsViewProps) {
  const [settings, setSettings] = useState<AutomationSettings>(() => ({ ...automationSettings }));
  const completeRequirements = requirements.filter((requirement) => requirement.complete).length;

  const updateSetting = <KeyName extends keyof AutomationSettings>(
    key: KeyName,
    value: AutomationSettings[KeyName],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    setSettings({ ...automationSettings });
  }, [automationSettings]);

  return (
    <section className="app-view settings-view" aria-labelledby="settings-title">
      <header className="view-header">
        <div className="view-header__copy">
          <p className="view-header__eyebrow">Sistema</p>
          <h1 id="settings-title" className="view-header__title">Configuración</h1>
          <p className="view-header__description">
            Conexión con Metricool, estado del sistema y reglas de respuesta.
          </p>
        </div>
        <div className="view-header__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={onRunDiagnostics}
            disabled={isRunningDiagnostics || !canRunDiagnostics}
            title={!canRunDiagnostics ? "Requiere rol agente o superior" : "Lee Metricool ahora y actualiza el estado"}
          >
            {isRunningDiagnostics ? <BusyOrb /> : <ArrowClockwise className="button__icon" size={17} weight="bold" aria-hidden="true" />}
            {isRunningDiagnostics ? "Sincronizando" : "Sincronizar ahora"}
          </button>
        </div>
      </header>

      <div className="settings-layout">
        <div className="settings-layout__main">
          <article className="panel integrations-panel" aria-labelledby="integrations-title">
            <header className="panel__header">
              <div>
                <h2 id="integrations-title" className="panel__title">Integraciones</h2>
              </div>
            </header>

            <div className="integration-list">
              {integrations.map((integration) => (
                <section className="integration-row" key={integration.id}>
                  <span className={`integration-row__icon integration-row__icon--${integration.kind}`}>
                    <IntegrationIcon kind={integration.kind} />
                  </span>
                  <div className="integration-row__content">
                    <div className="integration-row__titleline">
                      <h3>{integration.name}</h3>
                      <span className={`service-status service-status--${integration.status}`}>
                        <ServiceStatusIcon status={integration.status} />
                        {integration.statusLabel}
                      </span>
                    </div>
                    <p>{integration.description}</p>
                    <small>{integration.detail}</small>
                  </div>
                  <div className="integration-row__actions">
                    <small>{integration.lastCheckedLabel}</small>
                  </div>
                </section>
              ))}
            </div>
          </article>

          <form
            className="panel automation-settings"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canEditSettings) return;
              onSaveAutomationSettings?.(settings);
            }}
            aria-labelledby="automation-settings-title"
          >
            <header className="panel__header">
              <div>
                <h2 id="automation-settings-title" className="panel__title">Reglas de respuesta</h2>
                <p className="panel__description">
                  Controles globales para las respuestas automáticas de las cuentas aprobadas.
                </p>
              </div>
            </header>

            <fieldset className="settings-fieldset">
              <legend className="sr-only">Activación y revisión de respuestas automáticas</legend>

              <label className="switch-setting">
                <span className="switch-setting__copy">
                  <strong>Respuestas automáticas</strong>
                  <small>Permitir envíos en categorías y marcas aprobadas.</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.automaticRepliesEnabled}
                  onChange={(event) => updateSetting("automaticRepliesEnabled", event.target.checked)}
                  disabled={!canEditSettings || (!canEnableAutomaticReplies && !settings.automaticRepliesEnabled)}
                  title={!canEnableAutomaticReplies ? "Activar respuestas automáticas requiere rol administrador" : undefined}
                />
              </label>

              <label className="switch-setting">
                <span className="switch-setting__copy">
                  <strong>Revisión humana para casos sensibles</strong>
                  <small>Legal, pagos/fraude, amenazas, salud, datos personales y reclamos siempre se derivan.</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.humanReviewForSensitiveCases}
                  onChange={() => undefined}
                  disabled
                  title="Control obligatorio: no se puede desactivar"
                />
              </label>

              <label className="switch-setting">
                <span className="switch-setting__copy">
                  <strong>Pausar ante sentimiento negativo</strong>
                  <small>Evita envíos automáticos cuando se detecta frustración o urgencia.</small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={settings.pauseOnNegativeSentiment}
                  onChange={(event) => updateSetting("pauseOnNegativeSentiment", event.target.checked)}
                  disabled={!canEditSettings}
                />
              </label>
            </fieldset>

            <div className="settings-fields-grid">
              <label className="select-setting">
                <span>
                  <strong>Claridad del tema para enviar solo</strong>
                  <small>
                    {settings.automaticRepliesEnabled
                      ? "Alta: el mensaje calza con una regla. Media: se usa la categoría que ya tenía. Lo demás queda como borrador para una persona."
                      : "Solo aplica si activas las respuestas automáticas. Hoy todo lo responde una persona."}
                  </small>
                </span>
                <select
                  value={clarityRequirementFromThreshold(settings.confidenceThreshold)}
                  onChange={(event) => {
                    const requirement = event.target.value as ClarityRequirement;
                    // Solo cambia el umbral si cambia la opción: así no se «baja» por error.
                    if (requirement !== clarityRequirementFromThreshold(settings.confidenceThreshold)) {
                      updateSetting("confidenceThreshold", thresholdForClarityRequirement(requirement));
                    }
                  }}
                  disabled={!canEditSettings}
                >
                  <option value="alta">Solo alta</option>
                  <option value="alta_media">Alta o media</option>
                </select>
              </label>

              <label className="select-setting">
                <span>
                  <strong>Frecuencia de sincronización</strong>
                  <small>Intervalo de consulta al Inbox de Metricool.</small>
                </span>
                <select
                  value={settings.pollingIntervalMinutes}
                  onChange={(event) => updateSetting("pollingIntervalMinutes", Number(event.target.value))}
                  disabled={!canEditSettings}
                >
                  <option value="5">Cada 5 minutos</option>
                  <option value="10">Cada 10 minutos</option>
                </select>
              </label>
            </div>

            <footer className="panel__footer panel__footer--actions">
              <p className="settings-footnote">
                <ShieldCheck size={16} weight="fill" aria-hidden="true" />
                Los reclamos y mensajes urgentes siempre mantienen supervisión humana.
              </p>
              <button
                className="button button--primary"
                type="submit"
                disabled={isSaving || !canEditSettings}
                title={!canEditSettings ? "Requiere rol supervisor o administrador" : undefined}
              >
                <FloppyDisk size={17} weight="bold" aria-hidden="true" />
                {isSaving ? "Guardando" : "Guardar reglas"}
              </button>
            </footer>
          </form>
        </div>

        <aside className="settings-layout__aside">
          <section className="panel metricool-limits-panel" aria-labelledby="metricool-limits-title">
            <header className="panel__header">
              <div>
                <h2 id="metricool-limits-title" className="panel__title">Límites de respuesta</h2>
                <p className="panel__description">Restricciones vigentes que la automatización no puede evadir.</p>
              </div>
            </header>
            <ul>
              <li><strong>Instagram y Facebook:</strong> mensajes privados y comentarios.</li>
              <li><strong>X:</strong> mensajes privados.</li>
              <li><strong>TikTok y YouTube:</strong> comentarios.</li>
              <li><strong>LinkedIn:</strong> comentarios y menciones, sin DMs.</li>
              <li><strong>Google Business:</strong> reseñas con aprobación humana.</li>
              <li><strong>Anuncios:</strong> sus comentarios no se responden desde el Inbox.</li>
              <li><strong>Historial:</strong> Metricool no lo conserva permanentemente; wiwo.sac guarda una copia.</li>
            </ul>
          </section>

          <section className="panel environment-panel" aria-labelledby="environment-title">
            <header className="panel__header">
              <div>
                <h2 id="environment-title" className="panel__title">Estado del sistema</h2>
              </div>
            </header>

            <dl className="environment-list">
              {environmentChecks.map((check) => (
                <div className="environment-row" key={check.id}>
                  <dt>
                    <span className="environment-row__icon"><EnvironmentIcon kind={check.kind} /></span>
                    <span>
                      <strong>{check.label}</strong>
                      <small>{check.detail}</small>
                    </span>
                  </dt>
                  <dd>
                    <span>{check.value}</span>
                    <span className={`service-status service-status--${check.status}`}>
                      <ServiceStatusIcon status={check.status} />
                      {serviceStatusLabel(check.status)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

        </aside>
      </div>
    </section>
  );
}
