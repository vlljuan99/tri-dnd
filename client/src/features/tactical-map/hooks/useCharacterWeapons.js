import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api.js';
import { weaponSlots } from '../domain/weaponSlots.js';

// Ficha del personaje con sus armas listas para usar. El alcance de un arma no
// viaja en el inventario (solo su índice del SRD), así que hay que completarlo
// pidiendo el equipo al compendio; sin eso, el hotbar no puede decir si el arco
// llega y el panel de ataque tampoco.
//
// Lo usan el hotbar (para pintar los slots) y el panel de ataque (para tirar),
// que antes hacían por su cuenta esta misma carga.
async function withWeaponRanges(character) {
  const inventory = await Promise.all(
    character.inventory.map(async (item) => {
      if (!item.weapon || item.weapon.range || !item.srdIndex) return item;
      try {
        const detail = await api(`/srd/equipment/${item.srdIndex}`);
        return {
          ...item,
          weapon: {
            ...item.weapon,
            range: detail.data?.range ?? null,
            throwRange: detail.data?.throw_range ?? null,
            properties: item.weapon.properties?.length
              ? item.weapon.properties
              : (detail.data?.properties ?? []).map((property) => property.index),
          },
        };
      } catch {
        // Sin el detalle del SRD el arma sigue siendo usable: se queda con el
        // alcance por defecto de su tipo en `weaponGeometry`.
        return item;
      }
    })
  );
  return { ...character, inventory };
}

export function useCharacterWeapons(characterId) {
  const [character, setCharacter] = useState(null);
  const [error, setError] = useState('');
  // Saquear un cofre o cambiar de mano un arma no recarga la página: el
  // hotbar tiene que volver a pedir la ficha para reflejarlo (Fase E).
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!characterId) {
      setCharacter(null);
      return undefined;
    }
    let cancelled = false;
    setCharacter(null);
    setError('');
    api(`/characters/${characterId}`)
      .then(({ character: loaded }) => withWeaponRanges(loaded))
      .then((loaded) => {
        if (!cancelled) setCharacter(loaded);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'No se pudo cargar tu ficha.');
      });
    return () => {
      cancelled = true;
    };
  }, [characterId, reloadToken]);

  return { character, weapons: character ? weaponSlots(character) : [], error, reload };
}
