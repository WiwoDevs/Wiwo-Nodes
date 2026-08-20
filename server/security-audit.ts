import type { AppConfig } from "./config.js";
import type { DataStore } from "./types.js";
import { validateWorkflow } from "./workflow-validation.js";
import { validateAutomationWorkflow } from "./automation-validation.js";

type SecurityAuditStatus = "pass" | "warning" | "fail";

export interface SecurityAuditCheck {
  id: string;
  category: "access" | "data" | "network" | "workflow" | "operations";
  status: SecurityAuditStatus;
  title: string;
  detail: string;
  remediation?: string;
}

export interface SecurityAuditReport {
  generatedAt: string;
  ready: boolean;
  score: number;
  summary: Record<SecurityAuditStatus, number>;
  checks: SecurityAuditCheck[];
}

export function buildSecurityAudit(config: AppConfig, store: DataStore): SecurityAuditReport {
  const checks: SecurityAuditCheck[] = [];
  const add = (check: SecurityAuditCheck) => checks.push(check);
  add({
    id: "api-key",
    category: "access",
    status: config.security.requireApiKey && Boolean(config.security.apiKey) ? "pass" : "fail",
    title: "Autenticación del API",
    detail: config.security.requireApiKey ? "La clave del sitio es obligatoria." : "El API acepta solicitudes sin clave.",
    remediation: "Active SAC_FLOW_REQUIRE_API_KEY y configure SAC_FLOW_API_KEY.",
  });
  add({
    id: "actor-context",
    category: "access",
    status: config.security.actorContext.require && config.security.actorContext.trustHeaders ? "pass" : "warning",
    title: "Identidad y alcance del operador",
    detail: config.security.actorContext.require
      ? "El gateway debe aportar identidad, rol y marcas autorizadas."
      : "Se usa el rol local predeterminado; apropiado solo detrás de un sitio privado con clave.",
    remediation: "Para múltiples operadores, haga que el gateway firme y envíe el contexto de actor.",
  });
  add({
    id: "cors",
    category: "network",
    status: config.security.corsOrigins !== true && config.security.corsOrigins !== false ? "pass" : "warning",
    title: "Orígenes permitidos",
    detail: Array.isArray(config.security.corsOrigins)
      ? `${config.security.corsOrigins.length} origen(es) explícitos.`
      : config.security.corsOrigins ? "CORS permite cualquier origen." : "CORS está cerrado.",
    remediation: "Configure SAC_FLOW_CORS_ORIGINS con el dominio exacto del sitio.",
  });
  add({
    id: "headers-origin-rate-limit",
    category: "network",
    status: config.security.securityHeaders && config.security.enforceOriginCheck && config.security.rateLimit.enabled ? "pass" : "fail",
    title: "Controles HTTP",
    detail: "Cabeceras seguras, comprobación de origen y rate limiting deben estar activos en producción.",
    remediation: "Active los tres controles SAC_FLOW de seguridad HTTP.",
  });
  add({
    id: "persistence",
    category: "data",
    status: config.persistence.driver === "postgres" ? "pass" : config.demoMode ? "warning" : "fail",
    title: "Persistencia transaccional",
    detail: config.persistence.driver === "postgres" ? "PostgreSQL está seleccionado." : "El almacenamiento JSON no es apto para producción concurrente.",
    remediation: "Use SAC_FLOW_REPOSITORY=postgres en producción.",
  });
  add({
    id: "encryption",
    category: "data",
    status: config.persistence.driver !== "postgres"
      ? "warning"
      : (config.persistence.postgresEncryptionKey?.length ?? 0) >= 32 ? "pass" : "fail",
    title: "Cifrado de referencias Metricool",
    detail: config.persistence.driver === "postgres" ? "Las referencias se cifran con pgcrypto." : "No se evalúa pgcrypto en almacenamiento JSON.",
    remediation: "Genere una clave aleatoria de al menos 32 caracteres.",
  });
  const workflowValidation = validateWorkflow(store.workflow);
  add({
    id: "workflow-validation",
    category: "workflow",
    status: workflowValidation.valid ? "pass" : "fail",
    title: "Integridad del workflow",
    detail: `${workflowValidation.errors} errores y ${workflowValidation.warnings} advertencias.`,
    remediation: "Corrija todos los errores antes de publicar.",
  });
  add({
    id: "workflow-publication",
    category: "workflow",
    status: store.workflow.version === store.workflow.publishedVersion ? "pass" : "warning",
    title: "Versión publicada",
    detail: `Borrador v${store.workflow.version}; publicada v${store.workflow.publishedVersion}.`,
    remediation: "Valide y publique la versión actual antes de habilitar autoenvío.",
  });
  add({
    id: "auto-reply-guardrails",
    category: "workflow",
    status: !store.workflow.autoReplyEnabled || store.workflow.autoReplyAccountIds.length > 0 ? "pass" : "fail",
    title: "Allowlist de autoenvío",
    detail: store.workflow.autoReplyEnabled
      ? `${store.workflow.autoReplyAccountIds.length} cuenta(s) autorizadas.`
      : "El autoenvío permanece desactivado.",
    remediation: "Mantenga una allowlist explícita y revisión humana para casos sensibles.",
  });
  const configuredRefs = store.brands.filter((brand) => brand.account.metricool?.userId && brand.account.metricool?.blogId).length
    + Object.keys(config.metricool.accounts).length;
  add({
    id: "metricool-credentials",
    category: "operations",
    status: config.demoMode ? "warning" : Boolean(config.metricool.token) && configuredRefs > 0 ? "pass" : "fail",
    title: "Preparación Metricool",
    detail: config.demoMode ? "Modo demo activo; no se realizan llamadas externas." : `${configuredRefs} referencia(s) de cuenta y token global configurado.`,
    remediation: "Cargue el token y las referencias userId/blogId al finalizar la instalación.",
  });
  add({
    id: "outbound-kill-switch",
    category: "operations",
    status: config.operations.outboundSendsDisabled ? "pass" : "warning",
    title: "Cortacorriente de envíos",
    detail: config.operations.outboundSendsDisabled ? "Los envíos externos están bloqueados." : "Los envíos pueden ejecutarse si se cumplen los guardrails.",
    remediation: "Mantenga SAC_FLOW_DISABLE_OUTBOUND_SENDS=true durante shadow y canary.",
  });
  add({
    id: "auto-reply-dispatch-gate",
    category: "operations",
    status: config.operations.autoReplyDispatchMode === "shadow" ? "pass" : "warning",
    title: "Compuerta de despacho automático",
    detail: config.operations.autoReplyDispatchMode === "shadow"
      ? "Modo sombra activo: las candidatas se evalúan sin despacharse."
      : "Modo live armado: el worker puede despachar candidatas allowlisted cuando ambos cortacorrientes estén abiertos.",
    remediation: "Use live solo durante un canary autorizado y vuelva a shadow ante cualquier desviación.",
  });
  add({
    id: "automation-credential-encryption",
    category: "data",
    status: config.automation.credentialEncryptionKey.length >= 32 ? "pass" : "fail",
    title: "Cifrado de credenciales de automatización",
    detail: "Las credenciales y variables secretas se cifran con AES-256-GCM antes de persistirse.",
    remediation: "Configure SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY con al menos 32 caracteres aleatorios.",
  });
  const automationValidations = store.automation.workflows.map((workflow) => validateAutomationWorkflow(workflow, store.automation));
  const invalidAutomations = automationValidations.filter((result) => !result.valid).length;
  add({
    id: "automation-workflows",
    category: "workflow",
    status: invalidAutomations === 0 ? "pass" : "fail",
    title: "Integridad de automatizaciones generales",
    detail: `${store.automation.workflows.length} workflow(s), ${invalidAutomations} inválido(s).`,
    remediation: "Corrija ciclos, conexiones, parámetros y referencias antes de publicar.",
  });
  add({
    id: "automation-egress",
    category: "network",
    status: config.operations.externalNodesDisabled && config.operations.metricoolMutationsDisabled ? "pass" : "warning",
    title: "Protección de salidas durante desarrollo",
    detail: config.operations.externalNodesDisabled && config.operations.metricoolMutationsDisabled
      ? "Los nodos HTTP y las mutaciones Metricool están bloqueados."
      : "Existe al menos una vía de salida general habilitada.",
    remediation: "Mantenga SAC_FLOW_DISABLE_EXTERNAL_NODES y SAC_FLOW_DISABLE_METRICOOL_MUTATIONS activados hasta UAT autorizado.",
  });

  const summary = {
    pass: checks.filter((check) => check.status === "pass").length,
    warning: checks.filter((check) => check.status === "warning").length,
    fail: checks.filter((check) => check.status === "fail").length,
  };
  const score = Math.round(((summary.pass + summary.warning * 0.5) / checks.length) * 100);
  return { generatedAt: new Date().toISOString(), ready: summary.fail === 0, score, summary, checks };
}
