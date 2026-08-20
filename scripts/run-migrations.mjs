import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL || process.env.SAC_FLOW_POSTGRES_URL;
if (!connectionString) throw new Error("DATABASE_URL o SAC_FLOW_POSTGRES_URL es obligatorio para migrar.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "db", "migrations");
const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
const client = new pg.Client({ connectionString });

await client.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS sac_flow_schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const applied = await client.query("SELECT filename, checksum FROM sac_flow_schema_migrations");
  const known = new Map(applied.rows.map((row) => [row.filename, row.checksum]));
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const prior = known.get(file);
    if (prior && prior !== checksum) throw new Error(`La migración aplicada ${file} cambió de checksum.`);
    if (prior) continue;
    await client.query(sql);
    await client.query(
      "INSERT INTO sac_flow_schema_migrations (filename, checksum) VALUES ($1, $2)",
      [file, checksum],
    );
    process.stdout.write(`Applied ${file}\n`);
  }
  process.stdout.write(`Schema current: ${files.length} migration(s).\n`);
} finally {
  await client.end();
}
