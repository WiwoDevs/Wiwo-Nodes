/**
 * Redacción de los campos editoriales del reporte SAC.
 *
 * La plantilla termina con cinco marcadores que no son cifras sino texto firmado ante el
 * cliente: una lectura del mes y dos próximos pasos. Ningún cálculo los produce, y dejarlos
 * vacíos obliga a escribir catorce veces lo mismo a mano.
 *
 * Este módulo los redacta con Claude a partir de las cifras ya calculadas, más el corte de
 * cobertura por superficie y una muestra acotada de casos reales. El modelo no recibe la
 * base: recibe un resumen cerrado, de modo que solo pueda hablar de lo que el informe
 * efectivamente muestra.
 *
 * El resultado es un borrador. La aprobación es humana: el texto va con la firma de la
 * agencia ante el cliente y compromete lecturas que el dato solo sugiere.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { SacReportFigures } from "./sac-report.js";

/** Cobertura abierta por superficie: el corte que distingue un equipo lento de uno que no mira los comentarios. */
export interface SuperficieCobertura {
  superficie: string;
  casos: number;
  respondidos: number;
  pct: number;
}

export interface EjemploCaso {
  motivo: string;
  tono: string;
  superficie: string;
  respondido: boolean;
  texto: string;
}

export interface EditorialContext {
  figures: SacReportFigures;
  superficies: SuperficieCobertura[];
  ejemplos: EjemploCaso[];
  /** Canales con casos que la plantilla no puede graficar, para que el texto los nombre. */
  fueraDePlantilla: Array<{ canal: string; casos: number }>;
  /**
   * Redes que la marca tiene efectivamente conectadas. Sin esto el modelo propone cubrir
   * canales que la marca no opera: a una cuenta que solo vive en TikTok le recomendó
   * barrer Instagram y Facebook.
   */
  redesConectadas: string[];
}

export interface SacEditorial {
  lectura: string;
  next1: { titulo: string; detalle: string };
  next2: { titulo: string; detalle: string };
}

// Capacidad real de cada cuadro de la plantilla, medida sobre el XML: ancho y alto de la
// forma contra el cuerpo tipográfico de su texto. Un texto más largo no falla, se desborda
// sobre la lámina, que es peor que quedarse corto. El modelo recibe estos mismos números
// para escribir a la medida; el recorte de abajo es la red y casi nunca debería actuar.
export const LIMITES = { lectura: 300, titulo: 50, detalle: 300 } as const;

const editorialSchema = z.object({
  lectura: z.string().describe(
    `Lectura del mes en 2 o 3 oraciones. Apunta a ${LIMITES.lectura - 40} caracteres y nunca `
    + `pases de ${LIMITES.lectura}, que es lo que entra en el cuadro. Qué pasó, qué lo explica `
    + "y qué implica, apoyado solo en las cifras entregadas. Debe terminar en punto: cerrar la "
    + "idea dentro del largo es parte del encargo, no se recorta después.",
  ),
  next1: z.object({
    titulo: z.string().describe(`Acción concreta en 3 a 6 palabras, máximo ${LIMITES.titulo} caracteres, sin punto final.`),
    detalle: z.string().describe(`Dos o tres oraciones, máximo ${LIMITES.detalle} caracteres: qué se hace y qué resuelve. Debe terminar en punto.`),
  }),
  next2: z.object({
    titulo: z.string().describe(`Acción concreta en 3 a 6 palabras, máximo ${LIMITES.titulo} caracteres, sin punto final.`),
    detalle: z.string().describe(`Dos o tres oraciones, máximo ${LIMITES.detalle} caracteres: qué se hace y qué resuelve. Debe terminar en punto.`),
  }),
});

const SYSTEM_PROMPT = `Escribes el cierre de un informe mensual de atención al cliente en redes sociales que una agencia chilena entrega a su cliente.

Recibes las cifras ya calculadas de una marca en un mes, la cobertura abierta por superficie y una muestra de casos reales. Devuelves tres cosas: una lectura del mes y dos próximos pasos.

LA LECTURA
Explica el mes, no lo describe. Repetir "recibimos 125 casos con 82% de cobertura" no aporta: el cliente ya ve esos números en las láminas anteriores. Lo que aporta es la relación entre ellos: qué explica la cobertura que tuvo, qué motivo concentra el trabajo, si el tono negativo se corresponde con algún motivo puntual, dónde está el cuello de botella.

El corte por superficie suele ser lo más revelador. Un equipo que responde el 90% de los mensajes privados y el 15% de los comentarios públicos no tiene un problema de capacidad: tiene un canal desatendido, y eso se dice.

Cuando la cobertura es alta y pareja, no inventes un problema. Di qué la sostuvo y dónde está el margen que queda.

LOS PRÓXIMOS PASOS
Dos acciones que la agencia ejecuta el mes siguiente, derivadas de lo que muestran las cifras de esta marca. Nada genérico: "mejorar los tiempos de respuesta" sirve para cualquier informe y por eso no sirve para ninguno. Si los comentarios de Facebook quedaron sin responder, el paso es cubrirlos; si un motivo concentra un tercio de los casos, el paso ataca ese motivo.

Cada paso debe ser algo que la agencia hace, no algo que el cliente debería hacer.

Solo puedes proponer trabajo sobre las redes que la marca tiene conectadas, que vienen en la lista "redes_conectadas". Si una marca solo opera TikTok, recomendar un barrido de Instagram es proponer trabajo sobre una cuenta que no existe.

TONO
Español de Chile, profesional y directo. Sin superlativos ni lenguaje de marketing: nada de "excelente desempeño", "seguimos potenciando", "una comunidad cada vez más comprometida". Escribe como un analista que le informa a un par, no como un vendedor.

REGLAS DURAS
- Solo cifras entregadas. No estimes, no proyectes, no compares con meses de los que no tienes dato.
- Si la variación viene marcada como no comparable, no la menciones ni la insinúes: no hables de crecimiento, caída ni del mes anterior.
- Respeta los largos máximos de cada campo. El texto se imprime tal cual en la lámina y no se recorta: pasarse desborda el cuadro.
- No prometas plazos ni SLA numéricos que nadie te dio.
- No nombres clientes finales ni reproduzcas datos personales de la muestra.
- Los casos de la muestra son ilustrativos: úsalos para entender el mes, no los cites textualmente.`;

export class EditorialError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EditorialError";
  }
}

export interface EditorialOptions {
  apiKey?: string;
  model?: string;
  client?: Pick<Anthropic["messages"], "parse">;
}

function resumen(context: EditorialContext): string {
  const f = context.figures;
  return JSON.stringify({
    marca: f.brandLabel,
    periodo: f.period,
    redes_conectadas: context.redesConectadas,
    largos_maximos: LIMITES,
    casos_sac: f.casosSac,
    volumen_bruto_recibido: f.volumenBruto,
    respondidos: f.respondidos,
    cobertura_pct: f.coberturaPct,
    derivados_a_area_interna: f.derivados,
    privados: f.privados,
    publicos: f.publicos,
    canales: f.canales,
    motivos: f.motivos,
    tono: f.tono,
    variacion: f.variacion?.comparable ? f.variacion : "no comparable, no mencionar",
    cobertura_por_superficie: context.superficies,
    canales_sin_grafico_en_la_plantilla: context.fueraDePlantilla,
    muestra_de_casos: context.ejemplos,
  }, null, 1);
}

/** Recorta respetando palabras; la plantilla desborda antes que truncar sola. */
export function ajustar(texto: string, limite: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= limite) return limpio;
  const corte = limpio.slice(0, limite);
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > limite * 0.6 ? corte.slice(0, espacio) : corte).replace(/[,;:]$/, "")}…`;
}

export async function draftSacEditorial(
  context: EditorialContext,
  options: EditorialOptions = {},
): Promise<SacEditorial> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!options.client && !apiKey) {
    throw new EditorialError("Falta ANTHROPIC_API_KEY para redactar el cierre del informe.");
  }
  const messages = options.client ?? new Anthropic({ apiKey }).messages;

  let response: { parsed_output: z.infer<typeof editorialSchema> | null };
  try {
    response = await messages.parse({
      model: options.model ?? "claude-opus-5",
      max_tokens: 4_000,
      system: [{
        type: "text",
        text: SYSTEM_PROMPT,
        // El encargo no cambia entre marcas: cachearlo evita reenviarlo catorce veces.
        cache_control: { type: "ephemeral" },
      }],
      // Redactar el cierre sí exige razonar sobre las cifras, no solo etiquetar.
      output_config: {
        effort: "medium",
        format: zodOutputFormat(editorialSchema),
      },
      messages: [{
        role: "user",
        content: `Redacta el cierre del informe de esta marca:\n\n${resumen(context)}`,
      }],
    }) as { parsed_output: z.infer<typeof editorialSchema> | null };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      throw new EditorialError("Claude está limitando por tasa; reintente más tarde.", error);
    }
    if (error instanceof Anthropic.AuthenticationError) {
      throw new EditorialError("La ANTHROPIC_API_KEY no es válida.", error);
    }
    if (error instanceof Anthropic.APIError) {
      throw new EditorialError(`Claude respondió con estado ${error.status}.`, error);
    }
    throw new EditorialError("No fue posible contactar a Claude.", error);
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new EditorialError("Claude devolvió una respuesta que no calza con el esquema.");

  return {
    lectura: ajustar(parsed.lectura, LIMITES.lectura),
    next1: {
      titulo: ajustar(parsed.next1.titulo, LIMITES.titulo),
      detalle: ajustar(parsed.next1.detalle, LIMITES.detalle),
    },
    next2: {
      titulo: ajustar(parsed.next2.titulo, LIMITES.titulo),
      detalle: ajustar(parsed.next2.detalle, LIMITES.detalle),
    },
  };
}

/** Marcadores de la plantilla que cubre el cierre editorial. */
export function editorialPlaceholders(editorial: SacEditorial): Record<string, string> {
  return {
    sac_lectura: editorial.lectura,
    sac_next1_titulo: editorial.next1.titulo,
    sac_next1_detalle: editorial.next1.detalle,
    sac_next2_titulo: editorial.next2.titulo,
    sac_next2_detalle: editorial.next2.detalle,
  };
}
