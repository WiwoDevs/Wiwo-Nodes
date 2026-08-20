import dns from "node:dns/promises";
import net from "node:net";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { getAutomationNodeDefinition } from "./automation-catalog.js";
import type {
  AutomationExecutionMode,
  AutomationNode,
  AutomationNodeRun,
  AutomationWorkflow,
} from "./automation-types.js";

type Item = Record<string, unknown>;
type NodeOutputs = Record<string, Item[]>;

export interface AutomationEngineContext {
  mode: AutomationExecutionMode;
  variables: Record<string, string>;
  allowExternalRequests: boolean;
  allowMetricoolOperations: boolean;
  resolveCredential?: (credentialId: string) => Promise<Record<string, unknown>>;
  executeSubworkflow?: (workflowId: string, items: Item[], depth: number) => Promise<Item[]>;
  depth?: number;
  triggerNodeId?: string;
  signal?: AbortSignal;
  sensitiveValues?: Set<string>;
}

export interface AutomationEngineResult {
  status: "success" | "error";
  output: Item[];
  nodeRuns: AutomationNodeRun[];
  error?: { nodeId?: string; message: string };
}

const SENSITIVE_KEY = /(authorization|password|secret|token|api[-_]?key|cookie)/i;
const BLOCKED_DESTINATIONS = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED_DESTINATIONS.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10],
  ["ff00::", 8], ["2001:db8::", 32],
] as const) BLOCKED_DESTINATIONS.addSubnet(network, prefix, "ipv6");

function getPath(value: unknown, path: string): unknown {
  const normalized = path.replace(/^\$json\.?/, "").replace(/^\./, "");
  if (!normalized) return value;
  return normalized.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) return (current as Record<string, unknown>)[segment];
    return undefined;
  }, value);
}

function sanitizeString(value: string, sensitiveValues?: Set<string>): string {
  let safe = value;
  for (const secret of sensitiveValues || []) {
    if (!secret) continue;
    if (safe === secret) return "[redacted]";
    if (secret.length >= 4) safe = safe.replaceAll(secret, "[redacted]");
  }
  return safe.length > 4_000 ? `${safe.slice(0, 4_000)}…` : safe;
}

function sanitize(value: unknown, sensitiveValues?: Set<string>, depth = 0): unknown {
  if (depth > 5) return "[depth-limit]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, sensitiveValues, depth + 1));
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? sanitizeString(value, sensitiveValues) : value;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(item, sensitiveValues, depth + 1),
  ]));
}

function interpolateString(template: string, item: Item, variables: Record<string, string>): unknown {
  const exact = template.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (exact) {
    const expression = exact[1].trim();
    if (expression.startsWith("$vars.")) return variables[expression.slice(6)];
    if (expression === "$now") return new Date().toISOString();
    if (expression.startsWith("$json")) return getPath(item, expression);
  }
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, raw: string) => {
    const expression = raw.trim();
    const result = expression.startsWith("$vars.")
      ? variables[expression.slice(6)]
      : expression === "$now"
        ? new Date().toISOString()
        : expression.startsWith("$json")
          ? getPath(item, expression)
          : undefined;
    return result === undefined || result === null ? "" : typeof result === "string" ? result : JSON.stringify(result);
  });
}

function resolveValue(value: unknown, item: Item, variables: Record<string, string>): unknown {
  if (typeof value === "string") return interpolateString(value, item, variables);
  if (Array.isArray(value)) return value.map((entry) => resolveValue(entry, item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, resolveValue(entry, item, variables)]));
  }
  return value;
}

function compare(actual: unknown, operator: string, expected: unknown): boolean {
  if (operator === "exists") return actual !== undefined && actual !== null && actual !== "";
  if (operator === "notEquals") return String(actual) !== String(expected);
  if (operator === "contains") return Array.isArray(actual) ? actual.some((item) => String(item) === String(expected)) : String(actual ?? "").includes(String(expected ?? ""));
  if (["gt", "gte", "lt", "lte"].includes(operator)) {
    const left = Number(actual);
    const right = Number(expected);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (operator === "gt") return left > right;
    if (operator === "gte") return left >= right;
    if (operator === "lt") return left < right;
    return left <= right;
  }
  return String(actual) === String(expected);
}

function privateAddress(address: string): boolean {
  const family = net.isIP(address);
  return family === 0 || BLOCKED_DESTINATIONS.check(address, family === 4 ? "ipv4" : "ipv6");
}

async function assertSafeHttpUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("La solicitud HTTP solo admite http o https.");
  if (url.username || url.password) throw new Error("La URL no puede incluir credenciales.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (["localhost", "host.docker.internal"].includes(hostname.toLowerCase())) throw new Error("La solicitud HTTP bloqueó un destino local.");
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("La solicitud HTTP bloqueó una dirección no pública.");
  return url;
}

async function readResponseBody(response: Response, limit = 100_000): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error(`La respuesta HTTP supera ${limit} bytes.`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error(`La respuesta HTTP supera ${limit} bytes.`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function executeHttp(node: AutomationNode, items: Item[], context: AutomationEngineContext): Promise<Item[]> {
  if (!context.allowExternalRequests) throw new Error("Las solicitudes HTTP externas están desactivadas durante el desarrollo.");
  const output: Item[] = [];
  for (const item of items.slice(0, 20)) {
    const url = await assertSafeHttpUrl(String(resolveValue(node.parameters.url, item, context.variables) || ""));
    const method = String(node.parameters.method || "GET").toUpperCase();
    const headers: Record<string, string> = { accept: "application/json" };
    if (node.credentialId && context.resolveCredential) {
      const credential = await context.resolveCredential(node.credentialId);
      if (typeof credential.token === "string") headers.authorization = `Bearer ${credential.token}`;
      if (typeof credential.apiKey === "string") headers["x-api-key"] = credential.apiKey;
      if (typeof credential.name === "string" && typeof credential.value === "string") headers[credential.name] = credential.value;
      if (typeof credential.username === "string" && typeof credential.password === "string") {
        headers.authorization = `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`;
      }
    }
    const body = ["GET", "HEAD"].includes(method) ? undefined : JSON.stringify(resolveValue(node.parameters.body || {}, item, context.variables));
    if (body) headers["content-type"] = "application/json";
    // ponytail: DNS is checked before fetch; production still needs an egress proxy/firewall to eliminate DNS-rebinding races.
    const signal = context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
    const response = await fetch(url, { method, headers, body, redirect: "error", signal });
    const contentType = response.headers.get("content-type") || "";
    const text = await readResponseBody(response);
    let data: unknown = text;
    if (contentType.includes("application/json") && text) {
      try { data = JSON.parse(text); } catch { throw new Error("La respuesta HTTP declaró JSON, pero su contenido no es válido."); }
    }
    output.push({ ...item, http: { status: response.status, ok: response.ok, data: sanitize(data, context.sensitiveValues) } });
  }
  return output;
}

async function executeNode(node: AutomationNode, items: Item[], context: AutomationEngineContext): Promise<NodeOutputs> {
  const parameters = node.parameters;
  if (["core.manualTrigger", "core.schedule", "core.webhook", "core.formTrigger", "core.errorTrigger", "core.noOp", "core.merge"].includes(node.type)) return { main: items };
  if (node.type === "core.set") {
    return { main: items.map((item) => ({ ...(parameters.keepInput === false ? {} : item), ...(resolveValue(parameters.values || {}, item, context.variables) as Item) })) };
  }
  if (node.type === "core.if") {
    const result: NodeOutputs = { true: [], false: [] };
    for (const item of items) {
      const pass = compare(getPath(item, String(parameters.field || "")), String(parameters.operator || "equals"), resolveValue(parameters.value, item, context.variables));
      result[pass ? "true" : "false"].push(item);
    }
    return result;
  }
  if (node.type === "core.switch") {
    const result: NodeOutputs = { "case-0": [], "case-1": [], "case-2": [], fallback: [] };
    const cases = Array.isArray(parameters.cases) ? parameters.cases.slice(0, 3) as Array<Record<string, unknown>> : [];
    for (const item of items) {
      const actual = getPath(item, String(parameters.field || ""));
      const index = cases.findIndex((rule) => compare(actual, String(rule.operator || "equals"), resolveValue(rule.value, item, context.variables)));
      result[index >= 0 ? `case-${index}` : "fallback"].push(item);
    }
    return result;
  }
  if (node.type === "core.filter") {
    return { main: items.filter((item) => compare(getPath(item, String(parameters.field || "")), String(parameters.operator || "equals"), resolveValue(parameters.value, item, context.variables))) };
  }
  if (node.type === "core.sort") {
    const field = String(parameters.field || "");
    const direction = parameters.direction === "desc" ? -1 : 1;
    return { main: [...items].sort((left, right) => String(getPath(left, field) ?? "").localeCompare(String(getPath(right, field) ?? ""), "es", { numeric: true }) * direction) };
  }
  if (node.type === "core.limit") return { main: items.slice(0, Math.max(0, Math.min(10_000, Number(parameters.maxItems ?? 100)))) };
  if (node.type === "core.aggregate") {
    const field = String(parameters.groupBy || "");
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = String(getPath(item, field) ?? "(vacío)");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return { main: [...counts].map(([group, count]) => ({ group, count })) };
  }
  if (node.type === "core.removeDuplicates") {
    const seen = new Set<string>();
    const field = String(parameters.field || "");
    return { main: items.filter((item) => { const key = JSON.stringify(getPath(item, field)); if (seen.has(key)) return false; seen.add(key); return true; }) };
  }
  if (node.type === "core.splitOut") {
    const field = String(parameters.field || "");
    return { main: items.flatMap((item) => { const list = getPath(item, field); return Array.isArray(list) ? list.map((value) => ({ ...item, [field]: value })) : [item]; }) };
  }
  if (node.type === "core.dateTime") {
    const field = String(parameters.targetField || "timestamp");
    return { main: items.map((item) => ({ ...item, [field]: new Date().toISOString() })) };
  }
  if (node.type === "core.renameFields") {
    const mapping = parameters.mapping && typeof parameters.mapping === "object" && !Array.isArray(parameters.mapping) ? parameters.mapping as Record<string, unknown> : {};
    return { main: items.map((item) => { const next = { ...item }; for (const [from, to] of Object.entries(mapping)) { if (from in next && String(to)) { next[String(to)] = next[from]; delete next[from]; } } return next; }) };
  }
  if (node.type === "core.removeFields") {
    const fields = Array.isArray(parameters.fields) ? parameters.fields.map(String) : [];
    return { main: items.map((item) => { const next = { ...item }; for (const field of fields) delete next[field]; return next; }) };
  }
  if (node.type === "core.math") {
    const field = String(parameters.field || "");
    const target = String(parameters.targetField || "result");
    const operand = Number(parameters.value || 0);
    return { main: items.map((item) => {
      const actual = Number(getPath(item, field));
      if (!Number.isFinite(actual)) throw new Error(`${field} no contiene un número válido.`);
      const operation = String(parameters.operation || "add");
      const result = operation === "subtract" ? actual - operand : operation === "multiply" ? actual * operand : operation === "divide" ? (operand === 0 ? NaN : actual / operand) : operation === "round" ? Math.round(actual) : actual + operand;
      if (!Number.isFinite(result)) throw new Error("El cálculo produjo un resultado inválido.");
      return { ...item, [target]: result };
    }) };
  }
  if (node.type === "core.regexExtract") {
    const field = String(parameters.field || "");
    const target = String(parameters.targetField || "match");
    const pattern = String(parameters.pattern || "");
    if (pattern.length > 256 || /\\[1-9]/.test(pattern) || /\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) throw new Error("El patrón regex contiene construcciones no permitidas por seguridad.");
    let regex: RegExp;
    try { regex = new RegExp(pattern, "u"); } catch { throw new Error("El patrón regex no es válido."); }
    return { main: items.map((item) => ({ ...item, [target]: String(getPath(item, field) ?? "").slice(0, 10_000).match(regex)?.[0] || "" })) };
  }
  if (node.type === "core.jsonParse") {
    const field = String(parameters.field || "");
    const target = String(parameters.targetField || "parsed");
    return { main: items.map((item) => { const raw = getPath(item, field); if (typeof raw !== "string") throw new Error(`${field} no contiene texto JSON.`); try { return { ...item, [target]: JSON.parse(raw) }; } catch { throw new Error(`${field} contiene JSON inválido.`); } }) };
  }
  if (node.type === "core.jsonStringify") {
    const field = String(parameters.field || "");
    const target = String(parameters.targetField || "json");
    return { main: items.map((item) => ({ ...item, [target]: JSON.stringify(getPath(item, field)) })) };
  }
  if (node.type === "core.hash") {
    const field = String(parameters.field || "");
    const target = String(parameters.targetField || "hash");
    const algorithm = parameters.algorithm === "sha512" ? "sha512" : "sha256";
    return { main: items.map((item) => ({ ...item, [target]: createHash(algorithm).update(String(getPath(item, field) ?? "")).digest("hex") })) };
  }
  if (node.type === "core.base64") {
    const field = String(parameters.field || "");
    const target = String(parameters.targetField || "base64");
    return { main: items.map((item) => ({ ...item, [target]: parameters.mode === "decode" ? Buffer.from(String(getPath(item, field) ?? ""), "base64").toString("utf8") : Buffer.from(String(getPath(item, field) ?? ""), "utf8").toString("base64") })) };
  }
  if (node.type === "core.wait") {
    const milliseconds = Math.max(0, Math.min(2_000, Number(parameters.milliseconds ?? 0)));
    if (milliseconds) await delay(milliseconds, undefined, { signal: context.signal });
    return { main: items };
  }
  if (node.type === "core.stopAndError") throw new Error(String(parameters.message || "Ejecución detenida por el workflow."));
  if (node.type === "core.executeWorkflow") {
    if (!context.executeSubworkflow) throw new Error("El ejecutor de subworkflows no está disponible.");
    const output = await context.executeSubworkflow(String(parameters.workflowId || ""), items, (context.depth || 0) + 1);
    return { main: output };
  }
  if (node.type === "core.httpRequest") return { main: await executeHttp(node, items, context) };
  if (node.type === "core.respondToWebhook") return { main: items.map((item) => ({ ...item, response: resolveValue(parameters.body || {}, item, context.variables) })) };
  if (node.type === "sac.metricoolInbox") {
    if (parameters.operation !== "preview" && !context.allowMetricoolOperations) throw new Error("Las operaciones Metricool están bloqueadas durante el desarrollo.");
    const source = items.length ? items : [{}];
    return { main: source.map((item) => ({ ...item, sac: { mode: "preview", externalWritesBlocked: true, module: "SAC Flow" } })) };
  }
  if (node.type === "sac.classify") {
    const threshold = Number(parameters.minimumConfidence ?? 0.82);
    const safe: Item[] = [];
    const review: Item[] = [];
    for (const item of items) {
      const text = String(item.text || item.message || "").toLocaleLowerCase("es-CL");
      const sensitive = /(reclamo|legal|crisis|datos personales|contraseña|fraude)/i.test(text);
      const confidence = sensitive ? 0.96 : 0.86;
      const classified = { ...item, classification: { category: sensitive ? "sensible" : "general", sentiment: sensitive ? "negative" : "neutral", confidence, humanReview: sensitive || confidence < threshold } };
      (sensitive || confidence < threshold ? review : safe).push(classified);
    }
    return { safe, review };
  }
  if (node.type === "sac.humanReview") return { main: items.map((item) => ({ ...item, humanReview: { required: true, status: "pending" } })) };
  if (node.type === "sac.exportXlsx") return { main: items.map((item) => ({ ...item, export: { format: "xlsx", prepared: true } })) };
  throw new Error(`El nodo ${node.type} no tiene ejecutor instalado.`);
}

function topologicalOrder(workflow: AutomationWorkflow): AutomationNode[] {
  const enabled = workflow.nodes.filter((node) => !node.disabled);
  const enabledIds = new Set(enabled.map((node) => node.id));
  const incoming = new Map(enabled.map((node) => [node.id, 0]));
  const adjacency = new Map(enabled.map((node) => [node.id, [] as string[]]));
  for (const connection of workflow.connections) {
    if (!enabledIds.has(connection.sourceNode) || !enabledIds.has(connection.targetNode)) continue;
    adjacency.get(connection.sourceNode)!.push(connection.targetNode);
    incoming.set(connection.targetNode, (incoming.get(connection.targetNode) || 0) + 1);
  }
  const queue = enabled.filter((node) => incoming.get(node.id) === 0);
  const result: AutomationNode[] = [];
  while (queue.length) {
    const node = queue.shift()!;
    result.push(node);
    for (const target of adjacency.get(node.id) || []) {
      const next = (incoming.get(target) || 0) - 1;
      incoming.set(target, next);
      if (next === 0) queue.push(enabled.find((item) => item.id === target)!);
    }
  }
  if (result.length !== enabled.length) throw new Error("El workflow contiene ciclos y no puede ejecutarse.");
  return result;
}

export async function executeAutomationWorkflow(
  workflow: AutomationWorkflow,
  input: Item[],
  context: AutomationEngineContext,
): Promise<AutomationEngineResult> {
  const nodeRuns: AutomationNodeRun[] = [];
  const inputs = new Map<string, Item[]>();
  const outputs = new Map<string, NodeOutputs>();
  const order = topologicalOrder(workflow);
  const enabledIds = new Set(order.map((node) => node.id));
  const activeConnections = workflow.connections.filter((connection) => enabledIds.has(connection.sourceNode) && enabledIds.has(connection.targetNode));
  const triggers = order.filter((node) => getAutomationNodeDefinition(node.type)?.trigger);
  const modeTriggers = triggers.filter((node) => {
    if (context.mode === "webhook") return ["core.webhook", "core.formTrigger"].includes(node.type);
    if (context.mode === "schedule") return node.type === "core.schedule";
    if (context.mode === "subworkflow") return node.type === "core.manualTrigger";
    return node.type === "core.manualTrigger" || (context.mode === "retry" && getAutomationNodeDefinition(node.type)?.trigger);
  });
  const matchingTriggers = context.triggerNodeId
    ? modeTriggers.filter((node) => node.id === context.triggerNodeId)
    : modeTriggers;
  if (context.triggerNodeId && !matchingTriggers.length) {
    return { status: "error", output: [], nodeRuns, error: { nodeId: context.triggerNodeId, message: "El trigger solicitado no pertenece al workflow o no corresponde al modo de ejecución." } };
  }
  for (const trigger of matchingTriggers.length ? matchingTriggers : triggers.slice(0, 1)) inputs.set(trigger.id, input.length ? structuredClone(input) : [{}]);

  for (const node of order) {
    if (context.signal?.aborted) return { status: "error", output: [], nodeRuns, error: { nodeId: node.id, message: "Ejecución cancelada." } };
    const items = inputs.get(node.id) || [];
    if (!items.length && !inputs.has(node.id)) continue;
    const startedAt = new Date().toISOString();
    let attempts = 0;
    try {
      const maxAttempts = node.retryOnFail ? Math.max(1, Math.min(10, node.maxTries || 3)) : 1;
      let nodeOutput: NodeOutputs | undefined;
      let lastError: unknown;
      while (attempts < maxAttempts) {
        attempts += 1;
        try {
          nodeOutput = await executeNode(node, items, context);
          break;
        } catch (error) {
          lastError = error;
          if (attempts >= maxAttempts) throw error;
          await delay(Math.min(1_000, 100 * (2 ** (attempts - 1))), undefined, { signal: context.signal });
        }
      }
      if (!nodeOutput) throw lastError || new Error("El nodo no produjo un resultado.");
      outputs.set(node.id, nodeOutput);
      const sanitizedOutputs = sanitize(nodeOutput, context.sensitiveValues) as NodeOutputs;
      const finishedAt = new Date().toISOString();
      nodeRuns.push({
        nodeId: node.id, nodeName: node.name, nodeType: node.type, status: "success", startedAt, finishedAt,
        itemsIn: items.length, itemsOut: Object.values(nodeOutput).reduce((sum, list) => sum + list.length, 0), attempts, outputs: sanitizedOutputs,
      });
      for (const connection of activeConnections.filter((edge) => edge.sourceNode === node.id)) {
        const routed = nodeOutput[connection.sourceOutput] || [];
        if (!routed.length) continue;
        inputs.set(connection.targetNode, [...(inputs.get(connection.targetNode) || []), ...routed]);
      }
    } catch (error) {
      const message = sanitizeString(error instanceof Error ? error.message : "El nodo falló.", context.sensitiveValues);
      const finishedAt = new Date().toISOString();
      nodeRuns.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, status: "error", startedAt, finishedAt, itemsIn: items.length, itemsOut: 0, attempts, outputs: {}, error: message });
      if (!node.continueOnFail) return { status: "error", output: [], nodeRuns, error: { nodeId: node.id, message } };
      const continued = items.map((item) => ({ ...item, error: { node: node.name, message } }));
      outputs.set(node.id, { main: continued });
      for (const connection of activeConnections.filter((edge) => edge.sourceNode === node.id && edge.sourceOutput === "main")) {
        inputs.set(connection.targetNode, [...(inputs.get(connection.targetNode) || []), ...continued]);
      }
    }
  }

  const connectedSources = new Set(activeConnections.map((connection) => connection.sourceNode));
  const terminalNodes = order.filter((node) => !connectedSources.has(node.id));
  const output = terminalNodes.flatMap((node) => Object.values(outputs.get(node.id) || {}).flat());
  return { status: "success", output: sanitize(output, context.sensitiveValues) as Item[], nodeRuns };
}
