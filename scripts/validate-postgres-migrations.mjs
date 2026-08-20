import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "db", "migrations");

const requiredTables = [
  "organizations",
  "users",
  "memberships",
  "brands",
  "social_accounts",
  "metricool_account_refs",
  "workflow_configs",
  "workflow_account_allowlist",
  "workflow_nodes",
  "workflow_edges",
  "workflow_versions",
  "workflow_jobs",
  "interactions",
  "replies",
  "sync_runs",
  "sync_run_items",
  "audit_events",
  "idempotency_keys",
  "export_jobs",
];

const rlsTables = requiredTables.filter((table) => table !== "users");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedSql(sql) {
  return sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const files = (await readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right));

assert(files.length > 0, "No PostgreSQL migrations found.");

files.forEach((file, index) => {
  const expectedPrefix = String(index + 1).padStart(4, "0");
  assert(
    file.startsWith(`${expectedPrefix}_`),
    `Migration ${file} must start with ${expectedPrefix}_ to keep a deterministic order.`,
  );
});

const migrations = await Promise.all(
  files.map(async (file) => {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const compact = normalizedSql(sql);
    assert(compact.startsWith("begin;"), `${file} must start with BEGIN;`);
    assert(compact.endsWith("commit;"), `${file} must end with COMMIT;`);
    assert(!/\bdrop\s+(database|schema|table)\b/.test(compact), `${file} contains a destructive DROP.`);
    assert(!/\btruncate\b/.test(compact), `${file} contains TRUNCATE.`);
    assert(!/metricool_api_token|top-secret|never-return|smoke-user|smoke-blog/i.test(sql), `${file} contains a secret-like fixture.`);
    return { file, sql, compact };
  }),
);

const allSql = migrations.map((migration) => migration.compact).join(" ");

for (const table of requiredTables) {
  assert(
    allSql.includes(`create table ${table} `),
    `Missing required table ${table}.`,
  );
}

for (const table of rlsTables) {
  assert(
    allSql.includes(`alter table ${table} enable row level security`),
    `Missing row-level security enablement for ${table}.`,
  );
  assert(
    allSql.includes(`create policy ${table}_tenant_isolation on ${table}`),
    `Missing tenant isolation policy for ${table}.`,
  );
}

const criticalIndexes = [
  "interactions_inbox_idx",
  "interactions_account_time_idx",
  "replies_idempotency_unique",
  "replies_one_active_per_interaction",
  "replies_pending_due_idx",
  "audit_events_subject_idx",
  "idempotency_expiry_idx",
  "social_accounts_account_key_unique",
  "workflow_configs_workflow_key_unique",
  "interactions_interaction_key_unique",
  "interactions_assignment_idx",
  "sync_runs_run_key_unique",
  "workflow_versions_history_idx",
  "sync_runs_retry_of_idx",
  "workflow_jobs_due_idx",
];

for (const indexName of criticalIndexes) {
  assert(
    allSql.includes(indexName),
    `Missing critical index ${indexName}.`,
  );
}

assert(
  allSql.includes("unique (organization_id, social_account_id, kind, external_id)"),
  "Missing interaction deduplication constraint.",
);
assert(
  allSql.includes("set local app.organization_id") || allSql.includes("current_setting('app.organization_id'"),
  "Missing tenant context contract.",
);

const runtimeColumns = [
  "account_key text",
  "channels text[]",
  "workflow_key text",
  "last_run_status text",
  "edge_key text",
  "connector_type text",
  "interaction_key text",
  "version integer",
  "assigned_to_user_id text",
  "assigned_to_display_name text",
  "internal_notes jsonb",
  "response_text text",
  "audit_trail jsonb",
  "run_key text",
  "account_keys text[]",
  "instagram_provider text",
  "status_reason jsonb",
  "published_version integer",
  "workflow_version integer",
  "retry_of text",
  "schedule_key text",
  "approved_by_human boolean",
  "requested_by jsonb",
  "attempt_count integer",
  "lease_expires_at timestamptz",
  "reconciled_at timestamptz",
  "next_attempt_at timestamptz",
];

for (const column of runtimeColumns) {
  assert(
    allSql.includes(column),
    `Missing runtime PostgreSQL column contract: ${column}.`,
  );
}

console.log(`Validated ${files.length} PostgreSQL migration(s): ${files.join(", ")}`);
