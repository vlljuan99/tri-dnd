// Competencia de armas y armaduras que concede una clase (Fase B de la
// rebanada vertical). El `proficiencies` de una clase del SRD solo trae
// {index,name,url}: el tipo (armas, armaduras, herramientas…) y a qué arma o
// categoría concreta se refiere viven en la propia entrada de 'proficiencies',
// así que hay que resolverlas contra el compendio.
//
// Es la ÚNICA fuente de esos tokens: la ruta del compendio los adjunta al
// detalle de la clase para que el asistente los pinte, y la ruta de personajes
// los vuelve a derivar al guardar, sin fiarse de lo que mande el cliente.
import { db } from '../db.js';

/** Tokens de competencia de armas/armaduras a partir de las referencias de una clase. */
export function resolveCombatProficiencies(proficiencyRefs) {
  const weapon = new Set();
  const armor = new Set();
  for (const ref of proficiencyRefs ?? []) {
    if (!ref?.index) continue;
    // "Toda la armadura" es su propia entrada del SRD, pero su `reference`
    // apunta a la categoría genérica "armor" (no a un token que reconozcamos
    // aquí); se guarda el índice de la propia competencia para que
    // isProficientWithArmor la reconozca como comodín de ligera/media/pesada.
    if (ref.index === 'all-armor') {
      armor.add('all-armor');
      continue;
    }
    const row = db.prepare("SELECT data FROM srd_entries WHERE category = 'proficiencies' AND idx = ?").get(ref.index);
    if (!row) continue;
    const data = JSON.parse(row.data);
    const token = data.reference?.index;
    if (!token) continue;
    if (data.type === 'Weapons') weapon.add(token);
    else if (data.type === 'Armor') armor.add(token);
  }
  return { weaponProficiencies: [...weapon], armorProficiencies: [...armor] };
}

/**
 * Competencias de combate de una clase por su índice. Las clases propias del
 * DM (índice `custom:<id>`) no declaran armas ni armaduras en su modelo, así
 * que no conceden ninguna; lo mismo vale para una clase desconocida o vacía.
 */
export function combatProficienciesForClass(classIndex) {
  if (typeof classIndex !== 'string' || !classIndex || classIndex.startsWith('custom:')) {
    return { weaponProficiencies: [], armorProficiencies: [] };
  }
  const row = db.prepare("SELECT data FROM srd_entries WHERE category = 'classes' AND idx = ?").get(classIndex);
  if (!row) return { weaponProficiencies: [], armorProficiencies: [] };
  return resolveCombatProficiencies(JSON.parse(row.data).proficiencies);
}
