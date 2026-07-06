/**
 * Guía contextual breve tras finalizar el asistente de creación (o reabierta
 * desde "Ayuda" en la ficha). Se puede cerrar, saltar y no se repite sola en
 * cada acceso: el llamador decide cuándo mostrarla y marca que ya se vio.
 */
import { useEffect, useState } from 'react';

export const TUTORIAL_SEEN_KEY = 'tridnd_sheet_tutorial_seen';

const TIPS = [
  { title: 'Puntos de golpe', body: 'Usa los botones − / + junto a "Puntos de golpe" para reflejar daño o curación, o escribe el valor directamente.' },
  { title: 'Tiradas de característica', body: 'Pulsa el nombre corto de una característica (por ejemplo FUE) para tirar una prueba con su modificador.' },
  { title: 'Ventaja y desventaja', body: 'Al atacar, usa los botones "Vent." y "Desv." junto a "Atacar" para tirar dos veces y quedarte con el mejor o el peor resultado.' },
  { title: 'Realizar un ataque', body: 'Equipa un arma en el inventario y aparecerá en "Ataques", con botones para tirar impacto y daño (incluido crítico).' },
  { title: 'Lanzar un hechizo', body: 'En "Hechizos", cada conjuro conocido muestra botones de ataque o daño según corresponda, y tu CD de salvación arriba de la lista.' },
  { title: 'Consultar el inventario', body: 'En "Inventario" puedes marcar qué llevas equipado, ajustar cantidades y añadir objetos del compendio o propios.' },
  { title: 'Modo edición', body: 'Si la ficha es tuya, todos los campos son editables directamente; los cambios se guardan solos unos segundos después de dejar de escribir.' },
];

export default function SheetTutorial({ open, onClose }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  if (!open) return null;

  const tip = TIPS[i];
  const last = i === TIPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-lg border border-gold/25 bg-night-900 p-4 text-bone sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between text-xs text-bone/50">
          <span>Consejo {i + 1} de {TIPS.length}</span>
          <button onClick={onClose} className="text-bone/50 hover:text-bone">Saltar</button>
        </div>
        <h2 id="tutorial-title" className="font-display text-lg text-gold">{tip.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-bone/70">{tip.body}</p>
        <div className="mt-4 flex justify-between gap-2">
          <button
            onClick={() => setI((v) => Math.max(0, v - 1))}
            disabled={i === 0}
            className="rounded-sm border border-bone/20 px-3 py-1.5 text-sm disabled:opacity-30"
          >
            Anterior
          </button>
          <button
            onClick={() => (last ? onClose() : setI((v) => v + 1))}
            className="rounded-sm bg-gold px-4 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90"
          >
            {last ? 'Entendido' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
}
