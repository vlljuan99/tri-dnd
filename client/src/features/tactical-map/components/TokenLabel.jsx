import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

// Color por tipo de token: jugador en verde, PNJ en blanco/hueso, enemigo en
// rojo — mismo código de colores que las barras de vida del tablero.
const LABEL_COLORS = { player: '#6fae4a', enemy: '#c94f4f', npc: '#e8dfc9' };

function makeLabelTexture(text, { width = 256, height = 64, fontSize = 28, color = '#f4ead2' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, width, height);
  context.font = `700 ${fontSize}px Georgia, serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineWidth = 6;
  context.strokeStyle = '#14110f';
  context.fillStyle = color;
  context.strokeText(text, width / 2, height / 2);
  context.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function LabelSprite({ text, position, scale, fontSize, color }) {
  const texture = useMemo(() => makeLabelTexture(text, { fontSize, color }), [color, fontSize, text]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={position} scale={scale}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}

export default function TokenLabel({ token }) {
  const badge = token.type === 'player' ? 'PJ' : token.type === 'enemy' ? 'EN' : 'PNJ';
  const color = LABEL_COLORS[token.type] ?? LABEL_COLORS.npc;

  return (
    <>
      {/* La chapa (PJ/EN/PNJ) flota sobre la cabeza, lejos del icono central */}
      <LabelSprite text={badge} position={[0, 0.55, -0.72]} scale={[0.78, 0.2, 1]} fontSize={30} color={color} />
      <LabelSprite text={token.name} position={[0, 0.34, 0.72]} scale={[1.75, 0.44, 1]} fontSize={24} color={color} />
    </>
  );
}
