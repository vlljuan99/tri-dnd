import { useState } from 'react';
import { api } from '../../../api.js';
import ConfirmationDialog from '../../../components/ConfirmationDialog.jsx';
import StepShell from './StepShell.jsx';

// Paso 7 — Jugadores: el código de invitación y el estado del grupo. Los
// jugadores se unen desde el hub con el código; aquí el DM ve quién ha
// llegado y con qué personaje.
export default function JugadoresStep({ progress }) {
  const { campaign, setCampaign, members, characters, refreshOverview } = progress;
  const [copied, setCopied] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const players = members.filter((member) => member.role === 'jugador');
  const playerCharacters = characters.filter((character) => character.kind === 'pj');
  const characterByUser = new Map(playerCharacters.map((character) => [character.user_id, character]));

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(campaign.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // El portapapeles puede no estar disponible (http, permisos); el código
      // queda visible para copiarlo a mano.
    }
  }

  async function confirmAction() {
    if (!confirmation) return;
    setBusy(true);
    setError('');
    try {
      if (confirmation.type === 'regenerate') {
        const { inviteCode } = await api(`/campaigns/${campaign.id}/invitacion/regenerar`, {
          method: 'POST',
        });
        setCampaign((current) => ({ ...current, inviteCode }));
        setCopied(false);
      } else {
        await api(`/campaigns/${campaign.id}/jugadores/${confirmation.player.id}`, {
          method: 'DELETE',
        });
        await refreshOverview();
      }
      setConfirmation(null);
    } catch (actionError) {
      setError(actionError.message || 'No se pudo completar la acción.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepShell
      progress={progress}
      stepId="jugadores"
      description="Comparte el código de invitación con tu grupo: cada persona se une desde el hub con «Unirse a una mesa» y trae su personaje."
    >
      <div className="rounded-md border border-gold/20 bg-night-900/70 p-4">
        <p className="text-xs uppercase tracking-wider text-bone/50">Código de invitación</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="rounded-sm border border-gold/30 bg-night-950 px-4 py-2 font-mono text-2xl tracking-[0.35em] text-gold">
            {campaign.inviteCode}
          </span>
          <button
            type="button"
            onClick={copyCode}
            className="rounded-sm border border-gold/30 px-3 py-2 text-sm text-gold/80 hover:bg-gold/10"
          >
            {copied ? 'Copiado ✓' : 'Copiar'}
          </button>
          <button
            type="button"
            onClick={() => {
              setError('');
              setConfirmation({ type: 'regenerate' });
            }}
            className="rounded-sm border border-ochre/35 px-3 py-2 text-sm text-ochre hover:bg-ochre/10"
          >
            Regenerar código
          </button>
          <span className="text-xs text-bone/45">
            {players.length}
            {campaign.maxPlayers != null ? ` / ${campaign.maxPlayers}` : ''} jugador
            {players.length === 1 ? '' : 'es'} en la mesa
            {campaign.maxPlayers == null && ' · sin límite de plazas'}
          </span>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-bone/45">
          Si el código acaba en un canal equivocado, regénéralo: el anterior dejará de aceptar nuevas
          incorporaciones. Quienes ya están en la campaña no perderán el acceso.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-sm border border-blood/30 bg-blood/10 px-3 py-2 text-sm text-blood">
          {error}
        </p>
      )}

      <section className="mt-6">
        <h3 className="mb-3 font-display text-lg tracking-wide text-gold">El grupo</h3>
        {players.length === 0 ? (
          <p className="italic text-bone/50">
            Nadie se ha unido todavía. Pasa el código por vuestro Discord y aparecerán aquí.
          </p>
        ) : (
          <ul className="space-y-2">
            {players.map((player) => {
              const character = characterByUser.get(player.id);
              return (
                <li
                  key={player.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-gold/15 bg-night-900 p-3"
                >
                  <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-gold/25 bg-night-950">
                    {character?.avatarUrl && (
                      <img src={character.avatarUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-bone">{player.displayName}</p>
                    <p className="text-xs text-bone/50">
                      {character
                        ? `${character.name} · nivel ${character.level}`
                        : 'Sin personaje en esta campaña todavía'}
                    </p>
                  </div>
                  {character && (
                    <span className="font-mono text-xs text-bone/50">
                      PG {character.hp_current}/{character.hp_max} · CA {character.ac}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setConfirmation({ type: 'remove', player });
                    }}
                    className="ml-auto shrink-0 rounded-sm border border-blood/35 px-2.5 py-1.5 text-xs text-blood hover:bg-blood/10"
                  >
                    Expulsar
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmationDialog
        open={Boolean(confirmation)}
        title={
          confirmation?.type === 'regenerate'
            ? '¿Regenerar el código de invitación?'
            : `¿Expulsar a ${confirmation?.player?.displayName ?? 'este jugador'}?`
        }
        description={
          confirmation?.type === 'regenerate'
            ? 'El código actual dejará de funcionar inmediatamente y tendrás que compartir el nuevo con quien falte por unirse.'
            : 'Perderá el acceso a la campaña en este momento. Su ficha se conservará en su cuenta, pero se retirará de la mesa y del tracker.'
        }
        detail={
          confirmation?.type === 'regenerate'
            ? `Código que se invalidará: ${campaign.inviteCode}`
            : 'Puedes volver a invitarle más adelante con el código vigente.'
        }
        confirmLabel={confirmation?.type === 'regenerate' ? 'Regenerar código' : 'Expulsar jugador'}
        tone={confirmation?.type === 'regenerate' ? 'warning' : 'danger'}
        busy={busy}
        onCancel={() => {
          if (!busy) setConfirmation(null);
        }}
        onConfirm={confirmAction}
      />
    </StepShell>
  );
}
