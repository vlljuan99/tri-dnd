import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

// El color identifica el bando; el nombre conserva contraste sobre cualquier
// superficie del mapa, también cuando la escena tiene poca iluminación.
const LABEL_COLORS = { player: '#a2bc8c', enemy: '#d68e80', npc: '#c8bfab' };

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
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function LabelSprite({ text, position, scale, fontSize, color }) {
  const texture = useMemo(() => makeLabelTexture(text, { fontSize, color }), [color, fontSize, text]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={position} scale={scale}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}

function makeNameplate({ name, type, kind, hp, hpMax, selected, active }) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  const color = LABEL_COLORS[type] ?? LABEL_COLORS.npc;
  // No se deduce ni completa la vida de un token: solo se pinta si ambos
  // valores están presentes en la proyección recibida del servidor.
  const hasHp = Number.isInteger(hp) && Number.isInteger(hpMax) && hpMax > 0;
  const plateHeight = hasHp ? 76 : 60;
  const background = context.createLinearGradient(0, 8, 0, plateHeight + 8);
  background.addColorStop(0, 'rgba(34, 39, 35, .96)');
  background.addColorStop(1, 'rgba(13, 18, 18, .96)');
  context.beginPath();
  context.roundRect(5, 8, 374, plateHeight, 10);
  context.fillStyle = background;
  context.fill();
  context.strokeStyle = selected || active ? '#c2a570' : 'rgba(190, 185, 158, .3)';
  context.lineWidth = selected || active ? 2.5 : 1.5;
  context.stroke();
  context.fillStyle = color;
  context.fillRect(16, 22, 3, hasHp ? 46 : 30);

  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.font = '700 22px system-ui, sans-serif';
  const badge = kind === 'objeto' ? 'OBJ' : kind === 'trampa' ? 'TR' : type === 'player' ? 'PJ' : type === 'enemy' ? 'EN' : 'PNJ';
  context.fillText(badge, 29, 40);
  context.font = '600 36px Georgia, serif';
  context.fillStyle = '#efe9d8';
  let label = String(name || 'Sin nombre');
  if (context.measureText(label).width > 284) {
    while (label.length > 1 && context.measureText(`${label}…`).width > 284) label = label.slice(0, -1);
    label += '…';
  }
  context.fillText(label, 79, 39);

  if (hasHp) {
    const ratio = Math.max(0, Math.min(1, hp / hpMax));
    context.fillStyle = '#080f10';
    context.fillRect(79, 64, 284, 10);
    if (ratio > 0) {
      const lifeColor = ratio > 0.5 ? '#91ac75' : ratio > 0.25 ? '#c5a064' : '#c57268';
      context.fillStyle = lifeColor;
      context.fillRect(79, 64, 284 * ratio, 10);
      context.fillStyle = 'rgba(244, 241, 219, .3)';
      context.fillRect(79, 64, 284 * ratio, 1.5);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

export default function TokenLabel({ token, selected = false, active = false }) {
  const { name, type, kind, hp, hpMax, size } = token;
  const texture = useMemo(
    () => makeNameplate({ name, type, kind, hp, hpMax, selected, active }),
    [name, type, kind, hp, hpMax, selected, active]
  );
  useEffect(() => () => texture.dispose(), [texture]);
  const width = Math.min(2.15, Math.max(1.75, size * 1.45));

  return (
    <sprite position={[0, 0.24, size * 0.67]} scale={[width, width / 4, 1]} renderOrder={5}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
