import type {
  Brand,
  DataStore,
  DeferReplyDeliveryInput,
  Interaction,
  InteractionFilters,
  InteractionStats,
  MetricoolAccountReference,
  PublicBrand,
  PublicMetricoolAccountState,
  PrepareReplyDeliveryInput,
  ReconcileReplyDeliveryInput,
  ReplyDelivery,
  ReplyDeliveryFilters,
  SettleReplyDeliveryInput,
  StoredIdempotencyRecord,
  Workflow,
  WorkflowRun,
  WorkflowJob,
} from "./types.js";
import type { AutomationState } from "./automation-types.js";

export interface SacFlowRepository {
  initialize(): Promise<void>;
  snapshot(): Promise<DataStore>;
  snapshotAutomation(): Promise<AutomationState>;
  mutate<T>(operation: (store: DataStore) => T | Promise<T>): Promise<T>;
  mutateAutomation<T>(operation: (state: AutomationState) => T | Promise<T>): Promise<T>;
  listBrands(
    metricoolState: (
      accountId: string,
      storedConfigured: boolean,
      stored?: MetricoolAccountReference,
    ) => PublicMetricoolAccountState,
  ): Promise<PublicBrand[]>;
  findBrandByAccountId(accountId: string): Promise<Brand | undefined>;
  updateAccountMetricool(accountId: string, metricool: MetricoolAccountReference): Promise<Brand | undefined>;
  clearAccountMetricool(accountId: string): Promise<Brand | undefined>;
  listInteractions(filters?: InteractionFilters): Promise<Interaction[]>;
  findInteraction(id: string): Promise<Interaction | undefined>;
  updateInteraction(
    id: string,
    update: (interaction: Interaction, store: DataStore) => void,
  ): Promise<Interaction | undefined>;
  mutateInteractions<T>(
    ids: string[],
    operation: (store: DataStore) => T | Promise<T>,
  ): Promise<T>;
  insertInteractions(incoming: Interaction[]): Promise<{ created: Interaction[]; duplicates: number }>;
  prepareReplyDelivery(input: PrepareReplyDeliveryInput): Promise<{ delivery: ReplyDelivery; created: boolean }>;
  prepareAutoReplyDelivery(
    input: PrepareReplyDeliveryInput,
    maxPending: number,
  ): Promise<{
    delivery?: ReplyDelivery;
    created: boolean;
    capacityReached: boolean;
  }>;
  claimReplyDelivery(id: string, leaseMs: number): Promise<ReplyDelivery | undefined>;
  settleReplyDelivery(
    id: string,
    input: SettleReplyDeliveryInput,
  ): Promise<{ delivery: ReplyDelivery; interaction?: Interaction } | undefined>;
  deferReplyDelivery(id: string, input: DeferReplyDeliveryInput): Promise<ReplyDelivery | undefined>;
  reconcileReplyDelivery(
    id: string,
    input: ReconcileReplyDeliveryInput,
  ): Promise<{ delivery: ReplyDelivery; interaction?: Interaction } | undefined>;
  recoverStaleReplyDeliveries(at?: string): Promise<number>;
  findReplyDelivery(id: string): Promise<ReplyDelivery | undefined>;
  listReplyDeliveries(filters?: ReplyDeliveryFilters): Promise<ReplyDelivery[]>;
  getWorkflow(): Promise<Workflow>;
  getSchedulerState(): Promise<{ workflowId: string; enabled: boolean; pollIntervalMinutes: number; accountIds: string[] }>;
  updateWorkflow(patch: Partial<Workflow>): Promise<Workflow>;
  recordRun(run: WorkflowRun): Promise<WorkflowRun>;
  enqueueJob(job: WorkflowJob): Promise<boolean>;
  claimNextJob(workerId: string, staleLeaseMs: number): Promise<WorkflowJob | undefined>;
  completeJob(jobId: string, workerId: string, runId?: string): Promise<boolean>;
  failJob(jobId: string, workerId: string, error: string, backoffMs: number): Promise<boolean>;
  listJobs(status?: WorkflowJob["status"]): Promise<WorkflowJob[]>;
  retryJob(jobId: string): Promise<WorkflowJob | undefined>;
  claimIdempotency(record: StoredIdempotencyRecord): Promise<StoredIdempotencyRecord | undefined>;
  saveIdempotency(record: StoredIdempotencyRecord): Promise<void>;
  stats(filters?: InteractionFilters): Promise<InteractionStats>;
}
