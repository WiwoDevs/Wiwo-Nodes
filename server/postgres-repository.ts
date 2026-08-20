import { createHmac, randomUUID } from "node:crypto";
import pg, { type QueryResultRow } from "pg";
import { createDemoStore } from "./seed.js";
import { createDemoAutomationState } from "./automation-seed.js";
import type { SacFlowRepository } from "./repository-contract.js";
import type {
  Brand,
  Channel,
  DataStore,
  DeferReplyDeliveryInput,
  Interaction,
  InteractionAuditEntry,
  InteractionFilters,
  InteractionStats,
  MetricoolAccountReference,
  PrepareReplyDeliveryInput,
  PublicBrand,
  PublicMetricoolAccountState,
  ReconcileReplyDeliveryInput,
  ReplyDelivery,
  ReplyDeliveryActor,
  ReplyDeliveryFilters,
  RunAuditStep,
  SettleReplyDeliveryInput,
  StoredIdempotencyRecord,
  Workflow,
  WorkflowNode,
  WorkflowRun,
  WorkflowVersion,
  WorkflowJob,
} from "./types.js";
import type { AutomationState } from "./automation-types.js";
import { CHANNELS } from "./types.js";
import { ensureMetricoolInboxCoverage } from "./workflow-coverage.js";
import { mergeMissingMetricoolRef } from "./workflow-service.js";
import {
  metricoolContentForDisplay,
  shouldReplaceMetricoolContent,
} from "./metricool-content.js";

const { Pool } = pg;

export interface PgQueryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface PgClientLike extends PgQueryable {
  release(): void;
}

export interface PgPoolLike extends PgQueryable {
  connect(): Promise<PgClientLike>;
  end?(): Promise<void>;
}

export interface PostgresRepositoryOptions {
  connectionString: string;
  encryptionKey: string;
  organizationSlug: string;
  organizationName: string;
  seedDemoOnEmpty?: boolean;
  pool?: PgPoolLike;
}

type BrandRow = {
  brand_id: string;
  brand_name: string;
  color: string;
  brand_active: boolean;
  sac_policy: unknown;
  workbook_config: unknown;
  qa_workbook_config: unknown;
  resources: unknown;
  account_id: string;
  account_name: string;
  handle: string;
  channels: unknown;
  account_active: boolean;
  user_id: string | null;
  blog_id: string | null;
  instagram_provider: "INSTAGRAMBUSINESS" | "INSTAGRAM" | null;
};

type WorkflowRow = {
  workflow_id: string;
  workflow_key: string;
  name: string;
  version: number;
  published_version: number;
  published_at: Date | string | null;
  published_by: string | null;
  enabled: boolean;
  poll_interval_minutes: number;
  auto_reply_enabled: boolean;
  minimum_confidence: string | number;
  require_human_for: unknown;
  business_hours_only: boolean;
  updated_at: Date | string;
  last_run_at: Date | string | null;
  last_run_status: Workflow["lastRunStatus"] | null;
};

type WorkflowNodeRow = {
  node_key: string;
  type: WorkflowNode["type"];
  label: string;
  enabled: boolean;
  position_x: string | number;
  position_y: string | number;
  config: unknown;
};

type WorkflowEdgeRow = {
  edge_key: string;
  source_node_key: string;
  target_node_key: string;
  label: string | null;
  connector_type: "smoothstep" | "bezier" | "straight";
};

type InteractionRow = {
  interaction_key: string;
  external_id: string;
  brand_id: string;
  account_id: string;
  provider: Channel;
  kind: Interaction["type"];
  direction: Interaction["direction"];
  customer_name: string;
  customer_handle: string;
  body_text: string;
  category: string;
  sentiment: Interaction["sentiment"];
  confidence: string | number;
  status: Interaction["status"];
  source: Interaction["source"];
  version: number;
  received_at: Date | string;
  updated_at: Date | string;
  assigned_to_user_id: string | null;
  assigned_to_display_name: string | null;
  internal_notes: unknown;
  response_text: string | null;
  responded_at: Date | string | null;
  metricool_ref: unknown;
  audit_trail: unknown;
  status_reason: unknown;
  automation_assessment: unknown;
};

type WorkflowRunRow = {
  run_key: string;
  kind: WorkflowRun["kind"];
  status: WorkflowRun["status"];
  workflow_version: number;
  requested_by: string | null;
  retry_of: string | null;
  started_at: Date | string;
  finished_at: Date | string;
  demo_mode: boolean;
  account_keys: unknown;
  totals: unknown;
  audit_trail: unknown;
};

type WorkflowVersionRow = {
  version_key: string;
  workflow_key: string;
  version: number;
  status: WorkflowVersion["status"];
  snapshot: unknown;
  created_at: Date | string;
  created_by: string;
  change_note: string | null;
};

type WorkflowJobRow = {
  job_key: string;
  schedule_key: string;
  kind: WorkflowJob["kind"];
  status: WorkflowJob["status"];
  account_keys: unknown;
  item_limit: number;
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  locked_at: Date | string | null;
  locked_by: string | null;
  run_key: string | null;
  last_error: string | null;
  workflow_key: string | null;
  trigger_mode: WorkflowJob["triggerMode"] | null;
  input_payload: unknown;
};

type IdempotencyRow = {
  scope: string;
  key: string;
  request_hash: string;
  status_code: number;
  response_json: unknown;
  created_at: Date | string;
};

type ReplyDeliveryRow = {
  id: string;
  interaction_id: string;
  brand_id: string;
  account_id: string;
  body_text: string;
  approved_by_human: boolean;
  requested_by: unknown;
  idempotency_key: string;
  request_id: string;
  delivery_status: ReplyDelivery["status"];
  version: number;
  attempt_count: number;
  created_at: Date | string;
  updated_at: Date | string;
  last_attempt_at: Date | string | null;
  next_attempt_at: Date | string | null;
  lease_expires_at: Date | string | null;
  sent_at: Date | string | null;
  provider_response_ref: string | null;
  error_code: string | null;
  reconciled_at: Date | string | null;
  reconciled_by: unknown;
  reconciliation_note: string | null;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    return value
      .replace(/^{|}$/g, "")
      .split(",")
      .map((item) => item.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
  return [];
}

function asJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function matchesInteraction(interaction: Interaction, filters: InteractionFilters): boolean {
  if (filters.brandId && interaction.brandId !== filters.brandId) return false;
  if (filters.brandIds && !filters.brandIds.includes(interaction.brandId)) return false;
  if (filters.accountId && interaction.accountId !== filters.accountId) return false;
  if (filters.channel && interaction.channel !== filters.channel) return false;
  if (filters.type && interaction.type !== filters.type) return false;
  if (filters.status && interaction.status !== filters.status) return false;
  if (filters.sentiment && interaction.sentiment !== filters.sentiment) return false;
  if (filters.assignment === "assigned" && !interaction.assignedTo) return false;
  if (filters.assignment === "unassigned" && interaction.assignedTo) return false;
  if (filters.assigneeId && interaction.assignedTo?.userId !== filters.assigneeId) return false;
  if (filters.from && Date.parse(interaction.createdAt) < Date.parse(filters.from)) return false;
  if (filters.to && Date.parse(interaction.createdAt) > Date.parse(filters.to)) return false;
  if (filters.search) {
    const needle = filters.search.toLocaleLowerCase("es-CL");
    const haystack = [
      interaction.text,
      interaction.customerName,
      interaction.customerHandle,
      interaction.category,
      interaction.responseText || "",
      interaction.assignedTo?.displayName || "",
    ].join(" ").toLocaleLowerCase("es-CL");
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function fingerprint(reference: MetricoolAccountReference, encryptionKey: string): string {
  return createHmac("sha256", encryptionKey)
    .update(`${reference.userId}:${reference.blogId}`)
    .digest("hex");
}

function expiresAt(record: StoredIdempotencyRecord): string {
  const created = Date.parse(record.createdAt);
  const base = Number.isFinite(created) ? created : Date.now();
  return new Date(base + 7 * 24 * 60 * 60_000).toISOString();
}

function primaryProvider(channels: Channel[]): Channel {
  return channels.includes("instagram") ? "instagram" : channels[0] || "instagram";
}

function requireMapValue(map: Map<string, string>, key: string, label: string): string {
  const value = map.get(key);
  if (!value) throw new Error(`No se pudo persistir ${label}: falta clave ${key}.`);
  return value;
}

function mapWorkflowJobRow(row: WorkflowJobRow): WorkflowJob {
  return {
    id: row.job_key,
    scheduleKey: row.schedule_key,
    kind: row.kind,
    status: row.status,
    accountIds: asStringArray(row.account_keys),
    limit: Number(row.item_limit),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: toIso(row.next_attempt_at) ?? new Date().toISOString(),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    lockedAt: toIso(row.locked_at),
    lockedBy: row.locked_by ?? undefined,
    runId: row.run_key ?? undefined,
    lastError: row.last_error ?? undefined,
    workflowId: row.workflow_key ?? undefined,
    triggerMode: row.trigger_mode ?? undefined,
    input: asJson<Array<Record<string, unknown>>>(row.input_payload, []),
  };
}

function asDeliveryActor(value: unknown): ReplyDeliveryActor {
  const actor = asJson<Partial<ReplyDeliveryActor>>(value, {});
  return {
    userId: typeof actor.userId === "string" && actor.userId ? actor.userId : "system",
    displayName: typeof actor.displayName === "string" && actor.displayName ? actor.displayName : "Sistema",
  };
}

function mapReplyDeliveryRow(row: ReplyDeliveryRow): ReplyDelivery {
  return {
    id: row.id,
    interactionId: row.interaction_id,
    brandId: row.brand_id,
    accountId: row.account_id,
    bodyText: row.body_text,
    approvedByHuman: row.approved_by_human,
    requestedBy: asDeliveryActor(row.requested_by),
    idempotencyKey: row.idempotency_key,
    requestId: row.request_id,
    status: row.delivery_status,
    version: Number(row.version),
    attemptCount: Number(row.attempt_count),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    lastAttemptAt: toIso(row.last_attempt_at),
    nextAttemptAt: toIso(row.next_attempt_at),
    leaseExpiresAt: toIso(row.lease_expires_at),
    sentAt: toIso(row.sent_at),
    providerResponseRef: row.provider_response_ref ?? undefined,
    errorCode: row.error_code ?? undefined,
    reconciledAt: toIso(row.reconciled_at),
    reconciledBy: row.reconciled_by ? asDeliveryActor(row.reconciled_by) : undefined,
    reconciliationNote: row.reconciliation_note ?? undefined,
  };
}

export class PostgresRepository implements SacFlowRepository {
  private readonly pool: PgPoolLike;
  private readonly encryptionKey: string;
  private readonly organizationSlug: string;
  private readonly organizationName: string;
  private readonly seedDemoOnEmpty: boolean;
  private organizationId?: string;

  constructor(options: PostgresRepositoryOptions) {
    this.pool = options.pool ?? new Pool({ connectionString: options.connectionString });
    this.encryptionKey = options.encryptionKey;
    this.organizationSlug = options.organizationSlug;
    this.organizationName = options.organizationName;
    this.seedDemoOnEmpty = options.seedDemoOnEmpty ?? false;
  }

  async close(): Promise<void> {
    await this.pool.end?.();
  }

  private async ensureOrganization(client: PgQueryable): Promise<string> {
    if (this.organizationId) return this.organizationId;

    const existing = await client.query<{ id: string }>(
      "SELECT id::text AS id FROM organizations WHERE slug = $1 LIMIT 1",
      [this.organizationSlug],
    );
    if (existing.rows[0]) {
      this.organizationId = existing.rows[0].id;
      return this.organizationId;
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO organizations (slug, name)
       VALUES ($1, $2)
       RETURNING id::text AS id`,
      [this.organizationSlug, this.organizationName],
    );
    this.organizationId = inserted.rows[0]?.id;
    if (!this.organizationId) throw new Error("No se pudo inicializar la organización PostgreSQL.");
    return this.organizationId;
  }

  private async withTenantClient<T>(
    operation: (client: PgQueryable, organizationId: string) => Promise<T>,
    options: { write?: boolean } = {},
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const organizationId = await this.ensureOrganization(client);
      await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      if (options.write) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`sac-flow:${organizationId}`]);
      }
      const result = await operation(client, organizationId);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async initialize(): Promise<void> {
    await this.withTenantClient(async (client, organizationId) => {
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM brands WHERE organization_id = $1",
        [organizationId],
      );
      if (Number(count.rows[0]?.count ?? 0) === 0 && this.seedDemoOnEmpty) {
        await this.replaceStoreUnlocked(client, organizationId, createDemoStore());
      } else {
        if (this.seedDemoOnEmpty) await this.ensureDemoSacPoliciesUnlocked(client, organizationId);
        await this.ensureWorkflowUnlocked(client, organizationId);
      }
    }, { write: true });
  }

  private async ensureDemoSacPoliciesUnlocked(client: PgQueryable, organizationId: string): Promise<void> {
    const demoPolicies = createDemoStore().brands
      .filter((brand) => brand.sacPolicy)
      .map((brand) => ({ id: brand.id, policy: brand.sacPolicy }));
    for (const brand of demoPolicies) {
      await client.query(
        `UPDATE brands
         SET sac_policy = $3::jsonb
         WHERE organization_id = $1 AND slug = $2 AND sac_policy IS NULL`,
        [organizationId, brand.id, JSON.stringify(brand.policy)],
      );
    }
  }

  async snapshot(): Promise<DataStore> {
    return this.withTenantClient((client, organizationId) => this.readStoreUnlocked(client, organizationId));
  }

  async snapshotAutomation(): Promise<AutomationState> {
    return this.withTenantClient((client, organizationId) => this.readAutomationStateUnlocked(client, organizationId));
  }

  async mutate<T>(operation: (store: DataStore) => T | Promise<T>): Promise<T> {
    return this.withTenantClient(async (client, organizationId) => {
      const store = await this.readStoreUnlocked(client, organizationId);
      const result = await operation(store);
      store.updatedAt = new Date().toISOString();
      await this.replaceStoreUnlocked(client, organizationId, store);
      return clone(result);
    }, { write: true });
  }

  async mutateAutomation<T>(operation: (state: AutomationState) => T | Promise<T>): Promise<T> {
    return this.withTenantClient(async (client, organizationId) => {
      const state = await this.readAutomationStateUnlocked(client, organizationId);
      const result = await operation(state);
      await client.query(
        `INSERT INTO automation_platform_states (organization_id, state, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (organization_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [organizationId, JSON.stringify(state)],
      );
      return clone(result);
    }, { write: true });
  }

  async replace(store: DataStore): Promise<void> {
    await this.withTenantClient(async (client, organizationId) => {
      await this.replaceStoreUnlocked(client, organizationId, clone(store));
    }, { write: true });
  }

  async listBrands(
    metricoolState: (
      accountId: string,
      storedConfigured: boolean,
      stored?: MetricoolAccountReference,
    ) => PublicMetricoolAccountState,
  ): Promise<PublicBrand[]> {
    const store = await this.snapshot();
    return store.brands.map((brand) => {
      const { metricool, ...account } = brand.account;
      const state = metricoolState(
        account.id,
        Boolean(metricool?.userId && metricool?.blogId),
        metricool,
      );
      return {
        ...brand,
        account: {
          ...account,
          metricoolConfigured: state.liveReady,
          metricool: state,
        },
      };
    });
  }

  async findBrandByAccountId(accountId: string): Promise<Brand | undefined> {
    const store = await this.snapshot();
    return store.brands.find((brand) => brand.account.id === accountId);
  }

  async updateAccountMetricool(
    accountId: string,
    metricool: MetricoolAccountReference,
  ): Promise<Brand | undefined> {
    return this.mutate((store) => {
      const brand = store.brands.find((item) => item.account.id === accountId);
      if (!brand) return undefined;
      brand.account.metricool = metricool;
      brand.account.active = true;
      brand.active = true;
      return brand;
    });
  }

  async clearAccountMetricool(accountId: string): Promise<Brand | undefined> {
    return this.mutate((store) => {
      const brand = store.brands.find((item) => item.account.id === accountId);
      if (!brand) return undefined;
      delete brand.account.metricool;
      store.workflow.autoReplyAccountIds = store.workflow.autoReplyAccountIds.filter((id) => id !== accountId);
      if (store.workflow.autoReplyEnabled && store.workflow.autoReplyAccountIds.length === 0) {
        store.workflow.autoReplyEnabled = false;
      }
      store.workflow.updatedAt = new Date().toISOString();
      return brand;
    });
  }

  async listInteractions(filters: InteractionFilters = {}): Promise<Interaction[]> {
    const store = await this.snapshot();
    return store.interactions
      .filter((interaction) => matchesInteraction(interaction, filters))
      .sort((left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
        || right.id.localeCompare(left.id));
  }

  async findInteraction(id: string): Promise<Interaction | undefined> {
    const store = await this.snapshot();
    return store.interactions.find((interaction) => interaction.id === id);
  }

  async updateInteraction(
    id: string,
    update: (interaction: Interaction, store: DataStore) => void,
  ): Promise<Interaction | undefined> {
    return this.mutateInteractions([id], (store) => {
      const interaction = store.interactions.find((item) => item.id === id);
      if (!interaction) return undefined;
      interaction.version = Number.isInteger(interaction.version) && interaction.version > 0
        ? interaction.version
        : 1;
      interaction.internalNotes = Array.isArray(interaction.internalNotes) ? interaction.internalNotes : [];
      update(interaction, store);
      interaction.updatedAt = new Date().toISOString();
      interaction.version += 1;
      return interaction;
    });
  }

  async mutateInteractions<T>(
    ids: string[],
    operation: (store: DataStore) => T | Promise<T>,
  ): Promise<T> {
    const uniqueIds = [...new Set(ids)];
    return this.withTenantClient(async (client, organizationId) => {
      const store = await this.readStoreUnlocked(client, organizationId);
      const result = await operation(store);
      const byId = new Map(store.interactions.map((interaction) => [interaction.id, interaction]));
      for (const id of uniqueIds) {
        const interaction = byId.get(id);
        if (!interaction) continue;
        await client.query(
          `UPDATE interactions
           SET category = $3,
               sentiment = $4,
               confidence = $5,
               status = $6,
               version = $7,
               responded_at = $8,
               response_text = $9,
               audit_trail = $10::jsonb,
               assigned_to_user_id = $11,
               assigned_to_display_name = $12,
               internal_notes = $13::jsonb,
               updated_at = $14,
               status_reason = $15::jsonb,
               automation_assessment = $16::jsonb
           WHERE organization_id = $1 AND interaction_key = $2`,
          [
            organizationId,
            interaction.id,
            interaction.category,
            interaction.sentiment,
            interaction.confidence,
            interaction.status,
            interaction.version,
            interaction.respondedAt ?? null,
            interaction.responseText ?? null,
            JSON.stringify(interaction.audit),
            interaction.assignedTo?.userId ?? null,
            interaction.assignedTo?.displayName ?? null,
            JSON.stringify(interaction.internalNotes ?? []),
            interaction.updatedAt,
            interaction.statusReason ? JSON.stringify(interaction.statusReason) : null,
            interaction.automation ? JSON.stringify(interaction.automation) : null,
          ],
        );
      }
      return clone(result);
    }, { write: true });
  }

  async insertInteractions(incoming: Interaction[]): Promise<{ created: Interaction[]; duplicates: number }> {
    if (!incoming.length) return { created: [], duplicates: 0 };
    return this.withTenantClient(async (client, organizationId) => {
      const references = await client.query<{
        brand_key: string;
        brand_id: string;
        account_key: string;
        account_id: string;
      }>(
        `SELECT b.slug AS brand_key, b.id::text AS brand_id,
                sa.account_key, sa.id::text AS account_id
         FROM brands b
         JOIN social_accounts sa ON sa.organization_id = b.organization_id AND sa.brand_id = b.id
         WHERE b.organization_id = $1`,
        [organizationId],
      );
      const brandIds = new Map(references.rows.map((row) => [row.brand_key, row.brand_id]));
      const accountIds = new Map(references.rows.map((row) => [row.account_key, row.account_id]));
      const created: Interaction[] = [];
      let duplicates = 0;
      for (const interaction of incoming) {
        const brandId = requireMapValue(brandIds, interaction.brandId, "interacción");
        const accountId = requireMapValue(accountIds, interaction.accountId, "interacción");
        const result = await client.query(
          `INSERT INTO interactions
             (organization_id, brand_id, social_account_id, interaction_key, external_id, provider, kind,
              direction, customer_name, customer_handle, body_text, category, sentiment, confidence,
              status, source, version, received_at, responded_at, metricool_ref, response_text, audit_trail,
              assigned_to_user_id, assigned_to_display_name, internal_notes, updated_at, status_reason,
              automation_assessment)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                   $17, $18, $19, $20::jsonb, $21, $22::jsonb, $23, $24, $25::jsonb, $26, $27::jsonb,
                   $28::jsonb)
           ON CONFLICT (organization_id, social_account_id, kind, external_id) DO NOTHING`,
          [
            organizationId,
            brandId,
            accountId,
            interaction.id,
            interaction.externalId,
            interaction.channel,
            interaction.type,
            interaction.direction,
            interaction.customerName,
            interaction.customerHandle,
            interaction.text,
            interaction.category,
            interaction.sentiment,
            interaction.confidence,
            interaction.status,
            interaction.source,
            interaction.version || 1,
            interaction.createdAt,
            interaction.respondedAt ?? null,
            JSON.stringify(interaction.metricoolRef ?? {}),
            interaction.responseText ?? null,
            JSON.stringify(interaction.audit),
            interaction.assignedTo?.userId ?? null,
            interaction.assignedTo?.displayName ?? null,
            JSON.stringify(interaction.internalNotes ?? []),
            interaction.updatedAt,
            interaction.statusReason ? JSON.stringify(interaction.statusReason) : null,
            interaction.automation ? JSON.stringify(interaction.automation) : null,
          ],
        );
        if (result.rowCount === 1) created.push(interaction);
        else {
          duplicates += 1;
          const existing = await client.query<{ metricool_ref: unknown; body_text: string }>(
            `SELECT metricool_ref, body_text
             FROM interactions
             WHERE organization_id = $1
               AND social_account_id = $2
               AND kind = $3
               AND external_id = $4
             FOR UPDATE`,
            [organizationId, accountId, interaction.type, interaction.externalId],
          );
          const existingRow = existing.rows[0];
          const current = asJson<Interaction["metricoolRef"]>(existingRow?.metricool_ref, undefined);
          const enriched = mergeMissingMetricoolRef(current, interaction.metricoolRef);
          const replaceContent = shouldReplaceMetricoolContent(existingRow?.body_text, interaction.text);
          if (enriched.changed && replaceContent) {
            await client.query(
              `UPDATE interactions
               SET metricool_ref = $5::jsonb,
                   body_text = $6
               WHERE organization_id = $1
                 AND social_account_id = $2
                 AND kind = $3
                 AND external_id = $4`,
              [
                organizationId,
                accountId,
                interaction.type,
                interaction.externalId,
                JSON.stringify(enriched.value ?? {}),
                interaction.text,
              ],
            );
          } else if (enriched.changed) {
            await client.query(
              `UPDATE interactions
               SET metricool_ref = $5::jsonb
               WHERE organization_id = $1
                 AND social_account_id = $2
                 AND kind = $3
                 AND external_id = $4`,
              [organizationId, accountId, interaction.type, interaction.externalId, JSON.stringify(enriched.value ?? {})],
            );
          } else if (replaceContent) {
            await client.query(
              `UPDATE interactions
               SET body_text = $5
               WHERE organization_id = $1
                 AND social_account_id = $2
                 AND kind = $3
                 AND external_id = $4`,
              [organizationId, accountId, interaction.type, interaction.externalId, interaction.text],
            );
          }
        }
      }
      return { created, duplicates };
    }, { write: true });
  }

  async prepareReplyDelivery(input: PrepareReplyDeliveryInput): Promise<{ delivery: ReplyDelivery; created: boolean }> {
    const prepared = await this.withTenantClient(
      (client, organizationId) => this.prepareReplyDeliveryUnlocked(client, organizationId, input),
      { write: true },
    );
    if (!prepared.delivery) throw new Error("No se pudo persistir la entrega de respuesta.");
    return { delivery: prepared.delivery, created: prepared.created };
  }

  async prepareAutoReplyDelivery(
    input: PrepareReplyDeliveryInput,
    maxPending: number,
  ): Promise<{ delivery?: ReplyDelivery; created: boolean; capacityReached: boolean }> {
    const safeMaxPending = Math.min(2_000, Math.max(1, Math.trunc(maxPending)));
    return this.withTenantClient(
      (client, organizationId) => this.prepareReplyDeliveryUnlocked(
        client,
        organizationId,
        input,
        safeMaxPending,
      ),
      { write: true },
    );
  }

  private async prepareReplyDeliveryUnlocked(
    client: PgQueryable,
    organizationId: string,
    input: PrepareReplyDeliveryInput,
    maxPendingAutomatic?: number,
  ): Promise<{ delivery?: ReplyDelivery; created: boolean; capacityReached: boolean }> {
    const existing = await this.readReplyDeliveryUnlocked(
      client,
      organizationId,
      { idempotencyKey: input.idempotencyKey },
    );
    if (existing) return { delivery: existing, created: false, capacityReached: false };
    const active = (await this.readReplyDeliveriesUnlocked(
      client,
      organizationId,
      { interactionId: input.interactionId },
    )).find((item) => ["pending", "sending", "uncertain"].includes(item.status));
    if (active) return { delivery: active, created: false, capacityReached: false };

    if (maxPendingAutomatic !== undefined) {
      const pending = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM replies
         WHERE organization_id = $1
           AND delivery_status = 'pending'
           AND approved_by_human = false
           AND idempotency_key LIKE 'auto-reply:%'`,
        [organizationId],
      );
      if (Number(pending.rows[0]?.count ?? 0) >= maxPendingAutomatic) {
        return { created: false, capacityReached: true };
      }
    }

    const interaction = await client.query<{ id: string }>(
      `SELECT id::text AS id
       FROM interactions
       WHERE organization_id = $1 AND interaction_key = $2
       LIMIT 1`,
      [organizationId, input.interactionId],
    );
    const interactionId = interaction.rows[0]?.id;
    if (!interactionId) {
      throw new Error(`No se pudo preparar la entrega: interacción ${input.interactionId} inexistente.`);
    }
    const inserted = await client.query(
      `INSERT INTO replies
         (id, organization_id, interaction_id, mode, body_text, delivery_status, idempotency_key,
          approved_by_human, requested_by, request_id, version, attempt_count, created_at, updated_at)
       VALUES ($1, $2, $3, 'send', $4, 'pending', $5, $6, $7::jsonb, $8, 1, 0, $9, $9)
       ON CONFLICT DO NOTHING`,
      [
        input.id,
        organizationId,
        interactionId,
        input.bodyText,
        input.idempotencyKey,
        input.approvedByHuman,
        JSON.stringify(input.requestedBy),
        input.requestId,
        input.createdAt,
      ],
    );
    const delivery = await this.readReplyDeliveryUnlocked(
      client,
      organizationId,
      { idempotencyKey: input.idempotencyKey },
    ) || (await this.readReplyDeliveriesUnlocked(
      client,
      organizationId,
      { interactionId: input.interactionId },
    )).find((item) => ["pending", "sending", "uncertain"].includes(item.status));
    if (!delivery) throw new Error("No se pudo persistir la entrega de respuesta.");
    return { delivery, created: inserted.rowCount === 1, capacityReached: false };
  }

  async claimReplyDelivery(id: string, leaseMs: number): Promise<ReplyDelivery | undefined> {
    return this.withTenantClient(async (client, organizationId) => {
      const result = await client.query(
        `UPDATE replies AS r
         SET delivery_status = 'sending',
             attempt_count = r.attempt_count + 1,
             last_attempt_at = now(),
             next_attempt_at = NULL,
             lease_expires_at = now() + ($3::double precision * interval '1 millisecond'),
             updated_at = now(),
             version = r.version + 1
         FROM interactions AS target
         WHERE r.organization_id = $1
           AND r.id::text = $2
           AND r.delivery_status = 'pending'
           AND r.interaction_id = target.id
           AND target.organization_id = r.organization_id
           AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
           AND NOT EXISTS (
             SELECT 1
             FROM replies AS blocked
             JOIN interactions AS blocked_interaction
               ON blocked_interaction.organization_id = blocked.organization_id
              AND blocked_interaction.id = blocked.interaction_id
             WHERE blocked.organization_id = r.organization_id
               AND blocked.id <> r.id
               AND blocked.delivery_status IN ('sending', 'uncertain')
               AND blocked_interaction.social_account_id = target.social_account_id
           )`,
        [organizationId, id, leaseMs],
      );
      if (result.rowCount !== 1) return undefined;
      return this.readReplyDeliveryUnlocked(client, organizationId, { id });
    }, { write: true });
  }

  async settleReplyDelivery(
    id: string,
    input: SettleReplyDeliveryInput,
  ): Promise<{ delivery: ReplyDelivery; interaction?: Interaction } | undefined> {
    return this.withTenantClient(async (client, organizationId) => {
      const current = await this.readReplyDeliveryUnlocked(client, organizationId, { id });
      const expectedStatus = input.status === "demo_simulated" ? "pending" : "sending";
      if (!current || current.status !== expectedStatus) return undefined;
      const result = await client.query(
        `UPDATE replies
         SET delivery_status = $3,
             provider_response_ref = $4,
             error_code = $5,
             sent_at = CASE WHEN $3 IN ('sent', 'demo_simulated') THEN $6::timestamptz ELSE NULL END,
             next_attempt_at = NULL,
             lease_expires_at = NULL,
             updated_at = $6,
             version = version + 1
         WHERE organization_id = $1 AND id::text = $2 AND delivery_status = $7`,
        [
          organizationId,
          id,
          input.status,
          input.providerResponseRef ?? null,
          input.errorCode ?? null,
          input.at,
          expectedStatus,
        ],
      );
      if (result.rowCount !== 1) return undefined;
      let interaction: Interaction | undefined;
      if (input.status === "sent" || input.status === "demo_simulated") {
        const audit = {
          id: randomUUID(),
          at: input.at,
          action: "reply_sent",
          actor: current.approvedByHuman ? "agent" : "workflow",
          detail: input.status === "demo_simulated"
            ? "Envío simulado; no se contactó a Metricool."
            : "Respuesta enviada mediante Metricool.",
          metadata: {
            deliveryId: current.id,
            demoMode: input.status === "demo_simulated",
            approvedByHuman: current.approvedByHuman,
          },
        } satisfies InteractionAuditEntry;
        await client.query(
          `UPDATE interactions
           SET response_text = $3,
               status = 'replied',
               responded_at = $4,
               updated_at = $4,
               version = version + 1,
               audit_trail = COALESCE(audit_trail, '[]'::jsonb) || $5::jsonb
           WHERE organization_id = $1 AND interaction_key = $2`,
          [organizationId, current.interactionId, current.bodyText, input.at, JSON.stringify([audit])],
        );
        interaction = (await this.readInteractionsUnlocked(client, organizationId))
          .find((item) => item.id === current.interactionId);
      } else if (input.status === "failed" || input.status === "uncertain") {
        const audit = {
          id: randomUUID(),
          at: input.at,
          action: "draft_created",
          actor: current.approvedByHuman ? "agent" : "workflow",
          detail: "Texto conservado como borrador tras un envío no confirmado.",
          metadata: {
            deliveryId: current.id,
            deliveryStatus: input.status,
            ...(input.errorCode ? { errorCode: input.errorCode } : {}),
          },
        } satisfies InteractionAuditEntry;
        await client.query(
          `UPDATE interactions
           SET response_text = $3,
               status = CASE WHEN status IN ('new', 'pending', 'drafted') THEN 'drafted' ELSE status END,
               updated_at = $4,
               version = version + 1,
               audit_trail = COALESCE(audit_trail, '[]'::jsonb) || $5::jsonb
           WHERE organization_id = $1 AND interaction_key = $2
             AND status NOT IN ('replied', 'resolved')`,
          [organizationId, current.interactionId, current.bodyText, input.at, JSON.stringify([audit])],
        );
        interaction = (await this.readInteractionsUnlocked(client, organizationId))
          .find((item) => item.id === current.interactionId);
      }
      const delivery = await this.readReplyDeliveryUnlocked(client, organizationId, { id });
      if (!delivery) return undefined;
      return { delivery, interaction };
    }, { write: true });
  }

  async deferReplyDelivery(id: string, input: DeferReplyDeliveryInput): Promise<ReplyDelivery | undefined> {
    return this.withTenantClient(async (client, organizationId) => {
      const result = await client.query(
        `UPDATE replies
         SET delivery_status = 'pending',
             error_code = $3,
             next_attempt_at = $4::timestamptz,
             lease_expires_at = NULL,
             updated_at = $5::timestamptz,
             version = version + 1
         WHERE organization_id = $1 AND id::text = $2 AND delivery_status = 'sending'`,
        [organizationId, id, input.errorCode, input.nextAttemptAt, input.at],
      );
      if (result.rowCount !== 1) return undefined;
      return this.readReplyDeliveryUnlocked(client, organizationId, { id });
    }, { write: true });
  }

  async reconcileReplyDelivery(
    id: string,
    input: ReconcileReplyDeliveryInput,
  ): Promise<{ delivery: ReplyDelivery; interaction?: Interaction } | undefined> {
    return this.withTenantClient(async (client, organizationId) => {
      const current = await this.readReplyDeliveryUnlocked(client, organizationId, { id });
      if (!current || current.status !== "uncertain" || current.version !== input.expectedVersion) return undefined;
      const result = await client.query(
        `UPDATE replies
         SET delivery_status = $3,
             sent_at = CASE WHEN $3 = 'sent' THEN $4::timestamptz ELSE sent_at END,
             error_code = CASE WHEN $3 = 'sent' THEN NULL ELSE error_code END,
             reconciled_at = $4,
             reconciled_by = $5::jsonb,
             reconciliation_note = $6,
             next_attempt_at = NULL,
             updated_at = $4,
             version = version + 1
         WHERE organization_id = $1 AND id::text = $2
           AND delivery_status = 'uncertain' AND version = $7`,
        [organizationId, id, input.outcome, input.at, JSON.stringify(input.actor), input.note, input.expectedVersion],
      );
      if (result.rowCount !== 1) return undefined;
      const audit = {
        id: randomUUID(),
        at: input.at,
        action: "delivery_reconciled",
        actor: "agent",
        detail: `Entrega conciliada manualmente como ${input.outcome}.`,
        metadata: { deliveryId: current.id, outcome: input.outcome, reconciledBy: input.actor.userId },
      } satisfies InteractionAuditEntry;
      await client.query(
        `UPDATE interactions
         SET response_text = CASE WHEN $3 = 'sent' THEN $4 ELSE response_text END,
             status = CASE WHEN $3 = 'sent' THEN 'replied' ELSE status END,
             responded_at = CASE WHEN $3 = 'sent' THEN $5::timestamptz ELSE responded_at END,
             updated_at = $5,
             version = version + 1,
             audit_trail = COALESCE(audit_trail, '[]'::jsonb) || $6::jsonb
         WHERE organization_id = $1 AND interaction_key = $2`,
        [organizationId, current.interactionId, input.outcome, current.bodyText, input.at, JSON.stringify([audit])],
      );
      const delivery = await this.readReplyDeliveryUnlocked(client, organizationId, { id });
      if (!delivery) return undefined;
      const interaction = (await this.readInteractionsUnlocked(client, organizationId))
        .find((item) => item.id === current.interactionId);
      return { delivery, interaction };
    }, { write: true });
  }

  async recoverStaleReplyDeliveries(at = new Date().toISOString()): Promise<number> {
    return this.withTenantClient(async (client, organizationId) => {
      const result = await client.query(
        `UPDATE replies
         SET delivery_status = 'uncertain',
             error_code = 'DELIVERY_LEASE_EXPIRED',
             next_attempt_at = NULL,
             lease_expires_at = NULL,
             updated_at = $2,
             version = version + 1
         WHERE organization_id = $1
           AND delivery_status = 'sending'
           AND lease_expires_at <= $2::timestamptz`,
        [organizationId, at],
      );
      return result.rowCount ?? 0;
    }, { write: true });
  }

  async findReplyDelivery(id: string): Promise<ReplyDelivery | undefined> {
    return this.withTenantClient((client, organizationId) =>
      this.readReplyDeliveryUnlocked(client, organizationId, { id }));
  }

  async listReplyDeliveries(filters: ReplyDeliveryFilters = {}): Promise<ReplyDelivery[]> {
    return this.withTenantClient((client, organizationId) =>
      this.readReplyDeliveriesUnlocked(client, organizationId, filters));
  }

  async getWorkflow(): Promise<Workflow> {
    return this.withTenantClient((client, organizationId) => this.readWorkflowUnlocked(client, organizationId));
  }

  async getSchedulerState(): Promise<{ workflowId: string; enabled: boolean; pollIntervalMinutes: number; accountIds: string[] }> {
    return this.withTenantClient(async (client, organizationId) => {
      const workflow = await client.query<{ workflow_key: string; enabled: boolean; poll_interval_minutes: number }>(
        `SELECT workflow_key, enabled, poll_interval_minutes
         FROM workflow_configs
         WHERE organization_id = $1
         ORDER BY created_at
         LIMIT 1`,
        [organizationId],
      );
      const accounts = await client.query<{ account_key: string }>(
        `SELECT sa.account_key
         FROM social_accounts sa
         JOIN brands b ON b.organization_id = sa.organization_id AND b.id = sa.brand_id
         WHERE sa.organization_id = $1 AND sa.active = true AND b.active = true
         ORDER BY sa.account_key`,
        [organizationId],
      );
      const row = workflow.rows[0];
      return {
        workflowId: row?.workflow_key ?? "workflow-sac-metricool",
        enabled: row?.enabled ?? false,
        pollIntervalMinutes: Math.max(5, Number(row?.poll_interval_minutes) || 5),
        accountIds: accounts.rows.map((item) => item.account_key),
      };
    });
  }

  async updateWorkflow(patch: Partial<Workflow>): Promise<Workflow> {
    return this.mutate((store) => {
      store.workflow = {
        ...store.workflow,
        ...patch,
        id: store.workflow.id,
        updatedAt: new Date().toISOString(),
      };
      return store.workflow;
    });
  }

  async recordRun(run: WorkflowRun): Promise<WorkflowRun> {
    return this.withTenantClient(async (client, organizationId) => {
      await client.query(
        `INSERT INTO sync_runs
           (organization_id, run_key, kind, status, workflow_version, requested_by, retry_of,
            started_at, finished_at, demo_mode, account_keys, totals, audit_trail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
         ON CONFLICT (organization_id, run_key) DO NOTHING`,
        [
          organizationId,
          run.id,
          run.kind,
          run.status,
          run.workflowVersion,
          run.requestedBy ?? null,
          run.retryOf ?? null,
          run.startedAt,
          run.finishedAt,
          run.demoMode,
          run.accountIds,
          JSON.stringify(run.totals),
          JSON.stringify(run.auditTrail),
        ],
      );
      await client.query(
        `UPDATE workflow_configs
         SET last_run_at = $2, last_run_status = $3, updated_at = $2
         WHERE organization_id = $1`,
        [organizationId, run.finishedAt, run.status],
      );
      await client.query(
        `DELETE FROM sync_runs
         WHERE id IN (
           SELECT id FROM sync_runs
           WHERE organization_id = $1
           ORDER BY started_at DESC
           OFFSET 100
         )`,
        [organizationId],
      );
      return clone(run);
    }, { write: true });
  }

  async enqueueJob(job: WorkflowJob): Promise<boolean> {
    return this.withTenantClient(async (client, organizationId) => {
      const result = await client.query(
        `INSERT INTO workflow_jobs
           (organization_id, job_key, schedule_key, kind, status, account_keys, item_limit,
            attempts, max_attempts, next_attempt_at, created_at, updated_at,
            workflow_key, trigger_mode, input_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
         ON CONFLICT (organization_id, schedule_key) DO NOTHING`,
        [
          organizationId,
          job.id,
          job.scheduleKey,
          job.kind,
          job.status,
          job.accountIds,
          job.limit,
          job.attempts,
          job.maxAttempts,
          job.nextAttemptAt,
          job.createdAt,
          job.updatedAt,
          job.workflowId ?? null,
          job.triggerMode ?? null,
          JSON.stringify(job.input ?? []),
        ],
      );
      await client.query(
        `DELETE FROM workflow_jobs
         WHERE id IN (
           SELECT id FROM workflow_jobs
           WHERE organization_id = $1 AND status IN ('succeeded', 'dead')
           ORDER BY created_at DESC
           OFFSET 1000
         )`,
        [organizationId],
      );
      return result.rowCount === 1;
    }, { write: true });
  }

  async claimNextJob(workerId: string, staleLeaseMs: number): Promise<WorkflowJob | undefined> {
    return this.withTenantClient(async (client, organizationId) => {
      await client.query(
        `UPDATE workflow_jobs
         SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'retry' END,
             next_attempt_at = now(),
             updated_at = now(),
             locked_at = NULL,
             locked_by = NULL,
             last_error = 'Lease del worker expirada; trabajo recuperado automáticamente.'
         WHERE organization_id = $1
           AND status = 'running'
           AND locked_at < now() - ($2::double precision * interval '1 millisecond')`,
        [organizationId, staleLeaseMs],
      );
      const result = await client.query<WorkflowJobRow>(
        `WITH candidate AS (
           SELECT id
           FROM workflow_jobs
           WHERE organization_id = $1
             AND status IN ('queued', 'retry')
             AND next_attempt_at <= now()
           ORDER BY next_attempt_at, created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE workflow_jobs job
         SET status = 'running',
             attempts = job.attempts + 1,
             locked_at = now(),
             locked_by = $2,
             updated_at = now()
         FROM candidate
         WHERE job.id = candidate.id
         RETURNING job.job_key, job.schedule_key, job.kind, job.status, job.account_keys,
                   job.item_limit, job.attempts, job.max_attempts, job.next_attempt_at,
                   job.created_at, job.updated_at, job.locked_at, job.locked_by,
                   job.run_key, job.last_error, job.workflow_key, job.trigger_mode, job.input_payload`,
        [organizationId, workerId],
      );
      return result.rows[0] ? mapWorkflowJobRow(result.rows[0]) : undefined;
    }, { write: true });
  }

  async completeJob(jobId: string, workerId: string, runId?: string): Promise<boolean> {
    return this.withTenantClient(async (client, organizationId) => {
      const result = await client.query(
        `UPDATE workflow_jobs
         SET status = 'succeeded', run_key = $4, updated_at = now(),
             locked_at = NULL, locked_by = NULL, last_error = NULL
         WHERE organization_id = $1 AND job_key = $2 AND locked_by = $3 AND status = 'running'`,
        [organizationId, jobId, workerId, runId ?? null],
      );
      return result.rowCount === 1;
    }, { write: true });
  }

  async failJob(jobId: string, workerId: string, error: string, backoffMs: number): Promise<boolean> {
    return this.withTenantClient(async (client, organizationId) => {
      const result = await client.query(
        `UPDATE workflow_jobs
         SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'retry' END,
             next_attempt_at = now() + ($5::double precision * interval '1 millisecond'),
             updated_at = now(), locked_at = NULL, locked_by = NULL, last_error = left($4, 1000)
         WHERE organization_id = $1 AND job_key = $2 AND locked_by = $3 AND status = 'running'`,
        [organizationId, jobId, workerId, error, backoffMs],
      );
      return result.rowCount === 1;
    }, { write: true });
  }

  async listJobs(status?: WorkflowJob["status"]): Promise<WorkflowJob[]> {
    return this.withTenantClient(async (client, organizationId) => {
      const params: unknown[] = [organizationId];
      const statusClause = status ? "AND status = $2" : "";
      if (status) params.push(status);
      const result = await client.query<WorkflowJobRow>(
        `SELECT job_key, schedule_key, kind, status, account_keys, item_limit, attempts, max_attempts,
                next_attempt_at, created_at, updated_at, locked_at, locked_by, run_key, last_error,
                workflow_key, trigger_mode, input_payload
         FROM workflow_jobs
         WHERE organization_id = $1 ${statusClause}
         ORDER BY created_at DESC
         LIMIT 250`,
        params,
      );
      return result.rows.map(mapWorkflowJobRow);
    });
  }

  async retryJob(jobId: string): Promise<WorkflowJob | undefined> {
    return this.withTenantClient(async (client, organizationId) => {
      const result = await client.query<WorkflowJobRow>(
        `UPDATE workflow_jobs
         SET status = 'queued', attempts = 0, next_attempt_at = now(), updated_at = now(),
             locked_at = NULL, locked_by = NULL, last_error = NULL
         WHERE organization_id = $1 AND job_key = $2 AND status IN ('dead', 'retry')
         RETURNING job_key, schedule_key, kind, status, account_keys, item_limit, attempts,
                   max_attempts, next_attempt_at, created_at, updated_at, locked_at,
                   locked_by, run_key, last_error, workflow_key, trigger_mode, input_payload`,
        [organizationId, jobId],
      );
      return result.rows[0] ? mapWorkflowJobRow(result.rows[0]) : undefined;
    }, { write: true });
  }

  async claimIdempotency(record: StoredIdempotencyRecord): Promise<StoredIdempotencyRecord | undefined> {
    return this.withTenantClient(async (client, organizationId) => {
      const claimed = await client.query<{ key: string }>(
        `INSERT INTO idempotency_keys
           (organization_id, scope, key, request_hash, status_code, response_json, created_at, expires_at)
         VALUES ($1, $2, $3, $4, 102, 'null'::jsonb, $5, $6)
         ON CONFLICT (organization_id, scope, key)
         DO UPDATE SET
           request_hash = EXCLUDED.request_hash,
           status_code = 102,
           response_json = 'null'::jsonb,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at
         WHERE idempotency_keys.expires_at <= now()
            OR (idempotency_keys.status_code = 102
                AND idempotency_keys.created_at < now() - interval '5 minutes')
         RETURNING key`,
        [organizationId, record.scope, record.key, record.requestHash, record.createdAt, expiresAt(record)],
      );
      if (claimed.rows.length) return undefined;
      const existing = await client.query<IdempotencyRow>(
        `SELECT scope, key, request_hash, status_code, response_json, created_at
         FROM idempotency_keys
         WHERE organization_id = $1 AND scope = $2 AND key = $3
         LIMIT 1`,
        [organizationId, record.scope, record.key],
      );
      const row = existing.rows[0];
      return row ? {
        scope: row.scope,
        key: row.key,
        requestHash: row.request_hash,
        statusCode: row.status_code,
        response: row.response_json,
        createdAt: toIso(row.created_at) ?? new Date().toISOString(),
      } : undefined;
    }, { write: true });
  }

  async saveIdempotency(record: StoredIdempotencyRecord): Promise<void> {
    await this.withTenantClient(async (client, organizationId) => {
      await client.query(
        `INSERT INTO idempotency_keys
           (organization_id, scope, key, request_hash, status_code, response_json, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         ON CONFLICT (organization_id, scope, key)
         DO UPDATE SET
           request_hash = EXCLUDED.request_hash,
           status_code = EXCLUDED.status_code,
           response_json = EXCLUDED.response_json,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at`,
        [
          organizationId,
          record.scope,
          record.key,
          record.requestHash,
          record.statusCode,
          JSON.stringify(record.response),
          record.createdAt,
          expiresAt(record),
        ],
      );
      await client.query("DELETE FROM idempotency_keys WHERE organization_id = $1 AND expires_at <= now()", [organizationId]);
      await client.query(
        `DELETE FROM idempotency_keys
         WHERE ctid IN (
           SELECT ctid FROM idempotency_keys
           WHERE organization_id = $1
           ORDER BY created_at DESC
           OFFSET 250
         )`,
        [organizationId],
      );
    }, { write: true });
  }

  async stats(filters: InteractionFilters = {}): Promise<InteractionStats> {
    const store = await this.snapshot();
    const items = store.interactions.filter((interaction) => matchesInteraction(interaction, filters));
    const inboundItems = items.filter((item) => item.direction === "inbound");
    const pendingStatuses = new Set(["new", "pending", "drafted"]);
    const replied = inboundItems.filter((item) => item.status === "replied").length;
    const responseMinutes = inboundItems
      .filter((item) => item.respondedAt)
      .map((item) => (Date.parse(item.respondedAt!) - Date.parse(item.createdAt)) / 60_000)
      .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);

    const byBrand = store.brands
      .filter((brand) => !filters.brandId || brand.id === filters.brandId)
      .filter((brand) => !filters.brandIds || filters.brandIds.includes(brand.id))
      .map((brand) => {
        const brandItems = items.filter((item) => item.brandId === brand.id);
        return {
          brandId: brand.id,
          brandName: brand.name,
          total: brandItems.length,
          dms: brandItems.filter((item) => item.type === "dm").length,
          comments: brandItems.filter((item) => item.type === "comment").length,
          reviews: brandItems.filter((item) => item.type === "review").length,
          pending: brandItems.filter((item) => pendingStatuses.has(item.status)).length,
          replied: brandItems.filter((item) => item.direction === "inbound" && item.status === "replied").length,
        };
      })
      .sort((left, right) => right.total - left.total || left.brandName.localeCompare(right.brandName));

    return {
      generatedAt: new Date().toISOString(),
      total: items.length,
      dms: items.filter((item) => item.type === "dm").length,
      comments: items.filter((item) => item.type === "comment").length,
      reviews: items.filter((item) => item.type === "review").length,
      pending: items.filter((item) => pendingStatuses.has(item.status)).length,
      replied,
      escalated: items.filter((item) => item.status === "escalated").length,
      automatedResponses: items.filter((item) =>
        item.audit.some((entry) => entry.action === "reply_sent" && entry.actor === "workflow"),
      ).length,
      automationEvaluated: items.filter((item) => Boolean(item.automation)).length,
      automationScope: items.filter((item) =>
        Boolean(item.automation)
        || (item.direction === "inbound" && ["new", "pending", "drafted", "escalated"].includes(item.status)),
      ).length,
      autoReplyCandidates: items.filter((item) => item.automation?.recommendedRoute === "auto_reply").length,
      humanReviewRequired: items.filter((item) => item.automation?.effectiveRoute === "human_review").length,
      knowledgeBlocked: items.filter((item) =>
        item.automation?.knowledge.status === "missing"
        || item.automation?.knowledge.status === "live_source_required",
      ).length,
      responseRate: inboundItems.length ? Math.round((replied / inboundItems.length) * 1000) / 10 : 0,
      averageResponseMinutes: responseMinutes.length
        ? Math.round((responseMinutes.reduce((sum, value) => sum + value, 0) / responseMinutes.length) * 10) / 10
        : null,
      byChannel: Object.fromEntries(
        CHANNELS.map((channel) => [channel, items.filter((item) => item.channel === channel).length]),
      ) as InteractionStats["byChannel"],
      byStatus: {
        new: items.filter((item) => item.status === "new").length,
        pending: items.filter((item) => item.status === "pending").length,
        drafted: items.filter((item) => item.status === "drafted").length,
        replied: items.filter((item) => item.status === "replied").length,
        escalated: items.filter((item) => item.status === "escalated").length,
        resolved: items.filter((item) => item.status === "resolved").length,
      },
      byBrand,
    };
  }

  private async ensureWorkflowUnlocked(client: PgQueryable, organizationId: string): Promise<void> {
    const existing = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM workflow_configs WHERE organization_id = $1",
      [organizationId],
    );
    if (Number(existing.rows[0]?.count ?? 0) > 0) return;

    const store = createDemoStore();
    const workflowId = await this.insertWorkflowUnlocked(client, organizationId, store.workflow, new Map());
    await this.insertWorkflowVersionsUnlocked(client, organizationId, workflowId, store.workflowVersions);
  }

  private async readReplyDeliveryUnlocked(
    client: PgQueryable,
    organizationId: string,
    lookup: { id?: string; idempotencyKey?: string },
  ): Promise<ReplyDelivery | undefined> {
    const params: unknown[] = [organizationId];
    const clauses = ["r.organization_id = $1"];
    if (lookup.id) {
      params.push(lookup.id);
      clauses.push(`r.id::text = $${params.length}`);
    }
    if (lookup.idempotencyKey) {
      params.push(lookup.idempotencyKey);
      clauses.push(`r.idempotency_key = $${params.length}`);
    }
    const result = await client.query<ReplyDeliveryRow>(
      `${this.replyDeliverySelectSql()}
       WHERE ${clauses.join(" AND ")}
       ORDER BY r.created_at DESC
       LIMIT 1`,
      params,
    );
    return result.rows[0] ? mapReplyDeliveryRow(result.rows[0]) : undefined;
  }

  private async readReplyDeliveriesUnlocked(
    client: PgQueryable,
    organizationId: string,
    filters: ReplyDeliveryFilters = {},
  ): Promise<ReplyDelivery[]> {
    const params: unknown[] = [organizationId];
    const clauses = ["r.organization_id = $1"];
    if (filters.interactionId) {
      params.push(filters.interactionId);
      clauses.push(`i.interaction_key = $${params.length}`);
    }
    if (filters.accountId) {
      params.push(filters.accountId);
      clauses.push(`sa.account_key = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      clauses.push(`r.delivery_status = $${params.length}`);
    }
    if (filters.automaticOnly) {
      clauses.push("r.idempotency_key LIKE 'auto-reply:%' AND r.approved_by_human = false");
    }
    if (filters.brandIds) {
      if (filters.brandIds.length === 0) return [];
      params.push(filters.brandIds);
      clauses.push(`b.slug = ANY($${params.length}::text[])`);
    }
    const limit = Math.min(2_000, Math.max(1, Math.trunc(filters.limit ?? 500)));
    const result = await client.query<ReplyDeliveryRow>(
      `${this.replyDeliverySelectSql()}
       WHERE ${clauses.join(" AND ")}
       ORDER BY r.created_at ${filters.oldestFirst ? "ASC" : "DESC"}
       LIMIT ${limit}`,
      params,
    );
    return result.rows.map(mapReplyDeliveryRow);
  }

  private replyDeliverySelectSql(): string {
    return `SELECT
       r.id::text AS id,
       i.interaction_key AS interaction_id,
       b.slug AS brand_id,
       sa.account_key AS account_id,
       r.body_text,
       r.approved_by_human,
       r.requested_by,
       COALESCE(r.idempotency_key, r.id::text) AS idempotency_key,
       r.request_id,
       r.delivery_status,
       r.version,
       r.attempt_count,
       r.created_at,
       r.updated_at,
       r.last_attempt_at,
       r.next_attempt_at,
       r.lease_expires_at,
       r.sent_at,
       r.provider_response_ref,
       r.error_code,
       r.reconciled_at,
       r.reconciled_by,
       r.reconciliation_note
     FROM replies r
     JOIN interactions i
       ON i.organization_id = r.organization_id AND i.id = r.interaction_id
     JOIN brands b
       ON b.organization_id = i.organization_id AND b.id = i.brand_id
     JOIN social_accounts sa
       ON sa.organization_id = i.organization_id AND sa.id = i.social_account_id`;
  }

  private async readStoreUnlocked(client: PgQueryable, organizationId: string): Promise<DataStore> {
    const brands = await this.readBrandsUnlocked(client, organizationId);
    const workflow = await this.readWorkflowUnlocked(client, organizationId);
    const interactions = await this.readInteractionsUnlocked(client, organizationId);
    const deliveries = await this.readReplyDeliveriesUnlocked(client, organizationId);
    const runs = await this.readRunsUnlocked(client, organizationId);
    const idempotency = await this.readIdempotencyUnlocked(client, organizationId);
    const workflowVersions = await this.readWorkflowVersionsUnlocked(client, organizationId);
    const jobs = await this.readJobsUnlocked(client, organizationId);
    const automation = await this.readAutomationStateUnlocked(client, organizationId);
    const timestamps = [
      ...brands.map((brand) => brand.id),
      workflow.updatedAt,
      ...interactions.map((interaction) => interaction.updatedAt),
    ];
    const now = new Date().toISOString();
    return {
      version: 1,
      createdAt: now,
      updatedAt: timestamps.includes(workflow.updatedAt) ? workflow.updatedAt : now,
      brands,
      interactions,
      deliveries,
      workflow,
      workflowVersions,
      runs,
      jobs,
      idempotency,
      automation,
    };
  }

  private async readAutomationStateUnlocked(client: PgQueryable, organizationId: string): Promise<AutomationState> {
    const result = await client.query<{ state: unknown }>(
      "SELECT state FROM automation_platform_states WHERE organization_id = $1",
      [organizationId],
    );
    return asJson<AutomationState>(result.rows[0]?.state, createDemoAutomationState());
  }

  private async readBrandsUnlocked(client: PgQueryable, organizationId: string): Promise<Brand[]> {
    const result = await client.query<BrandRow>(
      `SELECT
         b.slug AS brand_id,
         b.name AS brand_name,
         b.color,
         b.active AS brand_active,
         b.sac_policy,
         b.workbook_config,
         b.qa_workbook_config,
         b.resources,
         sa.account_key AS account_id,
         sa.display_name AS account_name,
         sa.handle,
         sa.channels,
         sa.active AS account_active,
         pgp_sym_decrypt(mar.encrypted_user_id, $2)::text AS user_id,
         pgp_sym_decrypt(mar.encrypted_blog_id, $2)::text AS blog_id,
         mar.instagram_provider
       FROM brands b
       JOIN social_accounts sa
         ON sa.organization_id = b.organization_id
        AND sa.brand_id = b.id
       LEFT JOIN metricool_account_refs mar
         ON mar.organization_id = sa.organization_id
        AND mar.social_account_id = sa.id
       WHERE b.organization_id = $1
       ORDER BY b.slug`,
      [organizationId, this.encryptionKey],
    );

    return result.rows.map((row) => ({
      id: row.brand_id,
      name: row.brand_name,
      color: row.color,
      active: row.brand_active,
      sacPolicy: asJson<Brand["sacPolicy"]>(row.sac_policy, undefined),
      workbook: asJson<Brand["workbook"]>(row.workbook_config, undefined),
      qaWorkbook: asJson<Brand["qaWorkbook"]>(row.qa_workbook_config, undefined),
      resources: asJson<NonNullable<Brand["resources"]>>(row.resources, []),
      account: {
        id: row.account_id,
        brandId: row.brand_id,
        name: row.account_name,
        handle: row.handle,
        channels: asStringArray(row.channels) as Channel[],
        active: row.account_active,
        metricool: row.user_id && row.blog_id
          ? {
              userId: row.user_id,
              blogId: row.blog_id,
              instagramProvider: row.instagram_provider || "INSTAGRAMBUSINESS",
            }
          : undefined,
      },
    }));
  }

  private async readWorkflowUnlocked(client: PgQueryable, organizationId: string): Promise<Workflow> {
    const workflow = await client.query<WorkflowRow>(
      `SELECT
         id::text AS workflow_id,
         workflow_key,
         name,
         version,
         published_version,
         published_at,
         published_by,
         enabled,
         poll_interval_minutes,
         auto_reply_enabled,
         minimum_confidence,
         require_human_for,
         business_hours_only,
         updated_at,
         last_run_at,
         last_run_status
       FROM workflow_configs
       WHERE organization_id = $1
       ORDER BY created_at
       LIMIT 1`,
      [organizationId],
    );

    const row = workflow.rows[0];
    if (!row) return createDemoStore().workflow;

    const allowlist = await client.query<{ account_key: string }>(
      `SELECT sa.account_key
       FROM workflow_account_allowlist waa
       JOIN social_accounts sa
         ON sa.organization_id = waa.organization_id
        AND sa.id = waa.social_account_id
       WHERE waa.organization_id = $1 AND waa.workflow_id = $2
       ORDER BY sa.account_key`,
      [organizationId, row.workflow_id],
    );
    const nodes = await client.query<WorkflowNodeRow>(
      `SELECT node_key, type, label, enabled, position_x, position_y, config
       FROM workflow_nodes
       WHERE organization_id = $1 AND workflow_id = $2
       ORDER BY created_at, node_key`,
      [organizationId, row.workflow_id],
    );
    const edges = await client.query<WorkflowEdgeRow>(
      `SELECT edge_key, source_node_key, target_node_key, label, connector_type
       FROM workflow_edges
       WHERE organization_id = $1 AND workflow_id = $2
       ORDER BY created_at, edge_key`,
      [organizationId, row.workflow_id],
    );

    return ensureMetricoolInboxCoverage({
      id: row.workflow_key,
      name: row.name,
      version: Number(row.version) || 1,
      publishedVersion: Number(row.published_version) || 1,
      publishedAt: toIso(row.published_at),
      publishedBy: row.published_by ?? undefined,
      enabled: row.enabled,
      pollIntervalMinutes: row.poll_interval_minutes,
      autoReplyEnabled: row.auto_reply_enabled,
      autoReplyAccountIds: allowlist.rows.map((item) => item.account_key),
      minimumConfidence: Number(row.minimum_confidence),
      requireHumanFor: asStringArray(row.require_human_for),
      businessHoursOnly: row.business_hours_only,
      updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
      lastRunAt: toIso(row.last_run_at),
      lastRunStatus: row.last_run_status ?? undefined,
      nodes: nodes.rows.map((item) => ({
        id: item.node_key,
        type: item.type,
        label: item.label,
        enabled: item.enabled,
        position: { x: Number(item.position_x), y: Number(item.position_y) },
        config: asJson<Record<string, string | number | boolean | string[]>>(item.config, {}),
      })),
      edges: edges.rows.map((item) => ({
        id: item.edge_key,
        source: item.source_node_key,
        target: item.target_node_key,
        label: item.label ?? undefined,
        connectorType: item.connector_type ?? "smoothstep",
      })),
    });
  }

  private async readInteractionsUnlocked(client: PgQueryable, organizationId: string): Promise<Interaction[]> {
    const result = await client.query<InteractionRow>(
      `SELECT
         i.interaction_key,
         i.external_id,
         b.slug AS brand_id,
         sa.account_key AS account_id,
         i.provider,
         i.kind,
         i.direction,
         i.customer_name,
         i.customer_handle,
         i.body_text,
         i.category,
         i.sentiment,
         i.confidence,
         i.status,
         i.source,
         i.version,
         i.received_at,
         i.updated_at,
         i.assigned_to_user_id,
         i.assigned_to_display_name,
         i.internal_notes,
         i.response_text,
         i.responded_at,
         i.metricool_ref,
         i.audit_trail,
         i.status_reason,
         i.automation_assessment
       FROM interactions i
       JOIN brands b
         ON b.organization_id = i.organization_id
        AND b.id = i.brand_id
       JOIN social_accounts sa
         ON sa.organization_id = i.organization_id
        AND sa.id = i.social_account_id
       WHERE i.organization_id = $1
       ORDER BY i.received_at DESC, i.interaction_key DESC`,
      [organizationId],
    );

    return result.rows.map((row) => ({
      id: row.interaction_key,
      externalId: row.external_id,
      brandId: row.brand_id,
      accountId: row.account_id,
      channel: row.provider,
      type: row.kind,
      direction: row.direction,
      customerName: row.customer_name,
      customerHandle: row.customer_handle,
      text: metricoolContentForDisplay(row.body_text),
      category: row.category,
      sentiment: row.sentiment,
      confidence: Number(row.confidence),
      status: row.status,
      source: row.source,
      version: Number(row.version) || 1,
      createdAt: toIso(row.received_at) ?? new Date().toISOString(),
      updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
      assignedTo: row.assigned_to_user_id && row.assigned_to_display_name
        ? { userId: row.assigned_to_user_id, displayName: row.assigned_to_display_name }
        : undefined,
      internalNotes: asJson<Interaction["internalNotes"]>(row.internal_notes, []),
      responseText: row.response_text ?? undefined,
      respondedAt: toIso(row.responded_at),
      metricoolRef: asJson<Interaction["metricoolRef"]>(row.metricool_ref, undefined),
      statusReason: asJson<Interaction["statusReason"]>(row.status_reason, undefined),
      automation: asJson<Interaction["automation"]>(row.automation_assessment, undefined),
      audit: asJson<InteractionAuditEntry[]>(row.audit_trail, []),
    }));
  }

  private async readRunsUnlocked(client: PgQueryable, organizationId: string): Promise<WorkflowRun[]> {
    const result = await client.query<WorkflowRunRow>(
      `SELECT run_key, kind, status, workflow_version, requested_by, retry_of,
              started_at, finished_at, demo_mode, account_keys, totals, audit_trail
       FROM sync_runs
       WHERE organization_id = $1
       ORDER BY started_at DESC
       LIMIT 100`,
      [organizationId],
    );

    return result.rows.map((row) => ({
      id: row.run_key,
      kind: row.kind,
      status: row.status,
      workflowVersion: Number(row.workflow_version) || 1,
      requestedBy: row.requested_by ?? undefined,
      retryOf: row.retry_of ?? undefined,
      startedAt: toIso(row.started_at) ?? new Date().toISOString(),
      finishedAt: toIso(row.finished_at) ?? new Date().toISOString(),
      demoMode: row.demo_mode,
      accountIds: asStringArray(row.account_keys),
      totals: asJson<WorkflowRun["totals"]>(row.totals, {
        fetched: 0,
        created: 0,
        duplicates: 0,
        drafted: 0,
        replied: 0,
        escalated: 0,
        errors: 0,
      }),
      auditTrail: asJson<RunAuditStep[]>(row.audit_trail, []),
    }));
  }

  private async readWorkflowVersionsUnlocked(
    client: PgQueryable,
    organizationId: string,
  ): Promise<WorkflowVersion[]> {
    const result = await client.query<WorkflowVersionRow>(
      `SELECT
         concat(wc.workflow_key, '-v', wv.version) AS version_key,
         wc.workflow_key,
         wv.version,
         wv.status,
         wv.snapshot,
         wv.created_at,
         wv.created_by,
         wv.change_note
       FROM workflow_versions wv
       JOIN workflow_configs wc
         ON wc.organization_id = wv.organization_id
        AND wc.id = wv.workflow_id
       WHERE wv.organization_id = $1
       ORDER BY wv.version DESC
       LIMIT 50`,
      [organizationId],
    );
    return result.rows.map((row) => ({
      id: row.version_key,
      workflowId: row.workflow_key,
      version: Number(row.version),
      status: row.status,
      snapshot: asJson<Workflow>(row.snapshot, createDemoStore().workflow),
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
      createdBy: row.created_by,
      changeNote: row.change_note ?? undefined,
    }));
  }

  private async readJobsUnlocked(client: PgQueryable, organizationId: string): Promise<WorkflowJob[]> {
    const result = await client.query<WorkflowJobRow>(
      `SELECT job_key, schedule_key, kind, status, account_keys, item_limit, attempts, max_attempts,
              next_attempt_at, created_at, updated_at, locked_at, locked_by, run_key, last_error,
              workflow_key, trigger_mode, input_payload
       FROM workflow_jobs
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 250`,
      [organizationId],
    );
    return result.rows.map(mapWorkflowJobRow);
  }

  private async readIdempotencyUnlocked(client: PgQueryable, organizationId: string): Promise<StoredIdempotencyRecord[]> {
    const result = await client.query<IdempotencyRow>(
      `SELECT scope, key, request_hash, status_code, response_json, created_at
       FROM idempotency_keys
       WHERE organization_id = $1 AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 250`,
      [organizationId],
    );
    return result.rows.map((row) => ({
      scope: row.scope,
      key: row.key,
      requestHash: row.request_hash,
      statusCode: row.status_code,
      response: row.response_json,
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    }));
  }

  private async replaceStoreUnlocked(client: PgQueryable, organizationId: string, store: DataStore): Promise<void> {
    await client.query("UPDATE organizations SET name = $2 WHERE id = $1", [organizationId, this.organizationName]);
    await this.clearStoreUnlocked(client, organizationId);

    const brandIds = new Map<string, string>();
    const accountIds = new Map<string, string>();
    for (const brand of store.brands) {
      const insertedBrand = await client.query<{ id: string }>(
        `INSERT INTO brands
           (organization_id, slug, name, color, active, sac_policy, workbook_config, qa_workbook_config, resources)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)
         RETURNING id::text AS id`,
        [
          organizationId,
          brand.id,
          brand.name,
          brand.color,
          brand.active,
          brand.sacPolicy ? JSON.stringify(brand.sacPolicy) : null,
          brand.workbook ? JSON.stringify(brand.workbook) : null,
          brand.qaWorkbook ? JSON.stringify(brand.qaWorkbook) : null,
          JSON.stringify(brand.resources ?? []),
        ],
      );
      const brandUuid = insertedBrand.rows[0]?.id;
      if (!brandUuid) throw new Error(`No se pudo persistir la marca ${brand.id}.`);
      brandIds.set(brand.id, brandUuid);

      const accountFingerprint = brand.account.metricool
        ? fingerprint(brand.account.metricool, this.encryptionKey)
        : null;
      const insertedAccount = await client.query<{ id: string }>(
        `INSERT INTO social_accounts
           (organization_id, brand_id, provider, handle, display_name, active, metricool_source,
            metricool_reference_fingerprint, account_key, channels)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id::text AS id`,
        [
          organizationId,
          brandUuid,
          primaryProvider(brand.account.channels),
          brand.account.handle,
          brand.account.name,
          brand.account.active,
          brand.account.metricool ? "stored" : "none",
          accountFingerprint,
          brand.account.id,
          brand.account.channels,
        ],
      );
      const accountUuid = insertedAccount.rows[0]?.id;
      if (!accountUuid) throw new Error(`No se pudo persistir la cuenta ${brand.account.id}.`);
      accountIds.set(brand.account.id, accountUuid);

      if (brand.account.metricool && accountFingerprint) {
        await client.query(
          `INSERT INTO metricool_account_refs
             (social_account_id, organization_id, encrypted_user_id, encrypted_blog_id, key_version, fingerprint, instagram_provider)
           VALUES ($1, $2, pgp_sym_encrypt($3, $6), pgp_sym_encrypt($4, $6), $7, $5, $8)`,
          [
            accountUuid,
            organizationId,
            brand.account.metricool.userId,
            brand.account.metricool.blogId,
            accountFingerprint,
            this.encryptionKey,
            "v1",
            brand.account.metricool.instagramProvider || "INSTAGRAMBUSINESS",
          ],
        );
      }
    }

    const workflowId = await this.insertWorkflowUnlocked(client, organizationId, store.workflow, accountIds);
    await this.insertWorkflowVersionsUnlocked(client, organizationId, workflowId, store.workflowVersions);
    const interactionIds = await this.insertInteractionsUnlocked(client, organizationId, store.interactions, brandIds, accountIds);
    await this.insertReplyDeliveriesUnlocked(client, organizationId, store.deliveries ?? [], interactionIds);
    await this.insertRunsUnlocked(client, organizationId, store.runs);
    await this.insertJobsUnlocked(client, organizationId, store.jobs);
    await this.insertIdempotencyUnlocked(client, organizationId, store.idempotency);
    await client.query(
      `INSERT INTO automation_platform_states (organization_id, state, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (organization_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [organizationId, JSON.stringify(store.automation)],
    );
  }

  private async clearStoreUnlocked(client: PgQueryable, organizationId: string): Promise<void> {
    const tables = [
      "export_jobs",
      "idempotency_keys",
      "audit_events",
      "sync_run_items",
      "sync_runs",
      "replies",
      "interactions",
      "workflow_account_allowlist",
      "workflow_versions",
      "workflow_jobs",
      "workflow_edges",
      "workflow_nodes",
      "workflow_configs",
      "metricool_account_refs",
      "social_accounts",
      "brands",
      "automation_platform_states",
    ];
    for (const table of tables) {
      await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [organizationId]);
    }
  }

  private async insertWorkflowUnlocked(
    client: PgQueryable,
    organizationId: string,
    workflow: Workflow,
    accountIds: Map<string, string>,
  ): Promise<string> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO workflow_configs
         (organization_id, workflow_key, name, enabled, poll_interval_minutes, auto_reply_enabled,
          minimum_confidence, require_human_for, business_hours_only, version, published_version,
          published_at, published_by, updated_at, last_run_at, last_run_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id::text AS id`,
      [
        organizationId,
        workflow.id,
        workflow.name,
        workflow.enabled,
        workflow.pollIntervalMinutes,
        workflow.autoReplyEnabled,
        workflow.minimumConfidence,
        workflow.requireHumanFor,
        workflow.businessHoursOnly,
        workflow.version,
        workflow.publishedVersion,
        workflow.publishedAt ?? null,
        workflow.publishedBy ?? null,
        workflow.updatedAt,
        workflow.lastRunAt ?? null,
        workflow.lastRunStatus ?? null,
      ],
    );
    const workflowUuid = inserted.rows[0]?.id;
    if (!workflowUuid) throw new Error(`No se pudo persistir el workflow ${workflow.id}.`);

    for (const accountId of workflow.autoReplyAccountIds) {
      const accountUuid = accountIds.get(accountId);
      if (!accountUuid) continue;
      await client.query(
        `INSERT INTO workflow_account_allowlist (organization_id, workflow_id, social_account_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [organizationId, workflowUuid, accountUuid],
      );
    }

    for (const node of workflow.nodes) {
      await client.query(
        `INSERT INTO workflow_nodes
           (organization_id, workflow_id, node_key, type, label, enabled, position_x, position_y, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          organizationId,
          workflowUuid,
          node.id,
          node.type,
          node.label,
          node.enabled,
          node.position.x,
          node.position.y,
          JSON.stringify(node.config),
        ],
      );
    }

    for (const edge of workflow.edges) {
      await client.query(
        `INSERT INTO workflow_edges
           (organization_id, workflow_id, edge_key, source_node_key, target_node_key, label, connector_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [organizationId, workflowUuid, edge.id, edge.source, edge.target, edge.label ?? null, edge.connectorType ?? "smoothstep"],
      );
    }

    return workflowUuid;
  }

  private async insertWorkflowVersionsUnlocked(
    client: PgQueryable,
    organizationId: string,
    workflowId: string,
    versions: WorkflowVersion[],
  ): Promise<void> {
    for (const version of versions.slice(0, 50)) {
      await client.query(
        `INSERT INTO workflow_versions
           (organization_id, workflow_id, version, status, snapshot, created_at, created_by, change_note)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
        [
          organizationId,
          workflowId,
          version.version,
          version.status,
          JSON.stringify(version.snapshot),
          version.createdAt,
          version.createdBy,
          version.changeNote ?? null,
        ],
      );
    }
  }

  private async insertInteractionsUnlocked(
    client: PgQueryable,
    organizationId: string,
    interactions: Interaction[],
    brandIds: Map<string, string>,
    accountIds: Map<string, string>,
  ): Promise<Map<string, string>> {
    const interactionIds = new Map<string, string>();
    for (const interaction of interactions) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO interactions
           (organization_id, brand_id, social_account_id, interaction_key, external_id, provider, kind,
            direction, customer_name, customer_handle, body_text, category, sentiment, confidence,
            status, source, version, received_at, responded_at, metricool_ref, response_text, audit_trail,
            assigned_to_user_id, assigned_to_display_name, internal_notes, updated_at, status_reason,
            automation_assessment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, $18, $19, $20::jsonb, $21, $22::jsonb, $23, $24, $25::jsonb, $26, $27::jsonb,
                 $28::jsonb)
         RETURNING id::text AS id`,
        [
          organizationId,
          requireMapValue(brandIds, interaction.brandId, "interacción"),
          requireMapValue(accountIds, interaction.accountId, "interacción"),
          interaction.id,
          interaction.externalId,
          interaction.channel,
          interaction.type,
          interaction.direction,
          interaction.customerName,
          interaction.customerHandle,
          interaction.text,
          interaction.category,
          interaction.sentiment,
          interaction.confidence,
          interaction.status,
          interaction.source,
          interaction.version || 1,
          interaction.createdAt,
          interaction.respondedAt ?? null,
          JSON.stringify(interaction.metricoolRef ?? {}),
          interaction.responseText ?? null,
          JSON.stringify(interaction.audit),
          interaction.assignedTo?.userId ?? null,
          interaction.assignedTo?.displayName ?? null,
          JSON.stringify(interaction.internalNotes ?? []),
          interaction.updatedAt,
          interaction.statusReason ? JSON.stringify(interaction.statusReason) : null,
          interaction.automation ? JSON.stringify(interaction.automation) : null,
        ],
      );
      const interactionUuid = inserted.rows[0]?.id;
      if (!interactionUuid) throw new Error(`No se pudo persistir la interacción ${interaction.id}.`);
      interactionIds.set(interaction.id, interactionUuid);
    }
    return interactionIds;
  }

  private async insertReplyDeliveriesUnlocked(
    client: PgQueryable,
    organizationId: string,
    deliveries: ReplyDelivery[],
    interactionIds: Map<string, string>,
  ): Promise<void> {
    for (const delivery of deliveries.slice(0, 2_000)) {
      const interactionId = interactionIds.get(delivery.interactionId);
      if (!interactionId) continue;
      await client.query(
        `INSERT INTO replies
           (id, organization_id, interaction_id, mode, body_text, delivery_status, idempotency_key,
            provider_response_ref, error_code, created_at, sent_at, approved_by_human, requested_by,
            request_id, version, attempt_count, updated_at, last_attempt_at, lease_expires_at,
            next_attempt_at, reconciled_at, reconciled_by, reconciliation_note)
         VALUES ($1, $2, $3, 'send', $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13,
                 $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22)
         ON CONFLICT DO NOTHING`,
        [
          delivery.id,
          organizationId,
          interactionId,
          delivery.bodyText,
          delivery.status,
          delivery.idempotencyKey,
          delivery.providerResponseRef ?? null,
          delivery.errorCode ?? null,
          delivery.createdAt,
          delivery.sentAt ?? null,
          delivery.approvedByHuman,
          JSON.stringify(delivery.requestedBy),
          delivery.requestId,
          delivery.version,
          delivery.attemptCount,
          delivery.updatedAt,
          delivery.lastAttemptAt ?? null,
          delivery.leaseExpiresAt ?? null,
          delivery.nextAttemptAt ?? null,
          delivery.reconciledAt ?? null,
          delivery.reconciledBy ? JSON.stringify(delivery.reconciledBy) : null,
          delivery.reconciliationNote ?? null,
        ],
      );
    }
  }

  private async insertRunsUnlocked(
    client: PgQueryable,
    organizationId: string,
    runs: WorkflowRun[],
  ): Promise<void> {
    for (const run of runs.slice(0, 100)) {
      await client.query(
        `INSERT INTO sync_runs
           (organization_id, run_key, kind, status, workflow_version, requested_by, retry_of,
            started_at, finished_at, demo_mode, account_keys, totals, audit_trail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)`,
        [
          organizationId,
          run.id,
          run.kind,
          run.status,
          run.workflowVersion,
          run.requestedBy ?? null,
          run.retryOf ?? null,
          run.startedAt,
          run.finishedAt,
          run.demoMode,
          run.accountIds,
          JSON.stringify(run.totals),
          JSON.stringify(run.auditTrail),
        ],
      );
    }
  }

  private async insertJobsUnlocked(
    client: PgQueryable,
    organizationId: string,
    jobs: WorkflowJob[],
  ): Promise<void> {
    for (const job of jobs.slice(0, 250)) {
      await client.query(
        `INSERT INTO workflow_jobs
           (organization_id, job_key, schedule_key, kind, status, account_keys, item_limit,
            attempts, max_attempts, next_attempt_at, created_at, updated_at, locked_at,
            locked_by, run_key, last_error, workflow_key, trigger_mode, input_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)`,
        [
          organizationId,
          job.id,
          job.scheduleKey,
          job.kind,
          job.status,
          job.accountIds,
          job.limit,
          job.attempts,
          job.maxAttempts,
          job.nextAttemptAt,
          job.createdAt,
          job.updatedAt,
          job.lockedAt ?? null,
          job.lockedBy ?? null,
          job.runId ?? null,
          job.lastError?.slice(0, 1_000) ?? null,
          job.workflowId ?? null,
          job.triggerMode ?? null,
          JSON.stringify(job.input ?? []),
        ],
      );
    }
  }

  private async insertIdempotencyUnlocked(
    client: PgQueryable,
    organizationId: string,
    idempotency: StoredIdempotencyRecord[],
  ): Promise<void> {
    for (const record of idempotency.slice(0, 250)) {
      await client.query(
        `INSERT INTO idempotency_keys
           (organization_id, scope, key, request_hash, status_code, response_json, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         ON CONFLICT DO NOTHING`,
        [
          organizationId,
          record.scope,
          record.key,
          record.requestHash,
          record.statusCode,
          JSON.stringify(record.response),
          record.createdAt,
          expiresAt(record),
        ],
      );
    }
  }
}
