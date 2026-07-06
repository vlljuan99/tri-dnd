const MAX_UNITS = 16;

// El DM solo describe la escena; aquí se refina siempre a un prompt válido
// para un mapa de batalla en vista cenital, sin depender de que el DM lo pida.
function buildMapPrompt(description) {
  return [
    'Mapa de batalla para partida de rol de mesa (D&D 5e), renderizado en vista aérea cenital ' +
      'estricta (top-down, cámara a 90 grados mirando directamente hacia abajo, sin perspectiva ni ángulo).',
    `Escena a representar: ${description}.`,
    'Estilo: ilustración de fantasía pintada a mano, con textura de suelo y terreno detallada, ' +
      'iluminación ambiental uniforme y sombras cortas proyectadas verticalmente, como se verían desde arriba.',
    'Composición: la escena debe cubrir todo el encuadre de borde a borde, como una textura de suelo ' +
      'continua, pensada para superponerle una cuadrícula de juego encima.',
    'Restricciones estrictas: sin texto, sin números, sin letras, sin marcas de agua ni firma, ' +
      'sin viñeteado ni bordes oscuros, sin cuadrícula dibujada, sin interfaz de usuario, ' +
      'sin personajes, criaturas ni miniaturas, sin vista en perspectiva, ángulo o isométrica, sin horizonte ni cielo visible.',
  ].join(' ');
}

function fitDimensions(pixelWidth, pixelHeight) {
  const aspect = pixelWidth / pixelHeight;
  const width = aspect >= 1 ? MAX_UNITS : MAX_UNITS * aspect;
  const height = aspect >= 1 ? MAX_UNITS / aspect : MAX_UNITS;
  return { width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10 };
}

export async function generateMapImageOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta configurar OPENAI_API_KEY en el servidor');

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: buildMapPrompt(prompt),
      size: '1536x1024',
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Error generando la imagen con OpenAI');
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI no devolvió ninguna imagen');
  return { buffer: Buffer.from(b64, 'base64'), ...fitDimensions(1536, 1024) };
}

export async function generateMapImageGoogle(prompt) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Falta configurar GOOGLE_API_KEY en el servidor');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: buildMapPrompt(prompt) }],
        parameters: { sampleCount: 1, aspectRatio: '4:3' },
      }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Error generando la imagen con Google');
  const b64 = data.predictions?.[0]?.bytesBase64Encoding;
  if (!b64) throw new Error('Google no devolvió ninguna imagen');
  return { buffer: Buffer.from(b64, 'base64'), ...fitDimensions(4, 3) };
}

export function generateMapImage(provider, prompt) {
  return provider === 'google' ? generateMapImageGoogle(prompt) : generateMapImageOpenAI(prompt);
}
