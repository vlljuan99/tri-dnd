import { createContext, useContext, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const MaterialsContext = createContext(null);

// Piedra local y determinista: comparte dos texturas pequeñas entre todas las
// salas. El color y el relieve son cosméticos; nunca describen terreno jugable.
function stoneTextures() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(size, size);
  let seed = 7419;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const shades = Array.from({ length: 32 }, () => 132 + random() * 38);
  for (let y = 0; y < size; y += 1) {
    const row = Math.floor(y / 32);
    for (let x = 0; x < size; x += 1) {
      const offsetX = (x + (row % 2) * 32) % size;
      const col = Math.floor(offsetX / 64);
      const edge = Math.min(offsetX % 64, 63 - offsetX % 64, y % 32, 31 - y % 32);
      const grain = (random() - 0.5) * 22;
      const weathering = Math.sin(x * 0.21 + Math.sin(y * 0.12)) * 4 + Math.sin(y * 0.42) * 3;
      const shade = edge < 1 ? 48 + grain : shades[row * 4 + col] + grain + weathering - (edge < 3 ? 19 : 0);
      const index = (y * size + x) * 4;
      pixels.data[index] = shade;
      pixels.data[index + 1] = shade;
      pixels.data[index + 2] = shade;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const color = new THREE.CanvasTexture(canvas);
  color.colorSpace = THREE.SRGBColorSpace;
  const relief = new THREE.CanvasTexture(canvas);
  for (const texture of [color, relief]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
  }
  return { color, relief };
}

export function BoardMaterials({ children }) {
  const resources = useMemo(() => ({
    ...stoneTextures(),
    block: new RoundedBoxGeometry(1, 1, 1, 1, 0.045),
  }), []);
  useEffect(() => () => {
    resources.color.dispose();
    resources.relief.dispose();
    resources.block.dispose();
  }, [resources]);
  return <MaterialsContext.Provider value={resources}>{children}</MaterialsContext.Provider>;
}

export function StoneMaterial({ color = '#aaa99d', ...props }) {
  const textures = useContext(MaterialsContext);
  return <meshStandardMaterial map={textures.color} bumpMap={textures.relief} bumpScale={0.045}
    color={color} roughness={0.92} metalness={0.02} {...props} />;
}

export function StoneBlock({ dimensions, children, ...props }) {
  const { block } = useContext(MaterialsContext);
  return <mesh geometry={block} scale={dimensions} {...props}>{children}</mesh>;
}
