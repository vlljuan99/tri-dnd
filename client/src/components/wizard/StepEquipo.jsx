import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { srdCampaignPath } from '../../lib/srdCampaign.js';
import { parseStartingEquipment, partLabel } from '../../lib/wizard.js';
import { equipItem, inventoryItemFromEntry, isTwoHanded } from '../../lib/equipment.js';
import HelpBlock from './HelpBlock.jsx';

// Paso «Equipo» (Fase A de la rebanada vertical): construye el inventario a
// partir de `starting_equipment`/`starting_equipment_options` de la clase.
// Es el único camino de equipo inicial — nada de oro ni compra libre todavía
// (ver docs/VERTICAL-SLICE.md, Fase A).

// Coloca los objetos elegidos en sus slots por defecto (armadura → armadura,
// escudo → escudo, primera arma → mano principal); `equipItem` ya resuelve
// los conflictos de armas a dos manos.
//
// La segunda arma solo va a la mano secundaria si esa mano está libre de
// verdad: con escudo equipado o con un arma a dos manos en la principal se
// queda en la mochila, porque equiparla desplazaría al escudo (y quien elige
// «arma marcial + escudo» en el manual quiere el escudo puesto).
function autoEquip(items) {
  let inventory = items;
  const armor = items.find((i) => i.armor && i.armor.category !== 'Shield');
  if (armor) inventory = equipItem(inventory, armor.id, 'armadura');
  const shield = items.find((i) => i.armor?.category === 'Shield');
  if (shield) inventory = equipItem(inventory, shield.id, 'escudo');
  const weapons = items.filter((i) => i.weapon);
  if (weapons[0]) inventory = equipItem(inventory, weapons[0].id, 'mano-principal');
  if (weapons[1] && !shield && !isTwoHanded(weapons[0]?.weapon)) {
    inventory = equipItem(inventory, weapons[1].id, 'mano-secundaria');
  }
  return inventory;
}

/** Elecciones completas (grupo elegido + huecos de categoría rellenos) → objetos concedidos. */
function grantsFromChoices(groups, groupChoice, categoryPicks, categoryMembers) {
  const grants = [];
  for (const group of groups) {
    const option = group.options.find((o) => o.key === groupChoice[group.key]);
    if (!option) continue;
    grants.push(...option.fixedGrants);
    for (const slot of option.categorySlots) {
      const picked = (categoryPicks[slot.pathKey] ?? []).filter(Boolean);
      for (const index of picked) {
        const member = categoryMembers[slot.categoryIndex]?.find((m) => m.index === index);
        if (member) grants.push({ index, name: member.name, qty: 1 });
      }
    }
  }
  return grants;
}

export default function StepEquipo({ char, patch, classDetail, errors }) {
  const { fixed, groups } = useMemo(() => parseStartingEquipment(classDetail), [classDetail]);
  const [itemsByIndex, setItemsByIndex] = useState({});
  const [categoryMembers, setCategoryMembers] = useState({});
  const [categoryNames, setCategoryNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const groupChoice = char.wizard_data.equipmentGroupChoice ?? {};
  const categoryPicks = char.wizard_data.equipmentCategoryPicks ?? {};

  useEffect(() => {
    if (!classDetail) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError('');

    const categoryIndexes = [
      ...new Set(groups.flatMap((g) => g.options.flatMap((o) => o.categorySlots.map((s) => s.categoryIndex)))),
    ];

    async function load() {
      const categoryDetails = await Promise.all(
        categoryIndexes.map((idx) => api(srdCampaignPath('equipment-categories', char.campaign_id, idx)))
      );
      const membersByCategory = {};
      const namesByCategory = {};
      categoryDetails.forEach((detail, i) => {
        membersByCategory[categoryIndexes[i]] = (detail.data?.equipment ?? []).map((ref) => ({
          index: ref.index,
          name: ref.name,
        }));
        // El nombre del compendio ya viene traducido cuando existe en
        // data/translations/es.json; el de la clase siempre está en inglés.
        if (detail.name) namesByCategory[categoryIndexes[i]] = detail.name;
      });

      const allIndexes = new Set();
      fixed.forEach((f) => allIndexes.add(f.index));
      groups.forEach((g) => g.options.forEach((o) => o.fixedGrants.forEach((f) => allIndexes.add(f.index))));
      Object.values(membersByCategory).flat().forEach((m) => allIndexes.add(m.index));

      const entries = await Promise.all(
        [...allIndexes].map((idx) => api(srdCampaignPath('equipment', char.campaign_id, idx)))
      );
      if (cancelled) return;
      setItemsByIndex(Object.fromEntries(entries.map((e) => [e.index, e])));
      setCategoryMembers(membersByCategory);
      setCategoryNames(namesByCategory);
      setLoading(false);
    }

    load().catch((e) => {
      if (!cancelled) {
        setLoadError(e.message);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classDetail?.index, char.campaign_id]);

  // Construye el inventario a partir de las elecciones ya hechas, en cuanto
  // los datos del compendio están cargados. Solo vuelve a escribir cuando la
  // combinación de elecciones cambia de verdad (evita PUTs en bucle).
  useEffect(() => {
    if (loading || !classDetail) return;
    const grants = [...fixed, ...grantsFromChoices(groups, groupChoice, categoryPicks, categoryMembers)];
    const signature = JSON.stringify(grants);
    if (char.wizard_data.appliedEquipmentSignature === signature) return;
    const items = grants.map((grant) =>
      inventoryItemFromEntry(itemsByIndex[grant.index] ?? { index: grant.index, name: grant.name, meta: {} }, grant.qty)
    );
    patch({
      inventory: autoEquip(items),
      wizard_data: { ...char.wizard_data, appliedEquipmentSignature: signature },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, classDetail, fixed, groups, groupChoice, categoryPicks, categoryMembers, itemsByIndex]);

  function chooseOption(group, optionKey) {
    patch({
      wizard_data: { ...char.wizard_data, equipmentGroupChoice: { ...groupChoice, [group.key]: optionKey } },
    });
  }

  function pickCategoryItem(pathKey, i, index) {
    const current = categoryPicks[pathKey] ?? [];
    const next = [...current];
    next[i] = index;
    patch({
      wizard_data: { ...char.wizard_data, equipmentCategoryPicks: { ...categoryPicks, [pathKey]: next } },
    });
  }

  // Nombre en español de un objeto o categoría del compendio, con el nombre
  // inglés de la clase como último recurso (entradas aún sin traducir).
  const translate = (index, fallback) => itemsByIndex[index]?.name ?? categoryNames[index] ?? fallback;

  if (!classDetail) {
    return <p className="text-sm text-bone/50">Elige antes una clase en el paso «Clase».</p>;
  }
  if (loadError) return <p className="text-sm text-blood">{loadError}</p>;
  if (loading) return <p className="text-sm text-bone/50">Cargando opciones de equipo…</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-bone/70">
        Este es el equipo inicial que concede tu clase según el manual. Cómo lo llevas puesto
        (mano principal, secundaria, armadura, escudo o mochila) podrás ajustarlo después desde
        la ficha; aquí solo elige qué te llevas.
      </p>

      {fixed.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs uppercase tracking-wider text-bone/50">Equipo fijo</p>
          <ul className="space-y-0.5 text-sm text-bone/80">
            {fixed.map((f) => (
              <li key={f.index}>
                {itemsByIndex[f.index]?.name ?? f.name}
                {f.qty > 1 ? ` ×${f.qty}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.key} className="rounded-md border border-bone/10 p-3">
          {/* La descripción del SRD («(a) chain mail or (b) leather armor…»)
              está en inglés y repite lo que ya dicen las opciones: se anuncia
              en español la elección y se listan debajo. */}
          <p className="mb-2 text-sm text-bone/70">
            {group.choose > 1 ? `Elige ${group.choose} opciones:` : 'Elige una opción:'}
          </p>
          <div className="space-y-2">
            {group.options.map((option) => {
              const checked = groupChoice[group.key] === option.key;
              return (
                <div
                  key={option.key}
                  className={`rounded-sm border px-3 py-2 ${checked ? 'border-gold/50 bg-gold/10' : 'border-bone/10'}`}
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={group.key}
                      checked={checked}
                      onChange={() => chooseOption(group, option.key)}
                      className="accent-gold"
                    />
                    {partLabel(option.part, translate)}
                  </label>
                  {checked &&
                    option.categorySlots.map((slot) => (
                      <div key={slot.pathKey} className="ml-6 mt-2 flex flex-wrap gap-2">
                        {Array.from({ length: slot.choose }).map((_, i) => (
                          <select
                            key={i}
                            value={categoryPicks[slot.pathKey]?.[i] ?? ''}
                            onChange={(e) => pickCategoryItem(slot.pathKey, i, e.target.value)}
                            className="rounded-sm border border-bone/20 bg-night-950 px-2 py-1 text-xs text-bone/80"
                          >
                            <option value="">Elige {translate(slot.categoryIndex, slot.categoryName)}…</option>
                            {(categoryMembers[slot.categoryIndex] ?? []).map((m) => (
                              <option key={m.index} value={m.index}>
                                {itemsByIndex[m.index]?.name ?? m.name}
                              </option>
                            ))}
                          </select>
                        ))}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {errors.equipo && <p className="text-xs text-blood">{errors.equipo}</p>}

      <HelpBlock title="¿Por qué elijo el equipo ahora?">
        Estas son las opciones que el manual concede a tu clase al nivel 1: nada de comprar con
        oro todavía. Una vez en la ficha podrás añadir más objetos y reorganizar qué llevas
        puesto.
      </HelpBlock>
    </div>
  );
}

export function validateEquipo(char, classDetail) {
  const errors = {};
  if (!classDetail) return errors;
  const { groups } = parseStartingEquipment(classDetail);
  const groupChoice = char.wizard_data.equipmentGroupChoice ?? {};
  const categoryPicks = char.wizard_data.equipmentCategoryPicks ?? {};
  for (const group of groups) {
    const option = group.options.find((o) => o.key === groupChoice[group.key]);
    if (!option) {
      errors.equipo = 'Completa las elecciones de equipo inicial antes de continuar.';
      break;
    }
    const incomplete = option.categorySlots.some(
      (slot) => (categoryPicks[slot.pathKey] ?? []).filter(Boolean).length < slot.choose
    );
    if (incomplete) {
      errors.equipo = 'Completa las elecciones de equipo inicial antes de continuar.';
      break;
    }
  }
  return errors;
}
