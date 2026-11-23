/**
 * Etiqueta legible de la categoría de un caso. La API guarda claves internas («sin_clasificar»,
 * «consulta_producto»); la interfaz nunca debe mostrarlas tal cual.
 */
const CATEGORY_LABELS: Record<string, string> = {
  sin_clasificar: "Sin clasificar",
  reclamo: "Reclamo",
  reclamo_critico: "Reclamo crítico",
  consulta_producto: "Consulta de producto",
  consulta_general: "Consulta general",
  precio: "Precio",
  stock: "Stock",
  despacho: "Despacho",
  seguimiento_pedido: "Seguimiento de pedido",
  postventa: "Postventa",
  pago: "Pago",
  pago_facturacion: "Pago y facturación",
  horarios_ubicacion: "Horarios y ubicación",
  contacto: "Contacto",
  agradecimiento: "Agradecimiento",
  critica: "Crítica",
  no_aplica: "No aplica",
  datos_personales: "Datos personales",
};

export function categoryLabel(category: string | null | undefined): string {
  const key = (category ?? "").trim();
  if (!key) return "Sin clasificar";
  const known = CATEGORY_LABELS[key.toLowerCase()];
  if (known) return known;
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toLocaleUpperCase("es-CL") + words.slice(1);
}
