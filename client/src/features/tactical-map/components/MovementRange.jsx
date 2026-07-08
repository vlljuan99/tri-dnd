// Área de movimiento del combatiente activo (Fase 8.5): casillas a las que
// aún puede llegar con el movimiento que le queda este turno. Verde musgo
// translúcido sobre el suelo, sin capturar clics (el clic sigue moviendo).
export default function MovementRange({ cells, gridSize }) {
  if (!cells?.length) return null;
  return (
    <group>
      {cells.map(({ col, row }) => (
        <mesh
          key={`${col}-${row}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[(col + 0.5) * gridSize, 0.018, (row + 0.5) * gridSize]}
          raycast={() => null}
        >
          <planeGeometry args={[gridSize * 0.92, gridSize * 0.92]} />
          <meshBasicMaterial color="#5e8c4a" transparent opacity={0.28} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
