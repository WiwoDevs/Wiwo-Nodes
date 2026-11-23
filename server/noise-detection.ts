/**
 * Detección de ruido y spam en mensajes entrantes.
 *
 * Las reglas de `esMensajeGestionado` ya separan reacciones y emojis sueltos, pero no ven lo
 * que solo aparece al mirar varios mensajes juntos: la misma frase pegada en todas las
 * publicaciones, el mismo texto desde muchas cuentas (bots o cadenas de concurso), los
 * comentarios que solo etiquetan a otras personas y el spam promocional o de estafas
 * ("tu página será desactivada, verifica aquí"). A eso se suma la señal de la IA en sombra.
 *
 * Es una función pura sobre la lista que ya cargan la bandeja, los comentarios por
 * publicación y Reportes, así que no agrega lecturas ni persiste nada. Solo señala: descartar
 * un caso como spam es siempre una decisión de una persona.
 */
import type { Interaction } from "./types.js";
import { isMetricoolContentUnavailable } from "./metricool-content.js";

export type NoiseKind = "repetido" | "coordinado" | "solo_menciones" | "promocional" | "ia_spam";

export interface NoiseSignal {
  kind: NoiseKind;
  /** Texto corto para el equipo, sin datos del cliente. */
  label: string;
  /** Reglas sobre el texto y el volumen, o sugerencia de la IA en sombra. */
  origen: "reglas" | "ia";
  /** Cuántos mensajes forman el grupo (repetido o coordinado). */
  veces?: number;
}

/** Misma persona, mismo texto, al menos estas veces en la ventana: spam pegado en varios posts. */
const REPEAT_MIN = 3;
const REPEAT_WINDOW_MS = 7 * 86_400_000;
/** Un "precio?" repetido en tres publicaciones es interés real, no spam: se exige texto largo. */
const REPEAT_MIN_CHARS = 20;
/** Mismo texto desde varias cuentas distintas en poco tiempo: bots o cadenas. */
const COORDINATED_MIN_AUTHORS = 3;
const COORDINATED_WINDOW_MS = 72 * 3_600_000;
const COORDINATED_MIN_CHARS = 25;

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|link|ly|io|me|shop|store|site|online|xyz|click)(?:\/\S*)?\b/i;
const MENTION_PATTERN = /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_.]{2,30}/gu;
const PHONE_PATTERN = /(?:\+\d{1,3}[\s.-]?)?\d(?:[\s.-]?\d){7,}/;

/**
 * Frases típicas de spam promocional y de estafas que suplantan a Meta. Solo cuentan junto a
 * un enlace, una cuenta, un teléfono o un "escríbeme": así un cliente que pregunta por su
 * premio o por WhatsApp no cae aquí.
 */
const PROMO_PATTERNS: RegExp[] = [
  /\bgana(?:r|s)? (?:dinero|plata|\$)/,
  /\bingresos? (?:extra|pasivos?)/,
  /\binver(?:si[oó]n|tir|sionista)\b/,
  /\b(?:cripto|crypto|bitcoin|btc|forex|trading|binance|usdt)\b/,
  /\b(?:seguidores|followers|likes) (?:reales|gratis|baratos)/,
  /\bpromociona(?:r)? tu (?:cuenta|perfil|marca|negocio)/,
  /\b(?:colaboraci[oó]n|collab|embajador(?:a)?|brand ambassador)\b/,
  /\b(?:env[ií]a(?:me)?|m[aá]nda(?:me)?|escr[ií]be(?:me)?) (?:un )?(?:dm|md|mensaje|inbox)\b/,
  /\b(?:check|revisa|mira) (?:my|mi|our|nuestro) (?:dm|profile|perfil|bio)\b/,
  /\blink (?:en|in) (?:mi |my )?bio\b/,
  /\b(?:onlyfans|contenido (?:exclusivo|\+18)|sugar daddy|sugar mommy)\b/,
  /\btu (?:p[aá]gina|cuenta|perfil) (?:ser[aá]|fue|ha sido|est[aá]) (?:desactivad|suspendid|eliminad|restringid|bloquead)/,
  /\binfracci[oó]n (?:de|a) (?:los )?(?:derechos|copyright|normas)/,
  /\bverifica(?:r)? (?:tu|su) (?:cuenta|p[aá]gina|identidad)/,
  /\b(?:meta|facebook|instagram) (?:support|business support|soporte|security)\b/,
  /\bhas sido (?:seleccionad[oa]|elegid[oa])\b.*\b(?:reclama|link|dm|enlace)/,
];

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@./:\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function authorKey(item: Interaction): string {
  const handle = (item.customerHandle || "").trim().toLowerCase().replace(/^@/, "");
  return `${item.brandId}|${item.channel}|${handle || (item.customerName ?? "").trim().toLowerCase()}`;
}

function eligible(item: Interaction): boolean {
  return item.direction === "inbound"
    && item.source !== "planilla"
    && Boolean(item.text?.trim())
    && !isMetricoolContentUnavailable(item.text);
}

/** Solo etiqueta a otras cuentas: sin palabras propias después de quitar menciones y emojis. */
export function isMentionsOnly(text: string): boolean {
  if (!text.match(MENTION_PATTERN)) return false;
  return !/\p{L}{2,}/u.test(text.replace(MENTION_PATTERN, " ").replace(/[^\p{L}\s]/gu, " "));
}

export function isPromotionalSpam(text: string): boolean {
  const value = normalize(text);
  const contact = URL_PATTERN.test(text) || Boolean(text.match(MENTION_PATTERN)) || PHONE_PATTERN.test(text)
    || /\b(?:dm|md|inbox|perfil|bio|whatsapp|telegram|wa\.me)\b/.test(value);
  return contact && PROMO_PATTERNS.some((pattern) => pattern.test(value));
}

/** Agrupa por clave y devuelve los grupos que caben en la ventana con el tamaño mínimo. */
function denseGroups(
  items: Interaction[],
  keyOf: (item: Interaction) => string | undefined,
  windowMs: number,
  accept: (group: Interaction[]) => boolean,
): Interaction[][] {
  const groups = new Map<string, Interaction[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const result: Interaction[][] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    // Ventana deslizante: el grupo vale si algún tramo de `windowMs` reúne lo exigido.
    let start = 0;
    const flagged = new Set<Interaction>();
    for (let end = 0; end < ordered.length; end += 1) {
      while (Date.parse(ordered[end]!.createdAt) - Date.parse(ordered[start]!.createdAt) > windowMs) start += 1;
      const slice = ordered.slice(start, end + 1);
      if (accept(slice)) slice.forEach((item) => flagged.add(item));
    }
    if (flagged.size) result.push([...flagged]);
  }
  return result;
}

/**
 * Señales de ruido por id de interacción. La repetición y la coordinación se miran solo en
 * comentarios: en un DM, una persona que insiste ("hola??") es un cliente esperando, no spam.
 */
export function detectNoise(interactions: Interaction[]): Map<string, NoiseSignal> {
  const signals = new Map<string, NoiseSignal>();
  const candidates = interactions.filter(eligible);
  const comments = candidates.filter((item) => item.type === "comment");

  for (const group of denseGroups(
    comments,
    (item) => {
      const text = normalize(item.text);
      const long = text.length >= REPEAT_MIN_CHARS || URL_PATTERN.test(item.text) || Boolean(item.text.match(MENTION_PATTERN));
      return long ? `${authorKey(item)}|${text}` : undefined;
    },
    REPEAT_WINDOW_MS,
    (slice) => slice.length >= REPEAT_MIN,
  )) {
    for (const item of group) {
      signals.set(item.id, { kind: "repetido", label: `Mismo texto ${group.length} veces de la misma cuenta`, origen: "reglas", veces: group.length });
    }
  }

  for (const group of denseGroups(
    comments,
    (item) => {
      const text = normalize(item.text);
      return text.length >= COORDINATED_MIN_CHARS ? `${item.brandId}|${item.channel}|${text}` : undefined;
    },
    COORDINATED_WINDOW_MS,
    (slice) => new Set(slice.map(authorKey)).size >= COORDINATED_MIN_AUTHORS,
  )) {
    const authors = new Set(group.map(authorKey)).size;
    for (const item of group) {
      if (signals.has(item.id)) continue;
      signals.set(item.id, { kind: "coordinado", label: `Mismo texto desde ${authors} cuentas`, origen: "reglas", veces: group.length });
    }
  }

  for (const item of candidates) {
    if (signals.has(item.id)) continue;
    if (isPromotionalSpam(item.text)) {
      signals.set(item.id, { kind: "promocional", label: "Spam promocional o posible estafa", origen: "reglas" });
    } else if (item.type === "comment" && isMentionsOnly(item.text)) {
      signals.set(item.id, { kind: "solo_menciones", label: "Solo etiqueta a otras cuentas", origen: "reglas" });
    } else if (item.aiTriage?.ruido === "spam_promocional" || item.aiTriage?.ruido === "estafa_phishing") {
      signals.set(item.id, {
        kind: "ia_spam",
        label: item.aiTriage.ruido === "estafa_phishing" ? "IA: posible estafa o suplantación" : "IA: posible spam",
        origen: "ia",
      });
    }
  }
  return signals;
}

/** Descartable como spam sin revisar uno por uno: lo marcó una regla o la IA, y nadie lo marcó a mano como caso. */
export function isDiscardableNoise(item: Interaction, signal: NoiseSignal | undefined): boolean {
  if (!signal) return false;
  if (item.sacTriage?.modelo === "manual" && item.sacTriage.esCasoSac) return false;
  return signal.kind !== "solo_menciones" || item.type === "comment";
}
