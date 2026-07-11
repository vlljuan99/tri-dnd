import { useEffect, useMemo, useRef, useState } from 'react';
import { detectGrid, gridDims, cropToGrid } from '../lib/gridDetection.js';

const ROOM_MAX_SIDE = 100; // límite de map_rooms en el servidor

const inputClass =
  'w-full rounded-sm border border-gold/20 bg-night-950 px-2 py-1 text-sm text-bone focus:border-gold focus:outline-none';
const labelClass = 'block text-[0.65rem] uppercase tracking-widest text-bone/50';

// Modal de calibración al subir el suelo de una sala: detecta la cuadrícula
// dibujada en la imagen, la muestra superpuesta para que el DM la afine y, al
// confirmar, recorta la imagen para que empiece en una línea de cuadrícula y
// devuelve cuántas casillas reales tiene. Así la cuadrícula del tablero
// coincide 1:1 con la de la imagen.
export default function GridCalibrationModal({ file, busy, onCancel, onConfirm, onUploadOriginal }) {
  const [img, setImg] = useState(null);
  const [cal, setCal] = useState(null);
  const [detection, setDetection] = useState(null); // resultado bruto, para "volver a detectar"
  const [error, setError] = useState('');
  const canvasRef = useRef(null);

  // Cargar la imagen y lanzar la detección. La bandera evita que el primer
  // montaje de StrictMode (cuyo object URL se revoca en el cleanup) pise el
  // estado con un error de carga tardío.
  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      setError('');
      setImg(image);
      try {
        const detected = detectGrid(image);
        setDetection(detected);
        setCal(
          detected ?? {
            // Sin detección fiable: propuesta neutra de ~20 casillas de ancho
            cellX: image.naturalWidth / 20,
            cellY: image.naturalWidth / 20,
            offsetX: 0,
            offsetY: 0,
            confidence: 0,
          }
        );
      } catch {
        setError('No se pudo analizar la imagen');
      }
    };
    image.onerror = () => {
      if (!cancelled) setError('No se pudo cargar la imagen');
    };
    image.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const dims = useMemo(() => (img && cal ? gridDims(img, cal) : null), [img, cal]);
  const tooBig = dims && (dims.cols > ROOM_MAX_SIDE || dims.rows > ROOM_MAX_SIDE);

  // Vista previa: imagen encogida con la cuadrícula calibrada encima y la
  // región que se conservará marcada en dorado
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img || !cal) return;
    const maxW = 640;
    const maxH = 420;
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(232, 195, 104, 0.85)';
    ctx.lineWidth = 1;
    for (let x = cal.offsetX; x <= img.naturalWidth + 0.5; x += cal.cellX) {
      const px = Math.round(x * scale) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, canvas.height);
      ctx.stroke();
    }
    for (let y = cal.offsetY; y <= img.naturalHeight + 0.5; y += cal.cellY) {
      const py = Math.round(y * scale) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(canvas.width, py);
      ctx.stroke();
    }

    if (dims) {
      ctx.strokeStyle = '#e8c368';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        cal.offsetX * scale,
        cal.offsetY * scale,
        dims.cols * cal.cellX * scale,
        dims.rows * cal.cellY * scale
      );
    }
  }, [img, cal, dims]);

  function numberField(name, { step, min }) {
    return {
      type: 'number',
      step,
      min,
      className: inputClass,
      value: cal ? Math.round(cal[name] * 10) / 10 : '',
      onChange: (e) => {
        const v = Number.parseFloat(e.target.value);
        if (Number.isFinite(v) && v >= min) setCal((c) => ({ ...c, [name]: v }));
      },
    };
  }

  async function apply() {
    if (!img || !cal || !dims || tooBig) return;
    setError('');
    try {
      const { blob, cols, rows } = await cropToGrid(img, cal);
      await onConfirm({ blob, cols, rows });
    } catch (e) {
      setError(e.message || 'No se pudo procesar la imagen');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-sm border border-gold/25 bg-night-900 p-4 shadow-xl">
        <h2 className="font-display text-lg text-gold">Ajustar cuadrícula de la imagen</h2>
        <p className="mt-1 text-xs text-bone/60">
          {detection
            ? detection.confidence >= 0.35
              ? 'Cuadrícula detectada automáticamente. Comprueba que las líneas doradas coinciden con las de la imagen y afínala si hace falta.'
              : 'La detección no es fiable en esta imagen: ajusta el tamaño de casilla y el desfase a mano hasta que las líneas doradas coincidan.'
            : 'Analizando la imagen…'}
        </p>

        <div className="mt-3 flex justify-center rounded-sm border border-gold/15 bg-night-950 p-2">
          {error ? (
            <p className="py-10 text-sm text-blood">{error}</p>
          ) : (
            <canvas ref={canvasRef} className="max-w-full" />
          )}
        </div>

        {cal && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <label className={labelClass}>Casilla ancho (px)</label>
                <input {...numberField('cellX', { step: 0.5, min: 4 })} />
              </div>
              <div>
                <label className={labelClass}>Casilla alto (px)</label>
                <input {...numberField('cellY', { step: 0.5, min: 4 })} />
              </div>
              <div>
                <label className={labelClass}>Desfase X (px)</label>
                <input {...numberField('offsetX', { step: 1, min: 0 })} />
              </div>
              <div>
                <label className={labelClass}>Desfase Y (px)</label>
                <input {...numberField('offsetY', { step: 1, min: 0 })} />
              </div>
            </div>

            <p className="mt-2 text-sm text-bone/80">
              La sala quedará de{' '}
              <span className="font-display text-gold">
                {dims ? `${dims.cols} × ${dims.rows}` : '—'}
              </span>{' '}
              casillas.
              {tooBig && (
                <span className="text-blood">
                  {' '}
                  Supera el máximo de {ROOM_MAX_SIDE} casillas por lado: sube el tamaño de casilla o
                  recorta la imagen antes.
                </span>
              )}
            </p>
          </>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={apply}
            disabled={busy || !cal || !dims || tooBig || !!error}
            className="flex-1 rounded-sm bg-gold/80 px-3 py-1.5 font-display text-sm text-night-950 hover:bg-gold disabled:opacity-40"
          >
            Aplicar cuadrícula y subir
          </button>
          <button
            type="button"
            onClick={onUploadOriginal}
            disabled={busy}
            className="rounded-sm border border-bone/30 px-3 py-1.5 text-sm text-bone/70 hover:bg-bone/5 disabled:opacity-40"
          >
            Subir sin ajustar
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-sm border border-blood/40 px-3 py-1.5 text-sm text-blood hover:bg-blood/10 disabled:opacity-40"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
