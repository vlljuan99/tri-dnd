// Token local del propio jugador. Es el único dato de prueba que queda en
// el tablero: los enemigos, aliados y objetos vienen del mapa preparado en
// el editor, y los tokens del resto de jugadores llegarán cuando se
// persistan los personajes por sala (resto de la fase 7).
export function createTestTacticalMap({ campaignId, user }) {
  return {
    id: `test-map-${campaignId}`,
    campaignId,
    name: 'Tablero',
    width: 12,
    height: 8,
    gridSize: 1,
    tokens: [
      {
        id: 'pj-propio',
        name: user?.displayName ? `${user.displayName}` : 'Aventurero',
        color: '#4a8bd6',
        position: { x: 1.5, y: 0, z: 1.5 },
        size: 1,
        type: 'player',
        ownerUserId: user?.id,
        visible: true,
      },
    ],
  };
}
