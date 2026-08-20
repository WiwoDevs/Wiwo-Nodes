import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowClockwise,
  Buildings,
  CheckCircle,
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
} from "../types";
import { BrandFilesPanel } from "./BrandFilesPanel";
import {
  platformLabel,
  SOCIAL_PLATFORM_OPTIONS,
  SocialPlatformIcon,
} from "./SocialPlatformIcon";

type HealthFilter = AccountHealth | "all";
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
  onDeactivateBrand?: (account: BrandAccount) => void | Promise<void>;
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
  onDeactivateBrand,
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
  const [metricoolUserId, setMetricoolUserId] = useState("");
  const [metricoolBlogId, setMetricoolBlogId] = useState("");
  const [metricoolInstagramProvider, setMetricoolInstagramProvider] = useState<"INSTAGRAMBUSINESS" | "INSTAGRAM">(
    "INSTAGRAMBUSINESS",
  );
  const [workbookAccountId, setWorkbookAccountId] = useState<string | null>(null);

  const visibleAccounts = useMemo(() => {
    const normalizedQuery = normalize(query.trim());

    return accounts.filter((account) => {
      const searchableText = `${account.name} ${account.category} ${account.manager} ${account.channels
        .map((channel) => channel.username)
        .join(" ")}`;
      const matchesQuery =
        normalizedQuery.length === 0 || normalize(searchableText).includes(normalizedQuery);
      const matchesHealth = healthFilter === "all" || account.health === healthFilter;
      return matchesQuery && matchesHealth;
    });
  }, [accounts, healthFilter, query]);

  const healthCounts = accounts.reduce(
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

  const deactivateBrandAccount = async () => {
    if (!brandDialogAccount) return;
    const confirmed = window.confirm(
      `Desactivar ${brandDialogAccount.name} en SAC Flow? No se borra historial, pero se quita de automatización y se retira la referencia Metricool guardada.`,
    );
    if (!confirmed) return;
    try {
      await onDeactivateBrand?.(brandDialogAccount);
      closeBrandDialog();
    } catch {
      // El contenedor muestra el error en el toast y dejamos el formulario abierto.
    }
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
          <p className="view-header__eyebrow">Administración multicuenta</p>
          <h1 id="accounts-title" className="view-header__title">Cuentas conectadas</h1>
          <p className="view-header__description">
            Estado de las marcas, sus canales y su libro de registros SAC.
          </p>
        </div>
        <div className="view-header__actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => openCredentialDialog()}
            disabled={!canAdmin}
            title={!canAdmin ? "Requiere rol administrador" : undefined}
          >
            <LinkSimple size={17} weight="bold" aria-hidden="true" />
            Conectar Metricool
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => openBrandDialog("create")}
            disabled={!canAdmin}
            title={!canAdmin ? "Requiere rol administrador" : undefined}
          >
            <Plus size={17} weight="bold" aria-hidden="true" />
            Nueva marca
          </button>
        </div>
      </header>

      <div className="health-summary" aria-label="Resumen del estado de las cuentas">
        <button
          className={`health-card health-card--healthy${healthFilter === "healthy" ? " health-card--active" : ""}`}
          type="button"
          onClick={() => setHealthFilter(healthFilter === "healthy" ? "all" : "healthy")}
          aria-pressed={healthFilter === "healthy"}
        >
          <span className="health-card__icon"><CheckCircle size={21} weight="fill" aria-hidden="true" /></span>
          <span className="health-card__copy">
            <strong>{healthCounts.healthy}</strong>
            <span>Operativas</span>
          </span>
          <small>Sincronización normal</small>
        </button>
        <button
          className={`health-card health-card--attention${healthFilter === "attention" ? " health-card--active" : ""}`}
          type="button"
          onClick={() => setHealthFilter(healthFilter === "attention" ? "all" : "attention")}
          aria-pressed={healthFilter === "attention"}
        >
          <span className="health-card__icon"><WarningCircle size={21} weight="fill" aria-hidden="true" /></span>
          <span className="health-card__copy">
            <strong>{healthCounts.attention}</strong>
            <span>Con atención</span>
          </span>
          <small>Retraso o límite de API</small>
        </button>
        <button
          className={`health-card health-card--disconnected${healthFilter === "disconnected" ? " health-card--active" : ""}`}
          type="button"
          onClick={() => setHealthFilter(healthFilter === "disconnected" ? "all" : "disconnected")}
          aria-pressed={healthFilter === "disconnected"}
        >
          <span className="health-card__icon"><XCircle size={21} weight="fill" aria-hidden="true" /></span>
          <span className="health-card__copy">
            <strong>{healthCounts.disconnected}</strong>
            <span>Desconectada</span>
          </span>
          <small>Requiere reconexión</small>
        </button>
      </div>

      <div className="accounts-toolbar" role="search" aria-label="Buscar y filtrar cuentas">
        <label className="search-field">
          <span className="sr-only">Buscar cuentas</span>
          <MagnifyingGlass className="search-field__icon" size={18} aria-hidden="true" />
          <input
            className="search-field__input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar marca, responsable o usuario"
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
            <option value="healthy">Operativas</option>
            <option value="attention">Con atención</option>
            <option value="disconnected">Desconectadas</option>
          </select>
        </label>
        <p className="accounts-toolbar__count" aria-live="polite">
          {visibleAccounts.length} de {accounts.length} cuentas
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
                          <span className="brand-avatar" aria-hidden="true">{account.initials}</span>
                          <span className="brand-cell__copy">
                            <strong>{account.name}</strong>
                            <small>{account.category}</small>
                          </span>
                        </button>
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
                        <small className="cell-detail">Referencia {account.metricoolBlogId}</small>
                        <small className="cell-detail">Fuente {metricoolSourceLabel(account)}</small>
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

            {brandDialogMode === "edit" ? (
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
              {brandDialogMode === "edit" && brandDialogAccount ? (
                <button
                  className="button button--danger"
                  type="button"
                  onClick={deactivateBrandAccount}
                  disabled={isSavingBrand || brandDialogAccount.brandActive === false}
                >
                  <Trash size={16} weight="bold" aria-hidden="true" />
                  Desactivar
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
