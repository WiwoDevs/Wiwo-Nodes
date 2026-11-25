import { ProfileAvatar } from "./ProfileAvatar";
import { useCallback, useMemo, useState, type FormEvent } from "react";
import {
  ArrowClockwise,
  Buildings,
  CheckCircle,
  CloudArrowDown,
  Eye,
  EyeSlash,
  FloppyDisk,
  FolderOpen,
  LinkSimple,
  MagnifyingGlass,
  PauseCircle,
  PencilSimple,
  PlayCircle,
  Plus,
  Power,
  ShieldCheck,
  Trash,
  WarningCircle,
  X,
  XCircle,
} from "@phosphor-icons/react";
import type {
  AccountHealth,
  BrandAdminInput,
  BrandAccount,
  ChannelConnection,
  SocialPlatform,
  BrandResourceKind,
  MetricoolInstagramProvider,
} from "../types";
import type { MetricoolImportResult } from "../lib/api";
import { BrandFilesPanel } from "./BrandFilesPanel";
import { MetricoolImportDialog } from "./MetricoolImportDialog";
import {
  platformLabel,
  SOCIAL_PLATFORM_OPTIONS,
  SocialPlatformIcon,
} from "./SocialPlatformIcon";
import { confirmAction } from "../lib/confirm";

/** Redes que se pueden marcar «En SAC» (también antes de conectarlas en Metricool). */
const SAC_PLATFORMS: SocialPlatform[] = ["instagram", "facebook", "tiktok", "linkedin", "x", "youtube"];
import { AccountFilter } from "./AccountFilter";
import { ClientsDashboard, type UsageScope } from "./ClientsDashboard";

type HealthFilter = AccountHealth | "all" | "inactive";

function isInactiveAccount(account: BrandAccount): boolean {
  return account.brandActive === false || account.accountActive === false;
}
type BrandDialogMode = "create" | "edit";

type BrandFormState = {
  brandId: string;
  accountId: string;
  name: string;
  accountName: string;
  accountHandle: string;
  color: string;
  active: boolean;
  accountActive: boolean;
} & Record<SocialPlatform, boolean>;

const emptyBrandForm: BrandFormState = {
  brandId: "",
  accountId: "",
  name: "",
  accountName: "",
  accountHandle: "",
  color: "#4b46f5",
  instagram: true,
  facebook: true,
  x: false,
  tiktok: false,
  youtube: false,
  linkedin: false,
  google_business: false,
  active: true,
  accountActive: true,
};

export interface AccountsViewProps {
  accounts: BrandAccount[];
  canAdmin?: boolean;
  canSync?: boolean;
  onCreateBrand?: (input: BrandAdminInput) => void | Promise<void>;
  onUpdateBrand?: (account: BrandAccount, input: BrandAdminInput) => void | Promise<void>;
  /** Admin principal: puede ocultar y volver a mostrar clientes; ve los ocultos aparte. */
  canHide?: boolean;
  onSetBrandHidden?: (account: BrandAccount, hidden: boolean) => Promise<void>;
  /** Admin principal: marca qué redes de cada cuenta se usan hoy en SAC (solo etiqueta y filtro). */
  onSetSacUsage?: (account: BrandAccount, channels: SocialPlatform[]) => Promise<void>;
  /** Importa marcas del catálogo de Metricool (solo admin). */
  onImportMetricoolBrands?: (blogIds: string[], instagramProvider: MetricoolInstagramProvider) => Promise<MetricoolImportResult>;
  /** Oculta varias marcas de una vez (p. ej. las de ejemplo sin referencia a Metricool). */
  onDeactivateBrands?: (accounts: BrandAccount[]) => Promise<void>;
  onSyncAccount?: (account: BrandAccount) => void | Promise<void>;
  onSaveMetricoolAccount?: (
    account: BrandAccount,
    credentials: {
      userId: string;
      blogId: string;
      instagramProvider: "INSTAGRAMBUSINESS" | "INSTAGRAM";
    },
  ) => void | Promise<void>;
  onDisconnectMetricoolAccount?: (account: BrandAccount) => void | Promise<void>;
  onToggleAutomation?: (account: BrandAccount, enabled: boolean) => void | Promise<void>;
  onSaveBrandWorkbook?: (account: BrandAccount, spreadsheetUrl: string) => void | Promise<void>;
  onDownloadBrandWorkbook?: (account: BrandAccount) => void | Promise<void>;
  onSaveBrandQaWorkbook?: (account: BrandAccount, spreadsheetUrl: string) => void | Promise<void>;
  onDownloadBrandQaTemplate?: (account: BrandAccount) => void | Promise<void>;
  onAddBrandResource?: (account: BrandAccount, input: { name: string; url: string; kind: BrandResourceKind }) => void | Promise<void>;
  onDeleteBrandResource?: (account: BrandAccount, resourceId: string) => void | Promise<void>;
  isSavingBrand?: boolean;
  isSavingAccount?: boolean;
  isSavingWorkbook?: boolean;
}

const formatInteger = new Intl.NumberFormat("es-CL");

function normalize(value: string) {
  return value
    .toLocaleLowerCase("es-CL")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function healthLabel(health: AccountHealth) {
  if (health === "healthy") return "Operativa";
  if (health === "attention") return "Requiere atención";
  return "Desconectada";
}

function HealthIcon({ health }: { health: AccountHealth }) {
  const props = { size: 16, weight: "fill" as const, "aria-hidden": true };
  if (health === "healthy") return <CheckCircle {...props} />;
  if (health === "attention") return <WarningCircle {...props} />;
  return <XCircle {...props} />;
}

function PlatformIcon({ platform }: { platform: SocialPlatform }) {
  return <SocialPlatformIcon platform={platform} size={16} weight="fill" aria-hidden="true" />;
}

function channelStatusLabel(channel: ChannelConnection) {
  if (channel.status === "connected") return "Conectado";
  if (channel.status === "degraded") return "Con retraso";
  return "Desconectado";
}

function metricoolSourceLabel(account: BrandAccount) {
  if (account.metricoolSource === "env") return "variables de entorno";
  if (account.metricoolSource === "fallback") return "fallback servidor";
  if (account.metricoolSource === "stored") return "backend local";
  return "sin referencia";
}

function handleFromAccount(account: BrandAccount): string {
  return account.accountHandle
    ?? account.channels.find((channel) => channel.platform === "instagram")?.username
    ?? account.channels[0]?.username
    ?? "";
}

function brandFormFromAccount(account: BrandAccount): BrandFormState {
  const channels = new Set(account.channels.map((channel) => channel.platform));
  return {
    brandId: account.brandId ?? account.id,
    accountId: account.id,
    name: account.name,
    accountName: account.name,
    accountHandle: handleFromAccount(account),
    color: account.brandColor ?? "#4b46f5",
    instagram: channels.has("instagram"),
    facebook: channels.has("facebook"),
    x: channels.has("x"),
    tiktok: channels.has("tiktok"),
    youtube: channels.has("youtube"),
    linkedin: channels.has("linkedin"),
    google_business: channels.has("google_business"),
    active: account.brandActive ?? true,
    accountActive: account.accountActive ?? true,
  };
}

function brandFormToInput(form: BrandFormState, mode: BrandDialogMode): BrandAdminInput {
  const channels = SOCIAL_PLATFORM_OPTIONS
    .filter((platform) => form[platform.id])
    .map((platform) => platform.id);
  return {
    ...(mode === "create" && form.brandId.trim() ? { brandId: form.brandId.trim() } : {}),
    ...(mode === "create" && form.accountId.trim() ? { accountId: form.accountId.trim() } : {}),
    name: form.name.trim(),
    accountName: form.accountName.trim() || form.name.trim(),
    accountHandle: form.accountHandle.trim(),
    color: form.color.trim(),
    channels,
    active: form.active,
    accountActive: form.accountActive,
  };
}

function validateBrandForm(form: BrandFormState): string | null {
  if (form.name.trim().length < 2) return "La marca necesita un nombre de al menos 2 caracteres.";
  if (!/^#([0-9a-f]{6})$/i.test(form.color.trim())) return "Usa un color hexadecimal como #2563eb.";
  if (!/^@?[A-Za-z0-9._-]{2,80}$/.test(form.accountHandle.trim())) return "Usa un handle válido, por ejemplo @marca_empresa.";
  if (!SOCIAL_PLATFORM_OPTIONS.some((platform) => form[platform.id])) return "Selecciona al menos una plataforma.";
  const slugPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  if (form.brandId.trim() && !slugPattern.test(form.brandId.trim())) return "El ID de marca solo acepta minúsculas, números y guiones.";
  if (form.accountId.trim() && !slugPattern.test(form.accountId.trim())) return "El ID de cuenta solo acepta minúsculas, números y guiones.";
  return null;
}

export function AccountsView({
  accounts,
  canAdmin = true,
  canSync = true,
  onCreateBrand,
  onUpdateBrand,
  canHide = false,
  onSetBrandHidden,
  onSetSacUsage,
  onSyncAccount,
  onSaveMetricoolAccount,
  onDisconnectMetricoolAccount,
  onToggleAutomation,
  onSaveBrandWorkbook,
  onDownloadBrandWorkbook,
  onSaveBrandQaWorkbook,
  onDownloadBrandQaTemplate,
  onAddBrandResource,
  onDeleteBrandResource,
  onImportMetricoolBrands,
  onDeactivateBrands,
  isSavingBrand = false,
  isSavingAccount = false,
  isSavingWorkbook = false,
}: AccountsViewProps) {
  const [query, setQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [brandDialogMode, setBrandDialogMode] = useState<BrandDialogMode | null>(null);
  const [brandDialogAccountId, setBrandDialogAccountId] = useState<string | null>(null);
  const [brandForm, setBrandForm] = useState<BrandFormState>(emptyBrandForm);
  const [brandFormError, setBrandFormError] = useState<string | null>(null);
  const [credentialAccountId, setCredentialAccountId] = useState<string | null>(null);
  const [isImportOpen, setImportOpen] = useState(false);
  const [metricoolUserId, setMetricoolUserId] = useState("");
  const [metricoolBlogId, setMetricoolBlogId] = useState("");
  const [metricoolInstagramProvider, setMetricoolInstagramProvider] = useState<"INSTAGRAMBUSINESS" | "INSTAGRAM">(
    "INSTAGRAMBUSINESS",
  );
  const [workbookAccountId, setWorkbookAccountId] = useState<string | null>(null);
  // «En SAC» por defecto en cuanto hay cuentas marcadas; si nadie marcó nada, todas.
  const [usageChoice, setUsageChoice] = useState<UsageScope | null>(null);
  const [metricoolAccountId, setMetricoolAccountId] = useState("all");
  const [periodTotals, setPeriodTotals] = useState<Record<string, number>>({});
  const onPeriodTotals = useCallback((totals: Record<string, number>) => setPeriodTotals(totals), []);
  const [usageAccountId, setUsageAccountId] = useState<string | null>(null);
  const [usageDraft, setUsageDraft] = useState<SocialPlatform[]>([]);
  const [isSavingUsage, setSavingUsage] = useState(false);

  // Los clientes ocultos no cuentan como alertas ni se operan. Solo el admin principal los
  // recibe de la API y los ve aparte, en el filtro "Ocultos", para volver a mostrarlos.
  const activeAccounts = useMemo(() => accounts.filter((account) => !isInactiveAccount(account)), [accounts]);
  const inactiveCount = accounts.length - activeAccounts.length;
  const sacMarkedCount = activeAccounts.filter((account) => account.sacChannels?.length).length;
  const usageScope: UsageScope = usageChoice ?? (sacMarkedCount ? "sac" : "all");
  /** Cuentas del alcance elegido (En SAC o Todas) y de la cuenta de Metricool elegida: tablero y lista. */
  const scopedAccounts = useMemo(() => activeAccounts.filter((account) =>
    (usageScope === "all" || Boolean(account.sacChannels?.length))
    && (metricoolAccountId === "all" || account.id === metricoolAccountId)), [activeAccounts, metricoolAccountId, usageScope]);
  const filterAccounts = useMemo(
    () => activeAccounts.filter((account) => usageScope === "all" || Boolean(account.sacChannels?.length)),
    [activeAccounts, usageScope],
  );

  const visibleAccounts = useMemo(() => {
    const normalizedQuery = normalize(query.trim());
    const base = healthFilter === "inactive"
      ? accounts.filter(isInactiveAccount).filter((account) => metricoolAccountId === "all" || account.id === metricoolAccountId)
      : scopedAccounts;

    return base.filter((account) => {
      const searchableText = `${account.name} ${account.category} ${account.manager} ${account.channels
        .map((channel) => channel.username)
        .join(" ")}`;
      const matchesQuery =
        normalizedQuery.length === 0 || normalize(searchableText).includes(normalizedQuery);
      const matchesHealth = healthFilter === "all" || healthFilter === "inactive" || account.health === healthFilter;
      return matchesQuery && matchesHealth;
    });
  }, [accounts, healthFilter, metricoolAccountId, query, scopedAccounts]);

  const healthCounts = scopedAccounts.reduce(
    (counts, account) => {
      counts[account.health] += 1;
      return counts;
    },
    { healthy: 0, attention: 0, disconnected: 0 },
  );

  const toggleAutomation = (account: BrandAccount) => {
    void onToggleAutomation?.(account, !account.automationEnabled);
  };

  const brandDialogAccount = useMemo(
    () => accounts.find((account) => account.id === brandDialogAccountId) ?? null,
    [accounts, brandDialogAccountId],
  );

  const credentialAccount = useMemo(
    () => accounts.find((account) => account.id === credentialAccountId) ?? null,
    [accounts, credentialAccountId],
  );

  const workbookAccount = useMemo(
    () => accounts.find((account) => account.id === workbookAccountId) ?? null,
    [accounts, workbookAccountId],
  );

  const openBrandDialog = (mode: BrandDialogMode, account?: BrandAccount) => {
    setBrandDialogMode(mode);
    setBrandDialogAccountId(account?.id ?? null);
    setBrandForm(account ? brandFormFromAccount(account) : emptyBrandForm);
    setBrandFormError(null);
  };

  const closeBrandDialog = () => {
    if (isSavingBrand) return;
    setBrandDialogMode(null);
    setBrandDialogAccountId(null);
    setBrandForm(emptyBrandForm);
    setBrandFormError(null);
  };

  const updateBrandForm = <Field extends keyof BrandFormState>(field: Field, value: BrandFormState[Field]) => {
    setBrandForm((current) => ({ ...current, [field]: value }));
    setBrandFormError(null);
  };

  const submitBrandForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!brandDialogMode) return;
    const error = validateBrandForm(brandForm);
    if (error) {
      setBrandFormError(error);
      return;
    }

    try {
      const input = brandFormToInput(brandForm, brandDialogMode);
      if (brandDialogMode === "create") {
        await onCreateBrand?.(input);
      } else if (brandDialogAccount) {
        await onUpdateBrand?.(brandDialogAccount, input);
      }
      closeBrandDialog();
    } catch {
      // El contenedor muestra el error en el toast y dejamos el formulario abierto.
    }
  };

  /** Pide confirmación y oculta o vuelve a mostrar el cliente. true si se hizo. */
  const confirmVisibility = async (account: BrandAccount, hidden: boolean): Promise<boolean> => {
    if (!onSetBrandHidden) return false;
    const confirmed = await confirmAction(hidden
      ? {
        title: `¿Ocultar ${account.name}?`,
        message: "Deja de sincronizar con Metricool y desaparece para todo el equipo: bandeja, Inicio, Reportes y MetriQ. No se borra nada."
          + "\n\nSe conserva su vínculo con Metricool para que no vuelva a importarse solo. Puedes volver a mostrarlo desde el filtro «Ocultos».",
        confirmLabel: "Ocultar",
        tone: "danger",
      }
      : {
        title: `¿Volver a mostrar ${account.name}?`,
        message: "Vuelve a la bandeja, Reportes y MetriQ con todo su historial, y la próxima sincronización trae lo que llegó mientras estuvo oculto.",
        confirmLabel: "Mostrar",
      });
    if (!confirmed) return false;
    try {
      await onSetBrandHidden(account, hidden);
      return true;
    } catch {
      // El contenedor muestra el error en el toast.
      return false;
    }
  };

  const hideFromDialog = async () => {
    if (brandDialogAccount && await confirmVisibility(brandDialogAccount, true)) closeBrandDialog();
  };

  const openCredentialDialog = (account?: BrandAccount) => {
    const target = account
      ?? accounts.find((item) => !item.metricoolReferenceStored)
      ?? accounts.find((item) => !item.metricoolLiveReady)
      ?? accounts[0];
    if (!target) return;
    setCredentialAccountId(target.id);
    setMetricoolUserId("");
    setMetricoolBlogId("");
    setMetricoolInstagramProvider(target.metricoolInstagramProvider);
  };

  const closeCredentialDialog = () => {
    if (isSavingAccount) return;
    setCredentialAccountId(null);
    setMetricoolUserId("");
    setMetricoolBlogId("");
    setMetricoolInstagramProvider("INSTAGRAMBUSINESS");
  };

  const submitCredentialForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!credentialAccount || !metricoolUserId.trim() || !metricoolBlogId.trim()) return;
    try {
      await onSaveMetricoolAccount?.(credentialAccount, {
        userId: metricoolUserId.trim(),
        blogId: metricoolBlogId.trim(),
        instagramProvider: metricoolInstagramProvider,
      });
      closeCredentialDialog();
    } catch {
      // El contenedor muestra el error en el toast y dejamos el formulario abierto.
    }
  };

  const disconnectCredentialAccount = async () => {
    if (!credentialAccount) return;
    try {
      await onDisconnectMetricoolAccount?.(credentialAccount);
      closeCredentialDialog();
    } catch {
      // El contenedor muestra el error en el toast y dejamos el formulario abierto.
    }
  };

  const usageAccount = useMemo(
    () => accounts.find((account) => account.id === usageAccountId) ?? null,
    [accounts, usageAccountId],
  );
  const openUsageDialog = (account: BrandAccount) => {
    setUsageAccountId(account.id);
    setUsageDraft(account.sacChannels ?? []);
  };
  const closeUsageDialog = () => {
    if (isSavingUsage) return;
    setUsageAccountId(null);
  };
  const submitUsage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!usageAccount || !onSetSacUsage) return;
    setSavingUsage(true);
    try {
      await onSetSacUsage(usageAccount, usageDraft);
      setUsageAccountId(null);
    } catch {
      // El contenedor muestra el error; el diálogo queda abierto.
    } finally {
      setSavingUsage(false);
    }
  };

  const openWorkbookDialog = (account: BrandAccount) => {
    setWorkbookAccountId(account.id);
  };

  const closeWorkbookDialog = () => {
    if (isSavingWorkbook) return;
    setWorkbookAccountId(null);
  };

  return (
    <section className="app-view accounts-view" aria-labelledby="accounts-title">
      <header className="view-header">
        <div className="view-header__copy">
          <p className="view-header__eyebrow">Sistema</p>
          <h1 id="accounts-title" className="view-header__title">Clientes</h1>
          <p className="view-header__description">
            Mensajes recibidos, cuentas de Metricool y qué redes se usan hoy en SAC.
          </p>
        </div>
        <div className="view-header__actions">
          {onImportMetricoolBrands && canAdmin ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setImportOpen(true)}
            >
              <CloudArrowDown size={17} weight="bold" aria-hidden="true" />
              Importar desde Metricool
            </button>
          ) : null}
          {canAdmin ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => openCredentialDialog()}
            >
              <LinkSimple size={17} weight="bold" aria-hidden="true" />
              Conectar Metricool
            </button>
          ) : null}
          {canAdmin ? (
            <button
              className="button button--primary"
              type="button"
              onClick={() => openBrandDialog("create")}
            >
              <Plus size={17} weight="bold" aria-hidden="true" />
              Nueva marca
            </button>
          ) : null}
        </div>
      </header>

      <div className="accounts-toolbar clients-toolbar" role="search" aria-label="Filtrar clientes">
        <div className="clients-usage" role="radiogroup" aria-label="Uso en SAC">
          <button
            type="button"
            role="radio"
            aria-checked={usageScope === "sac"}
            className={usageScope === "sac" ? "is-active" : ""}
            onClick={() => setUsageChoice("sac")}
            title="Cuentas con al menos una red marcada «En SAC»"
          >
            En SAC <small>{sacMarkedCount}</small>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={usageScope === "all"}
            className={usageScope === "all" ? "is-active" : ""}
            onClick={() => setUsageChoice("all")}
            title="Todas las cuentas visibles, se usen o no en SAC"
          >
            Todas <small>{activeAccounts.length}</small>
          </button>
        </div>
        <div className="filter-field filter-field--compact clients-toolbar__account">
          <span className="filter-field__label">Cuenta de Metricool</span>
          <AccountFilter
            accounts={filterAccounts}
            value={metricoolAccountId}
            onChange={setMetricoolAccountId}
            inWindowCounts={periodTotals}
            countLabel="Mensajes recibidos en el período"
            allLabel="Todas las cuentas"
          />
        </div>
        <label className="search-field">
          <span className="sr-only">Buscar clientes</span>
          <MagnifyingGlass className="search-field__icon" size={18} aria-hidden="true" />
          <input
            className="search-field__input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar cliente o usuario"
          />
          {query ? (
            <button
              className="icon-button search-field__clear"
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => setQuery("")}
            >
              <X size={16} weight="bold" aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <label className="filter-field filter-field--compact">
          <span className="filter-field__label">Estado</span>
          <select
            value={healthFilter}
            onChange={(event) => setHealthFilter(event.target.value as HealthFilter)}
          >
            <option value="all">Todas</option>
            <option value="healthy">Operativas ({healthCounts.healthy})</option>
            <option value="attention">Con atención ({healthCounts.attention})</option>
            <option value="disconnected">Desconectadas ({healthCounts.disconnected})</option>
            {canHide && (inactiveCount > 0 || healthFilter === "inactive") ? <option value="inactive">Ocultos ({inactiveCount})</option> : null}
          </select>
        </label>
      </div>

      {healthFilter !== "inactive" ? (
        <ClientsDashboard accounts={scopedAccounts} scope={usageScope} totalsAccounts={filterAccounts} onTotalsChange={onPeriodTotals} />
      ) : null}

      <div className="clients-list-heading">
        <h2>Cuentas</h2>
        <p className="accounts-toolbar__count" aria-live="polite">
          {healthFilter === "inactive"
            ? `${visibleAccounts.length} oculto${visibleAccounts.length === 1 ? "" : "s"}`
            : `${visibleAccounts.length} de ${activeAccounts.length} cuentas visibles`}
        </p>
      </div>

      <article className="panel accounts-panel">
        {visibleAccounts.length > 0 ? (
          <div className="table-scroll" tabIndex={0} aria-label="Listado de cuentas conectadas">
            <table className="data-table accounts-table">
              <caption className="sr-only">Estado de las cuentas y plataformas conectadas</caption>
              <thead>
                <tr>
                  <th scope="col">Marca</th>
                  <th scope="col">En SAC</th>
                  <th scope="col">Canales</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Interacciones en 30 días</th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Automatización</th>
                  <th scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleAccounts.map((account) => {
                  return (
                    <tr key={account.id}>
                      <td>
                        <button
                          className="brand-cell brand-cell--button"
                          type="button"
                          onClick={() => {
                            if (!canAdmin) return;
                            openBrandDialog("edit", account);
                          }}
                          disabled={!canAdmin}
                          title={!canAdmin ? "Edición disponible para administradores" : undefined}
                        >
                          <span className="brand-avatar" aria-hidden="true">
                            <ProfileAvatar
                              url={`/api/media/brand-picture/${account.brandId ?? account.id}`}
                              initials={account.initials}
                            />
                          </span>
                          <span className="brand-cell__copy">
                            <strong>{account.name}</strong>
                            <small>{account.category}</small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <div className="sac-usage-cell">
                          {account.sacChannels?.length ? (
                            <span className="sac-usage-cell__networks" aria-label={`Se usa en SAC: ${account.sacChannels.map(platformLabel).join(", ")}`}>
                              {account.sacChannels.map((platform) => {
                                const pending = !account.channels.some((channel) => channel.platform === platform);
                                return (
                                <span
                                  key={platform}
                                  className={`sac-usage-chip${pending ? " is-pending" : ""}`}
                                  title={pending ? `${platformLabel(platform)}: aún no conectada en Metricool (pendiente)` : platformLabel(platform)}
                                >
                                  <SocialPlatformIcon platform={platform} size={14} weight="fill" aria-hidden="true" />
                                </span>
                                );
                              })}
                            </span>
                          ) : (
                            <span className="sac-usage-cell__none">No se usa</span>
                          )}
                          {onSetSacUsage && canHide ? (
                            <button
                              type="button"
                              className="icon-button sac-usage-cell__edit"
                              onClick={() => openUsageDialog(account)}
                              aria-label={`Editar redes en SAC de ${account.name}`}
                              title="Editar qué redes se usan en SAC"
                            >
                              <PencilSimple size={14} weight="bold" aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="channel-stack">
                          {account.channels.map((channel) => (
                            <span
                              className={`channel-connection channel-connection--${channel.status}`}
                              key={`${account.id}-${channel.platform}`}
                              aria-label={`${platformLabel(channel.platform)}: ${channel.username}, ${channelStatusLabel(channel)}`}
                            >
                              <PlatformIcon platform={channel.platform} />
                              <span>{channel.username}</span>
                              <small>{channelStatusLabel(channel)}</small>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span className={`health-status health-status--${account.health}`}>
                          <HealthIcon health={account.health} />
                          {healthLabel(account.health)}
                        </span>
                        <small className="cell-detail">{account.healthDetail}</small>
                        <small className="cell-detail">Última sincronización {account.lastSyncLabel}</small>
                      </td>
                      <td>
                        <strong className="numeric-value">
                          {formatInteger.format(account.interactions30d)}
                        </strong>
                        <small className="cell-detail">mensajes, comentarios y reseñas</small>
                        <small className="cell-detail">{account.unread} sin responder</small>
                      </td>
                      <td>
                        <span className="manager-cell">{account.manager}</span>
                        <small className="cell-detail" title={`Referencia Metricool: ${metricoolSourceLabel(account)}`}>
                          {account.metricoolSource && account.metricoolSource !== "none" ? "Vinculada a Metricool" : "Sin vincular a Metricool"}
                        </small>
                      </td>
                      <td>
                        <button
                          className={`toggle-button${account.automationEnabled ? " toggle-button--on" : ""}`}
                          type="button"
                          role="switch"
                          aria-checked={account.automationEnabled}
                          onClick={() => toggleAutomation(account)}
                          disabled={!canAdmin || account.health === "disconnected"}
                          title={!canAdmin ? "Requiere rol administrador" : undefined}
                        >
                          {account.automationEnabled ? (
                            <PlayCircle size={17} weight="fill" aria-hidden="true" />
                          ) : (
                            <PauseCircle size={17} weight="fill" aria-hidden="true" />
                          )}
                          {account.automationEnabled ? "Activa" : "Pausada"}
                        </button>
                      </td>
                      <td className="actions-cell">
                        <div className="row-action-group">
                          <button
                            className="row-action"
                            type="button"
                            onClick={() => openBrandDialog("edit", account)}
                            disabled={!canAdmin}
                            title={!canAdmin ? "Requiere rol administrador" : undefined}
                          >
                            <PencilSimple size={15} weight="bold" aria-hidden="true" />
                            Editar
                          </button>
                          <button
                            className={`row-action${account.workbook || account.qaWorkbook ? " row-action--primary" : ""}`}
                            type="button"
                            onClick={() => openWorkbookDialog(account)}
                            disabled={!canAdmin}
                            title={`${account.resources.length} archivos · registros y QA por marca`}
                          >
                            <FolderOpen size={15} weight="bold" aria-hidden="true" />
                            Archivos
                          </button>
                          {!account.metricoolLiveReady ? (
                            <button
                              className="row-action row-action--primary"
                              type="button"
                              onClick={() => openCredentialDialog(account)}
                              disabled={!canAdmin}
                              title={!canAdmin ? "Requiere rol administrador" : undefined}
                            >
                              <LinkSimple size={15} weight="bold" aria-hidden="true" />
                              {account.metricoolReferenceStored ? "Actualizar" : "Conectar"}
                            </button>
                          ) : (
                            <button
                              className="row-action"
                              type="button"
                              onClick={() => onSyncAccount?.(account)}
                              disabled={!canSync}
                              title={!canSync ? "Requiere rol agente o superior" : undefined}
                            >
                              <ArrowClockwise size={15} weight="bold" aria-hidden="true" />
                              Sincronizar
                            </button>
                          )}
                          {canHide && onSetBrandHidden ? (
                            isInactiveAccount(account) ? (
                              <button
                                className="row-action row-action--primary"
                                type="button"
                                onClick={() => void confirmVisibility(account, false)}
                                disabled={isSavingBrand}
                                title="Vuelve a sincronizar y a aparecer en la operación, Reportes y MetriQ"
                              >
                                <Eye size={15} weight="bold" aria-hidden="true" />
                                Mostrar
                              </button>
                            ) : (
                              <button
                                className="row-action"
                                type="button"
                                onClick={() => void confirmVisibility(account, true)}
                                disabled={isSavingBrand}
                                title="Deja de sincronizar y desaparece para el equipo; no borra nada"
                              >
                                <EyeSlash size={15} weight="bold" aria-hidden="true" />
                                Ocultar
                              </button>
                            )
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state empty-state--large">
            <MagnifyingGlass size={28} weight="duotone" aria-hidden="true" />
            <strong>No encontramos cuentas</strong>
            <p>Prueba otra búsqueda o vuelve a mostrar todos los estados.</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                setQuery("");
                setHealthFilter("all");
              }}
            >
              Mostrar todas
            </button>
          </div>
        )}
      </article>

      {brandDialogMode ? (
        <div className="account-credentials-backdrop" role="presentation">
          <form className="account-credentials-panel brand-admin-panel" onSubmit={submitBrandForm}>
            <header>
              <span className="account-credentials-panel__icon">
                <Buildings size={20} weight="fill" aria-hidden="true" />
              </span>
              <div>
                <p className="view-header__eyebrow">Administración de marcas</p>
                <h2>{brandDialogMode === "create" ? "Crear nueva marca" : "Editar marca"}</h2>
                <p>
                  Administra la marca y su cuenta interna de SAC Flow. Esto no crea páginas en Meta ni toca Metricool.
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Cerrar administración de marca"
                onClick={closeBrandDialog}
                disabled={isSavingBrand}
              >
                <X size={16} weight="bold" aria-hidden="true" />
              </button>
            </header>

            <div className="brand-admin-grid">
              {brandDialogMode === "create" ? (
                <>
                  <label className="form-field">
                    <span>ID de marca opcional</span>
                    <input
                      value={brandForm.brandId}
                      onChange={(event) => updateBrandForm("brandId", event.target.value)}
                      placeholder="marca-nueva"
                      autoComplete="off"
                      disabled={isSavingBrand}
                    />
                    <small>Minúsculas, números y guiones. Si queda vacío, la API lo genera.</small>
                  </label>
                  <label className="form-field">
                    <span>ID de cuenta opcional</span>
                    <input
                      value={brandForm.accountId}
                      onChange={(event) => updateBrandForm("accountId", event.target.value)}
                      placeholder="account-marca-nueva"
                      autoComplete="off"
                      disabled={isSavingBrand}
                    />
                    <small>Usado para allowlist, sync y referencias Metricool.</small>
                  </label>
                </>
              ) : (
                <>
                  <label className="form-field">
                    <span>ID de marca</span>
                    <input value={brandForm.brandId} disabled readOnly />
                    <small>No se edita para preservar historial y permisos.</small>
                  </label>
                  <label className="form-field">
                    <span>ID de cuenta</span>
                    <input value={brandForm.accountId} disabled readOnly />
                    <small>Referencia interna usada por Metricool y automatización.</small>
                  </label>
                </>
              )}

              <label className="form-field">
                <span>Nombre de marca</span>
                <input
                  value={brandForm.name}
                  onChange={(event) => updateBrandForm("name", event.target.value)}
                  placeholder="Nombre de la marca"
                  autoComplete="organization"
                  disabled={isSavingBrand}
                  required
                />
              </label>
              <label className="form-field">
                <span>Nombre de cuenta</span>
                <input
                  value={brandForm.accountName}
                  onChange={(event) => updateBrandForm("accountName", event.target.value)}
                  placeholder="Igual al nombre de marca"
                  autoComplete="off"
                  disabled={isSavingBrand}
                />
              </label>

              <label className="form-field">
                <span>Handle principal</span>
                <input
                  value={brandForm.accountHandle}
                  onChange={(event) => updateBrandForm("accountHandle", event.target.value)}
                  placeholder="@marca_empresa"
                  autoComplete="off"
                  disabled={isSavingBrand}
                  required
                />
              </label>
              <label className="form-field">
                <span>Color</span>
                <input
                  value={brandForm.color}
                  onChange={(event) => updateBrandForm("color", event.target.value)}
                  placeholder="#4b46f5"
                  autoComplete="off"
                  disabled={isSavingBrand}
                  required
                />
              </label>
            </div>

            <fieldset className="brand-admin-options">
              <legend>Canales disponibles</legend>
              {SOCIAL_PLATFORM_OPTIONS.map((platform) => (
                <label key={platform.id} title={platform.inbox}>
                  <input
                    type="checkbox"
                    checked={brandForm[platform.id]}
                    onChange={(event) => updateBrandForm(platform.id, event.target.checked)}
                    disabled={isSavingBrand}
                  />
                  <SocialPlatformIcon platform={platform.id} size={16} weight="fill" aria-hidden="true" />
                  <span>{platform.label}<small>{platform.inbox}</small></span>
                </label>
              ))}
            </fieldset>

            {brandDialogMode === "edit" && canHide ? (
              <fieldset className="brand-admin-options brand-admin-options--stacked">
                <legend>Estado operacional</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={brandForm.active}
                    onChange={(event) => {
                      updateBrandForm("active", event.target.checked);
                      if (!event.target.checked) updateBrandForm("accountActive", false);
                    }}
                    disabled={isSavingBrand}
                  />
                  <Power size={16} weight="fill" aria-hidden="true" />
                  Marca activa
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={brandForm.accountActive}
                    onChange={(event) => updateBrandForm("accountActive", event.target.checked)}
                    disabled={isSavingBrand || !brandForm.active}
                  />
                  <ShieldCheck size={16} weight="fill" aria-hidden="true" />
                  Cuenta social activa
                </label>
              </fieldset>
            ) : null}

            {brandFormError ? (
              <p className="brand-admin-error" role="alert">{brandFormError}</p>
            ) : (
              <p className="account-credentials-panel__note">
                La operación guarda metadatos internos. Las referencias `userId/blogId` se agregan aparte y nunca se muestran en esta pantalla.
              </p>
            )}

            <footer className="brand-admin-footer">
              {brandDialogMode === "edit" && brandDialogAccount && canHide && onSetBrandHidden ? (
                <button
                  className="button button--danger"
                  type="button"
                  onClick={() => void hideFromDialog()}
                  disabled={isSavingBrand || isInactiveAccount(brandDialogAccount)}
                >
                  <EyeSlash size={16} weight="bold" aria-hidden="true" />
                  Ocultar cliente
                </button>
              ) : <span />}
              <span className="brand-admin-footer__actions">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={closeBrandDialog}
                  disabled={isSavingBrand}
                >
                  Cancelar
                </button>
                <button className="button button--primary" type="submit" disabled={isSavingBrand}>
                  <FloppyDisk size={16} weight="bold" aria-hidden="true" />
                  {isSavingBrand ? "Guardando" : brandDialogMode === "create" ? "Crear marca" : "Guardar cambios"}
                </button>
              </span>
            </footer>
          </form>
        </div>
      ) : null}

      {isImportOpen && onImportMetricoolBrands ? (
        <MetricoolImportDialog
          accounts={accounts}
          onClose={() => setImportOpen(false)}
          onImport={onImportMetricoolBrands}
          onDeactivate={onDeactivateBrands}
        />
      ) : null}

      {usageAccount ? (
        <div className="account-credentials-backdrop" role="presentation">
          <form className="account-credentials-panel sac-usage-panel" onSubmit={submitUsage} aria-labelledby="sac-usage-title">
            <header>
              <span className="account-credentials-panel__icon">
                <CheckCircle size={20} weight="fill" aria-hidden="true" />
              </span>
              <div>
                <p className="view-header__eyebrow">Uso en SAC</p>
                <h2 id="sac-usage-title">{usageAccount.name}</h2>
                <p>
                  Marca las redes que el equipo atiende hoy en SAC. Es solo una etiqueta para filtrar Clientes:
                  las demás siguen sincronizando y conservan su historial.
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Cerrar uso en SAC"
                onClick={closeUsageDialog}
                disabled={isSavingUsage}
              >
                <X size={16} weight="bold" aria-hidden="true" />
              </button>
            </header>
            <fieldset className="brand-admin-options">
              <legend>Redes conectadas</legend>
              {usageAccount.channels.map((channel) => (
                <label key={channel.platform}>
                  <input
                    type="checkbox"
                    checked={usageDraft.includes(channel.platform)}
                    onChange={(event) => setUsageDraft((current) => event.target.checked
                      ? [...new Set([...current, channel.platform])]
                      : current.filter((platform) => platform !== channel.platform))}
                    disabled={isSavingUsage}
                  />
                  <SocialPlatformIcon platform={channel.platform} size={16} weight="fill" aria-hidden="true" />
                  <span>{platformLabel(channel.platform)}<small>{channel.username}</small></span>
                </label>
              ))}
            </fieldset>
            {/* Redes aún no conectadas en Metricool: se pueden dejar marcadas y valen solas al conectarse. */}
            {SAC_PLATFORMS.some((platform) => !usageAccount.channels.some((channel) => channel.platform === platform)) ? (
              <fieldset className="brand-admin-options">
                <legend>Aún no conectadas (quedan pendientes)</legend>
                {SAC_PLATFORMS.filter((platform) => !usageAccount.channels.some((channel) => channel.platform === platform)).map((platform) => (
                  <label key={platform}>
                    <input
                      type="checkbox"
                      checked={usageDraft.includes(platform)}
                      onChange={(event) => setUsageDraft((current) => event.target.checked
                        ? [...new Set([...current, platform])]
                        : current.filter((item) => item !== platform))}
                      disabled={isSavingUsage}
                    />
                    <SocialPlatformIcon platform={platform} size={16} weight="fill" aria-hidden="true" />
                    <span>{platformLabel(platform)}<small>Se atenderá cuando se conecte en Metricool</small></span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <footer>
              <button className="button button--secondary" type="button" onClick={closeUsageDialog} disabled={isSavingUsage}>
                Cancelar
              </button>
              <button className="button button--primary" type="submit" disabled={isSavingUsage}>
                <FloppyDisk size={16} weight="bold" aria-hidden="true" />
                {isSavingUsage ? "Guardando" : "Guardar"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {credentialAccount ? (
        <div className="account-credentials-backdrop" role="presentation">
          <form className="account-credentials-panel" onSubmit={submitCredentialForm}>
            <header>
              <span className="account-credentials-panel__icon">
                <ShieldCheck size={20} weight="fill" aria-hidden="true" />
              </span>
              <div>
                <p className="view-header__eyebrow">Conexión Metricool</p>
                <h2>Configurar cuenta</h2>
                <p>
                  Guarda la referencia servidor-servidor de Metricool para una marca. El token de API sigue fuera del navegador.
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Cerrar configuración de cuenta"
                onClick={closeCredentialDialog}
                disabled={isSavingAccount}
              >
                <X size={16} weight="bold" aria-hidden="true" />
              </button>
            </header>

            <label className="form-field">
              <span>Marca</span>
              <select
                value={credentialAccount.id}
                onChange={(event) => {
                  setCredentialAccountId(event.target.value);
                  setMetricoolUserId("");
                  setMetricoolBlogId("");
                  const nextAccount = accounts.find((account) => account.id === event.target.value);
                  setMetricoolInstagramProvider(nextAccount?.metricoolInstagramProvider || "INSTAGRAMBUSINESS");
                }}
                disabled={isSavingAccount}
              >
                {accounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name} · {account.metricoolLiveReady ? "lista" : account.metricoolReferenceStored ? "referencia guardada" : "sin referencia"}
                  </option>
                ))}
              </select>
            </label>

            <div className="account-credentials-panel__state">
              <span className={`health-status health-status--${credentialAccount.health}`}>
                <HealthIcon health={credentialAccount.health} />
                {healthLabel(credentialAccount.health)}
              </span>
              <small>{credentialAccount.healthDetail}</small>
              <small>Fuente actual: {metricoolSourceLabel(credentialAccount)}</small>
              <small>
                Instagram: {credentialAccount.metricoolInstagramProvider === "INSTAGRAMBUSINESS"
                  ? "conectado vía Facebook"
                  : "conectado directamente"}
              </small>
            </div>

            <label className="form-field">
              <span>Metricool userId</span>
              <input
                value={metricoolUserId}
                onChange={(event) => setMetricoolUserId(event.target.value)}
                placeholder="Ej. 123456"
                autoComplete="off"
                disabled={isSavingAccount}
                required
              />
            </label>

            <label className="form-field">
              <span>Metricool blogId</span>
              <input
                value={metricoolBlogId}
                onChange={(event) => setMetricoolBlogId(event.target.value)}
                placeholder="Ej. 987654"
                autoComplete="off"
                disabled={isSavingAccount}
                required
              />
            </label>

            {credentialAccount.channels.some((channel) => channel.platform === "instagram") ? (
              <label className="form-field">
                <span>Conexión de Instagram</span>
                <select
                  value={metricoolInstagramProvider}
                  onChange={(event) => setMetricoolInstagramProvider(
                    event.target.value as "INSTAGRAMBUSINESS" | "INSTAGRAM",
                  )}
                  disabled={isSavingAccount}
                >
                  <option value="INSTAGRAMBUSINESS">Vía Facebook · recomendado</option>
                  <option value="INSTAGRAM">Credenciales directas de Instagram</option>
                </select>
              </label>
            ) : null}

            <p className="account-credentials-panel__note">
              Estos IDs se guardan en el repositorio configurado. En producción use PostgreSQL y secretos administrados; el token nunca se guarda aquí ni se envía al frontend.
            </p>

            <footer>
              <button
                className="button button--secondary"
                type="button"
                onClick={disconnectCredentialAccount}
                disabled={isSavingAccount || !credentialAccount.metricoolReferenceStored}
              >
                <Trash size={16} weight="bold" aria-hidden="true" />
                Desconectar
              </button>
              <button className="button button--primary" type="submit" disabled={isSavingAccount}>
                <FloppyDisk size={16} weight="bold" aria-hidden="true" />
                {isSavingAccount ? "Guardando" : "Guardar referencia"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {workbookAccount ? (
        <BrandFilesPanel
          account={workbookAccount}
          canEdit={canAdmin}
          isSaving={isSavingWorkbook}
          onClose={closeWorkbookDialog}
          onSaveRecords={(account, url) => onSaveBrandWorkbook?.(account, url)}
          onDownloadRecords={(account) => onDownloadBrandWorkbook?.(account)}
          onSaveQa={(account, url) => onSaveBrandQaWorkbook?.(account, url)}
          onDownloadQaTemplate={(account) => onDownloadBrandQaTemplate?.(account)}
          onAddResource={(account, input) => onAddBrandResource?.(account, input)}
          onDeleteResource={(account, resourceId) => onDeleteBrandResource?.(account, resourceId)}
        />
      ) : null}
    </section>
  );
}
