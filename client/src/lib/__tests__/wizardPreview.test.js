import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveWizardPreview, previewCharacter, wizardPreviewDeltas, buildWizardEquipment, autoEquipWizardItems } from '../wizardPreview.js';
import { parseStartingEquipment } from '../wizard.js';

const abilities = { str: 14, dex: 12, con: 13, int: 8, wis: 10, cha: 15 };
const character = {
  kind: 'pj', level: 1, class_index: 'fighter', race_index: 'human', abilities,
  hp_max: 99, ac: 99, speed: 99, save_proficiencies: [], skill_proficiencies: ['stealth'],
  weapon_proficiencies: [], inventory: [], wizard_data: { baseAbilities: abilities },
};
const context = {
  classDetails: {
    fighter: { hit_die: 10, saving_throws: [{ index: 'str' }, { index: 'con' }], weapon_proficiencies_resolved: ['simple-weapons', 'martial-weapons'] },
    wizard: { hit_die: 6, saving_throws: [{ index: 'int' }, { index: 'wis' }], weapon_proficiencies_resolved: ['dagger'] },
  },
  raceDetails: {
    human: { speed: 30, ability_bonuses: [] },
    elf: { speed: 35, ability_bonuses: [{ ability_score: { index: 'dex' }, bonus: 2 }], proficiencies: [{ index: 'skill-perception' }] },
  },
};

test('la vista previa deriva PG, CA, velocidad y salvaciones antes de que responda el servidor', () => {
  const preview = deriveWizardPreview(character, context);
  assert.equal(preview.hp, 11);
  assert.equal(preview.ac, 11);
  assert.equal(preview.speed, 30);
  assert.equal(preview.saves.str, 4);
  assert.equal(preview.saves.con, 3);
  assert.equal(preview.skills.stealth, 3);
  assert.equal(character.hp_max, 99, 'anticipar no escribe campos derivados');
});

test('anticipar especie cambia bonos, habilidades automáticas y deltas sin acumular bonos raciales', () => {
  const original = structuredClone(character);
  const before = deriveWizardPreview(character, context);
  const after = deriveWizardPreview(previewCharacter(character, { race_index: 'elf' }), context);
  assert.equal(after.abilities.dex, 14);
  assert.equal(after.ac, 12);
  assert.equal(after.skills.stealth, 4);
  assert.equal(after.skills.perception, 2);
  assert.equal(after.speed, 35);
  assert.ok(wizardPreviewDeltas(before, after).includes('+2 DES'));
  assert.ok(wizardPreviewDeltas(before, after).includes('Sigilo +4'));
  assert.deepEqual(character, original);
  assert.deepEqual(deriveWizardPreview(after.character, context).abilities, after.abilities);
});

test('anticipar clase y características cambia PG, salvaciones y ataques con las mismas reglas de la ficha', () => {
  const sword = { id: 'espada', srdIndex: 'longsword', name: 'Espada larga', slot: 'mano-principal', weapon: { damageDice: '1d8', weaponCategory: 'Martial', weaponRange: 'Melee', properties: [] } };
  const armed = { ...character, inventory: [sword] };
  const fighter = deriveWizardPreview(armed, context);
  assert.equal(fighter.attacks[0].bonus, 4);
  assert.equal(fighter.attacks[0].damage, '1d8+2');
  const wizard = deriveWizardPreview(previewCharacter(armed, { class_index: 'wizard' }), context);
  assert.equal(wizard.hp, 7);
  assert.equal(wizard.saves.str, 2);
  assert.equal(wizard.saves.wis, 2);
  assert.equal(wizard.attacks[0].bonus, 2, 'el mago no añade competencia a la espada larga');
  const stronger = deriveWizardPreview(previewCharacter(armed, { wizard_data: { baseAbilities: { ...abilities, str: 16, con: 16 } } }), context);
  assert.equal(stronger.hp, 13);
  assert.equal(stronger.attacks[0].bonus, 5);
  assert.equal(stronger.attacks[0].damage, '1d8+3');
  assert.equal(stronger.character.wizard_data.baseAbilities.dex, 12);
});

test('las elecciones de equipo anticipan armadura, escudo y arma sin cambiar su colocación original', () => {
  const classDetail = {
    starting_equipment: [{ quantity: 1, equipment: { index: 'leather', name: 'Cuero' } }],
    starting_equipment_options: [{ choose: 1, from: { options: [
      { option_type: 'multiple', items: [
        { option_type: 'counted_reference', count: 1, of: { index: 'shield', name: 'Escudo' } },
        { option_type: 'choice', choice: { choose: 1, from: { option_set_type: 'equipment_category', equipment_category: { index: 'martial-melee-weapons', name: 'Armas marciales' } } } },
      ] },
    ] } }],
  };
  const { fixed, groups } = parseStartingEquipment(classDetail);
  const slot = groups[0].options[0].categorySlots[0];
  const built = buildWizardEquipment({
    fixed, groups,
    groupChoice: { 'equip-0': 'equip-0-0' }, categoryPicks: { [slot.pathKey]: ['longsword'] },
    categoryMembers: { 'martial-melee-weapons': [{ index: 'longsword', name: 'Espada larga' }] },
    itemsByIndex: {
      leather: { index: 'leather', name: 'Cuero', meta: { armorClass: { base: 11, dex_bonus: true }, armorCategory: 'Light' } },
      shield: { index: 'shield', name: 'Escudo', meta: { armorClass: { base: 2, dex_bonus: false }, armorCategory: 'Shield' } },
      longsword: { index: 'longsword', name: 'Espada larga', meta: { damage: { dice: '1d8', type: 'slashing' }, weaponCategory: 'Martial', weaponRange: 'Melee' } },
    },
  });
  assert.equal(built.inventory.find((item) => item.srdIndex === 'shield').slot, 'escudo');
  assert.equal(built.inventory.find((item) => item.srdIndex === 'longsword').slot, 'mano-principal');
  const after = deriveWizardPreview(previewCharacter(character, { inventory: built.inventory }), context);
  assert.equal(after.ac, 14);
  assert.equal(after.attacks[0].bonus, 4);
  assert.ok(wizardPreviewDeltas(deriveWizardPreview(character, context), after).includes('CA 14'));
  assert.ok(wizardPreviewDeltas(deriveWizardPreview(character, context), after).includes('Espada larga +4 · 1d8+2'));
});

test('autoEquip conserva el escudo frente al arma secundaria y respeta las armas a dos manos', () => {
  const shield = { id: 'escudo', armor: { category: 'Shield', base: 2 } };
  const sword = { id: 'espada', weapon: { properties: [] } };
  const dagger = { id: 'daga', weapon: { properties: ['light'] } };
  const equipped = autoEquipWizardItems([shield, sword, dagger]);
  assert.equal(equipped.find((item) => item.id === 'escudo').slot, 'escudo');
  assert.equal(equipped.find((item) => item.id === 'daga').slot, undefined);
  const greatsword = { id: 'espadon', weapon: { properties: ['two-handed'] } };
  const twoHanded = autoEquipWizardItems([shield, greatsword, dagger]);
  assert.equal(twoHanded.find((item) => item.id === 'escudo').slot, null);
  assert.equal(twoHanded.find((item) => item.id === 'espadon').slot, 'mano-principal');
  assert.equal(twoHanded.find((item) => item.id === 'daga').slot, undefined);
});

test('el reparto parcial actualiza la vista previa desde la primera elección y no arrastra bonos anteriores', () => {
  const partial = previewCharacter(character, { wizard_data: { abilityMethod: 'array', baseAbilities: null, poolAssignment: { dex: 15 } } });
  const elf = deriveWizardPreview({ ...partial, race_index: 'elf' }, context);
  assert.equal(elf.abilities.dex, 17);
  assert.equal(elf.ac, 13);
  assert.equal(elf.skills.stealth, 5);
  assert.equal(elf.abilities.con, 10);
  const human = deriveWizardPreview({ ...partial, race_index: 'human' }, context);
  assert.equal(human.abilities.dex, 15);
  assert.equal(human.ac, 12);
  assert.equal(partial.wizard_data.baseAbilities, null);
});
