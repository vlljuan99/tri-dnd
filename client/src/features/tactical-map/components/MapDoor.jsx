// Marcador 3D de una puerta sobre el tablero compuesto. Cerrada se ve
// sólida; abierta, translúcida. Dorada si la abre el jugador, roja si la
// controla el DM; las escaleras/portales se distinguen por la forma.
const COLORS = { jugador: '#c9a86a', dm: '#b33939' };

export default function MapDoor({ door, gridSize, onOpen }) {
  const x = (door.col + 0.5) * gridSize;
  const z = (door.row + 0.5) * gridSize;
  const color = COLORS[door.control] ?? COLORS.jugador;
  const opacity = door.isOpen ? 0.35 : 0.95;

  function handleClick(event) {
    event.stopPropagation();
    onOpen?.(door);
  }

  return (
    <group position={[x, 0.07, z]} onClick={handleClick}>
      {door.kind === 'portal' ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[gridSize * 0.18, gridSize * 0.3, 24]} />
          <meshStandardMaterial color={color} transparent opacity={opacity} />
        </mesh>
      ) : door.kind === 'escalera' ? (
        <group>
          {[-0.18, 0, 0.18].map((offset) => (
            <mesh key={offset} position={[0, 0, offset * gridSize]}>
              <boxGeometry args={[gridSize * 0.55, 0.05, gridSize * 0.1]} />
              <meshStandardMaterial color={color} transparent opacity={opacity} />
            </mesh>
          ))}
        </group>
      ) : (
        <mesh>
          <boxGeometry args={[gridSize * 0.62, 0.16, gridSize * 0.3]} />
          <meshStandardMaterial color={color} transparent opacity={opacity} />
        </mesh>
      )}
      {/* Zona de clic generosa e invisible */}
      <mesh onClick={handleClick} visible={false}>
        <boxGeometry args={[gridSize * 0.9, 0.4, gridSize * 0.9]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}
