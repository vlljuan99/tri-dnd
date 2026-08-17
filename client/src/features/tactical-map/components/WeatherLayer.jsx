import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { weatherFog } from '../domain/weather.js';

function Precipitation({ map, type }) {
  const pointsRef = useRef(null);
  const count = Math.round(180 + (map.weatherIntensity ?? 0.55) * 520);
  const positions = useMemo(() => {
    const data = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      data[index * 3] = Math.random() * map.width;
      data[index * 3 + 1] = 1 + Math.random() * 15;
      data[index * 3 + 2] = Math.random() * map.height;
    }
    return data;
  }, [count, map.height, map.width]);

  useFrame((_, delta) => {
    const attribute = pointsRef.current?.geometry?.attributes?.position;
    if (!attribute) return;
    const speed = type === 'lluvia' ? 11 : 2.3;
    for (let index = 0; index < count; index += 1) {
      const yIndex = index * 3 + 1;
      attribute.array[yIndex] -= delta * speed;
      if (type === 'nieve') attribute.array[index * 3] += Math.sin(Date.now() * 0.0015 + index) * delta * 0.22;
      if (attribute.array[yIndex] < 0.25) attribute.array[yIndex] = 12 + Math.random() * 4;
    }
    attribute.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} raycast={() => null}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={type === 'lluvia' ? '#9fc4d8' : '#f1f4ef'}
        size={type === 'lluvia' ? 0.055 : 0.13}
        transparent
        opacity={0.58 + (map.weatherIntensity ?? 0.55) * 0.25}
        depthWrite={false}
      />
    </points>
  );
}

export default function WeatherLayer({ map }) {
  const weather = map.weather ?? 'despejado';
  const fog = weatherFog(map);
  return (
    <>
      {fog && <fog attach="fog" args={[fog.color, fog.near, fog.far]} />}
      {(weather === 'lluvia' || weather === 'nieve') && <Precipitation map={map} type={weather} />}
    </>
  );
}
