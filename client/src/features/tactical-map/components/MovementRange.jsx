// Overlay de casillas sobre el suelo, sin capturar clics. Se usa para el
// área de movimiento del combatiente activo (verde musgo), el camino de la
// vista previa de movimiento (dorado) y el terreno difícil (ocre).
export default function MovementRange({ cells, gridSize, color = '#5e8c4a', opacity = 0.28, y = 0.018 }) {
  if (!cells?.length) return null;
  return (
    <group>
      {cells.map(({ col, row }) => (
        <mesh
          key={`${col}-${row}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[(col + 0.5) * gridSize, y, (row + 0.5) * gridSize]}
          raycast={() => null}
        >
          <planeGeometry args={[gridSize * 0.92, gridSize * 0.92]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
