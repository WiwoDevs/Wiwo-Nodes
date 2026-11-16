/**
 * La escena del inicio de sesión llega como HTML estático. La CSP de producción
 * (`style-src 'self'`) bloquea los `<style>` y los atributos `style="…"` que entran por
 * innerHTML, así que:
 * - los bloques `<style>` se quitan (su contenido vive en src/styles/login-escena.css);
 * - cada `style="…"` pasa a `data-scene-style="…"` y se aplica después por CSSOM
 *   (`element.style.cssText`), que la CSP sí permite.
 */
export function prepareSceneMarkup(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/\sstyle="/g, ' data-scene-style="');
}

/** Aplica por CSSOM los estilos que `prepareSceneMarkup` dejó en `data-scene-style`. */
export function applySceneStyles(root: ParentNode): number {
  let applied = 0;
  root.querySelectorAll<HTMLElement | SVGElement>("[data-scene-style]").forEach((element) => {
    element.style.cssText = element.getAttribute("data-scene-style") ?? "";
    element.removeAttribute("data-scene-style");
    applied += 1;
  });
  return applied;
}
