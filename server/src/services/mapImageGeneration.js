const MAX_UNITS = 16;

// Describe la forma de la sala y sus conexiones para que la imagen generada
// respete la orientación (un pasillo horizontal debe ser apaisado) y las
// puertas queden en el borde correcto, conectando visualmente las estancias.
function buildShapeContext(context) {
  if (!context?.width || !context?.height) return [];
  const { width, height, openings = [] } = context;
  const parts = [];

  const aspect = width / height;
  if (aspect >= 2) {
    parts.push(
      `Forma: la estancia es un espacio alargado HORIZONTAL de proporción ${width}:${height} ` +
        '(tipo pasillo o galería): el eje largo va de izquierda a derecha de la imagen, ' +
        'con las paredes largas arriba y abajo.'
    );
  } else if (aspect <= 0.5) {
    parts.push(
      `Forma: la estancia es un espacio alargado VERTICAL de proporción ${width}:${height} ` +
        '(tipo pasillo o galería): el eje largo va de arriba abajo de la imagen, ' +
        'con las paredes largas a izquierda y derecha.'
    );
  } else {
    parts.push(`Forma: estancia de proporción ${width}:${height}, aproximadamente rectangular.`);
  }

  if (openings.length) {
    const SIDE_LABELS = {
      norte: 'el borde superior',
      sur: 'el borde inferior',
      este: 'el borde derecho',
      oeste: 'el borde izquierdo',
    };
    const list = openings.map((side) => SIDE_LABELS[side] ?? side).join(', ');
    parts.push(
      `Conexiones: la estancia tiene abertura/paso hacia ${list} de la imagen; ` +
        'el suelo debe llegar limpio hasta esas aberturas (sin pared que las tape) ' +
        'para que conecte visualmente con las estancias vecinas del mapa.'
    );
  }
  return parts;
}

// El DM solo describe la escena; aquí se refina siempre a un prompt válido
// para un mapa de batalla en vista cenital, sin depender de que el DM lo pida.
function buildMapPrompt(description, context) {
  return [
    'Mapa de batalla para partida de rol de mesa (D&D 5e), renderizado en vista aérea cenital ' +
      'estricta (top-down, cámara a 90 grados mirando directamente hacia abajo, sin perspectiva ni ángulo).',
    `Escena a representar: ${description}.`,
    ...buildShapeContext(context),
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

// Tamaño de imagen según la forma de la sala: apaisada, vertical o cuadrada
function pickOpenAISize(context) {
  const aspect = context?.width && context?.height ? context.width / context.height : 1.5;
  if (aspect >= 1.3) return '1536x1024';
  if (aspect <= 0.77) return '1024x1536';
  return '1024x1024';
}

function pickGoogleAspect(context) {
  const aspect = context?.width && context?.height ? context.width / context.height : 4 / 3;
  if (aspect >= 2.2) return '16:9';
  if (aspect >= 1.15) return '4:3';
  if (aspect <= 0.45) return '9:16';
  if (aspect <= 0.87) return '3:4';
  return '1:1';
}

export async function generateMapImageOpenAI(prompt, context) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta configurar OPENAI_API_KEY en el servidor');

  const size = pickOpenAISize(context);
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: buildMapPrompt(prompt, context),
      size,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Error generando la imagen con OpenAI');
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI no devolvió ninguna imagen');
  const [pw, ph] = size.split('x').map(Number);
  return { buffer: Buffer.from(b64, 'base64'), ...fitDimensions(pw, ph) };
}

export async function generateMapImageGoogle(prompt, context) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Falta configurar GOOGLE_API_KEY en el servidor');

  const aspectRatio = pickGoogleAspect(context);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: buildMapPrompt(prompt, context) }],
        parameters: { sampleCount: 1, aspectRatio },
      }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Error generando la imagen con Google');
  const b64 = data.predictions?.[0]?.bytesBase64Encoding;
  if (!b64) throw new Error('Google no devolvió ninguna imagen');
  const [aw, ah] = aspectRatio.split(':').map(Number);
  return { buffer: Buffer.from(b64, 'base64'), ...fitDimensions(aw, ah) };
}

export function generateMapImage(provider, prompt, context) {
  return provider === 'google'
    ? generateMapImageGoogle(prompt, context)
    : generateMapImageOpenAI(prompt, context);
}
