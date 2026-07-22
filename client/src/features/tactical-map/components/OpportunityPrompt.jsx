import { useState } from 'react';
import { useRoom } from '../../../store/socket.js';

function damageLabel(attack) {
  const parts = (attack.damage ?? [])
    .map((component) => component.dice)
    .filter(Boolean);
  return parts.length ? parts.join(' + ') : 'daño fijo';
}

export default function OpportunityPrompt({ opportunity }) {
  const resolveOpportunity = useRoom((state) => state.resolveOpportunity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(attackId, accept) {
    setBusy(true);
    setError('');
    const result = await resolveOpportunity(opportunity.id, attackId, accept);
    if (result?.error) {
      setError(result.error);
      setBusy(false);
    }
  }

  return (
    <div className="absolute left-1/2 top-20 z-40 w-[22rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-sm border border-ochre/70 bg-night-900/95 p-4 text-bone shadow-2xl backdrop-blur">
      <p className="font-display text-xs uppercase tracking-[0.2em] text-ochre">
        Ataque de oportunidad
      </p>
      <p className="mt-1.5 text-sm text-bone/85">
        <span className="text-gold">{opportunity.attackerName}</span> puede usar su reacción
        contra <span className="text-gold">{opportunity.targetName}</span>.
      </p>
      <div className="mt-3 space-y-2">
        {(opportunity.attacks ?? []).map((attack) => (
          <button
            key={attack.id}
            type="button"
            disabled={busy}
            onClick={() => decide(attack.id, true)}
            className="flex w-full items-center justify-between gap-3 rounded-sm border border-gold/35 bg-gold/10 px-3 py-2 text-left text-sm hover:border-gold hover:bg-gold/15 disabled:opacity-50"
          >
            <span>{attack.name}</span>
            <span className="shrink-0 font-mono text-xs text-bone/60">
              {attack.attackBonus >= 0 ? '+' : ''}{attack.attackBonus} · {damageLabel(attack)}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => decide(null, false)}
        className="mt-3 w-full rounded-sm border border-bone/25 px-3 py-1.5 text-sm text-bone/65 hover:border-bone/50 hover:text-bone disabled:opacity-50"
      >
        Dejar pasar
      </button>
      {error && <p className="mt-2 text-xs text-blood">{error}</p>}
    </div>
  );
}
