/**
 * Avatar y menú de perfil de la esquina superior derecha, como en las demás apps WIWO:
 * nombre, correo, tipo de identidad, rol y "Cerrar sesión".
 */
import { useEffect, useId, useRef, useState } from "react";
import { SignOut } from "@phosphor-icons/react";
import type { SessionActor } from "../types";

const ROLE_LABEL: Record<SessionActor["role"], string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  agent: "Agente",
  viewer: "Lectura",
};

function identityLabel(source: SessionActor["source"]): string {
  if (source === "dev") return "Prueba local";
  if (source === "google") return "Interno";
  return "Sesión local";
}

type ProfileMenuProps = {
  actor: SessionActor;
  onSignOut?: () => Promise<void>;
};

export function ProfileMenu({ actor, onSignOut }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const initial = (actor.displayName.trim().charAt(0) || "?").toLocaleUpperCase("es");

  useEffect(() => {
    if (!open) return;
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

  async function handleSignOut() {
    if (!onSignOut || signingOut) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="profile-avatar"
        aria-label={`Perfil de ${actor.displayName}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        {initial}
      </button>
      {open ? (
        <div className="profile-popover" id={menuId} role="dialog" aria-label="Perfil">
          <div className="profile-popover__identity">
            <strong>{actor.displayName}</strong>
            {actor.email ? <span title={actor.email}>{actor.email}</span> : null}
          </div>
          <div className="profile-popover__chips">
            <span className="profile-chip">{identityLabel(actor.source)}</span>
            <span className="profile-chip profile-chip--role">{ROLE_LABEL[actor.role]}</span>
          </div>
          {onSignOut ? (
            <>
              <hr />
              <button type="button" className="profile-popover__signout" onClick={() => void handleSignOut()} disabled={signingOut}>
                <SignOut size={20} />
                {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
