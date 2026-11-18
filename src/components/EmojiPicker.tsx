/**
 * Botón de emojis para el compositor de Gestión DMs/comentarios. Lista propia y corta (sin dependencias ni
 * descargas), pensada para atención al cliente, con los últimos usados recordados en este navegador.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Smiley } from "@phosphor-icons/react";

const RECENT_KEY = "wiwo-nodes:recent-emojis";
const RECENT_LIMIT = 16;

const CATEGORIES = [
  { id: "caras", label: "Caras", icon: "😀", emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "😉", "😍", "🥰", "😘", "😋", "😎", "🤩", "🥳", "🤗", "🤔", "🤭", "😮", "😯", "🙄", "😏", "😌", "😔", "😕", "😢", "😭", "😤", "😳", "😱", "🥺", "😴", "🤒", "😷", "🤓", "🫶"] },
  { id: "gestos", label: "Gestos", icon: "👍", emojis: ["👍", "👎", "👌", "🤌", "🤞", "✌️", "🤟", "🤙", "👏", "🙌", "🙏", "💪", "👋", "🤝", "✋", "👉", "👆", "👇", "☝️", "👀", "🫡", "🤷", "🙋", "💁"] },
  { id: "corazones", label: "Corazones y celebración", icon: "❤️", emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💕", "💖", "💗", "💘", "💯", "✨", "🔥", "🎉", "🎊", "🥂", "⭐", "🌟", "🏆", "🎈", "🎂", "🎶"] },
  { id: "compras", label: "Compras y atención", icon: "📦", emojis: ["📦", "🚚", "🛒", "🛍️", "🎁", "🏷️", "💳", "💰", "🧾", "📅", "⏰", "⏳", "📍", "🏬", "📞", "📱", "📧", "💬", "📸", "🔗", "🔧", "🔒", "📝", "📢"] },
  { id: "simbolos", label: "Símbolos", icon: "✅", emojis: ["✅", "☑️", "✔️", "❌", "⚠️", "ℹ️", "❓", "❗", "➡️", "⬅️", "⬆️", "⬇️", "🔝", "🆕", "🆗", "🔔", "🕐", "♻️", "🇨🇱", "🌎", "🔴", "🟢", "🔵", "🟡"] },
  { id: "naturaleza", label: "Naturaleza y comida", icon: "🌸", emojis: ["☀️", "🌙", "🌈", "⛅", "❄️", "🌊", "🌸", "🌻", "🌿", "🍀", "🐶", "🐱", "🍕", "🍔", "🌮", "🍟", "☕", "🍰", "🍫", "🍷", "⚽", "🎮", "🎬", "✈️"] },
] as const;

function readRecent(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function rememberRecent(emoji: string, current: string[]): string[] {
  const next = [emoji, ...current.filter((item) => item !== emoji)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Sin almacenamiento: los recientes duran mientras la vista esté abierta.
  }
  return next;
}

export function EmojiPicker({ onPick, disabled = false }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => readRecent());
  const [categoryId, setCategoryId] = useState<string>(() => (readRecent().length ? "recientes" : CATEGORIES[0].id));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // El compositor recorta lo que se sale de él: el panel se fija a la ventana, anclado sobre el botón.
  const [anchor, setAnchor] = useState<CSSProperties>({});
  const panelId = useId();

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchor({
        right: Math.max(8, window.innerWidth - rect.right),
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const tabs = [
    ...(recent.length ? [{ id: "recientes", label: "Recientes", icon: "🕘", emojis: recent }] : []),
    ...CATEGORIES.map((category) => ({ ...category, emojis: [...category.emojis] })),
  ];
  const active = tabs.find((tab) => tab.id === categoryId) ?? tabs[0]!;

  const pick = (emoji: string) => {
    setRecent((current) => rememberRecent(emoji, current));
    onPick(emoji);
  };

  return (
    <div className="emoji-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="emoji-picker__trigger"
        onClick={toggle}
        disabled={disabled}
        aria-label="Insertar emoji"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title="Emojis"
      >
        <Smiley size={20} weight={open ? "fill" : "regular"} aria-hidden="true" />
      </button>
      {open ? (
        <div className="emoji-picker__panel" id={panelId} role="dialog" aria-label="Emojis" style={anchor}>
          <div className="emoji-picker__tabs" role="tablist" aria-label="Categorías de emojis">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === active.id}
                className={tab.id === active.id ? "is-active" : ""}
                onClick={() => setCategoryId(tab.id)}
                title={tab.label}
              >
                <span aria-hidden="true">{tab.icon}</span>
                <span className="sr-only">{tab.label}</span>
              </button>
            ))}
          </div>
          <p className="emoji-picker__heading">{active.label}</p>
          <div className="emoji-picker__grid" role="tabpanel" aria-label={active.label}>
            {active.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => pick(emoji)}
                // No quita el foco del texto: el emoji entra donde estaba el cursor.
                onMouseDown={(event) => event.preventDefault()}
                aria-label={`Insertar ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
