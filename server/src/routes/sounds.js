import { Router, raw as expressRaw } from 'express';
import { requireAuth } from '../auth.js';
import {
  MAX_SOUND_BYTES,
  canEditSounds,
  clearSound,
  isSoundKey,
  saveSound,
  serializeSounds,
} from '../services/soundLibrary.js';

// Sonidos de la mesa. Cualquiera que haya entrado necesita LEER el catálogo
// (su navegador tiene que saber qué sonido usar para cada cosa), pero solo el
// administrador puede cambiar los sonidos por defecto de la instalación.
export const soundsRouter = Router();

soundsRouter.use(requireAuth);

soundsRouter.get('/', (req, res) => {
  res.json({
    sonidos: serializeSounds(),
    puedeEditar: canEditSounds(req.user),
  });
});

function requireSoundAdmin(req, res) {
  if (canEditSounds(req.user)) return true;
  res.status(403).json({ error: 'Solo el administrador puede cambiar los sonidos de la instalación' });
  return false;
}

soundsRouter.put(
  '/:key',
  // Binario crudo, como el resto de subidas de la API, para no forzar el
  // body-parser JSON global.
  expressRaw({ type: () => true, limit: MAX_SOUND_BYTES }),
  (req, res) => {
    if (!requireSoundAdmin(req, res)) return;
    if (!isSoundKey(req.params.key)) {
      return res.status(404).json({ error: 'Ese sonido no existe en el catálogo' });
    }

    const result = saveSound({
      key: req.params.key,
      buffer: req.body,
      mimeType: req.headers['content-type'],
      originalName: typeof req.headers['x-nombre-original'] === 'string'
        ? decodeURIComponent(req.headers['x-nombre-original']).slice(0, 120)
        : null,
      userId: req.user.id,
    });
    if (result.error) return res.status(400).json({ error: result.error });

    res.json({ sonidos: serializeSounds(), puedeEditar: true });
  }
);

soundsRouter.delete('/:key', (req, res) => {
  if (!requireSoundAdmin(req, res)) return;
  const result = clearSound({ key: req.params.key });
  if (result.error) return res.status(404).json({ error: result.error });
  res.json({ sonidos: serializeSounds(), puedeEditar: true });
});
