import { useToasts } from '../store/toast.js';

// Pila de avisos de la mesa, abajo a la derecha para no taparle al DM el
// tracker (arriba a la derecha) ni el chat. Sustituye a window.alert: no
// bloquea, no hay que cerrarlo y se puede seguir jugando mientras se lee.

export default function ToastStack() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (!toasts.length) return null;

  return (
    <div
      // aria-live para que un lector de pantalla anuncie «No es tu turno» sin
      // que el foco salte: el aviso llega mientras el jugador sigue a lo suyo.
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-72 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismiss(toast.id)}
          title="Descartar"
          className={`pointer-events-auto animate-[toastIn_180ms_ease-out] rounded-sm border px-3 py-2 text-left text-sm shadow-lg shadow-black/40 backdrop-blur ${
            toast.tone === 'error'
              ? 'border-blood/50 bg-night-900/95 text-blood'
              : 'border-gold/40 bg-night-900/95 text-bone/90'
          }`}
        >
          {toast.message}
        </button>
      ))}
      <style>{`@keyframes toastIn{0%{transform:translateY(6px);opacity:0}100%{transform:translateY(0);opacity:1}}`}</style>
    </div>
  );
}
