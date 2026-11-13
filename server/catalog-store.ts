import type { Brand } from "./types.js";

/**
 * Una mutación de catálogo puede crear, editar, activar o desactivar marcas, pero nunca
 * quitarlas ni renombrar su id: en PostgreSQL eliminar la fila de la marca arrastra en
 * cascada sus cuentas e interacciones. Ambos repositorios aplican la misma regla para que
 * el comportamiento no dependa del driver.
 */
export function assertCatalogBrandsPreserved(before: readonly Brand[], after: readonly Brand[]): void {
  const afterIds = new Set<string>();
  for (const brand of after) {
    if (afterIds.has(brand.id)) {
      throw new Error(`La marca ${brand.id} quedó duplicada en la mutación de catálogo.`);
    }
    afterIds.add(brand.id);
  }
  const removed = before.filter((brand) => !afterIds.has(brand.id)).map((brand) => brand.id);
  if (removed.length) {
    throw new Error(`Una mutación de catálogo no puede eliminar marcas (${removed.join(", ")}); desactívelas.`);
  }
}
