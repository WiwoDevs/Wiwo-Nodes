/**
 * Filtro de cuenta con búsqueda: lista alfabética, usuario y red de cada cuenta (para
 * distinguir marcas con el mismo nombre, p. ej. dos "FlixBus") y los casos en plazo de cada una.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import type { BrandAccount } from "../types";

type AccountFilterProps = {
  accounts: BrandAccount[];
  value: string;
  onChange: (value: string) => void;
  /** Casos por atender en plazo por cuenta (o lo que diga `countLabel`). */
  inWindowCounts: Record<string, number>;
  /** Qué cuenta el número de cada opción; por defecto, los casos en plazo de la Bandeja. */
  countLabel?: string;
  /** Texto de la opción que no filtra. */
  allLabel?: string;
  /** Agrega «Solo cuentas En SAC» (valor "sac") cuando hay cuentas marcadas en Clientes. */
  sacOption?: boolean;
};

type Option = { id: string; name: string; detail: string; count?: number; group?: "sac" | "other" };

function normalize(value: string): string {
  return value.toLocaleLowerCase("es-CL").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  google_business: "Google",
};

export function AccountFilter({ accounts, value, onChange, inWindowCounts, countLabel = "Casos por atender en plazo", allLabel = "Todas las cuentas", sacOption = false }: AccountFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options = useMemo<Option[]>(() => {
    // Con cuentas marcadas «En SAC» (Clientes), esas van primero en su propio grupo.
    const grouped = accounts.some((account) => account.sacChannels?.length) && accounts.some((account) => !account.sacChannels?.length);
    const sorted = [...accounts].sort((left, right) =>
      (grouped ? Number(Boolean(right.sacChannels?.length)) - Number(Boolean(left.sacChannels?.length)) : 0)
      || left.name.localeCompare(right.name, "es"));
    return [
      { id: "all", name: allLabel, detail: `${accounts.length} cuentas` },
      ...(sacOption && grouped ? [{
        id: "sac",
        name: "Solo cuentas En SAC",
        detail: `${accounts.filter((account) => account.sacChannels?.length).length} cuentas que el equipo atiende hoy`,
        count: accounts.filter((account) => account.sacChannels?.length).reduce((sum, account) => sum + (inWindowCounts[account.id] ?? 0), 0),
      }] : []),
      ...sorted.map((account) => {
        const handle = account.accountHandle || account.channels[0]?.username;
        const networks = [...new Set(account.channels.map((channel) => PLATFORM_LABEL[channel.platform] ?? channel.platform))].join(" · ");
        return {
          id: account.id,
          name: account.name,
          detail: [handle ? `@${handle.replace(/^@/, "")}` : null, networks || null].filter(Boolean).join(" · "),
          count: inWindowCounts[account.id] ?? 0,
          ...(grouped ? { group: account.sacChannels?.length ? "sac" as const : "other" as const } : {}),
        };
      }),
    ];
  }, [accounts, allLabel, inWindowCounts, sacOption]);

  const visible = useMemo(() => {
    const term = normalize(query.trim());
    if (!term) return options;
    return options.filter((option) => option.id === "all" || option.id === "sac" || normalize(`${option.name} ${option.detail}`).includes(term));
  }, [options, query]);

  const selected = options.find((option) => option.id === value) ?? options[0]!;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, visible.findIndex((option) => option.id === value)));
    inputRef.current?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // Solo al abrir: la posición activa luego la mueve el teclado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(visible.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = visible[active];
      if (option) choose(option.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="account-filter" ref={rootRef}>
      <button
        type="button"
        className="account-filter__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        title={selected.id === "all" ? allLabel : `${selected.name} · ${selected.detail}`}
      >
        <span>{selected.name}</span>
        <CaretDown size={14} weight="bold" aria-hidden="true" />
      </button>
      {open ? (
        <div className="account-filter__popover">
          <label className="account-filter__search">
            <MagnifyingGlass size={15} aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              placeholder="Buscar cuenta"
              aria-label="Buscar cuenta"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={visible[active] ? `${listId}-${visible[active]!.id}` : undefined}
            />
          </label>
          <ul id={listId} role="listbox" aria-label="Cuentas" className="account-filter__list">
            {visible.map((option, index) => [
              option.group && option.group !== visible[index - 1]?.group ? (
                <li key={`grupo-${option.group}`} role="presentation" className="account-filter__group">
                  {option.group === "sac"
                    ? `En SAC (${visible.filter((item) => item.group === "sac").length})`
                    : `Otras cuentas (${visible.filter((item) => item.group === "other").length})`}
                </li>
              ) : null,
              <li
                key={option.id}
                id={`${listId}-${option.id}`}
                role="option"
                aria-selected={option.id === value}
                className={`account-filter__option${index === active ? " is-active" : ""}${option.id === value ? " is-selected" : ""}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => { event.preventDefault(); choose(option.id); }}
              >
                <span className="account-filter__copy">
                  <strong>{option.name}</strong>
                  {option.detail ? <small>{option.detail}</small> : null}
                </span>
                {option.count ? <em className="account-filter__count" title={countLabel}>{option.count}</em> : null}
              </li>,
            ])}
            {visible.length === 1 && query ? <li className="account-filter__empty">Ninguna cuenta coincide.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
