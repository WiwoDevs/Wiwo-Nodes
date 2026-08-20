#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const liveApi = path.join(root, "worker", "live-api.js");
const hosting = path.join(root, ".openai", "hosting.json");

for (const file of [index, worker, liveApi, hosting]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
rmSync(path.join(dist, "server", "demo-api.js"), { force: true });
copyFileSync(worker, path.join(dist, "server", "index.js"));
copyFileSync(liveApi, path.join(dist, "server", "live-api.js"));
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));

console.log("Prepared Sites build: dist/server/index.js and dist/.openai/hosting.json");
