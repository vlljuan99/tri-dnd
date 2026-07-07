import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * Carga una ficha de personaje y gestiona su autoguardado con debounce.
 * Compartido por la ficha completa y la vista rápida (modo presencial), para
 * que ambas vean y persistan exactamente el mismo estado.
 */
export function useCharacter(id) {
  const [char, setChar] = useState(null);
  const [editable, setEditable] = useState(false);
  const [saveState, setSaveState] = useState('saved'); // saved | pending | saving | error
  const [error, setError] = useState('');

  const pendingRef = useRef({});
  const timerRef = useRef(null);

  useEffect(() => {
    api(`/characters/${id}`)
      .then(({ character, editable }) => {
        setChar(character);
        setEditable(editable);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  async function flush() {
    const body = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(body).length === 0) return;
    setSaveState('saving');
    try {
      await api(`/characters/${id}`, { method: 'PUT', body });
      setSaveState('saved');
    } catch {
      setSaveState('error');
      Object.assign(pendingRef.current, body); // reintentar con el siguiente cambio
    }
  }

  function patch(fields) {
    setChar((c) => ({ ...c, ...fields }));
    Object.assign(pendingRef.current, fields);
    setSaveState('pending');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 800);
  }

  return { char, editable, saveState, error, patch };
}
