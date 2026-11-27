/**
 * Campana de la barra superior: lo nuevo de la bandeja (mensajes, comentarios y reseñas de
 * clientes) con contador de no leídas. Un clic en un aviso abre el caso; "Marcar todo como
 * leído" guarda hasta cuándo se leyó (por persona en la base, o en el navegador sin sesión).
 */
import { useEffect, useId, useRef, useState } from "react";
import { Bell, Checks } from "@phosphor-icons/react";
import type { Interaction } from "../types";
import { notificationAge, notificationTitle, type NotificationItem } from "../lib/notifications";
import { platformLabel, SocialPlatformIcon } from "./SocialPlatformIcon";
import { ProfileAvatar } from "./ProfileAvatar";

type NotificationsMenuProps = {
  items: NotificationItem[];
  unreadCount: number;
  /** Casos por atender en plazo (lo que antes mostraba la campana). */
  pendingCount?: number;
  loading?: boolean;
  onOpen: (interaction: Interaction) => void;
  onMarkAllRead: () => void;
  onOpenInbox: () => void;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toLocaleUpperCase("es") || "?";
}

export function NotificationsMenu({ items, unreadCount, pendingCount, loading = false, onOpen, onMarkAllRead, onOpenInbox }: NotificationsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div className="notifications-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-button notification-button"
        aria-label={unreadCount ? `Notificaciones: ${unreadCount} sin leer` : "Notificaciones"}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        title="Notificaciones"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={19} />
        {unreadCount ? <b className="notification-button__count">{badge}</b> : null}
      </button>
      {open ? (
        <div className="notifications-popover" id={panelId} role="dialog" aria-label="Notificaciones">
          <header className="notifications-popover__head">
            <strong>Notificaciones</strong>
            <button type="button" className="notifications-popover__mark" onClick={onMarkAllRead} disabled={!unreadCount}>
              <Checks size={15} weight="bold" aria-hidden="true" /> Marcar todo como leído
            </button>
          </header>
          {items.length ? (
            <ol className="notifications-popover__list">
              {items.map(({ interaction, at, unread }) => (
                <li key={interaction.contactKey ?? interaction.id}>
                  <button
                    type="button"
                    className={`notification-item${unread ? " is-unread" : ""}`}
                    onClick={() => {
                      setOpen(false);
                      onOpen(interaction);
                    }}
                  >
                    <span className="notification-item__avatar" aria-hidden="true">
                      <ProfileAvatar url={interaction.customerAvatarUrl} initials={initials(interaction.customerName)} />
                      <span className="notification-item__network">
                        <SocialPlatformIcon platform={interaction.platform} size={11} weight="fill" />
                      </span>
                    </span>
                    <span className="notification-item__body">
                      <span className="notification-item__title">
                        <strong>{notificationTitle(interaction.kind)}</strong>
                        <span> · {platformLabel(interaction.platform)}</span>
                      </span>
                      <span className="notification-item__who">{interaction.customerName} · {interaction.brandName}</span>
                      <span className="notification-item__text">{interaction.preview}</span>
                    </span>
                    <span className="notification-item__meta">
                      <time dateTime={at} title={new Date(at).toLocaleString("es-CL")}>{notificationAge(at, now)}</time>
                      {unread ? <i className="notification-item__dot" aria-label="Sin leer" /> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="notifications-popover__empty">{loading ? "Cargando…" : "No hay mensajes ni comentarios nuevos."}</p>
          )}
          <footer className="notifications-popover__foot">
            <span>{pendingCount === undefined ? "" : `${pendingCount} por atender en plazo`}</span>
            <button type="button" onClick={() => { setOpen(false); onOpenInbox(); }}>Ver Bandeja SAC</button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
