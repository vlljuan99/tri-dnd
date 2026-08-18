import { useEffect, useMemo, useRef, useState } from 'react';
import { SFX_GROUPS, eventsOfGroup } from '../lib/sfx/catalog.js';
import { fetchSounds, resetSound, uploadSound } from '../lib/sfx/api.js';
import { getSettings, preview, setOverrides, setSettings } from '../lib/sfx/index.js';

// Configuración de sonido. Tiene dos mitades muy distintas:
//
// - **Volumen y silencio**: preferencia de cada persona, guardada en su
//   navegador. La ve y la cambia cualquiera.
// - **Los sonidos en sí**: son de la instalación entera, así que solo los toca
//   el administrador. Más adelante cada DM podrá pisar estos por mesa, y estos
//   seguirán siendo los que reciba por defecto.

function Fila({ evento, estado, puedeEditar, onSubir, onRestaurar, ocupado }) {
  const inputRef = useRef(null);
  const personalizado = Boolean(estado?.custom);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-ink/10 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm tracking-wide text-ink">{evento.label}</p>
        <p className="text-xs text-ink/60">{evento.hint}</p>
        <p className="mt-0.5 text-xs">
          {personalizado ? (
            <span className="text-ember">
              Personalizado{estado.originalName ? ` · ${estado.originalName}` : ''}
            </span>
          ) : (
            <span className="text-ink/45">Sintetizado</span>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={() => preview(evento.key)}
        className="rounded-sm border border-ink/25 px-3 py-1.5 text-sm text-ink/80 hover:border-ember hover:text-ember"
      >
        Escuchar
      </button>

      {puedeEditar && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onSubir(evento.key, file);
            }}
          />
          <button
            type="button"
            disabled={ocupado}
            onClick={() => inputRef.current?.click()}
            className="rounded-sm border border-ink/25 px-3 py-1.5 text-sm text-ink/80 hover:border-ember hover:text-ember disabled:opacity-40"
          >
            {personalizado ? 'Cambiar' : 'Subir'}
          </button>
          {personalizado && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onRestaurar(evento.key)}
              className="rounded-sm border border-transparent px-2 py-1.5 text-sm text-ink/50 hover:text-ember disabled:opacity-40"
            >
              Restaurar
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function SoundSettingsPage() {
  const [sonidos, setSonidos] = useState(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [ajustes, setAjustes] = useState(() => getSettings());

  const porClave = useMemo(
    () => Object.fromEntries((sonidos ?? []).map((sonido) => [sonido.key, sonido])),
    [sonidos]
  );

  function aplicar(data) {
    setSonidos(data.sonidos ?? []);
    setPuedeEditar(Boolean(data.puedeEditar));
    // El reproductor tiene que enterarse en el acto: si acabas de subir un
    // sonido, el botón de escuchar debe usar ya el nuevo.
    setOverrides(
      Object.fromEntries((data.sonidos ?? []).filter((s) => s.url).map((s) => [s.key, s.url]))
    );
  }

  useEffect(() => {
    fetchSounds()
      .then(aplicar)
      .catch((cause) => setError(cause.message));
  }, []);

  async function onSubir(key, file) {
    setOcupado(true);
    setError('');
    try {
      aplicar(await uploadSound(key, file));
      preview(key);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setOcupado(false);
    }
  }

  async function onRestaurar(key) {
    setOcupado(true);
    setError('');
    try {
      aplicar(await resetSound(key));
      preview(key);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setOcupado(false);
    }
  }

  function cambiarAjustes(next) {
    setAjustes(setSettings(next));
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h2 className="font-display text-2xl tracking-wide text-ink">Sonido</h2>
      <p className="mt-1 text-sm text-ink/70">
        Los efectos nacen sintetizados, sin ficheros. Cualquiera de ellos se puede sustituir por una
        grabación propia: un dado de verdad sobre madera no hay síntesis que lo imite.
      </p>

      <section className="mt-5 rounded-sm border border-ink/15 bg-parchment-100/60 p-4">
        <h3 className="font-display text-sm uppercase tracking-widest text-ink/70">Tu volumen</h3>
        <p className="mt-0.5 text-xs text-ink/55">
          Es tuyo y de este navegador: no afecta a lo que oye el resto de la mesa.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex flex-1 items-center gap-3 text-sm text-ink/80">
            <span className="w-16">Volumen</span>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(ajustes.volume * 100)}
              onChange={(event) => cambiarAjustes({ volume: Number(event.target.value) / 100 })}
              className="h-1 flex-1 accent-ember"
            />
            <span className="w-10 text-right font-mono text-xs text-ink/60">
              {Math.round(ajustes.volume * 100)}%
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink/80">
            <input
              type="checkbox"
              checked={ajustes.muted}
              onChange={(event) => cambiarAjustes({ muted: event.target.checked })}
              className="accent-ember"
            />
            Silenciar
          </label>
        </div>
      </section>

      {error && (
        <p className="mt-4 rounded-sm border border-ember/40 bg-ember/10 px-3 py-2 text-sm text-ember">
          {error}
        </p>
      )}

      {sonidos === null ? (
        <p className="mt-6 text-sm text-ink/60">Cargando sonidos…</p>
      ) : (
        <>
          {!puedeEditar && (
            <p className="mt-5 rounded-sm border border-ink/15 bg-parchment-100/60 px-3 py-2 text-sm text-ink/65">
              Puedes escuchar los sonidos y ajustar tu volumen. Cambiarlos para toda la instalación
              es cosa del administrador.
            </p>
          )}
          {SFX_GROUPS.map((grupo) => (
            <section key={grupo.id} className="mt-6">
              <h3 className="font-display text-sm uppercase tracking-widest text-ink/70">
                {grupo.label}
              </h3>
              <div className="mt-1 rounded-sm border border-ink/15 bg-parchment-100/40 px-4">
                {eventsOfGroup(grupo.id).map((evento) => (
                  <Fila
                    key={evento.key}
                    evento={evento}
                    estado={porClave[evento.key]}
                    puedeEditar={puedeEditar}
                    ocupado={ocupado}
                    onSubir={onSubir}
                    onRestaurar={onRestaurar}
                  />
                ))}
              </div>
            </section>
          ))}
          {puedeEditar && (
            <p className="mt-6 text-xs text-ink/50">
              Formatos admitidos: mp3, ogg, wav, webm y m4a, hasta 2 MB. Son efectos cortos, no
              música: lo que subas aquí lo oirá toda la instalación.
            </p>
          )}
        </>
      )}
    </div>
  );
}
