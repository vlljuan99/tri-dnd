import { Component, Suspense, useEffect, useMemo } from 'react';
import { useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';

class IconErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError() {
    return { error: true };
  }

  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

function PortraitDisc({ texture, radius }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]} raycast={() => null}>
      <circleGeometry args={[radius, 64]} />
      {/* El papel conserva el color del retrato bajo iluminación tenue. El
          bisel metálico que lo rodea sí responde a las luces de la escena. */}
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function IconDisc({ imageUrl, radius }) {
  const source = useLoader(THREE.TextureLoader, imageUrl);
  const gl = useThree((state) => state.gl);
  const texture = useMemo(() => {
    // useLoader comparte la imagen: el recorte y su liberación pertenecen a
    // esta copia, nunca a la textura que pueda usar otra ficha.
    const portrait = source.clone();
    const aspect = source.image.width / source.image.height;
    portrait.colorSpace = THREE.SRGBColorSpace;
    portrait.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    if (aspect > 1) {
      portrait.repeat.set(1 / aspect, 1);
      portrait.offset.set((1 - 1 / aspect) / 2, 0);
    } else if (aspect < 1) {
      portrait.repeat.set(1, aspect);
      portrait.offset.set(0, (1 - aspect) / 2);
    }
    portrait.needsUpdate = true;
    return portrait;
  }, [gl, source]);
  useEffect(() => () => texture.dispose(), [texture]);

  return <PortraitDisc texture={texture} radius={radius} />;
}

function makeFallbackPortrait(color, name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const backdrop = context.createRadialGradient(106, 72, 8, 128, 128, 162);
  backdrop.addColorStop(0, '#62675e');
  backdrop.addColorStop(0.6, '#303a36');
  backdrop.addColorStop(1, '#141d1d');
  context.fillStyle = backdrop;
  context.fillRect(0, 0, 256, 256);
  context.globalAlpha = 0.2;
  context.fillStyle = color;
  context.fillRect(0, 0, 256, 256);
  context.globalAlpha = 1;

  // Efigie anónima grabada: identifica una ficha sin inventar su especie,
  // clase o equipamiento cuando el personaje aún no tiene un retrato.
  const relief = context.createLinearGradient(60, 60, 200, 230);
  relief.addColorStop(0, '#cdc7af');
  relief.addColorStop(0.45, '#928e7e');
  relief.addColorStop(1, '#484e47');
  context.fillStyle = relief;
  context.shadowColor = '#0b1312';
  context.shadowBlur = 9;
  context.shadowOffsetY = 5;
  context.beginPath();
  context.ellipse(128, 99, 32, 40, 0, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.moveTo(48, 231);
  context.bezierCurveTo(54, 173, 77, 163, 101, 152);
  context.lineTo(111, 135);
  context.lineTo(145, 135);
  context.lineTo(155, 152);
  context.bezierCurveTo(179, 163, 202, 173, 208, 231);
  context.closePath();
  context.fill();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.strokeStyle = 'rgba(236, 217, 172, .35)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(128, 128, 117, 0, Math.PI * 2);
  context.stroke();
  context.font = '600 28px Georgia, serif';
  context.textAlign = 'center';
  context.fillStyle = '#e1d8bd';
  const initial = Array.from(String(name || '').trim())[0] || '?';
  context.fillText(initial.toLocaleUpperCase('es'), 128, 211);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function FallbackPortrait({ radius, color, name }) {
  const texture = useMemo(() => makeFallbackPortrait(color, name), [color, name]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <PortraitDisc texture={texture} radius={radius} />;
}

export default function TokenIcon({ imageUrl, radius, color = '#63775c', name = '' }) {
  const portraitUrl = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  const fallback = <FallbackPortrait radius={radius} color={color} name={name} />;
  if (!portraitUrl) return fallback;
  return (
    <IconErrorBoundary key={portraitUrl} fallback={fallback}>
      <Suspense fallback={fallback}>
        <IconDisc imageUrl={portraitUrl} radius={radius} />
      </Suspense>
    </IconErrorBoundary>
  );
}
