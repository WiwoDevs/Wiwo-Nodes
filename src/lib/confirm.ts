/**
 * Confirmaciones dentro de la página (reemplazan window.confirm): `await confirmAction({...})`
 * devuelve true si la persona acepta. Un único <ConfirmHost /> montado en la app las muestra.
 */
export type ConfirmTone = "default" | "danger";

export type ConfirmOptions = {
  title: string;
  /** Texto principal; los saltos de línea dobles separan párrafos. */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" para acciones que quitan acceso, desactivan o descartan trabajo. */
  tone?: ConfirmTone;
};

export type ConfirmRequest = ConfirmOptions & { id: number; resolve: (accepted: boolean) => void };

type Listener = (request: ConfirmRequest | null) => void;

let listener: Listener | null = null;
let current: ConfirmRequest | null = null;
let sequence = 0;

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  // Sin host montado (no debería pasar), se cancela: nunca se ejecuta una acción sin confirmar.
  if (!listener) return Promise.resolve(false);
  // Una confirmación nueva reemplaza a la anterior, que queda cancelada.
  current?.resolve(false);
  return new Promise<boolean>((resolve) => {
    const request: ConfirmRequest = {
      ...options,
      id: ++sequence,
      resolve: (accepted) => {
        if (current?.id === request.id) {
          current = null;
          listener?.(null);
        }
        resolve(accepted);
      },
    };
    current = request;
    listener?.(request);
  });
}

export function subscribeConfirm(next: Listener): () => void {
  listener = next;
  next(current);
  return () => {
    if (listener === next) listener = null;
  };
}
