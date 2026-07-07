import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

function makeLabelTexture(text, { width = 256, height = 64, fontSize = 28 } = {}) {
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
  context.fillStyle = '#f4ead2';
  context.strokeText(text, width / 2, height / 2);
  context.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function LabelSprite({ text, position, scale, fontSize }) {
  const texture = useMemo(() => makeLabelTexture(text, { fontSize }), [fontSize, text]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={position} scale={scale}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}

export default function TokenLabel({ token }) {
  const badge = token.type === 'player' ? 'PJ' : token.type === 'enemy' ? 'EN' : 'PNJ';

  return (
    <>
      <LabelSprite text={badge} position={[0, 0.34, -0.08]} scale={[0.78, 0.2, 1]} fontSize={30} />
      <LabelSprite text={token.name} position={[0, 0.34, 0.72]} scale={[1.75, 0.44, 1]} fontSize={24} />
    </>
  );
}
