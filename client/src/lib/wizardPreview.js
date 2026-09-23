// Vista previa del creador: adapta las decisiones locales a los espejos de
// reglas existentes. Ningún valor derivado de aquí se envía al servidor.
import {
  ABILITIES, SKILLS, abilityModifier, estimateHitPoints, saveBonus, skillBonus,
  weaponAttackBonus, weaponDamageModifier, formatModifier,
} from './dnd.js';
import { computeArmorClass, equipItem, inventoryItemFromEntry, isTwoHanded } from './equipment.js';
import { applyRacialBonuses, mergeAutomaticSkills, raceAutomaticSkills } from './wizard.js';

/** El parche de una opción puede aportar solo la parte de wizard_data que cambia. */
export function previewCharacter(character, fields = {}) {
  return {
    ...character,
    ...fields,
    wizard_data: { ...character.wizard_data, ...fields.wizard_data },
  };
}

const PORTRAIT_PROGRESS = [0, 12, 38, 55, 70, 86, 94, 100];

/** Progreso cosmético del retrato: nunca participa en reglas ni se persiste. */
export function wizardPortraitProgress({ stage = 0, classIndex = null, raceIndex = null, avatarPath = null } = {}) {
  if (avatarPath) return 100;
  const safeStage = Math.max(0, Math.min(PORTRAIT_PROGRESS.length - 1, Math.trunc(Number(stage) || 0)));
  // La especie perfila el origen, pero la clase sigue siendo la que termina de
  // definir la pose jugable. El tope evita presentar un aspecto como cerrado.
  if (!classIndex) return raceIndex ? Math.max(28, Math.min(PORTRAIT_PROGRESS[safeStage], 38)) : 0;
  return PORTRAIT_PROGRESS[safeStage];
}

export function deriveWizardPreview(character, context = {}) {
  const classDetail = context.classDetails?.[character.class_index] ?? context.classDetail;
  const raceDetail = context.raceDetails?.[character.race_index] ?? context.raceDetail;
  const data = character.wizard_data ?? {};
  // Cada valor asignado se anticipa sin esperar a completar los seis. La
  // base neutra de 10 evita arrastrar bonos de un reparto o especie anterior.
  const base = data.baseAbilities ?? Object.fromEntries(ABILITIES.map(({ key }) => [key, data.poolAssignment?.[key] ?? 10]));
  const abilities = applyRacialBonuses(base, raceDetail, data.raceAbilityChoice ?? []);
  const rules = {
    ...character,
    level: character.level ?? 1,
    abilities: Object.fromEntries(ABILITIES.map(({ key }) => [key, abilities?.[key] ?? 10])),
    save_proficiencies: classDetail?.saving_throws?.map((save) => save.index) ?? character.save_proficiencies ?? [],
    skill_proficiencies: raceDetail
      ? mergeAutomaticSkills(character.skill_proficiencies, data.appliedRaceSkillProficiencies, raceAutomaticSkills(raceDetail))
      : character.skill_proficiencies ?? [],
    weapon_proficiencies: classDetail?.weapon_proficiencies_resolved ?? character.weapon_proficiencies ?? [],
    speed: raceDetail?.speed ?? character.speed ?? 30,
  };
  return {
    character: rules,
    hp: classDetail?.hit_die
      ? Math.max(1, estimateHitPoints(classDetail.hit_die, abilityModifier(rules.abilities.con), rules.level))
      : character.hp_max ?? 0,
    ac: computeArmorClass(rules),
    speed: rules.speed,
    abilities: rules.abilities,
    saves: Object.fromEntries(ABILITIES.map(({ key }) => [key, saveBonus(rules, key)])),
    skills: Object.fromEntries(SKILLS.map((skill) => [skill.index, skillBonus(rules, skill)])),
    attacks: (rules.inventory ?? []).filter((item) => item.weapon).map((item, index) => ({
      key: `${item.srdIndex ?? item.name}-${index}`,
      name: item.name,
      bonus: weaponAttackBonus(rules, item),
      damage: `${item.weapon.damageDice}${formatModifier(weaponDamageModifier(rules, item.weapon))}`,
      damageType: item.weapon.damageType,
      equipped: item.slot === 'mano-principal' || item.slot === 'mano-secundaria',
    })),
  };
}

/** Deltas legibles también para el cajón compacto del móvil. */
export function wizardPreviewDeltas(before, after) {
  const changes = [];
  for (const { key, short } of ABILITIES) {
    const delta = after.abilities[key] - before.abilities[key];
    if (delta) changes.push(`${formatModifier(delta)} ${short}`);
  }
  for (const [key, label] of [['hp', 'PG'], ['ac', 'CA'], ['speed', 'Velocidad']]) {
    if (before[key] !== after[key]) changes.push(`${label} ${after[key]}${key === 'speed' ? ' pies' : ''}`);
  }
  for (const skill of SKILLS) {
    if (before.skills[skill.index] !== after.skills[skill.index]) {
      changes.push(`${skill.name} ${formatModifier(after.skills[skill.index])}`);
    }
  }
  for (const { key, short } of ABILITIES) {
    if (before.saves[key] !== after.saves[key]) changes.push(`Salv. ${short} ${formatModifier(after.saves[key])}`);
  }
  for (const attack of after.attacks) {
    const previous = before.attacks.find((entry) => entry.key === attack.key);
    if (!previous || previous.bonus !== attack.bonus || previous.damage !== attack.damage || previous.equipped !== attack.equipped) {
      changes.push(`${attack.name} ${formatModifier(attack.bonus)} · ${attack.damage}`);
    }
  }
  return changes;
}

/** Conserva la colocación automática que ya usaba el paso de equipo. */
export function autoEquipWizardItems(items) {
  let inventory = items;
  const armor = items.find((item) => item.armor && item.armor.category !== 'Shield');
  if (armor) inventory = equipItem(inventory, armor.id, 'armadura');
  const shield = items.find((item) => item.armor?.category === 'Shield');
  if (shield) inventory = equipItem(inventory, shield.id, 'escudo');
  const weapons = items.filter((item) => item.weapon);
  if (weapons[0]) inventory = equipItem(inventory, weapons[0].id, 'mano-principal');
  if (weapons[1] && !shield && !isTwoHanded(weapons[0]?.weapon)) {
    inventory = equipItem(inventory, weapons[1].id, 'mano-secundaria');
  }
  return inventory;
}

export function buildWizardEquipment({ fixed, groups, groupChoice, categoryPicks, categoryMembers, itemsByIndex }) {
  const grants = [...fixed];
  for (const group of groups) {
    const option = group.options.find((entry) => entry.key === groupChoice[group.key]);
    if (!option) continue;
    grants.push(...option.fixedGrants);
    for (const slot of option.categorySlots) {
      for (const index of (categoryPicks[slot.pathKey] ?? []).filter(Boolean)) {
        const member = categoryMembers[slot.categoryIndex]?.find((entry) => entry.index === index);
        if (member) grants.push({ index, name: member.name, qty: 1 });
      }
    }
  }
  return {
    signature: JSON.stringify(grants),
    inventory: autoEquipWizardItems(grants.map((grant) => inventoryItemFromEntry(
      itemsByIndex[grant.index] ?? { index: grant.index, name: grant.name, meta: {} }, grant.qty,
    ))),
  };
}
