import { Component, Suspense } from 'react';
import { useLoader } from '@react-three/fiber';
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
    if (this.state.error) return null;
    return this.props.children;
  }
}

function IconDisc({ imageUrl, radius }) {
  const texture = useLoader(THREE.TextureLoader, imageUrl);
  texture.colorSpace = THREE.SRGBColorSpace;

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.108, 0]} raycast={() => null}>
      <circleGeometry args={[radius, 32]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

export default function TokenIcon({ imageUrl, radius }) {
  if (!imageUrl) return null;
  return (
    <IconErrorBoundary>
      <Suspense fallback={null}>
        <IconDisc imageUrl={imageUrl} radius={radius} />
      </Suspense>
    </IconErrorBoundary>
  );
}
