import { ABILITIES, abilityModifier, formatModifier, estimateHitPoints, proficiencyBonus, CLASS_NAMES } from '../../lib/dnd.js';
import { validateIdentidad } from './StepIdentidad.jsx';
import { validateClase } from './StepClase.jsx';
import { validateRaza } from './StepRaza.jsx';
import { validateCaracteristicas } from './StepCaracteristicas.jsx';
import { validateCompetencias } from './StepCompetencias.jsx';
import HelpBlock from './HelpBlock.jsx';
import StatTooltip from '../StatTooltip.jsx';

export function collectWarnings(char, classDetail) {
  const warnings = [];
  const stepErrors = [
    validateIdentidad(char),
    validateClase(char),
    validateRaza(char),
    validateCaracteristicas(char),
    validateCompetencias(char, classDetail),
  ];
  for (const errs of stepErrors) {
    for (const msg of Object.values(errs)) warnings.push(msg);
  }
  if (char.inventory.length === 0) {
    warnings.push('El personaje no tiene equipo todavía. Podrás añadirlo después desde la ficha.');
  }
  if (classDetail?.spellcasting) {
    warnings.push('Tu clase lanza hechizos: podrás elegir trucos y hechizos conocidos desde la ficha.');
  }
  const dup = char.skill_proficiencies.filter((v, i, arr) => arr.indexOf(v) !== i);
  if (dup.length > 0) warnings.push('Hay competencias duplicadas en las habilidades elegidas.');
  return warnings;
}

export default function StepResumen({ char, classDetail, raceName, campaigns, onFinish, finishing, finishError }) {
  const warnings = collectWarnings(char, classDetail);
  // Solo bloquean el paso final las advertencias que vienen de datos
  // obligatorios incompletos (identidad, clase, raza, características,
  // competencias); el resto (sin equipo, hechizos pendientes...) son informativas.
  const requiredErrors = [
    validateIdentidad(char),
    validateClase(char),
    validateRaza(char),
    validateCaracteristicas(char),
    validateCompetencias(char, classDetail),
  ].flatMap((e) => Object.values(e));
  const canFinish = requiredErrors.length === 0;

  const conMod = abilityModifier(char.abilities.con);
  const dexMod = abilityModifier(char.abilities.dex);
  const hpMax = classDetail ? estimateHitPoints(classDetail.hit_die, conMod, char.level) : char.hp_max;
  const ac = 10 + dexMod;
  const campaign = campaigns.find((c) => c.id === char.campaign_id);

  return (
    <div className="space-y-4">
      <p className="text-sm text-bone/70">
        Revisa que todo esté correcto. Podrás seguir editando cualquier cosa desde la ficha en
        cuanto termines.
      </p>

      <div className="rounded-md border border-gold/20 bg-night-900 p-3">
        <p className="font-display text-lg text-gold">{char.name}</p>
        <p className="text-sm text-bone/60">
          {CLASS_NAMES[char.class_index] ?? char.class_index ?? 'Sin clase'} · {raceName ?? char.race_index ?? 'Sin raza'} · nivel {char.level}
        </p>
        {campaign && <p className="text-xs text-bone/50">Campaña: {campaign.name}</p>}
        {(char.background || char.alignment || char.pronouns) && (
          <p className="mt-1 text-xs text-bone/50">
            {[char.background, char.alignment, char.pronouns].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {ABILITIES.map((a) => (
          <div key={a.key} className="rounded-sm border border-bone/10 bg-night-950/50 p-2 text-center">
            <StatTooltip stat={a.key} as="p" className="text-xs text-bone/50">{a.short}</StatTooltip>
            <p className="font-mono text-lg text-bone">{char.abilities[a.key]}</p>
            <p className="font-mono text-xs text-bone/60">{formatModifier(abilityModifier(char.abilities[a.key]))}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <StatTooltip stat="hp" className="rounded-sm border border-blood/30 bg-blood/5 px-2.5 py-1.5">Puntos de golpe: {hpMax}</StatTooltip>
        <StatTooltip stat="ca" className="rounded-sm border border-bone/15 px-2.5 py-1.5">Clase de armadura: {ac}</StatTooltip>
        <StatTooltip stat="velocidad" className="rounded-sm border border-bone/15 px-2.5 py-1.5">Velocidad: {char.speed} pies</StatTooltip>
        <StatTooltip stat="competencia" className="rounded-sm border border-bone/15 px-2.5 py-1.5">Competencia: {formatModifier(proficiencyBonus(char.level))}</StatTooltip>
      </div>
      <HelpBlock title="¿De dónde salen los puntos de golpe y la clase de armadura?">
        Puntos de golpe = dado de golpe de {CLASS_NAMES[char.class_index] ?? 'tu clase'} + modificador
        de Constitución ({formatModifier(conMod)}), y un poco más por cada nivel adicional. Clase de
        armadura = 10 + modificador de Destreza ({formatModifier(dexMod)}); cambiará si luego
        equipas una armadura.
      </HelpBlock>

      {char.skill_proficiencies.length > 0 && (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wider text-bone/50">Habilidades</p>
          <p className="text-sm text-bone/70">{char.skill_proficiencies.join(', ')}</p>
        </div>
      )}
      {char.other_proficiencies.length > 0 && (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wider text-bone/50">Otras competencias</p>
          <p className="text-sm text-bone/70">{char.other_proficiencies.join(', ')}</p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-md border border-ochre/40 bg-ochre/5 p-3">
          <p className="mb-1.5 font-display text-sm text-ochre">Advertencias</p>
          <ul className="list-inside list-disc space-y-0.5 text-sm text-bone/70">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {finishError && <p className="text-sm text-blood">{finishError}</p>}

      <button
        type="button"
        onClick={onFinish}
        disabled={!canFinish || finishing}
        className="w-full rounded-sm bg-gold px-4 py-2.5 font-display tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
      >
        {finishing ? 'Finalizando…' : 'Finalizar personaje'}
      </button>
      {!canFinish && (
        <p className="text-center text-xs text-blood">Corrige los pasos con selecciones pendientes antes de finalizar.</p>
      )}
    </div>
  );
}
