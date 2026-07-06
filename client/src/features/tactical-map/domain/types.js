/**
 * @typedef {{ x: number, y: number, z: number }} MapPosition
 * @typedef {{ id: string, name: string, imageUrl?: string, color?: string, position: MapPosition, size: number, type: 'player' | 'enemy' | 'npc', ownerUserId?: number | string, visible: boolean }} TacticalToken
 * @typedef {{ id: string, campaignId: number | string, name: string, width: number, height: number, gridSize: number, backgroundUrl?: string, disabledCells: [number, number][], tokens: TacticalToken[] }} TacticalMap
 * @typedef {'top-down'} TacticalCameraMode
 */

export const TACTICAL_CAMERA_MODES = {
  TOP_DOWN: 'top-down',
};
