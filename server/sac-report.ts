/**
 * Cifras del reporte SAC mensual, en la forma que espera la plantilla de presentación.
 *
 * La plantilla usa marcadores `{{nombre}}` sobre un `.pptx`. Este módulo produce el mapa
 * marcador → valor; el reemplazo en el archivo vive aparte, para que las cifras se puedan
 * revisar y probar sin generar un binario.
 *
 * Decisión central: el total del reporte cuenta **casos SAC**, no mensajes recibidos. Cerca
 * de un tercio del volumen de Instagram son reacciones sociales (emojis sueltos, etiquetas
 * entre amigos, propuestas de colaboración) que nadie atiende. Contarlas triplicaría el
 * volumen y diluiría cada tasa del informe. El volumen bruto se conserva aparte, porque la
 * lámina de flujo necesita ambos números.
 */
import type { Brand, Channel, Interaction } from "./types.js";

export interface SacReportOptions {
  /** Primer día del período, YYYY-MM-DD inclusive. */
  from: string;
  /** Último día del período, YYYY-MM-DD inclusive. */
  to: string;
  /** Período anterior para la variación; omitido cuando no hay uno comparable. */
  previous?: { from: string; to: string };
  /** Etiqueta legible del período, por ejemplo "Agosto 2026". */
  label: string;
  /**
   * Qué cuenta como volumen del informe.
   *
   * `gestionado` descuenta lo que llegó a la bandeja sin ser un mensaje —menciones en
   * historias, reacciones— y los aplausos sueltos. `bruto` muestra todo lo recibido, sin
   * filtro: dice más sobre la exposición de la marca y menos sobre la carga del equipo.
   * Es una decisión editorial, no técnica, y por eso viaja en las opciones.
   */
  volumen?: "gestionado" | "bruto";
}

export interface SacReportFigures {
  brandKey: string;
  brandLabel: string;
  period: string;
  /** Mensajes recibidos, sin filtrar ruido social. */
  volumenBruto: number;
  /**
   * Mensajes con contenido real que el equipo tuvo que mirar. Es el volumen que encabeza el
   * informe: descuenta lo que Instagram entrega por la bandeja sin ser un mensaje —menciones
   * en historias, reacciones— y los aplausos sueltos, pero no exige que sean caso de atención.
   */
  mensajesGestionados: number;
  /** Mensajes reales cuyo contenido Metricool no entregó. Se informan, no se descartan. */
  ilegibles: number;
  /** Casos que el equipo debe atender. */
  casosSac: number;
  derivados: number;
  respondidos: number;
  coberturaPct: number;
  canales: Record<string, number>;
  privados: number;
  publicos: number;
  motivos: Array<{ motivo: string; casos: number; pct: number }>;
  tono: { positivo: number; neutro: number; negativo: number };
  /** `comparable: false` cuando el período anterior está truncado o sin clasificar. */
  variacion?: { anterior: number; deltaPct: number; comparable: boolean };
  /** Advertencias que el operador debe leer antes de presentar el informe. */
  advertencias: string[];
}

/**
 * Etiquetas de la tabla de motivos, cortas a propósito.
 *
 * La columna mide 4,4 cm a 16 pt: entran unos quince caracteres por línea. Las tres columnas
 * de la lámina son cuadros de texto independientes, así que una etiqueta que se parte en dos
 * líneas desplaza todas las cifras siguientes respecto de su motivo, y la tabla pasa a decir
 * algo falso sin que nada se vea roto. Ninguna etiqueta debe pasar de 15 caracteres.
 */
const ETIQUETA_MOTIVO: Record<string, string> = {
  reclamo: "Reclamos",
  consulta_producto: "Producto",
  precio: "Precios",
  stock: "Stock",
  despacho: "Despachos",
  seguimiento_pedido: "Seguimiento",
  postventa: "Postventa",
  pago_facturacion: "Pagos",
  horarios_ubicacion: "Horarios",
  contacto: "Contacto",
  agradecimiento: "Agradecimientos",
  critica: "Críticas",
  consulta_general: "Consultas",
  no_aplica: "Otros",
};

/** Ancho útil de la columna de motivos, en caracteres. Ver `ETIQUETA_MOTIVO`. */
export const MAX_ETIQUETA_MOTIVO = 15;

/** Filas que caben en la tabla de motivos sin desbordar la lámina, contando la última agrupada. */
export const MAX_FILAS_MOTIVOS = 12;

/**
 * Desglose de lo que el clasificador no puede etiquetar.
 *
 * Todo lo que no es materia de atención cae en `no_aplica`, y mostrado como una sola barra
 * "Otros" puede ser el 60% del gráfico sin decir nada. Pero ese bloque no es homogéneo: una
 * mención en una historia, un audio que Metricool no entrega y un "👏" son cosas distintas, y
 * la diferencia se lee del tipo de contenido sin necesidad de volver a pasar el modelo.
 */
const SALUDO = /^(hola|buenas?|buenos? d[ií]as?|buenas? tardes?|buenas? noches?|gracias|ok|listo|perfecto|saludos)[\s!.,¡]*$/i;

function motivoEstructural(item: Interaction): string | undefined {
  const kind = item.metricoolRef?.contentContext?.kind;
  if (kind === "story_mention") return "Menciones";
  if (kind === "story_reply") return "Resp. historias";
  if (kind === "reaction") return "Reacciones";
  if (kind === "attachment") return "Adjuntos";
  if (esIlegible(item)) return "Sin contenido";
  const texto = (item.text ?? "").replace(/\s+/g, " ").trim();
  if (texto && !/\p{L}/u.test(texto)) return "Reacciones";
  if (SALUDO.test(texto)) return "Saludos";
  return undefined;
}

function iso(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "";
}

function dentro(interaction: Interaction, from: string, to: string): boolean {
  const fecha = iso(interaction.createdAt);
  return Boolean(fecha) && fecha >= from && fecha <= to;
}

/** Clave de canal del reporte: la plantilla separa privado (mensajes) de público (comentarios). */
function claveCanal(channel: Channel, tipo: Interaction["type"]): string {
  const red = channel === "instagram" ? "ig"
    : channel === "facebook" ? "fb"
      : channel === "tiktok" ? "tt"
        : channel;
  return `${red}_${tipo === "dm" ? "privado" : "publico"}`;
}

function pct(parte: number, total: number): number {
  return total ? Math.round((parte / total) * 1000) / 10 : 0;
}

/**
 * Lo que Instagram deja en la bandeja sin ser un mensaje dirigido a la marca. Una mención en
 * una historia llega por el mismo canal que un privado, pero nadie la escribió para pedir
 * algo: en COLBÚN eran 54 de 83 "privados" de agosto.
 */
const CONTENIDO_NO_ES_MENSAJE = new Set(["story_mention", "story_reply", "reaction"]);

/** Mensajes reales cuyo contenido Metricool no entregó: existen, pero no se pueden leer. */
const CONTENIDO_ILEGIBLE = new Set(["unsupported", "unavailable", "deleted"]);

function contenido(item: Interaction): string {
  return CONTENIDO_ILEGIBLE.has(item.metricoolRef?.contentContext?.kind ?? "")
    || CONTENIDO_NO_ES_MENSAJE.has(item.metricoolRef?.contentContext?.kind ?? "")
    ? ""
    : (item.text ?? "").replace(/\s+/g, " ").trim();
}

export function esIlegible(item: Interaction): boolean {
  return CONTENIDO_ILEGIBLE.has(item.metricoolRef?.contentContext?.kind ?? "");
}

/**
 * Si el mensaje pesa en la carga de trabajo del mes.
 *
 * El corte de cuatro palabras separa un mensaje de una reacción: "👏👏", "Tremendaaaaa" y
 * "Linda foto!" no son gestión, aunque lleguen por el mismo canal. Un caso ya clasificado
 * entra siempre, por corto que sea —"no llegó"— porque ahí el clasificador ya leyó el hilo
 * completo y decidió; y un archivo adjunto también, porque una foto del producto fallado es
 * exactamente el mensaje que hay que atender.
 */
export function esMensajeGestionado(item: Interaction): boolean {
  const kind = item.metricoolRef?.contentContext?.kind;
  if (kind && CONTENIDO_NO_ES_MENSAJE.has(kind)) return false;
  if (esIlegible(item)) return false;
  if (item.sacTriage?.esCasoSac) return true;
  if (kind === "attachment") return true;
  const texto = contenido(item);
  if (!/\p{L}/u.test(texto)) return false;
  return texto.split(" ").filter((palabra) => /\p{L}/u.test(palabra)).length >= 4;
}

export function buildSacReport(
  brand: Brand,
  interactions: Interaction[],
  options: SacReportOptions,
): SacReportFigures {
  const advertencias: string[] = [];

  const entrantes = interactions.filter((item) =>
    item.brandId === brand.id
    && item.direction === "inbound"
    && dentro(item, options.from, options.to));

  const sinClasificar = entrantes.filter((item) => !item.sacTriage).length;
  if (sinClasificar) {
    advertencias.push(
      `${sinClasificar} de ${entrantes.length} mensajes sin clasificar: los totales por motivo `
      + "y el filtro de casos quedan incompletos.",
    );
  }

  // Sin triaje no se puede distinguir un caso de una reacción social; se cuenta como caso
  // para no perderlo, y la advertencia deja explícito que el número está inflado.
  const casos = entrantes.filter((item) => item.sacTriage?.esCasoSac ?? true);
  const derivados = entrantes.filter((item) => item.sacTriage?.requiereDerivacion).length;
  const respondidos = casos.filter((item) => item.status === "replied").length;

  const gestionados = options.volumen === "bruto" ? entrantes : entrantes.filter(esMensajeGestionado);
  const ilegibles = entrantes.filter(esIlegible).length;
  if (ilegibles) {
    advertencias.push(
      `${ilegibles} mensajes llegaron sin contenido legible desde Metricool: existen y se `
      + "cuentan aparte, pero no se pueden clasificar ni responder desde el informe.",
    );
  }

  // La lámina de distribución acompaña al volumen, no al filtro: sus barras tienen que sumar
  // el mismo número que encabeza el informe.
  const canales: Record<string, number> = {
    ig_privado: 0, ig_publico: 0, fb_privado: 0, fb_publico: 0, tt_privado: 0, tt_publico: 0,
  };
  for (const item of gestionados) {
    const clave = claveCanal(item.channel, item.type);
    canales[clave] = (canales[clave] ?? 0) + 1;
  }

  const privados = gestionados.filter((item) => item.type === "dm").length;
  const publicos = gestionados.length - privados;

  // La lámina de motivos se titula "comentarios y mensajes gestionados" y cierra con una fila
  // "Suma total … 100%": tiene que analizar el mismo conjunto que encabeza el informe, o el
  // 100% se refiere a un universo que ninguna otra lámina menciona.
  const conteoMotivos = new Map<string, number>();
  for (const item of gestionados) {
    const categoria = item.sacTriage?.categoria ?? item.category ?? "no_aplica";
    // El desglose estructural solo reemplaza a "Otros": una categoría que el clasificador sí
    // decidió manda siempre, aunque el mensaje venga sin texto legible.
    const motivo = categoria === "no_aplica"
      ? motivoEstructural(item) ?? ETIQUETA_MOTIVO.no_aplica
      : ETIQUETA_MOTIVO[categoria] ?? categoria;
    conteoMotivos.set(motivo, (conteoMotivos.get(motivo) ?? 0) + 1);
  }
  // La tabla de la lámina 4 tolera unas doce filas antes de desbordar el cuadro. Con el
  // desglose estructural los motivos pasan de nueve a dieciséis, así que la cola se agrupa
  // en vez de crecer fuera de la lámina.
  const ordenados = [...conteoMotivos.entries()]
    .map(([motivo, n]) => ({ motivo, casos: n, pct: pct(n, gestionados.length) }))
    .sort((left, right) => right.casos - left.casos);

  const motivos = ordenados.length <= MAX_FILAS_MOTIVOS
    ? ordenados
    : (() => {
      const visibles = ordenados.slice(0, MAX_FILAS_MOTIVOS - 1);
      const resto = ordenados.slice(MAX_FILAS_MOTIVOS - 1);
      const agrupados = resto.reduce((total, m) => total + m.casos, 0);
      const yaHayOtros = visibles.find((m) => m.motivo === ETIQUETA_MOTIVO.no_aplica);
      if (yaHayOtros) {
        yaHayOtros.casos += agrupados;
        yaHayOtros.pct = pct(yaHayOtros.casos, gestionados.length);
        return [...visibles].sort((left, right) => right.casos - left.casos);
      }
      return [
        ...visibles,
        { motivo: ETIQUETA_MOTIVO.no_aplica, casos: agrupados, pct: pct(agrupados, gestionados.length) },
      ];
    })();

  const tono = { positivo: 0, neutro: 0, negativo: 0 };
  for (const item of gestionados) {
    if (item.sentiment === "positive") tono.positivo += 1;
    else if (item.sentiment === "negative") tono.negativo += 1;
    else tono.neutro += 1;
  }

  let variacion: SacReportFigures["variacion"];
  if (options.previous) {
    const previos = interactions.filter((item) =>
      item.brandId === brand.id
      && item.direction === "inbound"
      && dentro(item, options.previous!.from, options.previous!.to));
    const anterior = previos.filter((item) => item.sacTriage?.esCasoSac ?? true).length;

    // El inbox de Metricool solo conserva las conversaciones privadas recientes, así que un
    // mes anterior puede estar truncado en mensajes y completo en comentarios. Comparar eso
    // produce un crecimiento que no ocurrió.
    const dmPrevios = previos.filter((item) => item.type === "dm").length;
    const dmActuales = casos.filter((item) => item.type === "dm").length;
    const privadosTruncados = dmPrevios * 3 < dmActuales;

    // Y si el mes anterior no pasó por el clasificador, sus mensajes se cuentan todos como
    // casos mientras que los del mes actual vienen filtrados. Eso compara volumen bruto
    // contra casos reales: el número resultante no significa nada, y de los dos sesgos es
    // el más fácil de pasar por alto porque no deja ningún hueco a la vista.
    const sinTriagePrevios = previos.filter((item) => !item.sacTriage).length;
    const baseSinFiltrar = previos.length > 0 && sinTriagePrevios > previos.length * 0.2;

    const comparable = !privadosTruncados && !baseSinFiltrar;
    variacion = {
      anterior,
      deltaPct: anterior ? Math.round(((casos.length - anterior) / anterior) * 1000) / 10 : 0,
      comparable,
    };

    if (privadosTruncados) {
      advertencias.push(
        "El período anterior tiene muy pocos mensajes privados respecto del actual: la ventana "
        + "del inbox de Metricool no alcanza tan atrás. La variación no es comparable.",
      );
    }
    if (baseSinFiltrar) {
      advertencias.push(
        `${sinTriagePrevios} de ${previos.length} mensajes del período anterior están sin clasificar: `
        + "se cuentan todos como casos y el mes actual no. La variación no es comparable.",
      );
    }
  }

  if (!canales.tt_privado) {
    advertencias.push("Metricool no expone mensajes privados de TikTok; ese dato queda en cero.");
  }

  return {
    brandKey: brand.id,
    brandLabel: brand.name,
    period: options.label,
    volumenBruto: entrantes.length,
    mensajesGestionados: gestionados.length,
    ilegibles,
    casosSac: casos.length,
    derivados,
    respondidos,
    coberturaPct: pct(respondidos, casos.length),
    canales,
    privados,
    publicos,
    motivos,
    tono,
    variacion,
    advertencias,
  };
}

/** Mapa marcador → texto, listo para reemplazar en la plantilla. */
export function reportPlaceholders(figures: SacReportFigures): Record<string, string> {
  const n = (value: number) => value.toLocaleString("es-CL");
  const p = (value: number) => `${value.toLocaleString("es-CL")}%`;

  // Una variación que el propio informe declara no comparable no puede imprimirse igual:
  // el lector ve el porcentaje, no la advertencia que viaja aparte.
  const variacionTexto = figures.variacion?.comparable
    ? figures.variacion.deltaPct >= 0
      ? `+${figures.variacion.deltaPct}% vs período anterior (${n(figures.variacion.anterior)})`
      : `${figures.variacion.deltaPct}% vs período anterior (${n(figures.variacion.anterior)})`
    : "Primer período con medición completa";

  // El informe habla de dos totales distintos y la plantilla los nombra: "VOLUMEN TOTAL" es
  // todo lo que hubo que mirar, "CASOS SAC" lo que quedó tras el filtro. Mezclarlos hacía que
  // la tabla de motivos no sumara su propio encabezado.
  const volumen = figures.mensajesGestionados;

  return {
    CLIENTE: figures.brandLabel,
    PERIODO: figures.period,
    sac_volumen: n(volumen),
    sac_casos: n(figures.casosSac),
    // Alias histórico: la plantilla vieja usa `sac_total` donde ahora va el volumen.
    sac_total: n(volumen),
    sac_volumen_bruto: n(figures.volumenBruto),
    sac_ilegibles: n(figures.ilegibles),
    sac_variacion_texto: variacionTexto,
    sac_derivados: n(figures.derivados),
    sac_cobertura_pct: p(figures.coberturaPct),
    sac_ig_privado: n(figures.canales.ig_privado ?? 0),
    sac_ig_privado_pct: p(pct(figures.canales.ig_privado ?? 0, volumen)),
    sac_ig_publico: n(figures.canales.ig_publico ?? 0),
    sac_ig_publico_pct: p(pct(figures.canales.ig_publico ?? 0, volumen)),
    sac_fb_privado: n(figures.canales.fb_privado ?? 0),
    sac_fb_privado_pct: p(pct(figures.canales.fb_privado ?? 0, volumen)),
    sac_fb_publico: n(figures.canales.fb_publico ?? 0),
    sac_fb_publico_pct: p(pct(figures.canales.fb_publico ?? 0, volumen)),
    sac_tt_privado: n(figures.canales.tt_privado ?? 0),
    sac_tt_privado_pct: p(pct(figures.canales.tt_privado ?? 0, volumen)),
    sac_tt_publico: n(figures.canales.tt_publico ?? 0),
    sac_tt_publico_pct: p(pct(figures.canales.tt_publico ?? 0, volumen)),
    sac_privados: n(figures.privados),
    sac_privados_pct: p(pct(figures.privados, volumen)),
    sac_publicos: n(figures.publicos),
    sac_publicos_pct: p(pct(figures.publicos, volumen)),
    sac_motivos_labels: figures.motivos.map((m) => m.motivo).join("\n"),
    sac_motivos_casos: figures.motivos.map((m) => n(m.casos)).join("\n"),
    sac_motivos_pct: figures.motivos.map((m) => p(m.pct)).join("\n"),
    // Los tres cuadros de tono no traen rótulo en la plantilla: se ven tres porcentajes sin
    // decir cuál es cuál. La etiqueta viaja en el valor —el relleno traduce el salto de línea
    // a un salto real— para no depender de editar la plantilla en cada cliente.
    sac_tono_positivo: `Positivo\n${p(pct(figures.tono.positivo, volumen))}`,
    sac_tono_neutro: `Neutro\n${p(pct(figures.tono.neutro, volumen))}`,
    sac_tono_negativo: `Negativo\n${p(pct(figures.tono.negativo, volumen))}`,
  };
}
