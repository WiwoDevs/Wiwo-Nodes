import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createDemoStore } from "./seed.js";
import { createDemoAutomationState } from "./automation-seed.js";
import type { SacFlowRepository } from "./repository-contract.js";
import type {
  Brand,
  DataStore,
  DeferReplyDeliveryInput,
  Interaction,
  InteractionFilters,
  InteractionStats,
  PrepareReplyDeliveryInput,
  PublicBrand,
  PublicMetricoolAccountState,
  ReconcileReplyDeliveryInput,
  ReplyDelivery,
  ReplyDeliveryFilters,
  MetricoolAccountReference,
  SettleReplyDeliveryInput,
  StoredIdempotencyRecord,
  Workflow,
  WorkflowRun,
  WorkflowJob,
  WorkflowVersion,
} from "./types.js";
import { CHANNELS } from "./types.js";
import { ensureMetricoolInboxCoverage } from "./workflow-coverage.js";
import { mergeMissingMetricoolRef } from "./workflow-service.js";
import {
  metricoolContentForDisplay,
  shouldReplaceMetricoolContent,
} from "./metricool-content.js";

const persistedStoreSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  brands: z.array(z.object({ id: z.string() }).passthrough()),
  interactions: z.array(z.object({ id: z.string(), externalId: z.string() }).passthrough()),
  deliveries: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  workflow: z.object({ id: z.string() }).passthrough(),
  workflowVersions: z.array(z.object({ id: z.string(), version: z.number() }).passthrough()).optional(),
  runs: z.array(z.object({ id: z.string() }).passthrough()),
  jobs: z.array(z.object({ id: z.string(), scheduleKey: z.string() }).passthrough()).optional(),
  idempotency: z.array(z.object({ key: z.string(), scope: z.string() }).passthrough()),
  automation: z.object({
    projects: z.array(z.object({ id: z.string() }).passthrough()),
    folders: z.array(z.object({ id: z.string() }).passthrough()),
    tags: z.array(z.object({ id: z.string() }).passthrough()),
    credentials: z.array(z.object({ id: z.string() }).passthrough()),
    variables: z.array(z.object({ id: z.string() }).passthrough()),
    workflows: z.array(z.object({ id: z.string() }).passthrough()),
    workflowVersions: z.array(z.object({ id: z.string() }).passthrough()),
    executions: z.array(z.object({ id: z.string() }).passthrough()),
  }).passthrough().optional(),
}).passthrough();

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeInteractionState(interaction: Interaction): Interaction {
  interaction.version = Number.isInteger(interaction.version) && interaction.version > 0
    ? interaction.version
    : 1;
  interaction.internalNotes = Array.isArray(interaction.internalNotes) ? interaction.internalNotes : [];
  return interaction;
}

function normalizeWorkflowState(store: DataStore): void {
  ensureMetricoolInboxCoverage(store.workflow);
  store.workflow.version = Number.isInteger(store.workflow.version) && store.workflow.version > 0
    ? store.workflow.version
    : 1;
  store.workflow.publishedVersion = Number.isInteger(store.workflow.publishedVersion)
    && store.workflow.publishedVersion > 0
    ? store.workflow.publishedVersion
    : store.workflow.version;
  store.workflowVersions = Array.isArray(store.workflowVersions)
    ? store.workflowVersions
    : [];
  if (store.workflowVersions.length === 0) {
    const initial: WorkflowVersion = {
      id: `${store.workflow.id}-v${store.workflow.version}`,
      workflowId: store.workflow.id,
      version: store.workflow.version,
      status: store.workflow.version === store.workflow.publishedVersion ? "published" : "draft",
      snapshot: clone(store.workflow),
      createdAt: store.workflow.updatedAt,
      createdBy: "migration",
      changeNote: "Versión importada desde almacenamiento anterior.",
    };
    store.workflowVersions = [initial];
  }
}

function normalizeDemoSacPolicies(store: DataStore): void {
  const demoById = new Map(createDemoStore(new Date(store.createdAt)).brands.map((brand) => [brand.id, brand]));
  for (const brand of store.brands) {
    if (brand.sacPolicy) continue;
    const demo = demoById.get(brand.id);
    if (demo?.name === brand.name && demo.account.id === brand.account.id) {
      brand.sacPolicy = demo.sacPolicy;
    }
  }
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

export class JsonRepository implements SacFlowRepository {
  readonly filePath: string;
  private tail: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readUnlocked(): Promise<DataStore> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const decoded: unknown = JSON.parse(raw);
      const parsed = persistedStoreSchema.safeParse(decoded);
      if (!parsed.success) {
        throw new Error("El archivo de datos local tiene una estructura incompatible.");
      }
      const store = decoded as DataStore;
      store.interactions.forEach(normalizeInteractionState);
      normalizeWorkflowState(store);
      normalizeDemoSacPolicies(store);
      store.deliveries = Array.isArray(store.deliveries) ? store.deliveries : [];
      store.jobs = Array.isArray(store.jobs) ? store.jobs : [];
      store.automation = store.automation || createDemoAutomationState(new Date(store.createdAt));
      return store;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      const initial = createDemoStore();
      await this.writeUnlocked(initial);
      return initial;
    }
  }

  private async writeUnlocked(store: DataStore): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = path.join(
      path.dirname(this.filePath),
      `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporary, this.filePath);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async initialize(): Promise<void> {
    await this.exclusive(async () => {
      await this.readUnlocked();
    });
  }

  async snapshot(): Promise<DataStore> {
    return this.exclusive(async () => {
      const snapshot = clone(await this.readUnlocked());
      for (const interaction of snapshot.interactions) {
        interaction.text = metricoolContentForDisplay(interaction.text);
      }
      return snapshot;
    });
  }

  async snapshotAutomation(): Promise<DataStore["automation"]> {
    return (await this.snapshot()).automation;
  }

  async mutate<T>(operation: (store: DataStore) => T | Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const store = await this.readUnlocked();
      const result = await operation(store);
      store.updatedAt = new Date().toISOString();
      await this.writeUnlocked(store);
      return clone(result);
    });
  }

  async mutateAutomation<T>(operation: (state: DataStore["automation"]) => T | Promise<T>): Promise<T> {
    return this.mutate((store) => operation(store.automation));
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
    const interaction = await this.mutate((store) => {
      const interaction = store.interactions.find((item) => item.id === id);
      if (!interaction) return undefined;
      normalizeInteractionState(interaction);
      update(interaction, store);
      interaction.updatedAt = new Date().toISOString();
      interaction.version += 1;
      return interaction;
    });
    if (interaction) interaction.text = metricoolContentForDisplay(interaction.text);
    return interaction;
  }

  async mutateInteractions<T>(
    _ids: string[],
    operation: (store: DataStore) => T | Promise<T>,
  ): Promise<T> {
    return this.mutate(operation);
  }

  async insertInteractions(incoming: Interaction[]): Promise<{ created: Interaction[]; duplicates: number }> {
    return this.mutate((store) => {
      const existingByKey = new Map(
        store.interactions.map((item) => [`${item.accountId}:${item.type}:${item.externalId}`, item]),
      );
      const created: Interaction[] = [];
      let duplicates = 0;
      for (const interaction of incoming) {
        normalizeInteractionState(interaction);
        const key = `${interaction.accountId}:${interaction.type}:${interaction.externalId}`;
        const existing = existingByKey.get(key);
        if (existing) {
          const enriched = mergeMissingMetricoolRef(existing.metricoolRef, interaction.metricoolRef);
          if (enriched.changed) existing.metricoolRef = enriched.value;
          if (shouldReplaceMetricoolContent(existing.text, interaction.text)) {
            existing.text = interaction.text;
          }
          duplicates += 1;
          continue;
        }
        existingByKey.set(key, interaction);
        store.interactions.push(interaction);
        created.push(interaction);
      }
      return { created, duplicates };
    });
  }

  async prepareReplyDelivery(input: PrepareReplyDeliveryInput): Promise<{ delivery: ReplyDelivery; created: boolean }> {
    return this.mutate((store) => {
      const existing = store.deliveries.find((item) => item.idempotencyKey === input.idempotencyKey);
      if (existing) return { delivery: existing, created: false };
      const active = store.deliveries.find((item) =>
        item.interactionId === input.interactionId
        && ["pending", "sending", "uncertain"].includes(item.status));
      if (active) return { delivery: active, created: false };
      const delivery: ReplyDelivery = {
        ...input,
        status: "pending",
        version: 1,
        attemptCount: 0,
        updatedAt: input.createdAt,
      };
      store.deliveries.unshift(delivery);
      store.deliveries = store.deliveries.slice(0, 2_000);
      return { delivery, created: true };
    });
  }

  async prepareAutoReplyDelivery(
    input: PrepareReplyDeliveryInput,
    maxPending: number,
  ): Promise<{ delivery?: ReplyDelivery; created: boolean; capacityReached: boolean }> {
    return this.mutate((store) => {
      const existing = store.deliveries.find((item) => item.idempotencyKey === input.idempotencyKey);
      if (existing) return { delivery: existing, created: false, capacityReached: false };
      const active = store.deliveries.find((item) =>
        item.interactionId === input.interactionId
        && ["pending", "sending", "uncertain"].includes(item.status));
      if (active) return { delivery: active, created: false, capacityReached: false };
      const safeMaxPending = Math.min(2_000, Math.max(1, Math.trunc(maxPending)));
      const pendingAutomatic = store.deliveries.filter((item) =>
        item.status === "pending"
        && !item.approvedByHuman
        && item.idempotencyKey.startsWith("auto-reply:")).length;
      if (pendingAutomatic >= safeMaxPending) {
        return { created: false, capacityReached: true };
      }
      const delivery: ReplyDelivery = {
        ...input,
        status: "pending",
        version: 1,
        attemptCount: 0,
        updatedAt: input.createdAt,
      };
      store.deliveries.unshift(delivery);
      store.deliveries = store.deliveries.slice(0, 2_000);
      return { delivery, created: true, capacityReached: false };
    });
  }

  async claimReplyDelivery(id: string, leaseMs: number): Promise<ReplyDelivery | undefined> {
    return this.mutate((store) => {
      const delivery = store.deliveries.find((item) => item.id === id);
      if (!delivery || delivery.status !== "pending") return undefined;
      const now = new Date();
      if (delivery.nextAttemptAt && Date.parse(delivery.nextAttemptAt) > now.getTime()) return undefined;
      const accountBlocked = store.deliveries.some((item) =>
        item.id !== delivery.id
        && item.accountId === delivery.accountId
        && ["sending", "uncertain"].includes(item.status));
      if (accountBlocked) return undefined;
      delivery.status = "sending";
      delivery.attemptCount += 1;
      delivery.lastAttemptAt = now.toISOString();
      delivery.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      delivery.nextAttemptAt = undefined;
      delivery.updatedAt = now.toISOString();
      delivery.version += 1;
      return delivery;
    });
  }

  async settleReplyDelivery(
    id: string,
    input: SettleReplyDeliveryInput,
  ): Promise<{ delivery: ReplyDelivery; interaction?: Interaction } | undefined> {
    const settled = await this.mutate((store) => {
      const delivery = store.deliveries.find((item) => item.id === id);
      const allowedStatus = input.status === "demo_simulated" ? "pending" : "sending";
      if (!delivery || delivery.status !== allowedStatus) return undefined;
      delivery.status = input.status;
      delivery.updatedAt = input.at;
      delivery.leaseExpiresAt = undefined;
      delivery.nextAttemptAt = undefined;
      delivery.providerResponseRef = input.providerResponseRef;
      delivery.errorCode = input.errorCode;
      delivery.sentAt = input.status === "sent" || input.status === "demo_simulated" ? input.at : undefined;
      delivery.version += 1;
      const interaction = store.interactions.find((item) => item.id === delivery.interactionId);
      if (interaction && (input.status === "sent" || input.status === "demo_simulated")) {
        interaction.responseText = delivery.bodyText;
        interaction.status = "replied";
        interaction.respondedAt = input.at;
        interaction.updatedAt = input.at;
        interaction.version += 1;
        interaction.audit.push({
          id: randomUUID(),
          at: input.at,
          action: "reply_sent",
          actor: delivery.approvedByHuman ? "agent" : "workflow",
          detail: input.status === "demo_simulated"
            ? "Envío simulado; no se contactó a Metricool."
            : "Respuesta enviada mediante Metricool.",
          metadata: {
            deliveryId: delivery.id,
            demoMode: input.status === "demo_simulated",
            approvedByHuman: delivery.approvedByHuman,
          },
        });
      } else if (interaction && (input.status === "failed" || input.status === "uncertain")
        && !["replied", "resolved"].includes(interaction.status)) {
        interaction.responseText = delivery.bodyText;
        if (["new", "pending", "drafted"].includes(interaction.status)) interaction.status = "drafted";
        interaction.updatedAt = input.at;
        interaction.version += 1;
        interaction.audit.push({
          id: randomUUID(),
          at: input.at,
          action: "draft_created",
          actor: delivery.approvedByHuman ? "agent" : "workflow",
          detail: "Texto conservado como borrador tras un envío no confirmado.",
          metadata: {
            deliveryId: delivery.id,
            deliveryStatus: input.status,
            ...(input.errorCode ? { errorCode: input.errorCode } : {}),
          },
        });
      }
      return { delivery, interaction };
    });
    if (settled?.interaction) {
      settled.interaction.text = metricoolContentForDisplay(settled.interaction.text);
    }
    return settled;
  }

  async deferReplyDelivery(id: string, input: DeferReplyDeliveryInput): Promise<ReplyDelivery | undefined> {
    return this.mutate((store) => {
      const delivery = store.deliveries.find((item) => item.id === id);
      if (!delivery || delivery.status !== "sending") return undefined;
      delivery.status = "pending";
      delivery.errorCode = input.errorCode;
      delivery.nextAttemptAt = input.nextAttemptAt;
      delivery.leaseExpiresAt = undefined;
      delivery.updatedAt = input.at;
      delivery.version += 1;
      return delivery;
    });
  }

  async reconcileReplyDelivery(
    id: string,
    input: ReconcileReplyDeliveryInput,
  ): Promise<{ delivery: ReplyDelivery; interaction?: Interaction } | undefined> {
    const reconciled = await this.mutate((store) => {
      const delivery = store.deliveries.find((item) => item.id === id);
      if (!delivery || delivery.status !== "uncertain" || delivery.version !== input.expectedVersion) return undefined;
      delivery.status = input.outcome;
      delivery.updatedAt = input.at;
      delivery.reconciledAt = input.at;
      delivery.reconciledBy = input.actor;
      delivery.reconciliationNote = input.note;
      delivery.nextAttemptAt = undefined;
      delivery.errorCode = input.outcome === "sent" ? undefined : delivery.errorCode;
      delivery.sentAt = input.outcome === "sent" ? input.at : delivery.sentAt;
      delivery.version += 1;
      const interaction = store.interactions.find((item) => item.id === delivery.interactionId);
      if (interaction) {
        if (input.outcome === "sent") {
          interaction.responseText = delivery.bodyText;
          interaction.status = "replied";
          interaction.respondedAt = input.at;
        }
        interaction.updatedAt = input.at;
        interaction.version += 1;
        interaction.audit.push({
          id: randomUUID(),
          at: input.at,
          action: "delivery_reconciled",
          actor: "agent",
          detail: `Entrega conciliada manualmente como ${input.outcome}.`,
          metadata: { deliveryId: delivery.id, outcome: input.outcome, reconciledBy: input.actor.userId },
        });
      }
      return { delivery, interaction };
    });
    if (reconciled?.interaction) {
      reconciled.interaction.text = metricoolContentForDisplay(reconciled.interaction.text);
    }
    return reconciled;
  }

  async recoverStaleReplyDeliveries(at = new Date().toISOString()): Promise<number> {
    return this.mutate((store) => {
      const cutoff = Date.parse(at);
      let recovered = 0;
      for (const delivery of store.deliveries) {
        if (delivery.status !== "sending" || !delivery.leaseExpiresAt) continue;
        if (Date.parse(delivery.leaseExpiresAt) > cutoff) continue;
        delivery.status = "uncertain";
        delivery.errorCode = "DELIVERY_LEASE_EXPIRED";
        delivery.leaseExpiresAt = undefined;
        delivery.nextAttemptAt = undefined;
        delivery.updatedAt = at;
        delivery.version += 1;
        recovered += 1;
      }
      return recovered;
    });
  }

  async findReplyDelivery(id: string): Promise<ReplyDelivery | undefined> {
    return (await this.snapshot()).deliveries.find((item) => item.id === id);
  }

  async listReplyDeliveries(filters: ReplyDeliveryFilters = {}): Promise<ReplyDelivery[]> {
    const limit = Math.min(2_000, Math.max(1, Math.trunc(filters.limit ?? 500)));
    return (await this.snapshot()).deliveries
      .filter((item) => !filters.interactionId || item.interactionId === filters.interactionId)
      .filter((item) => !filters.accountId || item.accountId === filters.accountId)
      .filter((item) => !filters.status || item.status === filters.status)
      .filter((item) => !filters.automaticOnly || (
        item.idempotencyKey.startsWith("auto-reply:") && !item.approvedByHuman
      ))
      .filter((item) => !filters.brandIds || filters.brandIds.includes(item.brandId))
      .sort((left, right) => filters.oldestFirst
        ? Date.parse(left.createdAt) - Date.parse(right.createdAt)
        : Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit);
  }

  async getWorkflow(): Promise<Workflow> {
    return (await this.snapshot()).workflow;
  }

  async getSchedulerState(): Promise<{ workflowId: string; enabled: boolean; pollIntervalMinutes: number; accountIds: string[] }> {
    const store = await this.snapshot();
    return {
      workflowId: store.workflow.id,
      enabled: store.workflow.enabled,
      pollIntervalMinutes: Math.max(5, store.workflow.pollIntervalMinutes),
      accountIds: store.brands
        .filter((brand) => brand.active && brand.account.active)
        .map((brand) => brand.account.id),
    };
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
    return this.mutate((store) => {
      store.runs.unshift(run);
      store.runs = store.runs.slice(0, 100);
      store.workflow.lastRunAt = run.finishedAt;
      store.workflow.lastRunStatus = run.status;
      store.workflow.updatedAt = run.finishedAt;
      return run;
    });
  }

  async enqueueJob(job: WorkflowJob): Promise<boolean> {
    return this.mutate((store) => {
      if (store.jobs.some((item) => item.scheduleKey === job.scheduleKey)) return false;
      store.jobs.unshift(job);
      store.jobs = store.jobs.slice(0, 250);
      return true;
    });
  }

  async claimNextJob(workerId: string, staleLeaseMs: number): Promise<WorkflowJob | undefined> {
    return this.mutate((store) => {
      const now = Date.now();
      for (const job of store.jobs) {
        if (job.status === "running" && job.lockedAt && Date.parse(job.lockedAt) < now - staleLeaseMs) {
          job.status = job.attempts >= job.maxAttempts ? "dead" : "retry";
          job.nextAttemptAt = new Date(now).toISOString();
          job.updatedAt = new Date(now).toISOString();
          job.lastError = "Lease del worker expirada; trabajo recuperado automáticamente.";
          delete job.lockedAt;
          delete job.lockedBy;
        }
      }
      const job = store.jobs.find((candidate) =>
        ["queued", "retry"].includes(candidate.status) && Date.parse(candidate.nextAttemptAt) <= now,
      );
      if (!job) return undefined;
      job.status = "running";
      job.attempts += 1;
      job.lockedAt = new Date(now).toISOString();
      job.lockedBy = workerId;
      job.updatedAt = new Date(now).toISOString();
      return job;
    });
  }

  async completeJob(jobId: string, workerId: string, runId?: string): Promise<boolean> {
    return this.mutate((store) => {
      const job = store.jobs.find((item) => item.id === jobId && item.lockedBy === workerId && item.status === "running");
      if (!job) return false;
      job.status = "succeeded";
      job.runId = runId;
      job.updatedAt = new Date().toISOString();
      delete job.lastError;
      delete job.lockedAt;
      delete job.lockedBy;
      return true;
    });
  }

  async failJob(jobId: string, workerId: string, error: string, backoffMs: number): Promise<boolean> {
    return this.mutate((store) => {
      const job = store.jobs.find((item) => item.id === jobId && item.lockedBy === workerId && item.status === "running");
      if (!job) return false;
      job.status = job.attempts >= job.maxAttempts ? "dead" : "retry";
      job.nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();
      job.updatedAt = new Date().toISOString();
      job.lastError = error.slice(0, 1_000);
      delete job.lockedAt;
      delete job.lockedBy;
      return true;
    });
  }

  async listJobs(status?: WorkflowJob["status"]): Promise<WorkflowJob[]> {
    return (await this.snapshot()).jobs
      .filter((job) => !status || job.status === status)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 250);
  }

  async retryJob(jobId: string): Promise<WorkflowJob | undefined> {
    return this.mutate((store) => {
      const job = store.jobs.find((item) => item.id === jobId);
      if (!job || !["dead", "retry"].includes(job.status)) return undefined;
      job.status = "queued";
      job.attempts = 0;
      job.nextAttemptAt = new Date().toISOString();
      job.updatedAt = new Date().toISOString();
      delete job.lastError;
      delete job.lockedAt;
      delete job.lockedBy;
      return job;
    });
  }

  async claimIdempotency(record: StoredIdempotencyRecord): Promise<StoredIdempotencyRecord | undefined> {
    return this.mutate((store) => {
      const existing = store.idempotency.find((item) => item.scope === record.scope && item.key === record.key);
      const age = existing ? Date.now() - Date.parse(existing.createdAt) : 0;
      const reusable = existing && (age >= 7 * 24 * 60 * 60_000 || existing.statusCode === 102 && age >= 5 * 60_000);
      if (existing && !reusable) return existing;
      store.idempotency = store.idempotency.filter((item) => !(item.scope === record.scope && item.key === record.key));
      store.idempotency.unshift(record);
      store.idempotency = store.idempotency.slice(0, 250);
      return undefined;
    });
  }

  async saveIdempotency(record: StoredIdempotencyRecord): Promise<void> {
    await this.mutate((store) => {
      store.idempotency = store.idempotency.filter(
        (item) => !(item.scope === record.scope && item.key === record.key),
      );
      store.idempotency.unshift(record);
      store.idempotency = store.idempotency.slice(0, 250);
    });
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
}
