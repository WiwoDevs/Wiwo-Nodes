/**
 * Enmascarado de datos personales antes de enviar texto a un proveedor de IA.
 *
 * Los DMs y comentarios son datos personales de los clientes de cada marca. Para clasificar
 * no hace falta saber quién escribe ni cómo contactarlo: se reemplazan correos, enlaces,
 * usuarios, RUT, tarjetas y teléfonos por marcadores fijos. El texto libre puede seguir
 * identificando a alguien, así que esto reduce la exposición pero no convierte el mensaje en
 * anónimo: el envío al proveedor sigue tratándose como dato personal.
 */

const RULES: Array<{ pattern: RegExp; token: string }> = [
  // Enlaces primero: pueden contener @, dígitos o correos y no aportan a la clasificación.
  { pattern: /\b(?:https?:\/\/|www\.)\S+/giu, token: "[URL]" },
  { pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, token: "[EMAIL]" },
  // Menciones a cuentas (@usuario), sin tocar el @ suelto de un texto.
  { pattern: /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_.]{2,30}/gu, token: "$1[USUARIO]" },
  // RUT chileno con o sin puntos y con dígito verificador: 12.345.678-9, 12345678-K.
  { pattern: /\b\d{1,2}\.?\d{3}\.?\d{3}\s?-\s?[\dkK]\b/g, token: "[RUT]" },
  // Tarjetas: 13 a 19 dígitos, agrupados o seguidos.
  { pattern: /\b(?:\d[ -]?){12,18}\d\b/g, token: "[TARJETA]" },
  // Teléfonos: +56 9 1234 5678, 912345678, (2) 2345 6789… Ocho o más dígitos con separadores.
  { pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,3}\)[\s.-]?)?\d(?:[\s.-]?\d){7,}/g, token: "[TELEFONO]" },
];

export function redactPersonalData(text: string): string {
  let result = text;
  for (const rule of RULES) result = result.replace(rule.pattern, rule.token);
  return result;
}
