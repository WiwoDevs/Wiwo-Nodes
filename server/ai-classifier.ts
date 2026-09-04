/**
 * Clasificación de interacciones con Claude.
 *
 * El motor por reglas de `sac-automation.ts` cubre vocabulario fijo de e-commerce y deja
 * fuera al 74% de los mensajes reales: emojis, jerga, consultas fuera de ese vocabulario.
 * Un reporte donde tres de cada cuatro casos dicen "otro" no sirve para presentar.
 *
 * Este módulo clasifica en lote y agrega algo que las reglas no pueden decidir: si el
 * mensaje es siquiera materia de atención al cliente. Cerca de un tercio del volumen de
 * Instagram son reacciones sociales ("😍", "@amiga", "hermoso") que inflan los totales de
 * un reporte SAC sin representar un caso.
 *
 * No decide envíos ni respuestas: solo escribe categoría, tonalidad y si es caso SAC. El
 * protocolo de guardrails sigue siendo la autoridad sobre qué se responde.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Interaction, Sentiment } from "./types.js";

/** Taxonomía cerrada. Un conjunto fijo mantiene los gráficos comparables mes a mes. */
export const SAC_CATEGORIES = [
  "reclamo",
  "consulta_producto",
  "precio",
  "stock",
  "despacho",
  "seguimiento_pedido",
  "postventa",
  "pago_facturacion",
  "horarios_ubicacion",
  "contacto",
  "agradecimiento",
  "critica",
  "consulta_general",
  "no_aplica",
] as const;
export type SacCategory = (typeof SAC_CATEGORIES)[number];

const classificationSchema = z.object({
  results: z.array(z.object({
    id: z.string().describe("El id exacto del mensaje que se está clasificando."),
    categoria: z.enum(SAC_CATEGORIES),
    tonalidad: z.enum(["positive", "neutral", "negative"]),
    esCasoSac: z.boolean().describe(
      "true si el mensaje requiere o merece atención del equipo. false para reacciones "
      + "sociales sin contenido: solo emojis, menciones a terceros, elogios de una palabra.",
    ),
    requiereDerivacion: z.boolean().describe(
      "true si responder exige información interna que el equipo de redes no posee: "
      + "estado de un pedido puntual, datos de una cuenta, stock de una tienda concreta.",
    ),
    confianza: z.number().min(0).max(1),
  })),
});

const SYSTEM_PROMPT = `Clasificas mensajes que clientes envían a marcas por redes sociales en Chile y Latinoamérica, para un sistema de atención al cliente.

Para cada mensaje entregas cinco cosas:

1. categoria — una sola, la dominante:
   reclamo: molestia, queja, producto defectuoso, mal servicio, pedido que no llegó
   consulta_producto: dudas sobre características, tallas, materiales, uso
   precio: cuánto cuesta, cotizaciones, descuentos
   stock: disponibilidad, tallas agotadas, reposición
   despacho: envíos, cobertura, plazos, costo de envío
   seguimiento_pedido: dónde está mi pedido, estado de una compra ya hecha
   postventa: cambios, devoluciones, garantías, reparaciones
   pago_facturacion: pagos, transferencias, boletas, cobros, medios de pago
   horarios_ubicacion: horarios, direcciones, sucursales, cómo llegar
   contacto: piden teléfono, correo, WhatsApp, o cómo comunicarse
   agradecimiento: agradecen, felicitan, elogian con contenido
   critica: opinión negativa que no es un reclamo accionable
   consulta_general: pregunta legítima que no encaja en las anteriores
   no_aplica: no es materia de atención al cliente

2. tonalidad — positive, neutral o negative, según cómo se siente el cliente. Un reclamo
   es negative aunque esté redactado con cortesía. Una pregunta neutra es neutral.

3. esCasoSac — false cuando el mensaje no representa un caso que el equipo deba atender:
   solo emojis o reacciones, menciones o etiquetas a terceros sin mensaje, elogios de una
   palabra, spam. true cuando hay una consulta, un problema, o algo que merece respuesta.
   Un agradecimiento con contenido real es true. Un "😍" suelto es false.

4. requiereDerivacion — true cuando responder bien exige información interna que el
   equipo de redes sociales no tiene a mano: el estado de un pedido específico, datos de la
   cuenta de esa persona, stock de una sucursal puntual, el detalle de un cobro. Es el caso
   que SAC debe derivar a un área interna. false cuando la respuesta está en información
   pública o general de la marca. Un mensaje que no es caso SAC nunca requiere derivación.

5. confianza — entre 0 y 1. Baja cuando el mensaje es ambiguo, muy corto o está en otro
   idioma.

Reglas:
- Los mensajes vienen en español chileno con modismos, errores de tipeo y emojis.
- Nunca inventes contexto que no está en el texto.
- Devuelve exactamente un resultado por mensaje recibido, con el id que te fue dado.`;

export interface ClassificationOutcome {
  id: string;
  categoria: SacCategory;
  tonalidad: Sentiment;
  esCasoSac: boolean;
  /** Requiere información interna: alimenta el conteo de casos derivados del reporte. */
  requiereDerivacion: boolean;
  confianza: number;
}

export interface ClassifierOptions {
  apiKey?: string;
  model?: string;
  /** Mensajes por solicitud. Lotes grandes ahorran tokens pero pierden más ante un fallo. */
  batchSize?: number;
  client?: Pick<Anthropic["messages"], "parse">;
}

/** Texto acotado: un mensaje larguísimo no aporta más señal y encarece el lote. */
function forPrompt(interaction: Interaction): { id: string; texto: string; canal: string; tipo: string } {
  const texto = (interaction.text ?? "").slice(0, 600).trim();
  return {
    id: interaction.id,
    texto: texto || "(sin texto)",
    canal: interaction.channel,
    tipo: interaction.type,
  };
}

export class ClassifierError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ClassifierError";
  }
}

/**
 * Clasifica un lote de interacciones. Devuelve un resultado por mensaje reconocido;
 * los mensajes que el modelo omita simplemente no aparecen, y el llamador decide qué hacer.
 */
export async function classifyInteractions(
  interactions: Interaction[],
  options: ClassifierOptions = {},
): Promise<ClassificationOutcome[]> {
  if (!interactions.length) return [];

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!options.client && !apiKey) {
    throw new ClassifierError("Falta ANTHROPIC_API_KEY para clasificar con IA.");
  }
  const messages = options.client ?? new Anthropic({ apiKey }).messages;
  const model = options.model ?? "claude-opus-5";
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 20, 50));

  const outcomes: ClassificationOutcome[] = [];
  for (let index = 0; index < interactions.length; index += batchSize) {
    const batch = interactions.slice(index, index + batchSize);
    const payload = batch.map(forPrompt);

    let response: { parsed_output: z.infer<typeof classificationSchema> | null };
    try {
      response = await messages.parse({
        model,
        // Suficiente para ~50 clasificaciones compactas sin truncar el JSON.
        max_tokens: 8_000,
        system: [{
          type: "text",
          text: SYSTEM_PROMPT,
          // La taxonomía no cambia entre lotes: cachearla evita reenviarla cada vez.
          cache_control: { type: "ephemeral" },
        }],
        // Clasificar es trabajo rutinario: esfuerzo alto encarece sin mejorar la etiqueta.
        output_config: {
          effort: "low",
          format: zodOutputFormat(classificationSchema),
        },
        messages: [{
          role: "user",
          content: `Clasifica estos ${payload.length} mensajes:\n\n${JSON.stringify(payload, null, 1)}`,
        }],
      }) as { parsed_output: z.infer<typeof classificationSchema> | null };
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        throw new ClassifierError("Claude está limitando por tasa; reintente más tarde.", error);
      }
      if (error instanceof Anthropic.AuthenticationError) {
        throw new ClassifierError("La ANTHROPIC_API_KEY no es válida.", error);
      }
      if (error instanceof Anthropic.APIError) {
        throw new ClassifierError(`Claude respondió con estado ${error.status}.`, error);
      }
      throw new ClassifierError("No fue posible contactar a Claude.", error);
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new ClassifierError("Claude devolvió una respuesta que no calza con el esquema.");
    }

    // Solo se aceptan ids del lote: evita que una alucinación escriba sobre otro caso.
    const known = new Set(batch.map((item) => item.id));
    for (const result of parsed.results) {
      if (!known.has(result.id)) continue;
      outcomes.push({
        id: result.id,
        categoria: result.categoria,
        tonalidad: result.tonalidad,
        esCasoSac: result.esCasoSac,
        // Un mensaje que no es caso SAC no puede derivarse: se fuerza la coherencia aquí
        // en vez de confiar en que el modelo nunca se contradiga.
        requiereDerivacion: result.esCasoSac && result.requiereDerivacion,
        confianza: result.confianza,
      });
    }
  }

  return outcomes;
}
