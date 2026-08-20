import type { AutomationNodeDefinition, AutomationTemplate, AutomationWorkflowSettings } from "./automation-types.js";

const DEFAULT_SETTINGS: AutomationWorkflowSettings = {
  timezone: "America/Santiago",
  executionTimeoutSeconds: 300,
  saveSuccessfulExecutions: true,
  saveFailedExecutions: true,
  concurrency: 1,
};

export const AUTOMATION_CREDENTIAL_TYPES = [
  { type: "httpHeaderAuth", name: "HTTP Header Auth", fields: ["name", "value"] },
  { type: "httpBasicAuth", name: "HTTP Basic Auth", fields: ["username", "password"] },
  { type: "httpBearerAuth", name: "Bearer Token", fields: ["token"] },
  { type: "apiKey", name: "API Key", fields: ["apiKey"] },
  { type: "metricoolApi", name: "Metricool API", fields: ["token"] },
] as const;

export const AUTOMATION_NODE_CATALOG: AutomationNodeDefinition[] = [
  {
    type: "core.manualTrigger", version: 1, name: "Inicio manual", description: "Ejecuta el workflow desde el editor.",
    group: "trigger", icon: "cursor-click", color: "#4b46f5", status: "ready", executable: true, trigger: true, outputs: ["main"], parameters: [],
  },
  {
    type: "core.schedule", version: 1, name: "Horario", description: "Inicia ejecuciones periódicas desde el worker.",
    group: "trigger", icon: "clock", color: "#3367d6", status: "ready", executable: true, trigger: true, outputs: ["main"],
    parameters: [{ key: "intervalMinutes", label: "Intervalo en minutos", type: "number", required: true, default: 15 }],
  },
  {
    type: "core.webhook", version: 1, name: "Webhook", description: "Recibe JSON mediante una ruta HTTP única.",
    group: "trigger", icon: "webhooks-logo", color: "#3367d6", status: "ready", executable: true, trigger: true, outputs: ["main"],
    credentialTypes: ["httpHeaderAuth", "httpBearerAuth"],
    parameters: [
      { key: "path", label: "Ruta", type: "string", required: true },
      { key: "method", label: "Método", type: "select", default: "POST", options: ["GET", "POST", "PUT", "PATCH"].map((value) => ({ label: value, value })) },
      { key: "authentication", label: "Autenticación", type: "select", default: "none", options: [{ label: "API global", value: "none" }, { label: "Credencial adicional", value: "credential" }] },
      { key: "authCredential", label: "Credencial del webhook", type: "credential", description: "Admite Bearer Token o Header Auth." },
    ],
  },
  {
    type: "core.formTrigger", version: 1, name: "Formulario", description: "Recibe campos enviados por un formulario interno.",
    group: "trigger", icon: "text-aa", color: "#3367d6", status: "beta", executable: true, trigger: true, outputs: ["main"],
    parameters: [{ key: "path", label: "Ruta", type: "string", required: true }],
  },
  {
    type: "core.errorTrigger", version: 1, name: "Error de workflow", description: "Inicia un flujo de recuperación ante una falla.",
    group: "trigger", icon: "warning", color: "#a64b59", status: "beta", executable: true, trigger: true, outputs: ["main"], parameters: [],
  },
  {
    type: "core.set", version: 1, name: "Editar campos", description: "Agrega, reemplaza o elimina propiedades de cada item.",
    group: "transform", icon: "pencil-simple", color: "#2766c7", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "values", label: "Valores JSON", type: "json", required: true, default: {} }, { key: "keepInput", label: "Conservar entrada", type: "boolean", default: true }],
  },
  {
    type: "core.if", version: 1, name: "Condición", description: "Divide los items entre las salidas verdadero y falso.",
    group: "flow", icon: "git-branch", color: "#5f62d6", status: "ready", executable: true, trigger: false, outputs: ["true", "false"],
    parameters: [
      { key: "field", label: "Campo", type: "string", required: true },
      { key: "operator", label: "Operador", type: "select", required: true, default: "equals", options: ["equals", "notEquals", "contains", "exists", "gt", "gte", "lt", "lte"].map((value) => ({ label: value, value })) },
      { key: "value", label: "Valor", type: "string" },
    ],
  },
  {
    type: "core.switch", version: 1, name: "Rutas", description: "Dirige items por reglas múltiples con una salida alternativa.",
    group: "flow", icon: "arrows-split", color: "#5f62d6", status: "ready", executable: true, trigger: false, outputs: ["case-0", "case-1", "case-2", "fallback"],
    parameters: [{ key: "field", label: "Campo", type: "string", required: true }, { key: "cases", label: "Casos JSON", type: "json", default: [] }],
  },
  {
    type: "core.merge", version: 1, name: "Combinar", description: "Combina los items recibidos desde varias ramas.",
    group: "flow", icon: "arrows-merge", color: "#5f62d6", status: "ready", executable: true, trigger: false, outputs: ["main"], parameters: [],
  },
  {
    type: "core.filter", version: 1, name: "Filtrar", description: "Conserva items que cumplen una condición.",
    group: "transform", icon: "funnel", color: "#2766c7", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "field", label: "Campo", type: "string", required: true }, { key: "operator", label: "Operador", type: "string", default: "equals" }, { key: "value", label: "Valor", type: "string" }],
  },
  {
    type: "core.sort", version: 1, name: "Ordenar", description: "Ordena items por un campo en forma ascendente o descendente.",
    group: "transform", icon: "sort-ascending", color: "#2766c7", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "field", label: "Campo", type: "string", required: true }, { key: "direction", label: "Dirección", type: "select", default: "asc", options: [{ label: "Ascendente", value: "asc" }, { label: "Descendente", value: "desc" }] }],
  },
  {
    type: "core.limit", version: 1, name: "Limitar", description: "Entrega solamente la cantidad indicada de items.",
    group: "transform", icon: "list-numbers", color: "#2766c7", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "maxItems", label: "Máximo", type: "number", required: true, default: 100 }],
  },
  {
    type: "core.aggregate", version: 1, name: "Agrupar", description: "Agrupa items y calcula recuentos por campo.",
    group: "data", icon: "chart-bar", color: "#187a75", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "groupBy", label: "Agrupar por", type: "string", required: true }],
  },
  {
    type: "core.removeDuplicates", version: 1, name: "Eliminar duplicados", description: "Deduplica items usando una propiedad estable.",
    group: "data", icon: "copy-simple", color: "#187a75", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "field", label: "Campo único", type: "string", required: true }],
  },
  {
    type: "core.splitOut", version: 1, name: "Separar lista", description: "Convierte un arreglo dentro de un item en múltiples items.",
    group: "transform", icon: "rows", color: "#2766c7", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "field", label: "Campo con arreglo", type: "string", required: true }],
  },
  {
    type: "core.dateTime", version: 1, name: "Fecha y hora", description: "Agrega una marca temporal ISO a los items.",
    group: "transform", icon: "calendar", color: "#2766c7", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "targetField", label: "Campo destino", type: "string", default: "timestamp" }],
  },
  {
    type: "core.renameFields", version: 1, name: "Renombrar campos", description: "Cambia nombres de propiedades mediante un mapa JSON.",
    group: "transform", icon: "text-t", color: "#2766c7", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "mapping", label: "Mapa origen/destino", type: "json", required: true, default: {} }],
  },
  {
    type: "core.removeFields", version: 1, name: "Eliminar campos", description: "Elimina propiedades seleccionadas de cada item.",
    group: "transform", icon: "eraser", color: "#2766c7", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "fields", label: "Campos JSON", type: "json", required: true, default: [] }],
  },
  {
    type: "core.math", version: 1, name: "Cálculo", description: "Aplica una operación numérica y guarda el resultado.",
    group: "transform", icon: "calculator", color: "#2766c7", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "field", label: "Campo", type: "string", required: true }, { key: "operation", label: "Operación", type: "select", default: "add", options: ["add", "subtract", "multiply", "divide", "round"].map((value) => ({ label: value, value })) }, { key: "value", label: "Valor", type: "number", default: 0 }, { key: "targetField", label: "Campo destino", type: "string", default: "result" }],
  },
  {
    type: "core.regexExtract", version: 1, name: "Extraer con regex", description: "Extrae una coincidencia de texto hacia otro campo.",
    group: "transform", icon: "text-columns", color: "#2766c7", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "field", label: "Campo", type: "string", required: true }, { key: "pattern", label: "Patrón", type: "string", required: true }, { key: "targetField", label: "Campo destino", type: "string", default: "match" }],
  },
  {
    type: "core.jsonParse", version: 1, name: "Leer JSON", description: "Convierte un string JSON en un objeto validado.",
    group: "data", icon: "brackets-curly", color: "#187a75", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "field", label: "Campo origen", type: "string", required: true }, { key: "targetField", label: "Campo destino", type: "string", default: "parsed" }],
  },
  {
    type: "core.jsonStringify", version: 1, name: "Crear JSON", description: "Serializa un valor como JSON en un campo de texto.",
    group: "data", icon: "brackets-square", color: "#187a75", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "field", label: "Campo origen", type: "string", required: true }, { key: "targetField", label: "Campo destino", type: "string", default: "json" }],
  },
  {
    type: "core.hash", version: 1, name: "Hash", description: "Calcula un hash no reversible para deduplicación o integridad.",
    group: "data", icon: "fingerprint", color: "#187a75", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "field", label: "Campo origen", type: "string", required: true }, { key: "algorithm", label: "Algoritmo", type: "select", default: "sha256", options: [{ label: "SHA-256", value: "sha256" }, { label: "SHA-512", value: "sha512" }] }, { key: "targetField", label: "Campo destino", type: "string", default: "hash" }],
  },
  {
    type: "core.base64", version: 1, name: "Base64", description: "Codifica o decodifica texto Base64 de forma local.",
    group: "data", icon: "file-code", color: "#187a75", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "field", label: "Campo origen", type: "string", required: true }, { key: "mode", label: "Modo", type: "select", default: "encode", options: [{ label: "Codificar", value: "encode" }, { label: "Decodificar", value: "decode" }] }, { key: "targetField", label: "Campo destino", type: "string", default: "base64" }],
  },
  {
    type: "core.wait", version: 1, name: "Esperar", description: "Pausa brevemente una ejecución local.",
    group: "flow", icon: "hourglass", color: "#5f62d6", status: "beta", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "milliseconds", label: "Milisegundos", type: "number", default: 0, description: "La beta local limita la espera a 2 segundos." }],
  },
  {
    type: "core.stopAndError", version: 1, name: "Detener con error", description: "Finaliza la ejecución con un mensaje controlado.",
    group: "flow", icon: "x-circle", color: "#a64b59", status: "ready", executable: true, trigger: false, outputs: [],
    parameters: [{ key: "message", label: "Mensaje", type: "string", required: true, default: "Ejecución detenida por el workflow." }],
  },
  {
    type: "core.noOp", version: 1, name: "Sin operación", description: "Conserva los items sin modificarlos.",
    group: "flow", icon: "circle", color: "#70758a", status: "ready", executable: true, trigger: false, outputs: ["main"], parameters: [],
  },
  {
    type: "core.executeWorkflow", version: 1, name: "Ejecutar workflow", description: "Invoca otro workflow publicado con límite de profundidad.",
    group: "flow", icon: "flow-arrow", color: "#5f62d6", status: "beta", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "workflowId", label: "Workflow", type: "workflow", required: true }],
  },
  {
    type: "core.httpRequest", version: 1, name: "Solicitud HTTP", description: "Consulta una API con controles SSRF y credenciales de servidor.",
    group: "action", icon: "globe", color: "#2b6cb0", status: "beta", executable: true, trigger: false, outputs: ["main"],
    credentialTypes: ["httpHeaderAuth", "httpBasicAuth", "httpBearerAuth", "apiKey"],
    parameters: [
      { key: "url", label: "URL", type: "string", required: true },
      { key: "method", label: "Método", type: "select", default: "GET", options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => ({ label: value, value })) },
      { key: "body", label: "Cuerpo JSON", type: "json", default: {} },
    ],
  },
  {
    type: "core.respondToWebhook", version: 1, name: "Responder webhook", description: "Define el JSON devuelto al solicitante.",
    group: "action", icon: "arrow-u-up-left", color: "#2b6cb0", status: "ready", executable: true, trigger: false, outputs: ["main"],
    parameters: [{ key: "body", label: "Respuesta JSON", type: "json", default: {} }],
  },
  {
    type: "sac.metricoolInbox", version: 1, name: "Metricool Inbox", description: "Punto de entrada seguro al módulo SAC, sin credenciales en el navegador.",
    group: "sac", icon: "chats-circle", color: "#315ee8", status: "ready", executable: true, trigger: false, outputs: ["main"],
    credentialTypes: ["metricoolApi"], parameters: [{ key: "operation", label: "Operación", type: "select", default: "preview", options: [{ label: "Vista previa local", value: "preview" }, { label: "Sincronizar", value: "sync" }] }],
  },
  {
    type: "sac.classify", version: 1, name: "Clasificación SAC", description: "Clasifica categoría, sentimiento, riesgo y confianza.",
    group: "sac", icon: "brain", color: "#315ee8", status: "ready", executable: true, trigger: false, outputs: ["safe", "review"],
    parameters: [{ key: "minimumConfidence", label: "Confianza mínima", type: "number", default: 0.82 }],
  },
  {
    type: "sac.humanReview", version: 1, name: "Revisión humana", description: "Marca casos sensibles para aprobación de un agente.",
    group: "sac", icon: "user-focus", color: "#315ee8", status: "ready", executable: true, trigger: false, outputs: ["main"], parameters: [],
  },
  {
    type: "sac.exportXlsx", version: 1, name: "Exportar XLSX", description: "Prepara interacciones y resumen para la exportación del módulo SAC.",
    group: "sac", icon: "file-xls", color: "#315ee8", status: "ready", executable: true, trigger: false, outputs: ["main"], parameters: [],
  },
];

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "template-webhook-normalize",
    name: "Webhook y normalización",
    description: "Recibe JSON, normaliza campos y devuelve una respuesta controlada.",
    category: "Core",
    featured: true,
    workflow: {
      tags: ["tag-api"], settings: DEFAULT_SETTINGS,
      nodes: [
        { id: "webhook", name: "Webhook", type: "core.webhook", typeVersion: 1, position: { x: 80, y: 220 }, parameters: { path: "entrada", method: "POST" } },
        { id: "set", name: "Normalizar", type: "core.set", typeVersion: 1, position: { x: 380, y: 220 }, parameters: { keepInput: true, values: { processed: true } } },
        { id: "response", name: "Responder", type: "core.respondToWebhook", typeVersion: 1, position: { x: 680, y: 220 }, parameters: { body: { ok: true } } },
      ],
      connections: [
        { id: "webhook-set", sourceNode: "webhook", sourceOutput: "main", targetNode: "set", targetInput: "main" },
        { id: "set-response", sourceNode: "set", sourceOutput: "main", targetNode: "response", targetInput: "main" },
      ],
    },
  },
  {
    id: "template-data-quality",
    name: "Calidad y deduplicación",
    description: "Filtra registros incompletos, elimina duplicados y agrupa resultados.",
    category: "Datos",
    featured: true,
    workflow: {
      tags: ["tag-data"], settings: DEFAULT_SETTINGS,
      nodes: [
        { id: "manual", name: "Inicio manual", type: "core.manualTrigger", typeVersion: 1, position: { x: 80, y: 220 }, parameters: {} },
        { id: "filter", name: "Con ID", type: "core.filter", typeVersion: 1, position: { x: 340, y: 220 }, parameters: { field: "id", operator: "exists" } },
        { id: "dedupe", name: "Sin duplicados", type: "core.removeDuplicates", typeVersion: 1, position: { x: 600, y: 220 }, parameters: { field: "id" } },
        { id: "aggregate", name: "Resumen", type: "core.aggregate", typeVersion: 1, position: { x: 860, y: 220 }, parameters: { groupBy: "category" } },
      ],
      connections: [
        { id: "manual-filter", sourceNode: "manual", sourceOutput: "main", targetNode: "filter", targetInput: "main" },
        { id: "filter-dedupe", sourceNode: "filter", sourceOutput: "main", targetNode: "dedupe", targetInput: "main" },
        { id: "dedupe-aggregate", sourceNode: "dedupe", sourceOutput: "main", targetNode: "aggregate", targetInput: "main" },
      ],
    },
  },
  {
    id: "template-sac-review",
    name: "SAC con revisión humana",
    description: "Conecta el módulo SAC, clasifica riesgo y conserva aprobación humana.",
    category: "SAC",
    featured: true,
    workflow: {
      tags: ["tag-sac"], settings: DEFAULT_SETTINGS,
      nodes: [
        { id: "manual", name: "Inicio seguro", type: "core.manualTrigger", typeVersion: 1, position: { x: 80, y: 220 }, parameters: {} },
        { id: "metricool", name: "Metricool Inbox", type: "sac.metricoolInbox", typeVersion: 1, position: { x: 350, y: 220 }, parameters: { operation: "preview" } },
        { id: "classify", name: "Clasificar", type: "sac.classify", typeVersion: 1, position: { x: 620, y: 220 }, parameters: { minimumConfidence: 0.82 } },
        { id: "review", name: "Revisión humana", type: "sac.humanReview", typeVersion: 1, position: { x: 900, y: 310 }, parameters: {} },
      ],
      connections: [
        { id: "manual-metricool", sourceNode: "manual", sourceOutput: "main", targetNode: "metricool", targetInput: "main" },
        { id: "metricool-classify", sourceNode: "metricool", sourceOutput: "main", targetNode: "classify", targetInput: "main" },
        { id: "classify-review", sourceNode: "classify", sourceOutput: "review", targetNode: "review", targetInput: "main" },
      ],
    },
  },
];

export function getAutomationNodeDefinition(type: string): AutomationNodeDefinition | undefined {
  return AUTOMATION_NODE_CATALOG.find((node) => node.type === type);
}

export function defaultAutomationWorkflowSettings(): AutomationWorkflowSettings {
  return structuredClone(DEFAULT_SETTINGS);
}
