// Síntesis de los sonidos por defecto. Sin ficheros, sin dependencias y sin
// licencias: todo sale de osciladores y ruido generados en el momento.
//
// Tiene techo de calidad y conviene decirlo: para golpes, chasquidos y campanas
// queda digno, pero un dado de madera sobre una mesa solo suena a dado con una
// grabación. Por eso cualquier sonido se puede sustituir por un sample.

let noiseBuffer = null;

/** Ruido blanco de un segundo, generado una vez y reutilizado. */
function getNoiseBuffer(ctx) {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

/** Envolvente percusiva: sube rápido y cae. */
function applyEnvelope(gainNode, ctx, { start, duration, attack = 0.005, peak = 1 }) {
  const gain = gainNode.gain;
  gain.setValueAtTime(0.0001, start);
  gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), start + attack);
  gain.exponentialRampToValueAtTime(0.0001, start + duration);
}

function playNoise(ctx, destination, recipe, { start, rate }) {
  const duration = recipe.duration / rate;
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);
  source.loop = true;
  source.playbackRate.value = rate;

  const filter = ctx.createBiquadFilter();
  filter.type = recipe.filter?.type ?? 'bandpass';
  filter.Q.value = recipe.filter?.q ?? 1;
  const from = (recipe.filter?.from ?? 1200) * rate;
  const to = (recipe.filter?.to ?? from) * rate;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), start + duration);

  const envelope = ctx.createGain();
  applyEnvelope(envelope, ctx, { start, duration, attack: recipe.attack });

  source.connect(filter).connect(envelope).connect(destination);
  source.start(start);
  source.stop(start + duration + 0.02);
}

function playTone(ctx, destination, recipe, { start, rate }) {
  const duration = recipe.duration / rate;
  const osc = ctx.createOscillator();
  osc.type = recipe.wave ?? 'sine';
  osc.frequency.setValueAtTime((recipe.from ?? 220) * rate, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, (recipe.to ?? recipe.from ?? 220) * rate), start + duration);

  const envelope = ctx.createGain();
  applyEnvelope(envelope, ctx, { start, duration, attack: recipe.attack });

  osc.connect(envelope).connect(destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function playChime(ctx, destination, recipe, { start, rate }) {
  const duration = recipe.duration / rate;
  const partials = recipe.partials?.length ? recipe.partials : [1];
  partials.forEach((multiple, index) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = (recipe.base ?? 440) * multiple * rate;

    // Los armónicos agudos se apagan antes, como en una campana de verdad.
    const partialDuration = duration * (index === 0 ? 1 : Math.max(0.35, 1 - index * 0.22));
    const envelope = ctx.createGain();
    applyEnvelope(envelope, ctx, {
      start,
      duration: partialDuration,
      attack: 0.004,
      peak: 1 / (index + 1.4),
    });

    osc.connect(envelope).connect(destination);
    osc.start(start);
    osc.stop(start + partialDuration + 0.02);
  });
}

const PLAYERS = { noise: playNoise, tone: playTone, chime: playChime };

/**
 * Sintetiza una receta del catálogo. `destination` ya lleva aplicado el volumen
 * del sonido y el general.
 */
export function playRecipe(ctx, destination, recipe, { when = 0, rate = 1 } = {}) {
  const play = PLAYERS[recipe?.kind];
  if (!play) return false;
  const start = Math.max(ctx.currentTime, when || ctx.currentTime);
  play(ctx, destination, recipe, { start, rate: rate > 0 ? rate : 1 });
  return true;
}
