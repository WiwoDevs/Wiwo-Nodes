/**
 * Adaptador de proveedores de IA.
 *
 * El resto del servidor pide "este JSON, con este esquema" y no sabe qué proveedor responde.
 * Hoy hay dos: DeepSeek servido por BytePlus ModelArk (API compatible con OpenAI) y Claude
 * (SDK de Anthropic). Cambiar de proveedor es configuración, no código, y la evaluación de
 * calidad puede compararlos sobre la misma muestra.
 *
 * Las credenciales viven solo aquí, en el servidor: ningún error, registro ni respuesta de la
 * API incluye la clave ni el texto enviado.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "./config.js";

export type AiProviderName = "byteplus" | "anthropic";

export interface AiJsonRequest {
  system: string;
  user: string;
  /** Nombre corto del esquema (lo exige el modo json_schema compatible con OpenAI). */
  schemaName: string;
  /** JSON Schema estricto: todas las propiedades requeridas y sin propiedades adicionales. */
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface AiJsonResult {
  json: unknown;
  model: string;
  usage: AiUsage;
}

export interface AiProvider {
  readonly name: AiProviderName;
  readonly model: string;
  completeJson(request: AiJsonRequest): Promise<AiJsonResult>;
}

export type AiProviderErrorCode = "rate_limited" | "auth" | "http" | "network" | "timeout" | "invalid_output" | "refusal";

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly code: AiProviderErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

/** Región de BytePlus ModelArk usada por defecto: Asia Pacífico (Johor, Malasia). */
export const BYTEPLUS_DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";
/** DeepSeek V4.1 Flash en ModelArk; admite salida json_schema y razonamiento desactivable. */
export const BYTEPLUS_DEFAULT_MODEL = "deepseek-v4-1-flash-261017";
export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface BytePlusOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

interface ChatCompletionPayload {
  model?: string;
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { code?: string; message?: string };
}

function parseJsonContent(content: string | null | undefined): unknown {
  if (!content?.trim()) throw new AiProviderError("El proveedor devolvió una respuesta vacía.", "invalid_output");
  try {
    return JSON.parse(content);
  } catch {
    throw new AiProviderError("El proveedor devolvió un JSON inválido.", "invalid_output");
  }
}

export function createBytePlusProvider(options: BytePlusOptions): AiProvider {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const endpoint = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  return {
    name: "byteplus",
    model: options.model,
    async completeJson(request) {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: request.maxTokens,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.user },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: request.schemaName, schema: request.jsonSchema, strict: true },
            },
            // Clasificar es trabajo rutinario: el razonamiento encarece y alarga sin mejorar la etiqueta.
            thinking: { type: "disabled" },
          }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new AiProviderError("BytePlus no respondió a tiempo.", "timeout");
        }
        throw new AiProviderError("No fue posible contactar a BytePlus.", "network");
      }

      const payload = await response.json().catch(() => undefined) as ChatCompletionPayload | undefined;
      if (response.status === 401 || response.status === 403) {
        throw new AiProviderError("BytePlus rechazó la credencial (BYTEPLUS_API_KEY).", "auth", response.status);
      }
      if (response.status === 429) {
        throw new AiProviderError("BytePlus está limitando por tasa; se reintenta más tarde.", "rate_limited", 429);
      }
      if (!response.ok) {
        // El código del proveedor ayuda a diagnosticar; el mensaje puede citar la entrada, así que no se copia.
        const code = payload?.error?.code ? ` (${String(payload.error.code).slice(0, 80)})` : "";
        throw new AiProviderError(`BytePlus respondió con estado ${response.status}${code}.`, "http", response.status);
      }

      const choice = payload?.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new AiProviderError("La respuesta de BytePlus quedó truncada por max_tokens.", "invalid_output");
      }
      if (choice?.finish_reason === "content_filter") {
        throw new AiProviderError("El filtro de contenido de BytePlus bloqueó la respuesta.", "refusal");
      }
      return {
        json: parseJsonContent(choice?.message?.content),
        model: payload?.model || options.model,
        usage: {
          inputTokens: payload?.usage?.prompt_tokens ?? 0,
          outputTokens: payload?.usage?.completion_tokens ?? 0,
          cachedInputTokens: payload?.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        },
      };
    },
  };
}

interface AnthropicOptions {
  apiKey?: string;
  model: string;
  timeoutMs: number;
  client?: Pick<Anthropic["messages"], "create">;
}

export function createAnthropicProvider(options: AnthropicOptions): AiProvider {
  const messages = options.client ?? new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs }).messages;
  return {
    name: "anthropic",
    model: options.model,
    async completeJson(request) {
      let response: Anthropic.Message;
      try {
        response = await messages.create({
          model: options.model,
          max_tokens: request.maxTokens,
          // Las instrucciones no cambian entre lotes: cachearlas evita reenviarlas cada vez.
          system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
          output_config: {
            effort: "low",
            format: { type: "json_schema", schema: request.jsonSchema },
          },
          messages: [{ role: "user", content: request.user }],
        }) as Anthropic.Message;
      } catch (error) {
        if (error instanceof Anthropic.RateLimitError) throw new AiProviderError("Claude está limitando por tasa.", "rate_limited", 429);
        if (error instanceof Anthropic.AuthenticationError) throw new AiProviderError("La ANTHROPIC_API_KEY no es válida.", "auth", 401);
        if (error instanceof Anthropic.APIConnectionTimeoutError) throw new AiProviderError("Claude no respondió a tiempo.", "timeout");
        if (error instanceof Anthropic.APIError) throw new AiProviderError(`Claude respondió con estado ${error.status}.`, "http", error.status);
        throw new AiProviderError("No fue posible contactar a Claude.", "network");
      }
      if (response.stop_reason === "refusal") throw new AiProviderError("Claude declinó la solicitud.", "refusal");
      if (response.stop_reason === "max_tokens") throw new AiProviderError("La respuesta de Claude quedó truncada por max_tokens.", "invalid_output");
      const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
      return {
        json: parseJsonContent(text),
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
        },
      };
    },
  };
}

export type AiProviderState =
  | { ready: true; provider: AiProvider }
  | { ready: false; reason: "disabled" | "missing_api_key" };

/** Arma el proveedor configurado, o explica por qué no hay ninguno (apagado o sin clave). */
export function createAiProvider(config: AppConfig["ai"], fetchImpl?: FetchLike): AiProviderState {
  if (!config.enabled) return { ready: false, reason: "disabled" };
  if (!config.apiKey) return { ready: false, reason: "missing_api_key" };
  if (config.provider === "anthropic") {
    return { ready: true, provider: createAnthropicProvider({ apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs }) };
  }
  return {
    ready: true,
    provider: createBytePlusProvider({
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      fetchImpl,
    }),
  };
}
