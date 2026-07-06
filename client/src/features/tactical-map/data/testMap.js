export function createTestTacticalMap({ campaignId, user }) {
  const ownerUserId = user?.id;

  return {
    id: `test-map-${campaignId}`,
    campaignId,
    name: 'Cripta del Umbral',
    width: 12,
    height: 8,
    gridSize: 1,
    tokens: [
      {
        id: 'pj-vanguardia',
        name: user?.displayName ? `${user.displayName}` : 'Aventurero',
        color: '#4a8bd6',
        position: { x: 2.5, y: 0, z: 5.5 },
        size: 1,
        type: 'player',
        ownerUserId,
        visible: true,
      },
      {
        id: 'pj-aliado',
        name: 'Aliada',
        color: '#6e7c55',
        position: { x: 3.5, y: 0, z: 4.5 },
        size: 1,
        type: 'player',
        visible: true,
      },
      {
        id: 'enemigo-lobo',
        name: 'Lobo sombrío',
        color: '#8c2f2f',
        position: { x: 8.5, y: 0, z: 2.5 },
        size: 1,
        type: 'enemy',
        visible: true,
      },
      {
        id: 'enemigo-custodio',
        name: 'Custodio',
        color: '#c4602e',
        position: { x: 9.5, y: 0, z: 5.5 },
        size: 1,
        type: 'enemy',
        visible: true,
      },
    ],
  };
}
