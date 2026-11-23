import type {
  AccessRole,
  Brand,
  CatalogStore,
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
  UserAccessRecord,
  StoreRecordCounts,
  StoredIdempotencyRecord,
  Workflow,
  WorkflowRun,
  WorkflowJob,
} from "./types.js";
import type { AutomationState } from "./automation-types.js";
import type { AccessRoleRecord, Permission } from "./permissions.js";

export interface SacFlowRepository {
  initialize(): Promise<void>;
  /**
   * Store completo, incluidas todas las interacciones. Úsese solo cuando la ruta necesita
   * de verdad las interacciones; para marcas/workflow existe `snapshotCatalog()`.
   */
  snapshot(): Promise<DataStore>;
  /** Marcas/cuentas, workflow y versiones del workflow, sin leer interacciones. */
  snapshotCatalog(): Promise<CatalogStore>;
  snapshotAutomation(): Promise<AutomationState>;
  /**
   * Mutación genérica del store completo. En PostgreSQL solo persiste las filas que la
   * operación cambió, pero aun así lee todo el store: prefiera `mutateCatalog()` o los
   * métodos específicos de interacciones, entregas, jobs e idempotencia.
   */
  mutate<T>(operation: (store: DataStore) => T | Promise<T>): Promise<T>;
  /**
   * Modifica marcas/cuentas, workflow y versiones sin leer ni reescribir interacciones.
   * Las marcas no se eliminan por esta vía (desactivar = `active: false`); quitar una
   * marca del arreglo es un error, porque en PostgreSQL arrastraría sus interacciones.
   */
  mutateCatalog<T>(operation: (catalog: CatalogStore) => T | Promise<T>): Promise<T>;
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
  /** Actualiza una sola interacción; el callback recibe la configuración, no el store completo. */
  updateInteraction(
    id: string,
    update: (interaction: Interaction, catalog: CatalogStore) => void,
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
  /** Últimas ejecuciones (máximo 100), de la más reciente a la más antigua. */
  listRuns(): Promise<WorkflowRun[]>;
  /** Conteos de marcas, interacciones y entregas sin materializar las filas. */
  countRecords(): Promise<StoreRecordCounts>;
  enqueueJob(job: WorkflowJob): Promise<boolean>;
  claimNextJob(workerId: string, staleLeaseMs: number): Promise<WorkflowJob | undefined>;
  completeJob(jobId: string, workerId: string, runId?: string): Promise<boolean>;
  failJob(jobId: string, workerId: string, error: string, backoffMs: number): Promise<boolean>;
  listJobs(status?: WorkflowJob["status"]): Promise<WorkflowJob[]>;
  retryJob(jobId: string): Promise<WorkflowJob | undefined>;
  claimIdempotency(record: StoredIdempotencyRecord): Promise<StoredIdempotencyRecord | undefined>;
  saveIdempotency(record: StoredIdempotencyRecord): Promise<void>;
  stats(filters?: InteractionFilters): Promise<InteractionStats>;
  /** Personas con rol asignado desde la app o que ya ingresaron, ordenadas por correo. */
  listUserAccess(): Promise<UserAccessRecord[]>;
  /**
   * Asigna (o con `null` quita) el rol de una persona. Conserva su último ingreso; un
   * registro sin rol ni ingreso se elimina.
   */
  setUserAccessRole(input: SetUserAccessRoleInput): Promise<UserAccessRecord | undefined>;
  /**
   * Guarda los ajustes personales de permisos de una persona (agregados y quitados respecto
   * de su rol). Listas vacías los quitan; un registro sin rol, ingreso ni ajustes se elimina.
   */
  setUserPermissionOverrides(input: SetUserPermissionOverridesInput): Promise<UserAccessRecord | undefined>;
  /**
   * Guarda los clientes ocultos para una persona (solo admin principal). Lista vacía los quita;
   * un registro sin rol, ingreso, ajustes ni clientes ocultos se elimina.
   */
  setUserHiddenBrands(input: SetUserHiddenBrandsInput): Promise<UserAccessRecord | undefined>;
  /** Registra un inicio de sesión exitoso (nombre y fecha). */
  recordUserSignIn(input: { email: string; name: string | null; at: string }): Promise<void>;
  /** Ajustes de roles de base y roles propios guardados. */
  listAccessRoles(): Promise<AccessRoleRecord[]>;
  /** Crea o reemplaza un rol guardado. */
  saveAccessRole(record: AccessRoleRecord): Promise<AccessRoleRecord>;
  /** Elimina un rol guardado (un rol propio o el ajuste de un rol de base). */
  deleteAccessRole(id: string): Promise<boolean>;
}

export interface SetUserPermissionOverridesInput {
  email: string;
  name?: string | null;
  add: Permission[];
  remove: Permission[];
  updatedBy: string;
  at: string;
}

export interface SetUserHiddenBrandsInput {
  email: string;
  name?: string | null;
  brandIds: string[];
  updatedBy: string;
  at: string;
}

export interface SetUserAccessRoleInput {
  email: string;
  name?: string | null;
  role: AccessRole | null;
  assignedBy: string;
  at: string;
}
