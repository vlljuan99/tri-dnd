import { api } from '../api.js';

// Biblioteca del DM (Fase 15): objetos ('objetos') y hechizos ('hechizos')
// propios. El `data` va con forma de entrada del SRD para reutilizar el
// consumo de la ficha; estas funciones lo construyen/parsean.

export function listLibrary(tipo, q = '') {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return api(`/biblioteca/${tipo}${qs}`).then((d) => d.results);
}
export const createLibrary = (tipo, body) => api(`/biblioteca/${tipo}`, { method: 'POST', body });
export const updateLibrary = (tipo, id, body) => api(`/biblioteca/${tipo}/${id}`, { method: 'PUT', body });
export const deleteLibrary = (tipo, id) => api(`/biblioteca/${tipo}/${id}`, { method: 'DELETE' });

// --- Opciones fijas (etiquetas en español) --------------------------------

export const EQUIPMENT_CATEGORIES = [
  { index: 'weapon', label: 'Arma' },
  { index: 'armor', label: 'Armadura' },
  { index: 'adventuring-gear', label: 'Equipo de aventura' },
  { index: 'tools', label: 'Herramientas' },
  { index: 'potion', label: 'Poción' },
  { index: 'ring', label: 'Anillo' },
  { index: 'wand', label: 'Varita' },
  { index: 'staff', label: 'Bastón' },
  { index: 'rod', label: 'Vara' },
  { index: 'scroll', label: 'Pergamino' },
  { index: 'wondrous-items', label: 'Objeto maravilloso' },
  { index: 'mounts-and-vehicles', label: 'Montura o vehículo' },
];

export const RARITIES = ['Común', 'Poco común', 'Raro', 'Muy raro', 'Legendario', 'Artefacto'];

export const WEAPON_RANGES = [
  { value: 'Melee', label: 'Cuerpo a cuerpo' },
  { value: 'Ranged', label: 'A distancia' },
];

export const DC_TYPES = [
  { index: 'str', label: 'FUE' },
  { index: 'dex', label: 'DES' },
  { index: 'con', label: 'CON' },
  { index: 'int', label: 'INT' },
  { index: 'wis', label: 'SAB' },
  { index: 'cha', label: 'CAR' },
];

export const ATTACK_TYPES = [
  { value: '', label: 'Sin ataque' },
  { value: 'melee', label: 'Cuerpo a cuerpo' },
  { value: 'ranged', label: 'A distancia' },
];

const label = (list, key, prop = 'index', lab = 'label') =>
  list.find((o) => o[prop] === key)?.[lab] ?? key;

// --- Objeto: formulario <-> data con forma SRD ----------------------------

export function buildItemData(form, damageTypes, properties) {
  const dt = (idx) => (idx ? { index: idx, name: label(damageTypes, idx, 'index', 'name') } : undefined);
  const data = { desc: form.desc.trim() ? [form.desc.trim()] : [] };
  if (form.category) {
    data.equipment_category = { index: form.category, name: label(EQUIPMENT_CATEGORIES, form.category) };
  }
  if (form.rarity) data.rarity = { name: form.rarity };
  if (form.category === 'weapon') {
    if (form.damageDice.trim()) data.damage = { damage_dice: form.damageDice.trim(), damage_type: dt(form.damageType) };
    if (form.versatileDice.trim())
      data.two_handed_damage = { damage_dice: form.versatileDice.trim(), damage_type: dt(form.damageType) };
    data.properties = form.properties.map((p) => ({ index: p, name: label(properties, p, 'index', 'name') }));
    if (form.weaponRange) data.weapon_range = form.weaponRange;
  }
  if (form.category === 'armor' && form.armorClass) {
    data.armor_class = { base: Number(form.armorClass) };
  }
  return data;
}

export function itemDataToForm(data = {}) {
  return {
    category: data.equipment_category?.index ?? 'weapon',
    rarity: data.rarity?.name ?? '',
    damageDice: data.damage?.damage_dice ?? '',
    damageType: data.damage?.damage_type?.index ?? data.two_handed_damage?.damage_type?.index ?? '',
    versatileDice: data.two_handed_damage?.damage_dice ?? '',
    properties: (data.properties ?? []).map((p) => p.index),
    weaponRange: data.weapon_range ?? '',
    armorClass: data.armor_class?.base ?? '',
    desc: (data.desc ?? []).join('\n'),
  };
}

export const emptyItemForm = () => ({
  category: 'weapon',
  rarity: '',
  damageDice: '',
  damageType: '',
  versatileDice: '',
  properties: [],
  weaponRange: 'Melee',
  armorClass: '',
  desc: '',
});

// --- Hechizo: formulario <-> data con forma SRD ---------------------------

export function buildSpellData(form, damageTypes, schools) {
  const level = Number(form.level) || 0;
  const data = {
    level,
    concentration: Boolean(form.concentration),
    ritual: Boolean(form.ritual),
    desc: form.desc.trim() ? [form.desc.trim()] : [],
  };
  if (form.school) data.school = { index: form.school, name: label(schools, form.school, 'index', 'name') };
  if (form.attackType) data.attack_type = form.attackType;
  if (form.dcType) data.dc = { dc_type: { index: form.dcType } };
  if (form.range.trim()) data.range = form.range.trim();
  if (form.duration.trim()) data.duration = form.duration.trim();
  if (form.damageDice.trim()) {
    data.damage = {
      damage_type: form.damageType
        ? { index: form.damageType, name: label(damageTypes, form.damageType, 'index', 'name') }
        : undefined,
      // Misma forma que el SRD: castSpellRoll lee damage_at_slot_level[nivel]
      damage_at_slot_level: { [String(level)]: form.damageDice.trim() },
    };
  }
  return data;
}

export function spellDataToForm(data = {}) {
  const slot = data.damage?.damage_at_slot_level ?? {};
  return {
    level: data.level ?? 0,
    school: data.school?.index ?? '',
    attackType: data.attack_type ?? '',
    dcType: data.dc?.dc_type?.index ?? '',
    range: data.range ?? '',
    duration: data.duration ?? '',
    damageDice: slot[String(data.level ?? 0)] ?? Object.values(slot)[0] ?? '',
    damageType: data.damage?.damage_type?.index ?? '',
    concentration: Boolean(data.concentration),
    ritual: Boolean(data.ritual),
    desc: (data.desc ?? []).join('\n'),
  };
}

export const emptySpellForm = () => ({
  level: 0,
  school: '',
  attackType: '',
  dcType: '',
  range: '',
  duration: '',
  damageDice: '',
  damageType: '',
  concentration: false,
  ritual: false,
  desc: '',
});
