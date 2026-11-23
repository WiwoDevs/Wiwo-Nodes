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
import { detectNoise } from "./noise-detection.js";

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
  /**
   * `comparable: false` cuando el período anterior está truncado o se filtró distinto.
   * `revisar: true` cuando, siendo comparable, cambió ±200 % o más: casi siempre es un mes
   * anterior con pocos datos, no un crecimiento real.
   */
  variacion?: { anterior: number; deltaPct: number; comparable: boolean; revisar?: boolean };
  /** Advertencias que el operador debe leer antes de presentar el informe. */
  advertencias: string[];
  /**
   * De dónde salió la decisión "es caso / es ruido" de cada mensaje entrante del mes.
   * `spam`: de los decididos por reglas, cuántos se descartaron por spam o ruido detectado
   * (texto repetido, el mismo texto desde varias cuentas, solo etiquetas, spam promocional).
   */
  clasificacion: { manual: number; ia: number; reglas: number; spam: number };
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

/** Etiqueta legible de una categoría (`reclamo` → "Reclamos"); la categoría tal cual si no tiene. */
export function etiquetaMotivo(categoria: string): string {
  return ETIQUETA_MOTIVO[categoria] ?? categoria;
}

function claveDeTexto(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Categoría de una etiqueta escrita a mano en una planilla ("Reclamos", "despacho", "Pago"):
 * la clave o la etiqueta de la tabla de motivos, en singular o plural. undefined si no
 * corresponde a ninguna (p. ej. "Experiencia general"), para que decidan las reglas.
 */
export function categoriaDesdeEtiqueta(texto: string): string | undefined {
  const clave = claveDeTexto(texto);
  if (!clave) return undefined;
  for (const [categoria, etiqueta] of Object.entries(ETIQUETA_MOTIVO)) {
    const deEtiqueta = claveDeTexto(etiqueta);
    if (clave === categoria || clave === deEtiqueta || clave === deEtiqueta.replace(/s$/, "")) return categoria;
  }
  return undefined;
}

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
  // Una etiqueta (@cuenta) no es una palabra del mensaje: "@ana @luis @pia @tom" es una
  // cadena de concurso, no cuatro palabras.
  return texto.split(" ").filter((palabra) => !palabra.startsWith("@") && /\p{L}/u.test(palabra)).length >= 4;
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export interface MonthPeriod {
  month: string;
  label: string;
  /** YYYY-MM-DD inclusive, en días UTC como el resto del reporte. */
  from: string;
  to: string;
  previous: { from: string; to: string };
}

/** "2026-08" → días del mes, etiqueta "Agosto 2026" y el mes anterior para la variación. */
export function monthPeriod(month: string): MonthPeriod {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const previousYear = monthNumber === 1 ? year - 1 : year;
  const previousMonth = monthNumber === 1 ? 12 : monthNumber - 1;
  const previousKey = `${previousYear}-${String(previousMonth).padStart(2, "0")}`;
  return {
    month,
    label: `${MESES[monthNumber - 1]} ${year}`,
    from: `${month}-01`,
    to: `${month}-${String(lastDay(year, monthNumber)).padStart(2, "0")}`,
    previous: { from: `${previousKey}-01`, to: `${previousKey}-${String(lastDay(previousYear, previousMonth)).padStart(2, "0")}` },
  };
}

/**
 * Cuentas activas que apuntan al mismo usuario de red social: sus mensajes se cuentan dos
 * veces en los totales. El sufijo "-<marca>" lo agrega la vinculación cuando el usuario ya
 * estaba tomado, así que se descuenta para comparar.
 */
export function duplicateAccountGroups(brands: Brand[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const brand of brands) {
    const handle = brand.account.handle.trim().toLowerCase().replace(/^@/, "").replace(new RegExp(`-${brand.id.toLowerCase()}$`), "");
    if (!handle) continue;
    groups.set(handle, [...(groups.get(handle) ?? []), brand.name]);
  }
  return [...groups.values()].filter((names) => names.length > 1);
}

/** Marcado a mano por una persona (manda sobre la IA y las reglas). */
export function esTriajeManual(item: Interaction): boolean {
  return item.sacTriage?.modelo === "manual";
}

/**
 * ¿Es un caso SAC? Manda lo marcado a mano o por la IA; sin eso, las reglas sin IA de
 * `esMensajeGestionado`: reacciones, menciones en historias, emojis sueltos, textos de menos
 * de cuatro palabras e ilegibles no son casos. Así el informe no cuenta ruido social como
 * casos aunque nadie haya clasificado el mes.
 */
export function esCasoSac(item: Interaction): boolean {
  return item.sacTriage ? item.sacTriage.esCasoSac : esMensajeGestionado(item);
}

function origenes(items: Interaction[], spam: number): SacReportFigures["clasificacion"] {
  const manual = items.filter(esTriajeManual).length;
  const reglas = items.filter((item) => !item.sacTriage).length;
  return { manual, ia: items.length - manual - reglas, reglas, spam };
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

  // Cuánto se decidió por reglas, a mano o con IA viaja en `clasificacion`: es una nota del
  // mes, no un problema de la marca, así que no se repite como advertencia en cada una.
  // Spam y ruido detectados por reglas sobre todo el conjunto (la repetición cruza meses y
  // personas). Solo pesan donde decidían las reglas: lo marcado a mano o por IA manda. La
  // sugerencia de la IA en sombra no cuenta aquí.
  const ruido = detectNoise(interactions.filter((item) => item.brandId === brand.id));
  const esSpamPorReglas = (item: Interaction) => !item.sacTriage && ruido.get(item.id)?.origen === "reglas";
  const spam = entrantes.filter(esSpamPorReglas).length;
  const clasificacion = origenes(entrantes, spam);

  // Lo marcado (a mano o por IA) manda; lo demás se decide por reglas de contenido.
  const casos = entrantes.filter((item) => esCasoSac(item) && !esSpamPorReglas(item));
  const derivados = entrantes.filter((item) => item.sacTriage?.requiereDerivacion).length;
  const respondidos = casos.filter((item) => item.status === "replied").length;

  const gestionados = options.volumen === "bruto"
    ? entrantes
    : entrantes.filter((item) => esMensajeGestionado(item) && !esSpamPorReglas(item));
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
    const anterior = previos.filter(esCasoSac).length;

    // El inbox de Metricool solo conserva las conversaciones privadas recientes, así que un
    // mes anterior puede estar truncado en mensajes y completo en comentarios. Comparar eso
    // produce un crecimiento que no ocurrió.
    const dmPrevios = previos.filter((item) => item.type === "dm").length;
    const dmActuales = casos.filter((item) => item.type === "dm").length;
    const privadosTruncados = dmPrevios * 3 < dmActuales;

    // Si un mes se decidió casi todo por reglas y el otro a mano o por IA, los dos filtros
    // no miden lo mismo: la variación saldría del cambio de método, no del volumen.
    const reglasPrevias = previos.filter((item) => !item.sacTriage).length;
    const proporcion = (parte: number, total: number) => (total ? parte / total : 0);
    const baseSinFiltrar = previos.length > 0
      && Math.abs(proporcion(reglasPrevias, previos.length) - proporcion(clasificacion.reglas, entrantes.length)) > 0.2;

    const comparable = !privadosTruncados && !baseSinFiltrar;
    const deltaPct = anterior ? Math.round(((casos.length - anterior) / anterior) * 1000) / 10 : 0;
    const revisar = comparable && Math.abs(deltaPct) >= 200;
    variacion = { anterior, deltaPct, comparable, ...(revisar ? { revisar } : {}) };
    if (revisar) {
      advertencias.push(
        `La variación contra el mes anterior es de ${deltaPct > 0 ? "+" : ""}${deltaPct.toLocaleString("es-CL")} % `
        + `(de ${anterior} a ${casos.length} casos): revisa que el mes anterior tenga datos completos antes de presentarla.`,
      );
    }

    if (privadosTruncados) {
      advertencias.push(
        "El período anterior tiene muy pocos mensajes privados respecto del actual: la ventana "
        + "del inbox de Metricool no alcanza tan atrás. La variación no es comparable.",
      );
    }
    if (baseSinFiltrar) {
      advertencias.push(
        `${reglasPrevias} de ${previos.length} mensajes del período anterior se decidieron por reglas `
        + `y ${clasificacion.reglas} de ${entrantes.length} en el actual: los dos meses se filtraron distinto. La variación no es comparable.`,
      );
    }
  }

  // Solo importa en marcas con TikTok conectado: en las demás el cero es real.
  if (!canales.tt_privado && brand.account.channels?.includes("tiktok")) {
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
    clasificacion,
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
