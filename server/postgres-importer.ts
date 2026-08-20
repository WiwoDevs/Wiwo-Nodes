import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditDataStore, type StoreAuditReport } from "./store-audit.js";
import { PostgresRepository } from "./postgres-repository.js";
import type { DataStore } from "./types.js";

interface ImportOptions {
  filePath: string;
  write: boolean;
  allowWarnings: boolean;
}

interface ImportResult {
  audit: StoreAuditReport;
  import: {
    sourceFile: string;
    dryRun: boolean;
    imported: boolean;
    organizationSlug?: string;
  };
}

function usage(): string {
  return [
    "Uso:",
    "  npm run postgres:audit-json -- ./data/sac-flow.json",
    "  npm run postgres:import-json -- ./data/sac-flow.json",
    "  npm run postgres:import-json:allow-warnings -- ./data/sac-flow.json",
    "",
    "Opciones:",
    "  --file <ruta>        Archivo JSON a auditar/importar. Default: SAC_FLOW_DATA_FILE o ./data/sac-flow.json",
    "  --dry-run            Solo audita. Es el modo por defecto.",
    "  --write              Importa a PostgreSQL si no hay errores.",
    "  --allow-warnings     Permite importar aunque existan advertencias.",
    "  --help               Muestra esta ayuda.",
  ].join("\n");
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ImportOptions {
  let filePath = env.SAC_FLOW_DATA_FILE || path.join(process.cwd(), "data", "sac-flow.json");
  let write = false;
  let dryRun = false;
  let allowWarnings = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--file") {
      const next = argv[index + 1];
      if (!next) throw new Error("--file requiere una ruta.");
      filePath = next;
      index += 1;
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--allow-warnings") {
      allowWarnings = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      filePath = arg;
      continue;
    }
    throw new Error(`Opción no reconocida: ${arg}`);
  }

  if (write && dryRun) {
    throw new Error("Use --write o --dry-run, no ambos.");
  }

  return {
    filePath: path.resolve(filePath),
    write,
    allowWarnings,
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string, fallbackKey?: string): string {
  const value = env[key]?.trim() || (fallbackKey ? env[fallbackKey]?.trim() : undefined);
  if (!value) {
    throw new Error(`${key}${fallbackKey ? `/${fallbackKey}` : ""} debe estar configurado para importar a PostgreSQL.`);
  }
  return value;
}

function assertImportAllowed(report: StoreAuditReport, allowWarnings: boolean): void {
  if (!report.ok) {
    throw new Error("La auditoría encontró errores. Corrija el JSON antes de importar.");
  }
  const warnings = report.issues.filter((issue) => issue.severity === "warning");
  if (warnings.length && !allowWarnings) {
    throw new Error("La auditoría encontró advertencias. Revise el reporte o agregue --allow-warnings.");
  }
}

async function loadStore(filePath: string): Promise<{ raw: string; store: unknown }> {
  const raw = await readFile(filePath, "utf8");
  return { raw, store: JSON.parse(raw) };
}

export async function importJsonStoreToPostgres(
  store: DataStore,
  report: StoreAuditReport,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ organizationSlug: string }> {
  assertImportAllowed(report, true);
  const repository = new PostgresRepository({
    connectionString: requireEnv(env, "SAC_FLOW_POSTGRES_URL", "DATABASE_URL"),
    encryptionKey: requireEnv(env, "SAC_FLOW_POSTGRES_ENCRYPTION_KEY"),
    organizationSlug: (env.SAC_FLOW_POSTGRES_ORGANIZATION_SLUG || "techlab-sac").trim(),
    organizationName: (env.SAC_FLOW_POSTGRES_ORGANIZATION_NAME || "Techlab SAC").trim(),
    seedDemoOnEmpty: false,
  });

  try {
    await repository.replace(store);
    return { organizationSlug: (env.SAC_FLOW_POSTGRES_ORGANIZATION_SLUG || "techlab-sac").trim() };
  } finally {
    await repository.close();
  }
}

export async function runPostgresImporter(options: ImportOptions): Promise<ImportResult> {
  const { raw, store } = await loadStore(options.filePath);
  const audit = auditDataStore(store, raw);
  const result: ImportResult = {
    audit,
    import: {
      sourceFile: options.filePath,
      dryRun: !options.write,
      imported: false,
    },
  };

  if (!options.write) return result;

  assertImportAllowed(audit, options.allowWarnings);
  const imported = await importJsonStoreToPostgres(store as DataStore, audit);
  result.import.imported = true;
  result.import.organizationSlug = imported.organizationSlug;
  return result;
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runPostgresImporter(options);
    console.log(JSON.stringify(result, null, 2));
    if (!result.audit.ok) {
      process.exitCode = 2;
      return;
    }
    const warnings = result.audit.issues.some((issue) => issue.severity === "warning");
    if (!options.write && warnings) {
      process.exitCode = 0;
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Error desconocido.",
    }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
