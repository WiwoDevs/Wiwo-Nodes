/**
 * La escena del inicio de sesión no puede llevar estilos en línea: la CSP de producción
 * (style-src 'self') los bloquea y la escena se vería gris. Sus <style> viven en
 * src/styles/login-escena.css y los style="…" se aplican por CSSOM.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareSceneMarkup } from "../../src/lib/login-scene.js";

const root = path.resolve(import.meta.dirname, "..", "..");

describe("Escena del inicio de sesión compatible con la CSP", () => {
  it("el marcado preparado no tiene <style> ni atributos style en línea", async () => {
    const html = await readFile(path.join(root, "src/assets/login-escena-primavera.html"), "utf8");
    const prepared = prepareSceneMarkup(html);
    expect(prepared).not.toMatch(/<style/i);
    expect(prepared).not.toMatch(/\sstyle="/);
    expect(prepared.match(/data-scene-style="/g)?.length).toBe(html.match(/\sstyle="/g)?.length);
  });

  it("los estilos de la escena están en una hoja propia que se carga con la app", async () => {
    const html = await readFile(path.join(root, "src/assets/login-escena-primavera.html"), "utf8");
    const css = await readFile(path.join(root, "src/styles/login-escena.css"), "utf8");
    for (const [, block] of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      expect(css).toContain(block!.trim().slice(0, 200));
    }
    const shell = await readFile(path.join(root, "src/components/LoginShell.tsx"), "utf8");
    expect(shell).toContain(`import "../styles/login-escena.css";`);
    expect(shell).toContain("prepareSceneMarkup(escenaPrimavera)");
  });

  it("la CSP de la API sigue sin permitir estilos en línea", async () => {
    const app = await readFile(path.join(root, "server/app.ts"), "utf8");
    expect(app).toMatch(/style-src 'self'(?! 'unsafe-inline')/);
  });
});
