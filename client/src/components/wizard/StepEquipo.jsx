import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { srdCampaignPath } from '../../lib/srdCampaign.js';
import { parseStartingEquipment, partLabel } from '../../lib/wizard.js';
import { buildWizardEquipment } from '../../lib/wizardPreview.js';
import StatTooltip from '../StatTooltip.jsx';
import HelpBlock from './HelpBlock.jsx';

// Paso «Equipo» (Fase A de la rebanada vertical): construye el inventario a
// partir de `starting_equipment`/`starting_equipment_options` de la clase.
// Es el único camino de equipo inicial — nada de oro ni compra libre todavía
// (ver docs/VERTICAL-SLICE.md, Fase A).

export default function StepEquipo({ char, patch, classDetail, errors, onPreview }) {
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
    const { signature, inventory } = equipmentFor(groupChoice, categoryPicks);
    if (char.wizard_data.appliedEquipmentSignature === signature) return;
    patch({
      inventory,
      wizard_data: { ...char.wizard_data, appliedEquipmentSignature: signature },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, classDetail, fixed, groups, groupChoice, categoryPicks, categoryMembers, itemsByIndex]);

  function equipmentFor(nextGroups, nextPicks) {
    return buildWizardEquipment({ fixed, groups, groupChoice: nextGroups, categoryPicks: nextPicks, categoryMembers, itemsByIndex });
  }

  function equipmentPatch(nextGroups, nextPicks) {
    const { signature, inventory } = equipmentFor(nextGroups, nextPicks);
    return {
      inventory,
      wizard_data: {
        ...char.wizard_data,
        equipmentGroupChoice: nextGroups,
        equipmentCategoryPicks: nextPicks,
        appliedEquipmentSignature: signature,
      },
    };
  }

  function chooseOption(group, optionKey) {
    onPreview?.(null);
    patch(equipmentPatch({ ...groupChoice, [group.key]: optionKey }, categoryPicks));
  }

  function picksWith(pathKey, i, index) {
    const current = categoryPicks[pathKey] ?? [];
    const next = [...current];
    next[i] = index;
    return { ...categoryPicks, [pathKey]: next };
  }

  function pickCategoryItem(pathKey, i, index) {
    onPreview?.(null);
    patch(equipmentPatch(groupChoice, picksWith(pathKey, i, index)));
  }

  function previewOption(group, option) {
    onPreview?.({ label: partLabel(option.part, translate), fields: equipmentPatch({ ...groupChoice, [group.key]: option.key }, categoryPicks) });
  }

  function previewItem(slot, i, entry) {
    onPreview?.({ label: translate(entry.index, entry.name), fields: equipmentPatch(groupChoice, picksWith(slot.pathKey, i, entry.index)) });
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
    <div className="min-w-0 space-y-5">
      <p className="text-sm text-bone/70">
        Prepara lo que llevarás en tu primera aventura. Tu clase concede este equipo inicial:
        explora las opciones para ver cómo cambian tu defensa y tus ataques.
      </p>

      {fixed.length > 0 && (
        <div className="rounded-xl border border-gold/15 bg-gold/5 p-4">
          <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-gold/75">Ya está en tu mochila</p>
          <ul className="flex flex-wrap gap-2 text-xs text-bone/80">
            {fixed.map((f) => (
              <li key={f.index} className="rounded-md border border-gold/15 bg-night-950/40 px-2 py-1">
                {itemsByIndex[f.index]?.name ?? f.name}
                {f.qty > 1 ? ` ×${f.qty}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.map((group, groupIndex) => (
        <fieldset key={group.key} className="min-w-0 rounded-xl border border-bone/10 p-3 sm:p-4">
          {/* La descripción del SRD («(a) chain mail or (b) leather armor…»)
              está en inglés y repite lo que ya dicen las opciones: se anuncia
              en español la elección y se listan debajo. */}
          <legend className="px-2 font-display text-sm text-gold">Elección {groupIndex + 1}</legend>
          <p className="mb-3 text-xs text-bone/60">{group.choose > 1 ? `Elige ${group.choose} opciones para tu equipo.` : 'Elige un conjunto de equipo.'}</p>
          <div className="space-y-2">
            {group.options.map((option) => {
              const checked = groupChoice[group.key] === option.key;
              return (
                <div
                  key={option.key}
                  onMouseEnter={() => previewOption(group, option)}
                  onMouseLeave={() => onPreview?.(null)}
                  className={`min-w-0 rounded-lg border px-3 py-3 transition-colors motion-reduce:transition-none ${checked ? 'border-gold/50 bg-gold/10' : 'border-bone/10 bg-night-950/30 hover:border-gold/30'}`}
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={group.key}
                      checked={checked}
                      onChange={() => chooseOption(group, option.key)}
                      onFocus={() => previewOption(group, option)}
                      onBlur={() => onPreview?.(null)}
                      className="shrink-0 accent-gold"
                    />
                    <span className="min-w-0 break-words">{partLabel(option.part, translate)}</span>
                  </label>
                  {checked &&
                    option.categorySlots.map((slot) => (
                      <div key={slot.pathKey} className="mt-3 min-w-0 space-y-3">
                        {Array.from({ length: slot.choose }).map((_, i) => (
                          <div key={i}>
                            <p id={`${slot.pathKey}-${i}`} className="mb-2 text-[11px] text-bone/60">{translate(slot.categoryIndex, slot.categoryName)}{slot.choose > 1 ? ` · ${i + 1} de ${slot.choose}` : ''}</p>
                            <div role="group" aria-labelledby={`${slot.pathKey}-${i}`} className="grid max-h-60 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                              {(categoryMembers[slot.categoryIndex] ?? []).map((m) => {
                                const entry = itemsByIndex[m.index];
                                const selected = categoryPicks[slot.pathKey]?.[i] === m.index;
                                return (
                                  <button key={m.index} type="button" aria-pressed={selected}
                                    onClick={() => pickCategoryItem(slot.pathKey, i, m.index)}
                                    onMouseEnter={() => previewItem(slot, i, m)} onMouseLeave={() => onPreview?.(null)}
                                    onFocus={() => previewItem(slot, i, m)} onBlur={() => onPreview?.(null)}
                                    className={`min-w-0 rounded-md border p-2 text-left text-xs transition-colors motion-reduce:transition-none ${selected ? 'border-gold bg-gold/15 text-gold' : 'border-bone/10 bg-night-950/60 text-bone/80 hover:border-gold/50'}`}>
                                    <span className="block break-words">{selected ? '✓ ' : ''}{entry?.name ?? m.name}</span>
                                    {entry?.meta?.damage && <span className="mt-0.5 block font-mono text-[10px] text-bone/45">Daño {entry.meta.damage.dice}</span>}
                                    {entry?.meta?.armorClass && <span className="mt-0.5 block text-[10px] text-bone/45">CA {entry.meta.armorClass.base}</span>}
                                  </button>
                                );
                              })}
                            </div>
                            {errors.equipo && !categoryPicks[slot.pathKey]?.[i] && <p role="alert" className="mt-2 text-xs text-blood">Elige este objeto para completar el conjunto de equipo de tu clase.</p>}
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
          {errors.equipo && !groupChoice[group.key] && <p role="alert" className="mt-2 text-xs text-blood">Falta esta elección: tu clase te concede uno de estos conjuntos.</p>}
        </fieldset>
      ))}

      <p className="text-xs leading-relaxed text-bone/50">La <StatTooltip stat="ca">CA</StatTooltip> y los ataques se actualizan al elegir. En la ficha podrás ajustar qué empuñas y qué guardas en la mochila.</p>

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

