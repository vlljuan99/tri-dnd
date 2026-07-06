export default function SelectionIndicator({ size }) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
      <torusGeometry args={[size * 0.49, 0.045, 8, 36]} />
      <meshBasicMaterial color="#f1c96a" />
    </mesh>
  );
}
