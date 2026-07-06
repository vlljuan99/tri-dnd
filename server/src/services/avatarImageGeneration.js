// El jugador solo describe a su personaje; aquí se refina siempre al mismo
// estilo visual para que todos los iconos de la mesa compartan una identidad
// común (retrato, encuadre, paleta e iluminación), sin depender de que el
// jugador lo pida.
function buildAvatarPrompt(description) {
  return [
    'Icono de personaje para una ficha de rol de mesa de D&D 5e: retrato de busto ' +
      '(cabeza y hombros), mirando ligeramente hacia la cámara, encuadre centrado con margen ' +
      'alrededor pensado para recortarse en un círculo.',
    `Personaje a representar: ${description}.`,
    'Estilo visual obligatorio e idéntico para todos los iconos de esta mesa: ilustración de ' +
      'fantasía pintada a mano tipo óleo digital, la misma paleta cálida y terrosa (dorados, ámbar, ' +
      'siena, musgo oscuro), iluminación dramática de un único foco lateral cálido, fondo liso oscuro ' +
      'casi negro sin escenografía ni paisaje detrás del personaje, misma textura pictórica homogénea.',
    'Restricciones estrictas: sin texto, sin números, sin marcas de agua ni firma, sin marco ni ' +
      'borde decorativo, sin cuerpo completo, sin múltiples personajes en la imagen, sin estilo cómic ' +
      'ni anime, sin fotografía realista.',
  ].join(' ');
}

export async function generateAvatarImageOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta configurar OPENAI_API_KEY en el servidor');

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: buildAvatarPrompt(prompt),
      size: '1024x1024',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Error generando el icono con OpenAI');
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI no devolvió ninguna imagen');
  return { buffer: Buffer.from(b64, 'base64') };
}

export async function generateAvatarImageGoogle(prompt) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Falta configurar GOOGLE_API_KEY en el servidor');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: buildAvatarPrompt(prompt) }],
        parameters: { sampleCount: 1, aspectRatio: '1:1' },
      }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Error generando el icono con Google');
  const b64 = data.predictions?.[0]?.bytesBase64Encoding;
  if (!b64) throw new Error('Google no devolvió ninguna imagen');
  return { buffer: Buffer.from(b64, 'base64') };
}

export function generateAvatarImage(provider, prompt) {
  return provider === 'google' ? generateAvatarImageGoogle(prompt) : generateAvatarImageOpenAI(prompt);
}
