import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { absoluteToBoard, boardToAbsolute, worldToGrid, gridToWorld } from '../domain/grid.js';
import { elementColor, spellElement } from '../domain/elements.js';
import { canMoveToken } from '../domain/permissions.js';
import { isOutOfCombat, turnControl } from '../domain/turnControl.js';
import { CAMERA_KEYS, matchShortcut } from '../domain/shortcuts.js';
import { targetRangeState, weaponRangeCells } from '../domain/weaponSlots.js';
import { useCharacterWeapons } from '../hooks/useCharacterWeapons.js';
import { cellKey } from '../domain/cells.js';
import { buildBoardWalkable, findBoardPath, reachableWithin, buildBoardElevation } from '../domain/pathfinding.js';
import { buildBoardWalls } from '../domain/walls.js';
import { computeBoardVision, hasBoardLineOfSight } from '../domain/vision.js';
import { spellRangeSquares } from '../domain/combatGeometry.js';
import { spellAimValidation, spellArea, spellAreaCells } from '../domain/spellAreas.js';
import {
  FLUID_TYPES,
  fluidEffectSummary,
  fluidTypesAlongBoardPath,
  normalizeFluidEffects,
} from '../domain/fluids.js';
import { useRoom } from '../../../store/socket.js';
import { toastError } from '../../../store/toast.js';
import { rollPool } from '../../../lib/dice.js';
import { api } from '../../../api.js';
import TacticalMapCanvas from './TacticalMapCanvas.jsx';
import AttackPanel from './AttackPanel.jsx';
import MonsterAttackPanel from './MonsterAttackPanel.jsx';
import FallPanel from './FallPanel.jsx';
import InventoryPanel from './InventoryPanel.jsx';
import InteractPanel from './InteractPanel.jsx';
import NotesPanel from './NotesPanel.jsx';
import GameDrawer from './GameDrawer.jsx';
import PlayerHud from './PlayerHud.jsx';
import CharacterQuickView from './CharacterQuickView.jsx';
import MapControls from './MapControls.jsx';
import CombatAlert, { TurnAlert } from './CombatAlert.jsx';
import InitiativeStrip from './InitiativeStrip.jsx';
import OpportunityPrompt from './OpportunityPrompt.jsx';
import SpellPanel from './SpellPanel.jsx';
import TableControls from './TableControls.jsx';
import { tirarYEnviar, trasElDado, useReveal } from '../../../store/reveal.js';
import RequestRollDialog from './RequestRollDialog.jsx';
import DeathSaveOverlay from './DeathSaveOverlay.jsx';
import TrapAlert from './TrapAlert.jsx';

const HAZARD_PRESETS = {
  fuego: {
    name: 'Muro de fuego', visualType: 'fuego', triggerTiming: 'both',
    saveAbility: 'dex', saveDc: 14, damageDice: '2d6', damageType: 'fire', condition: null,
    cells(center) {
      return Array.from({ length: 6 }, (_, index) => ({ col: center.col + index - 2, row: center.row }));
    },
  },
  telarana: {
    name: 'Telaraña', visualType: 'telarana', triggerTiming: 'both',
    saveAbility: 'dex', saveDc: 13, damageDice: '', damageType: null, condition: 'apresado',
    cells(center) {
      return Array.from({ length: 16 }, (_, index) => ({ col: center.col + (index % 4) - 1, row: center.row + Math.floor(index / 4) - 1 }));
    },
  },
  nube: {
    name: 'Nube hedionda', visualType: 'nube', triggerTiming: 'both',
    saveAbility: 'con', saveDc: 14, damageDice: '', damageType: 'poison', condition: 'envenenado',
    cells(center) {
      const cells = [];
      for (let row = -2; row <= 2; row += 1) for (let col = -2; col <= 2; col += 1) {
        if (col * col + row * row <= 6) cells.push({ col: center.col + col, row: center.row + row });
      }
      return cells;
    },
  },
  arcana: {
    name: 'Zona arcana', visualType: 'arcana', triggerTiming: 'both',
    saveAbility: 'wis', saveDc: 13, damageDice: '1d6', damageType: 'force', condition: null,
    cells(center) {
      return Array.from({ length: 9 }, (_, index) => ({ col: center.col + (index % 3) - 1, row: center.row + Math.floor(index / 3) - 1 }));
    },
  },
};

class CanvasErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center bg-night-950 p-6 text-center text-bone">
          <div>
            <p className="font-display text-lg text-blood">No se pudo mostrar el mapa táctico.</p>
            <p className="mt-2 text-sm text-bone/70">{this.state.error.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function TacticalMap({
  map,
  user,
  role,
  savingTokenId,
  saveError,
  onMoveToken,
  onOpenDoor,
  doorError,
  onPing,
  pings,
  onSelectFloor,
  playerView,
  onTogglePlayerView,
  canControlEnemyAi = false,
  onToggleEnemyAi,
  tableControlError = '',
  editorHref,
  showArchive,
  ownCharacterId,
  campaignId,
  // Fase F: descanso de mesa y reloj opcional. `canRest` lo decide la página
  // (el DM, o la cuenta que juega sola una escaramuza).
  canRest = false,
  clockEnabled = false,
  clockLabel = '',
  onRest,
  onToggleClock,
  restBusy = false,
}) {
  const [selectedTokenId, setSelectedTokenId] = useState(null);
  const [showGrid, setShowGrid] = useState(true);
  const [cameraCommand, setCameraCommand] = useState(null);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  // Vista previa de movimiento (estilo Baldur's Gate): destino, camino y
  // coste calculados al pulsar una casilla; el token no se mueve hasta confirmar
  const [movePreview, setMovePreview] = useState(null); // { cell, cost, path, remaining } | null
  const [combatTarget, setCombatTarget] = useState(null); // token objetivo del ataque
  const [aimingWeaponId, setAimingWeaponId] = useState(null); // arma empuñada desde el hotbar
  // Fase 4c: el DM pide una tirada; el jugador elige a quién ayuda
  const [requestRollOpen, setRequestRollOpen] = useState(false);
  const [helpPickerOpen, setHelpPickerOpen] = useState(false);
  const [fallTarget, setFallTarget] = useState(null); // { token, suggestedFeet } para una caída manual del DM
  const [interactTarget, setInteractTarget] = useState(null); // { type: 'door' | 'token', target }
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [spellOpen, setSpellOpen] = useState(false);
  const [spellCast, setSpellCast] = useState(null);
  const [spellBusy, setSpellBusy] = useState(false);
  const [spellError, setSpellError] = useState('');
  const [showSelectedVision, setShowSelectedVision] = useState(false);
  const [perceptionState, setPerceptionState] = useState({ busy: false, message: '' });
  const [hazardTool, setHazardTool] = useState(null);
  const [hazardDuration, setHazardDuration] = useState(3);
  const [hazardError, setHazardError] = useState('');
  const [hazardBusy, setHazardBusy] = useState(false);
  const [hudNotice, setHudNotice] = useState(null);
  const hudNoticeTimerRef = useRef(null);
  const selectedToken = useMemo(
    () => map.tokens.find((token) => token.id === selectedTokenId) || null,
    [map.tokens, selectedTokenId]
  );
  const selectedCell = selectedToken ? worldToGrid(selectedToken.position, map.gridSize) : null;
  const isDm = role === 'dm';

  // --- Economía de turno (Fase 8.5) ---------------------------------
  const combat = useRoom((s) => s.combat);
  const combatVisuals = useRoom((s) => s.combatVisuals);
  const spellAims = useRoom((s) => s.spellAims);
  const spellFx = useRoom((s) => s.spellFx);
  const shareSpellAim = useRoom((s) => s.shareSpellAim);
  const endTurn = useRoom((s) => s.endTurn);
  const toggleTurnMode = useRoom((s) => s.toggleTurnMode);
  const specialAction = useRoom((s) => s.specialAction);
  const deathSave = useRoom((s) => s.deathSave);
  const searchTraps = useRoom((s) => s.searchTraps);
  const castBoardSpell = useRoom((s) => s.castBoardSpell);
  const combatantForToken = (token) =>
    token
      ? combat.combatants.find((combatant) =>
          token.characterId
            ? combatant.characterId === token.characterId
            : combatant.mapTokenId === token.serverId
        ) ?? null
      : null;
  const selectedCombatant = combatantForToken(selectedToken);
  const targetCombatant = combatantForToken(combatTarget);
  const trapAlert = useRoom((s) => s.trapAlert);
  // Qué permite ahora mismo el token seleccionado (turno, movimiento gastado,
  // inconsciencia, condiciones). Mismo criterio que valida el servidor: los
  // controles que no pueden funcionar se apagan en vez de dar error al pulsar.
  const selectedGate = turnControl({
    combatant: selectedCombatant,
    speed: selectedToken?.speed,
    combatActive: combat.active,
    turnId: combat.turnId,
    // El DM recoloca fichas de PERSONAJE a placer (su ruta se salta camino y
    // presupuesto), pero mover un enemigo del tracker sí gasta su turno.
    freeMovement: isDm && Boolean(selectedToken?.characterId),
  });
  // Estar a 0 PG saca del tablero: ni atacar, ni interactuar. Es el único
  // motivo que apaga también las acciones que no gastan turno.
  const selectedIsDown = isOutOfCombat(selectedCombatant);
  const canControlSelected = Boolean(selectedToken && canMoveToken({ token: selectedToken, user, role }));
  const attackDistance =
    selectedToken && combatTarget
      ? Math.max(
          Math.abs(worldToGrid(selectedToken.position, map.gridSize).col - worldToGrid(combatTarget.position, map.gridSize).col),
          Math.abs(worldToGrid(selectedToken.position, map.gridSize).row - worldToGrid(combatTarget.position, map.gridSize).row)
        )
      : Infinity;
  // Ayudar (Fase 4c): si alguien ayudó al atacante y está a 5 pies del
  // objetivo, el ataque sale con ventaja. Espejo de lo que valida el servidor.
  const attackHelperName = (() => {
    const help = selectedCombatant?.helpFrom;
    if (!help || !combatTarget) return null;
    const helper = combat.combatants.find((c) => c.id === help.id);
    const helperToken = helper
      ? map.tokens.find((token) =>
          helper.characterId ? token.characterId === helper.characterId : token.serverId === helper.mapTokenId
        )
      : null;
    if (!helperToken) return null;
    const from = worldToGrid(helperToken.position, map.gridSize);
    const to = worldToGrid(combatTarget.position, map.gridSize);
    return Math.max(Math.abs(from.col - to.col), Math.abs(from.row - to.row)) <= 1 ? help.name : null;
  })();
  const activeCombatant = combat.active
    ? combat.combatants.find((c) => c.id === combat.turnId) ?? null
    : null;
  // ¿El combatiente activo es un PJ de este usuario? (el DM controla todos)
  const activeToken = activeCombatant
    ? map.tokens.find((token) =>
        activeCombatant.characterId
          ? token.characterId === activeCombatant.characterId
          : token.serverId === activeCombatant.mapTokenId
      ) ?? null
    : null;
  // Es realmente TU turno (para el HUD y el botón "Terminar turno"): tu
  // propio personaje, nunca el DM salvo que además sea el dueño (caso raro,
  // PJ del propio DM)
  const isOwnCharacterTurn = Boolean(activeToken && activeToken.ownerUserId === user?.id);

  // Salvación de muerte del PJ del HUD: la usan el botón del hotbar y la
  // escena de tensión (Fase 4c). El dado rueda y se revela en la bandeja.
  async function rollHudDeathSave() {
    if (!hudCombatant) return;
    const roll = rollPool({ d20: 1 }, { kind: 'check', label: 'Salvación de muerte', actorName: hudDisplay?.name });
    const natural = roll.groups.find((g) => g.sides === 20)?.results[0]?.kept ?? roll.total;
    const resp = await tirarYEnviar(roll, (tirada) => deathSave(hudCombatant.id, tirada, natural), {
      autor: hudDisplay?.name,
    });
    if (resp?.error) showHudNotice(resp.error);
  }

  function showHudNotice(message) {
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) return;
    clearTimeout(hudNoticeTimerRef.current);
    setHudNotice({ id: Date.now(), message: text });
    hudNoticeTimerRef.current = setTimeout(() => setHudNotice(null), 4000);
  }

  useEffect(() => () => clearTimeout(hudNoticeTimerRef.current), []);

  // En el tablero los dados caen en la franja baja, encima del HUD, para no
  // tapar el objetivo (Fase 4b). Al salir de la mesa vuelven al centro.
  const setRevealStage = useReveal((s) => s.setEscenario);
  useEffect(() => {
    setRevealStage('mesa');
    return () => setRevealStage('centro');
  }, [setRevealStage]);
  useEffect(() => {
    if (saveError) showHudNotice(saveError);
  }, [saveError]);

  useEffect(() => {
    if (!combat.active || !activeToken) return;
    setCameraCommand({
      type: 'focus',
      x: activeToken.position.x,
      z: activeToken.position.z,
      nonce: `${combat.round}-${combat.turnId}`,
    });
  }, [activeToken?.id, combat.active, combat.round, combat.turnId]);

  const latestCombatVisual = combatVisuals.at(-1);
  useEffect(() => {
    if (!latestCombatVisual?.strong) return;
    // Un crítico sobre un objetivo que VES empuja la cámara hacia él; si no lo
    // ves, basta la sacudida (moverla delataría dónde está).
    const criticalHit = latestCombatVisual.type === 'hit' && latestCombatVisual.critical;
    const targetVisible = map.tokens.some(
      (token) =>
        token.visible &&
        (latestCombatVisual.characterId
          ? token.characterId === latestCombatVisual.characterId
          : token.serverId === latestCombatVisual.mapTokenId)
    );
    setCameraCommand({
      type: criticalHit && targetVisible ? 'punch' : 'shake',
      strong: true,
      nonce: latestCombatVisual.id,
    });
  }, [latestCombatVisual?.id]);

  // --- Barra de estado (HUD) ------------------------------------------
  // El jugador siempre ve su propio personaje (útil saber tu HP aunque no
  // sea tu turno). El DM ve al combatiente ACTIVO —enemigo o PJ—, porque es
  // quien "juega" el turno de verdad: mostrarle siempre su propio PJ (si
  // tiene uno en esta partida) confundía de quién era el turno.
  const myToken = ownCharacterId ? map.tokens.find((t) => t.characterId === ownCharacterId) ?? null : null;
  const myCombatant = combat.combatants.find((c) => c.characterId === ownCharacterId) ?? null;

  // Mapa characterId → dueño, para saber qué filas de iniciativa son "mías"
  const ownerByCharId = useMemo(() => {
    const m = {};
    for (const t of map.tokens) if (t.characterId) m[t.characterId] = t.ownerUserId;
    return m;
  }, [map.tokens]);

  // El DM NO adopta el HUD de un PJ activo: la ficha/inventario/turno de un
  // personaje jugable son de su jugador. En el turno de un PJ, el DM solo ve
  // una barra mínima con "Saltar turno" (por si el jugador está ausente); en
  // el de un enemigo/NPC, sí ve su HUD para jugarlo.
  const dmOnPjTurn = isDm && combat.active && activeCombatant?.kind === 'pj';
  const hudCombatant = isDm ? (dmOnPjTurn ? null : activeCombatant ?? myCombatant) : myCombatant;
  const hudCharacterId = hudCombatant?.characterId ?? null;
  const hudToken = hudCharacterId
    ? map.tokens.find((t) => t.characterId === hudCharacterId) ?? null
    : null;
  // Enemigo activo: sin ficha ni token de personaje, solo nombre + lo que
  // trae el combatiente (HP/CA/velocidad, ya filtrados para el DM en servidor)
  const hudDisplay = hudCombatant
    ? { name: hudToken?.name ?? hudCombatant.name, imageUrl: hudToken?.imageUrl }
    : null;
  // Las notas son estrictamente privadas: el botón solo aparece viendo tu
  // propio personaje, nunca el de otro aunque seas el DM
  const canSeeHudNotes = Boolean(hudCharacterId) && hudCharacterId === ownCharacterId;
  // Estado del combatiente que enseña el hotbar, para apagar sus acciones
  // cuando ya no puede usarlas (muerto, agonizante, sin movimiento…).
  const hudGate = turnControl({
    combatant: hudCombatant,
    speed: hudToken?.speed,
    combatActive: combat.active,
    turnId: combat.turnId,
    // El DM juega enemigos con este mismo hotbar y ahí no tiene privilegios:
    // el servidor le exige turno, condiciones y presupuesto igual que a todos.
    freeMovement: isDm && hudCombatant?.kind === 'pj',
  });
  // Tu propio personaje fuera de juego (0 PG): además del hotbar, apaga las
  // acciones sueltas del tablero (buscar trampas, abrir puertas).
  const ownIsDown = isOutOfCombat(myCombatant);

  // --- Armas al alcance ---------------------------------------------
  // Las armas equipadas viven en el hotbar, no escondidas tras pulsar a un
  // enemigo: se empuña una (clic o tecla 1-4) y el tablero enseña a quién
  // llega. El panel de ataque sigue resolviendo la tirada.
  const { weapons: hudWeapons, reload: reloadHudCharacter } = useCharacterWeapons(hudCharacterId);
  const aimingWeapon = hudWeapons.find((weapon) => weapon.id === aimingWeaponId) ?? null;
  // Al cambiar de personaje (o quedarte sin esa arma) el apuntado se cae solo.
  useEffect(() => {
    if (aimingWeaponId && !hudWeapons.some((weapon) => weapon.id === aimingWeaponId)) setAimingWeaponId(null);
  }, [aimingWeaponId, hudWeapons]);

  const aimOrigin = aimingWeapon && hudToken ? worldToGrid(hudToken.position, map.gridSize) : null;
  // Hasta dónde llega el arma empuñada, con la misma lectura que el alcance de
  // andar pero en su color: contorno del alcance normal y, detrás, el de la
  // distancia larga. Lo recortan los muros y las columnas, así que la sombra
  // del contorno enseña qué esquina te cubre y desde dónde no tienes tiro.
  const aimRangeCells = useMemo(
    () => (aimOrigin ? weaponRangeCells(map, aimOrigin, aimingWeapon.geometry) : { normal: [], long: [] }),
    [aimOrigin?.col, aimOrigin?.row, aimingWeapon, map]
  );
  // A distancia el área cubriría medio tablero, así que el veredicto va sobre
  // cada objetivo: un aro verde (llega), ámbar (distancia larga, desventaja) o
  // rojo (fuera de alcance o sin línea de visión).
  const aimTargetStates = useMemo(() => {
    if (!aimOrigin || !aimingWeapon) return null;
    const states = new Map();
    for (const token of map.tokens) {
      if (!token.visible || token.characterId === hudCharacterId) continue;
      if (!token.characterId && token.kind !== 'enemigo' && token.kind !== 'aliado') continue;
      const cell = worldToGrid(token.position, map.gridSize);
      const distance = Math.max(Math.abs(cell.col - aimOrigin.col), Math.abs(cell.row - aimOrigin.row));
      const lineOfSight = hasBoardLineOfSight(map, aimOrigin, cell);
      states.set(token.id, targetRangeState(distance, aimingWeapon.geometry, { lineOfSight }).state);
    }
    return states;
  }, [aimOrigin?.col, aimOrigin?.row, aimingWeapon, hudCharacterId, map]);

  // Empuñar un arma selecciona tu propio token: apuntar y mover comparten
  // selección, y así el jugador ve de dónde sale el disparo.
  function aimWeapon(weaponId) {
    setAimingWeaponId((current) => {
      const next = current === weaponId ? null : weaponId;
      if (next) {
        if (hudToken) setSelectedTokenId(hudToken.id);
        setMovePreview(null);
        setSpellOpen(false);
        setSpellCast(null);
      }
      return next;
    });
  }

  // Grid de casillas pisables del tablero (con coste por terreno difícil):
  // lo comparten el área verde de alcance y la vista previa de movimiento.
  const boardWalkable = useMemo(() => buildBoardWalkable(map), [map]);
  const boardWalls = useMemo(() => buildBoardWalls(map), [map]);
  const boardElevation = useMemo(() => buildBoardElevation(map), [map]);
  const moveFluidWarnings = useMemo(() => {
    if (!movePreview?.path?.length) return [];
    const effects = normalizeFluidEffects(map.fluidEffects);
    return fluidTypesAlongBoardPath(map, movePreview.path).map((type) => ({
      type,
      label: FLUID_TYPES.find((entry) => entry.key === type)?.label ?? type,
      summary: fluidEffectSummary(type, effects[type]),
    }));
  }, [map, movePreview]);
  const spellOrigin = hudToken ? worldToGrid(hudToken.position, map.gridSize) : null;
  const spellPreview = useMemo(() => {
    if (!spellCast?.data || !spellCast.aim || !spellOrigin) {
      return { validation: null, cells: [], affectedNames: [] };
    }
    const sight = hasBoardLineOfSight(map, spellOrigin, spellCast.aim);
    const validation = spellAimValidation(spellCast.data, spellOrigin, spellCast.aim, sight);
    // La plantilla se pinta también cuando el apuntado NO es válido (en rojo):
    // ver dónde caería el conjuro es justo lo que ayuda a corregir la mira.
    const rawCells = spellCast.area
      ? spellAreaCells({
          origin: spellOrigin,
          aim: spellCast.aim,
          area: spellCast.area,
          self: spellRangeSquares(spellCast.data) === 0,
        })
      : [];
    const keys = new Set(rawCells.map((cell) => `${cell.x},${cell.y}`));
    const affectedNames = spellCast.area
      ? map.tokens
          .filter((token) => {
            if (!token.visible) return false;
            if (!token.characterId && token.kind !== 'enemigo' && token.kind !== 'aliado') return false;
            const cell = worldToGrid(token.position, map.gridSize);
            return keys.has(`${cell.col},${cell.row}`);
          })
          .map((token) => token.name)
      : spellCast.target
        ? [map.tokens.find((token) => token.id === spellCast.targetTokenId)?.name].filter(Boolean)
        : [];
    return {
      validation,
      cells: rawCells.map((cell) => ({ col: cell.x, row: cell.y })),
      affectedNames,
    };
  }, [hudToken, map, spellCast, spellOrigin?.col, spellOrigin?.row]);

  // --- Apuntado visible en el tablero -------------------------------
  // Tu propia mira se pinta en local (sin esperar al servidor) y la de los
  // demás llega por socket ya en coordenadas absolutas del editor, así que
  // hay que devolverlas al marco del tablero compuesto antes de dibujarlas.
  const spellAimValid = spellPreview.validation?.ok !== false;
  const aims = useMemo(() => {
    const entries = [];
    if (spellCast?.data && spellCast.aim && spellOrigin) {
      entries.push({
        id: 'propio',
        origin: { col: spellOrigin.col, row: spellOrigin.row },
        aim: { col: spellCast.aim.x, row: spellCast.aim.y },
        cells: spellPreview.cells,
        valid: spellAimValid,
        color: elementColor(spellElement(spellCast.data)),
      });
    }
    for (const remote of spellAims) {
      if (remote.floorId != null && remote.floorId !== map.floorId) continue;
      if (remote.casterId === hudCharacterId) continue;
      if (!remote.aim) continue;
      entries.push({
        id: `lanzador-${remote.casterId}`,
        origin: remote.origin ? absoluteToBoard(remote.origin, map) : null,
        aim: absoluteToBoard(remote.aim, map),
        cells: (remote.cells ?? []).map((cell) => absoluteToBoard(cell, map)),
        valid: remote.valid !== false,
        color: elementColor(remote.element),
        label: [remote.casterName, remote.spellName].filter(Boolean).join(' · '),
      });
    }
    return entries;
  }, [hudCharacterId, map, spellAims, spellAimValid, spellCast, spellOrigin?.col, spellOrigin?.row, spellPreview.cells]);

  // Destellos de conjuros ya resueltos (los emite el servidor al lanzar)
  const boardSpellFx = useMemo(
    () => spellFx
      .filter((fx) => fx.aim && (fx.floorId == null || fx.floorId === map.floorId))
      .map((fx) => ({
        ...fx,
        origin: fx.origin ? absoluteToBoard(fx.origin, map) : null,
        aim: absoluteToBoard(fx.aim, map),
        cells: (fx.cells ?? []).map((cell) => absoluteToBoard(cell, map)),
        color: elementColor(fx.element),
      })),
    [map, spellFx]
  );

  // Comparte la mira con la mesa cuando cambia (y la retira al cerrar el
  // panel o cambiar de personaje). La clave evita reenviar en cada render.
  const aimKey = spellCast?.data && spellCast.aim && spellOrigin
    ? `${map.floorId}:${spellCast.spell.index}:${spellCast.aim.x}:${spellCast.aim.y}:${spellOrigin.col}:${spellOrigin.row}:${spellAimValid}`
    : '';
  const aimSharedRef = useRef(false);
  useEffect(() => {
    if (!hudCharacterId) return;
    if (!aimKey) {
      if (aimSharedRef.current) shareSpellAim(hudCharacterId, null);
      aimSharedRef.current = false;
      return;
    }
    shareSpellAim(hudCharacterId, {
      floorId: map.floorId,
      origin: boardToAbsolute(spellOrigin, map),
      aim: boardToAbsolute({ col: spellCast.aim.x, row: spellCast.aim.y }, map),
      cells: spellPreview.cells.map((cell) => boardToAbsolute(cell, map)),
      valid: spellAimValid,
      spellName: spellCast.spell.name,
      element: spellElement(spellCast.data),
    });
    aimSharedRef.current = true;
  }, [aimKey, hudCharacterId]);

  // Al desmontar el tablero (o cambiar de personaje en el HUD) la mira que
  // quedó publicada debe irse con él, no envejecer sola en la mesa.
  useEffect(() => () => {
    if (aimSharedRef.current && hudCharacterId) shareSpellAim(hudCharacterId, null);
  }, [hudCharacterId]);
  const selectedHasHighGround = (() => {
    if (!selectedToken || !combatTarget) return false;
    const attackerCell = worldToGrid(selectedToken.position, map.gridSize);
    const targetCell = worldToGrid(combatTarget.position, map.gridSize);
    return (
      (boardElevation.get(cellKey(attackerCell.col, attackerCell.row)) ?? 0) >
      (boardElevation.get(cellKey(targetCell.col, targetCell.row)) ?? 0)
    );
  })();
  const attackLineOfSight = (() => {
    if (!selectedToken || !combatTarget) return false;
    return hasBoardLineOfSight(
      map,
      worldToGrid(selectedToken.position, map.gridSize),
      worldToGrid(combatTarget.position, map.gridSize)
    );
  })();
  // Línea de tiro: con un objetivo elegido, la recta que los une dice a QUIÉN
  // apuntas —con enemigos amontonados el contorno de alcance no basta— y de
  // qué color, si ese disparo llega.
  const aimLine = useMemo(() => {
    if (!aimOrigin || !aimingWeapon || !combatTarget) return null;
    const to = worldToGrid(combatTarget.position, map.gridSize);
    const state = targetRangeState(attackDistance, aimingWeapon.geometry, { lineOfSight: attackLineOfSight }).state;
    return { from: aimOrigin, to, state };
  }, [aimOrigin?.col, aimOrigin?.row, aimingWeapon, attackDistance, attackLineOfSight, combatTarget, map.gridSize]);

  const canMakeSelectedFall = Boolean(
    isDm &&
      selectedToken &&
      (selectedToken.characterId ||
        (selectedToken.serverId && (selectedToken.kind === 'enemigo' || selectedToken.kind === 'aliado')))
  );
  const selectedElevation = selectedCell
    ? boardElevation.get(cellKey(selectedCell.col, selectedCell.row)) ?? 0
    : 0;
  // Una cota pintada equivale a 5 pies. Como el daño solo cuenta cada 10,
  // se propone el tramo completo más cercano; el DM puede cambiarlo.
  const suggestedFallFeet = Math.max(10, Math.min(200, Math.floor((Math.abs(selectedElevation) * 5) / 10) * 10 || 10));
  const canShowSelectedVision = Boolean(
    isDm &&
      selectedToken?.serverId &&
      (selectedToken.kind === 'enemigo' || selectedToken.kind === 'aliado') &&
      Number.isInteger(selectedToken.visionRadius)
  );
  const visionCells = useMemo(() => {
    if (!canShowSelectedVision || !showSelectedVision || !selectedCell) return [];
    return computeBoardVision(map, {
      col: selectedCell.col,
      row: selectedCell.row,
      radius: selectedToken.visionRadius,
    });
  }, [canShowSelectedVision, map, selectedCell, selectedToken?.visionRadius, showSelectedVision]);

  // Terreno difícil aplanado a coordenadas del tablero, para pintarlo
  const terrainCells = useMemo(() => {
    const cells = [];
    for (const room of map.rooms ?? []) {
      for (const [c, r] of room.terrainCells ?? []) {
        cells.push({ col: room.col + c, row: room.row + r });
      }
    }
    return cells;
  }, [map.rooms]);

  // Área de movimiento: casillas alcanzables por el combatiente activo con
  // lo que le queda de movimiento (visible para toda la mesa al seleccionar
  // su token). Misma regla que valida el servidor: coste del camino real
  // (Dijkstra con terreno difícil) dentro del presupuesto.
  const reachableCells = useMemo(() => {
    if (!combat.active || !activeCombatant?.speed || !activeToken) return [];
    if (!selectedToken || selectedToken.id !== activeToken.id) return [];
    // El mismo criterio que apaga el pad y la vista previa: sin casillas, sin
    // turno o inconsciente, no se pinta un área que ya no se puede usar.
    const gate = turnControl({
      combatant: activeCombatant,
      speed: activeToken.speed,
      combatActive: combat.active,
      turnId: combat.turnId,
    });
    if (!gate.move.allowed || !gate.remaining) return [];
    const origin = worldToGrid(activeToken.position, map.gridSize);
    return reachableWithin(boardWalkable, origin, gate.remaining, boardWalls, boardElevation);
  }, [activeCombatant, activeToken, boardWalkable, boardWalls, boardElevation, combat.active, combat.turnId, map.gridSize, selectedToken]);

  // Movimiento que le queda al token seleccionado, si se puede saber desde
  // aquí (PJ con combatiente en el tracker y modo por turnos activo)
  const selectedRemaining =
    combat.active && selectedToken?.characterId && selectedCombatant ? selectedGate.remaining : null;

  // La vista previa muere con cualquier cambio de selección o del mapa (el
  // token pudo moverse por socket, el terreno cambiar, etc.)
  useEffect(() => {
    setMovePreview(null);
    setShowSelectedVision(false);
  }, [selectedTokenId, map]);

  async function handleSearchTraps() {
    if (!ownCharacterId || perceptionState.busy || ownIsDown) return;
    setPerceptionState({ busy: true, message: '' });
    const response = await searchTraps(ownCharacterId);
    if (response?.error) {
      setPerceptionState({ busy: false, message: response.error });
      return;
    }
    const names = response?.found?.map((trap) => trap.name) ?? [];
    // El hallazgo se cuenta cuando cae el dado de Percepción, no antes
    trasElDado(() =>
      setPerceptionState({
        busy: false,
        message: names.length
          ? `Descubres: ${names.join(', ')}.`
          : 'No descubres ninguna trampa.',
      })
    );
  }

  // Escape: primero cancela la vista previa, después deselecciona
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (aimingWeaponId) {
        setAimingWeaponId(null);
        return;
      }
      if (spellOpen) {
        setSpellOpen(false);
        setSpellCast(null);
        setSpellError('');
        return;
      }
      setMovePreview((preview) => {
        if (!preview) setSelectedTokenId(null);
        return null;
      });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [aimingWeaponId, spellOpen]);

  // Clic en el suelo: con un token tuyo seleccionado, calcula camino y coste
  // hasta esa casilla y muestra la vista previa (el movimiento espera a la
  // confirmación); clic fuera del suelo pisable = deseleccionar.
  function handleGroundClick(point) {
    if (hazardTool && isDm) {
      const preset = HAZARD_PRESETS[hazardTool];
      const center = worldToGrid(point, map.gridSize);
      const cells = preset.cells(center).filter((cell) => boardWalkable.has(cellKey(cell.col, cell.row)));
      if (!cells.length) {
        setHazardError('La zona debe caer sobre casillas transitables.');
        return;
      }
      setHazardBusy(true);
      setHazardError('');
      api(`/campaigns/${campaignId}/mapas/${map.serverMapId}/zonas`, {
        method: 'POST',
        body: {
          ...preset,
          cells: cells.map((cell) => ({
            floorId: map.floorId,
            x: cell.col + (map.origin?.x ?? 0),
            y: cell.row + (map.origin?.y ?? 0),
          })),
          duration: hazardDuration,
          halfOnSave: true,
        },
      })
        .then(() => setHazardTool(null))
        .catch((error) => setHazardError(error.message || 'No se pudo crear la zona.'))
        .finally(() => setHazardBusy(false));
      return;
    }
    if (spellCast?.data) {
      const cell = worldToGrid(point, map.gridSize);
      setSpellCast((current) => ({
        ...current,
        aim: { x: cell.col, y: cell.row },
        target: null,
        targetTokenId: null,
      }));
      setSpellError('');
      return;
    }
    if (!selectedToken) return;
    const cell = worldToGrid(point, map.gridSize);
    const walkableTarget = boardWalkable.has(cellKey(cell.col, cell.row));
    if (!walkableTarget) {
      // "Fuera": vacío, obstáculo o más allá del tablero → deseleccionar
      setMovePreview(null);
      setSelectedTokenId(null);
      return;
    }
    if (!canControlSelected) {
      // Token de otro (solo lectura): pulsar el suelo lo suelta
      setMovePreview(null);
      setSelectedTokenId(null);
      return;
    }
    // Muerto, agonizante, sin turno o sin casillas: se dice por qué en vez de
    // abrir una vista previa que el servidor va a rechazar igualmente.
    if (!selectedGate.move.allowed) {
      setMovePreview(null);
      showHudNotice(selectedGate.move.message);
      return;
    }
    const origin = worldToGrid(selectedToken.position, map.gridSize);
    if (origin.col === cell.col && origin.row === cell.row) {
      setMovePreview(null);
      return;
    }
    const result = findBoardPath(boardWalkable, origin, cell, 150, boardWalls, boardElevation);
    if (!result) {
      setMovePreview({ cell, cost: null, path: [], remaining: selectedRemaining });
      return;
    }
    setMovePreview({ cell, cost: result.cost, path: result.path, remaining: selectedRemaining });
  }

  async function confirmMove() {
    if (!movePreview || movePreview.cost === null) return;
    const target = gridToWorld(movePreview.cell, map.gridSize);
    setMovePreview(null);
    await onMoveToken(selectedTokenId, target);
  }

  // El objetivo del combate se mantiene fresco con cada refresco del mapa
  // (su HP cambia al recibir daño); si desaparece (ha caído), el panel se cierra
  useEffect(() => {
    if (!combatTarget) return;
    const fresh = map.tokens.find((t) => t.id === combatTarget.id);
    if (!fresh) setCombatTarget(null);
    else if (fresh !== combatTarget) setCombatTarget(fresh);
  }, [combatTarget, map.tokens]);

  // Con tu personaje seleccionado, pulsar un enemigo u otro PJ lo fija como
  // objetivo de ataque, y un marcador de trampa/objeto abre el popup de
  // interactuar (Fase 8.7); cualquier otro caso simplemente selecciona el token.
  function handleSelectToken(tokenId) {
    setFallTarget(null);
    const clicked = map.tokens.find((t) => t.id === tokenId);
    if (spellCast?.data && clicked) {
      const creature = Boolean(
        clicked.characterId || (clicked.serverId && ['enemigo', 'aliado'].includes(clicked.kind))
      );
      if (!spellCast.area && !creature) {
        setSpellError('Ese conjuro necesita una criatura como objetivo.');
        return;
      }
      const cell = worldToGrid(clicked.position, map.gridSize);
      setSpellCast((current) => ({
        ...current,
        aim: { x: cell.col, y: cell.row },
        target: clicked.characterId
          ? { kind: 'personaje', id: clicked.characterId }
          : { kind: 'marcador', id: clicked.serverId },
        targetTokenId: clicked.id,
      }));
      setSpellError('');
      return;
    }
    // Re-pulsar el token ya seleccionado lo deselecciona (toggle)
    if (tokenId === selectedTokenId) {
      setSelectedTokenId(null);
      setMovePreview(null);
      setCombatTarget(null);
      setFallTarget(null);
      setInteractTarget(null);
      return;
    }
    // El DM también puede atacar CON un enemigo/aliado que controla (no solo
    // con su propio PJ): sin ficha de personaje, sus ataques salen de la
    // ficha de monstruo del SRD (o de un ataque manual si no tiene ninguna).
    const isMonsterAttacker =
      isDm && Boolean(selectedToken?.serverId) && (selectedToken?.kind === 'enemigo' || selectedToken?.kind === 'aliado');
    // Un personaje a 0 PG no ataca ni interactúa: pulsar a otro token con él
    // seleccionado pasa a ser simple selección, como la de un token ajeno.
    const canAttackFrom =
      (Boolean(selectedToken?.characterId) || isMonsterAttacker) &&
      canControlSelected &&
      !selectedIsDown;
    const attackable =
      clicked &&
      clicked.id !== selectedToken?.id &&
      ((clicked.serverId && clicked.type === 'enemy') ||
        (clicked.characterId && clicked.characterId !== selectedToken?.characterId));
    if (canAttackFrom && attackable) {
      setCombatTarget(clicked);
      setInventoryOpen(false);
      return;
    }
    const interactable =
      !isDm && clicked && clicked.serverId && (clicked.kind === 'trampa' || clicked.kind === 'objeto');
    if (canAttackFrom && interactable) {
      setInteractTarget({ type: 'token', target: clicked });
      setInventoryOpen(false);
      return;
    }
    setSelectedTokenId(tokenId);
    setCombatTarget(null);
    setFallTarget(null);
    setInteractTarget(null);
    setInventoryOpen(false);
  }

  // Selección desde la tira de iniciativa: siempre selecciona y centra, nunca
  // ataca ni apunta un conjuro. Pulsar un retrato es un gesto de "enséñamelo",
  // no de "actúo sobre él": encadenarlo a handleSelectToken abriría el panel de
  // ataque por leer la vida de un enemigo.
  function handleFocusCombatant(tokenId) {
    const token = map.tokens.find((t) => t.id === tokenId);
    if (!token) return;
    // Con un arma empuñada el gesto ya no es ambiguo: pulsar un retrato ajeno
    // es elegirlo como objetivo. Es la segunda forma de descubrir el ataque,
    // para quien no acierte a pulsar la ficha en el tablero.
    const enemy = token.characterId
      ? token.characterId !== hudCharacterId
      : token.kind === 'enemigo' || token.kind === 'aliado';
    if (aimingWeapon && enemy) {
      setCombatTarget(token);
      setMovePreview(null);
      setInventoryOpen(false);
      sendCameraCommand('focus', { x: token.position.x, z: token.position.z });
      return;
    }
    setSelectedTokenId(tokenId);
    setMovePreview(null);
    setCombatTarget(null);
    setFallTarget(null);
    setInteractTarget(null);
    sendCameraCommand('focus', { x: token.position.x, z: token.position.z });
  }

  // Abrir una puerta: el DM la alterna directo (sin coste), el jugador pasa
  // por el popup de confirmación (adyacencia, turno y tirada los valida el
  // servidor al confirmar).
  function handleOpenDoor(door) {
    if (isDm) {
      onOpenDoor(door);
      return;
    }
    if (ownIsDown) {
      showHudNotice('Estás inconsciente: no puedes abrir puertas.');
      return;
    }
    if (door.isOpen) return;
    setInteractTarget({ type: 'door', target: door });
  }

  function sendCameraCommand(type, extra = {}) {
    setCameraCommand({ type, ...extra, issuedAt: Date.now() });
  }

  // Inclinación de la cámara por escalones: de cenital (0°, plano puro) a
  // 46° (el tablero se ve claramente en escorzo). Con la cámara ortográfica
  // el suelo se comprime cos(ángulo) en vertical: a 22° era solo un 7% y no
  // se apreciaba, por eso los pasos suben hasta ángulos que sí se notan.
  // El índice inicial (26°) debe coincidir con el tilt inicial de TacticalCamera.
  const TILT_STEPS_DEG = [0, 15, 26, 36, 46];
  const [tiltIndex, setTiltIndex] = useState(2);
  // La cámara puede quedar en un ángulo intermedio si el jugador orbita con el
  // ratón; entonces el escalón más cercano es el punto de partida del siguiente
  // paso, para que el botón no dé un salto hacia atrás.
  const [freeTilt, setFreeTilt] = useState(null); // grados reales tras orbitar
  function adjustTilt(dir) {
    const from = freeTilt == null
      ? tiltIndex
      : TILT_STEPS_DEG.reduce(
          (best, deg, index) => (Math.abs(deg - freeTilt) < Math.abs(TILT_STEPS_DEG[best] - freeTilt) ? index : best),
          0
        );
    const next = Math.min(TILT_STEPS_DEG.length - 1, Math.max(0, from + dir));
    if (next === tiltIndex && freeTilt == null) return;
    setTiltIndex(next);
    setFreeTilt(null);
    sendCameraCommand('tilt', { tilt: (TILT_STEPS_DEG[next] * Math.PI) / 180 });
  }

  // Teclado de cámara (Fase 4). Mismas manos que en cualquier juego con vista
  // táctica: Q/E giran, F encuadra, R/T gradúan la inclinación y +/− acercan.
  // No se disparan mientras se escribe en el chat (matchShortcut lo comprueba).
  useEffect(() => {
    function onKeyDown(event) {
      const action = matchShortcut(event, CAMERA_KEYS);
      if (!action) return;
      event.preventDefault();
      if (action === 'rotarIzquierda') sendCameraCommand('rotate', { dir: -1 });
      if (action === 'rotarDerecha') sendCameraCommand('rotate', { dir: 1 });
      if (action === 'centrar') {
        // F encuadra lo tuyo si hay algo tuyo que encuadrar; si no, el mapa.
        const focus = selectedToken ?? hudToken;
        if (focus) sendCameraCommand('focus', { x: focus.position.x, z: focus.position.z });
        else sendCameraCommand('center');
      }
      if (action === 'inclinarMas') adjustTilt(1);
      if (action === 'inclinarMenos') adjustTilt(-1);
      if (action === 'acercar') sendCameraCommand('zoom-in');
      if (action === 'alejar') sendCameraCommand('zoom-out');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function toggleMeasureMode() {
    setMeasureMode((value) => {
      if (!value) {
        setSelectedTokenId(null);
        setCombatTarget(null);
        setInteractTarget(null);
      }
      setMeasurePoints([]);
      return !value;
    });
  }

  // Cada clic centra el punto en su casilla; al tercer clic empieza una
  // medición nueva desde ahí
  function addMeasurePoint(point) {
    const snap = (v) => (Math.floor(v / map.gridSize) + 0.5) * map.gridSize;
    const snapped = { x: snap(point.x), z: snap(point.z) };
    setMeasurePoints((current) => (current.length >= 2 ? [snapped] : [...current, snapped]));
  }

  function nudgeSelectedToken(dx, dz) {
    if (!selectedToken) return;
    if (!selectedGate.move.allowed) {
      showHudNotice(selectedGate.move.message);
      return;
    }
    onMoveToken(selectedToken.id, {
      x: selectedToken.position.x + dx * map.gridSize,
      y: 0,
      z: selectedToken.position.z + dz * map.gridSize,
    });
  }

  const selectionSummary = measureMode
    ? 'Modo medir: pulsa dos casillas para ver la distancia.'
    : selectedToken
      ? `${selectedToken.name} · casilla ${selectedCell.col}, ${selectedCell.row}${
          // En combate manda lo que le queda al combatiente, no su velocidad
          // en la ficha: "6 casillas" junto a "sin movimiento" se contradecían.
          // Y un personaje a 0 PG no tiene casillas que anunciar.
          selectedIsDown
            ? ' · fuera de combate'
            : selectedGate.budget != null && selectedRemaining != null
              ? ` · ${selectedRemaining}/${selectedGate.budget} casillas`
              : selectedToken.speed
                ? ` · ${Math.floor(selectedToken.speed / 5)} casillas`
                : ''
        }${canControlSelected ? '' : ' · solo lectura'}`
      : '';
  const hudNotices = [
    !isDm ? perceptionState.message : '',
    doorError,
  ].filter(Boolean);
  // La caja de contexto queda para lo que depende del token seleccionado; las
  // acciones del personaje viven ahora en los slots del hotbar.
  const hasContextActions = canMakeSelectedFall || canShowSelectedVision;

  return (
    <section className="relative min-h-0 flex-1 overflow-hidden bg-night-950">
      <CanvasErrorBoundary>
        <TacticalMapCanvas
          map={map}
          user={user}
          role={role}
          selectedTokenId={selectedTokenId}
          showGrid={showGrid}
          savingTokenId={savingTokenId}
          cameraCommand={cameraCommand}
          onViewChange={({ tiltDeg }) => setFreeTilt(Math.round(tiltDeg))}
          onSelectToken={handleSelectToken}
          onGroundClick={handleGroundClick}
          onOpenDoor={handleOpenDoor}
          onPing={onPing}
          pings={pings}
          measureMode={measureMode}
          measurePoints={measurePoints}
          onMeasurePoint={addMeasurePoint}
          reachableCells={reachableCells}
          aimRangeCells={aimRangeCells}
          aimTargetStates={aimTargetStates}
          aimLine={aimLine}
          terrainCells={terrainCells}
          pathCells={movePreview?.path ?? []}
          visionCells={visionCells}
          aims={aims}
          spellFx={boardSpellFx}
          activeTokenId={activeToken?.id ?? null}
          combatVisuals={combatVisuals}
          combatants={combat.combatants}
        />
      </CanvasErrorBoundary>

      <CombatAlert />
      {/* Fase 4c: la trampa salta en todas las pantallas */}
      <TrapAlert alert={trapAlert} />
      {/* Fase 4c: tu turno a las puertas de la muerte, con toda la tensión */}
      {hudCombatant?.dying &&
        !hudCombatant.deathSaveRolled &&
        combat.active &&
        combat.turnId === hudCombatant.id &&
        hudToken?.ownerUserId === user?.id && (
          <DeathSaveOverlay name={hudDisplay?.name} saves={hudCombatant.deathSaves} onRoll={rollHudDeathSave} />
        )}
      <TurnAlert trigger={combat.active && isOwnCharacterTurn ? `${combat.round}-${combat.turnId}` : null} />
      {combat.opportunities?.[0] && (
        <OpportunityPrompt
          key={combat.opportunities[0].id}
          opportunity={combat.opportunities[0]}
        />
      )}

      {spellOpen && hudCharacterId && hudToken && (
        <SpellPanel
          characterId={hudCharacterId}
          campaignId={campaignId}
          selection={spellCast}
          validation={spellPreview.validation}
          affectedNames={spellPreview.affectedNames}
          busy={spellBusy}
          error={spellError}
          onSelect={(next) => {
            setSpellError('');
            if (!next) {
              setSpellCast(null);
              return;
            }
            const area = spellArea(next.data);
            const range = spellRangeSquares(next.data);
            const centeredSelf =
              range === 0 && area && !['cone', 'line', 'cube'].includes(area.type);
            setSpellCast({
              ...next,
              area,
              aim: centeredSelf && spellOrigin ? { x: spellOrigin.col, y: spellOrigin.row } : null,
              target: null,
              targetTokenId: null,
            });
            setMovePreview(null);
            setCombatTarget(null);
          }}
          onSlotLevel={(slotLevel) => setSpellCast((current) => ({ ...current, slotLevel }))}
          onCast={async () => {
            if (!spellCast) return;
            setSpellBusy(true);
            setSpellError('');
            const response = await castBoardSpell({
              characterId: hudCharacterId,
              spellIndex: spellCast.spell.index,
              // El servidor valida alcance y plantilla contra las coordenadas
              // absolutas del editor, no contra las del tablero compuesto
              aim: boardToAbsolute({ col: spellCast.aim.x, row: spellCast.aim.y }, map),
              target: spellCast.target,
              slotLevel: spellCast.slotLevel,
            });
            setSpellBusy(false);
            if (response?.error) {
              setSpellError(response.error);
              return;
            }
            setSpellCast(null);
            setSpellOpen(false);
          }}
          onClose={() => {
            setSpellOpen(false);
            setSpellCast(null);
            setSpellError('');
          }}
        />
      )}

      {/* Arriba-izquierda: identidad y contexto estable, sin acciones. */}
      <div className="tactical-surface pointer-events-none absolute left-3 top-3 z-10 max-w-[42vw] rounded-sm border border-gold/20 bg-night-900/90 px-3 py-2 text-bone shadow-xl backdrop-blur sm:left-4 sm:top-4">
        <p className="truncate font-display text-sm tracking-wide text-gold">{map.name}</p>
        <div className="mt-1 flex items-center gap-2 text-[0.65rem] uppercase tracking-widest text-bone/50">
          <span className="truncate">
            {map.floors?.find((floor) => floor.id === map.floorId)?.name ?? 'Planta actual'}
          </span>
          <span aria-hidden="true" className="text-gold/35">•</span>
          <span className="shrink-0">{combat.active ? `Ronda ${combat.round}` : 'Exploración libre'}</span>
        </div>
      </div>

      {/* Arriba-centro en combate: la tira de retratos, el sitio de honor del
          HUD. En móvil baja bajo la caja de identidad para no pisarla. */}
      {combat.active && (
        <div className="absolute left-1/2 top-[4.5rem] z-10 flex w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 justify-center md:top-3">
          <InitiativeStrip
            combat={combat}
            tokens={map.tokens}
            userId={user?.id}
            isDm={isDm}
            ownerByCharId={ownerByCharId}
            selectedTokenId={selectedTokenId}
            onSelect={handleFocusCombatant}
          />
        </div>
      )}

      {/* Fuera de combate el mismo hueco lista los tokens del tablero. */}
      {!combat.active && (
        <div className="absolute left-1/2 top-3 z-10 hidden max-h-[42vh] w-56 -translate-x-1/2 overflow-y-auto rounded-sm border border-gold/20 bg-night-900/90 p-2 shadow-xl backdrop-blur md:block">
        <p className="mb-2 px-1 font-display text-xs uppercase tracking-widest text-gold/80">Tokens</p>
        <div className="space-y-1">
          {map.tokens.map((token) => {
            const movable = canMoveToken({ token, user, role });
            return (
              <button
                key={token.id}
                type="button"
                onClick={() => handleSelectToken(token.id)}
                aria-pressed={selectedTokenId === token.id}
                className={`flex w-full flex-col gap-1.5 rounded-sm border px-2 py-2 text-left text-sm ${
                  selectedTokenId === token.id
                    ? 'border-gold bg-gold/10 text-gold'
                    : 'border-transparent text-bone hover:border-bone/20'
                }`}
              >
                <span className="truncate font-medium">{token.name}</span>
                <div className="flex items-center justify-between gap-2">
                  {Number.isInteger(token.hp) && Number.isInteger(token.hpMax) && token.hpMax > 0 ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-12 overflow-hidden rounded-sm bg-night-950">
                        <span
                          className={`block h-full ${
                            token.hp / token.hpMax > 0.5
                              ? 'bg-moss'
                              : token.hp / token.hpMax > 0.25
                                ? 'bg-ochre'
                                : 'bg-blood'
                          }`}
                          style={{ width: `${Math.max(0, Math.min(100, (token.hp / token.hpMax) * 100))}%` }}
                        />
                      </span>
                      <span className="font-mono text-[0.65rem] text-bone/60">
                        {token.hp}/{token.hpMax}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[0.65rem] text-bone/40">—</span>
                  )}
                  <span className="text-[0.65rem] uppercase tracking-widest text-bone/55">
                    {token.speed ? `${Math.floor(token.speed / 5)} cas` : movable ? 'mover' : token.type}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        </div>
      )}

      {/* Arriba-derecha: herramientas administrativas, fuera de la vista del
          jugador salvo el control de IA permitido en escaramuzas sin DM. */}
      <div className="absolute right-3 top-3 z-20 sm:right-4 sm:top-4">
        <TableControls
          isDm={isDm}
          canControlEnemyAi={canControlEnemyAi}
          canRest={canRest}
          clockEnabled={clockEnabled}
          clockLabel={clockLabel}
          restBusy={restBusy}
          onRest={onRest}
          onToggleClock={onToggleClock}
          onRequestRoll={() => setRequestRollOpen(true)}
          combat={combat}
          playerView={playerView}
          floors={map.floors ?? []}
          floorId={map.floorId}
          hazardPresets={HAZARD_PRESETS}
          hazardTool={hazardTool}
          hazardDuration={hazardDuration}
          hazardBusy={hazardBusy}
          hazardZones={map.hazardZones ?? []}
          error={[tableControlError, hazardError].filter(Boolean).join(' ')}
          onToggleTurnMode={() => toggleTurnMode()}
          onToggleEnemyAi={onToggleEnemyAi}
          onTogglePlayerView={onTogglePlayerView}
          onSelectFloor={onSelectFloor}
          onSelectHazard={(key) => {
            setHazardTool((current) => current === key ? null : key);
            setHazardError('');
          }}
          onHazardDuration={(value) => setHazardDuration(Math.max(1, Math.min(20, Number(value) || 1)))}
          onRemoveHazard={(zone) => {
            setHazardError('');
            api(`/campaigns/${campaignId}/mapas/${map.serverMapId}/zonas/${zone.id}`, { method: 'DELETE' })
              .catch((error) => setHazardError(error.message || 'No se pudo retirar la zona.'));
          }}
        />
      </div>

      {/* Contexto efímero junto al hotbar: la información y las acciones
          mantienen cajas separadas para no volver a crear un cajón de sastre. */}
      {!movePreview && (
        <div className="pointer-events-none absolute bottom-[12rem] left-1/2 z-10 flex w-[36rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col items-center gap-1.5 sm:bottom-[9rem] md:bottom-[5.5rem]">
          {selectionSummary && (
            <p className="max-w-full truncate rounded-full border border-bone/10 bg-night-950/80 px-3 py-1 text-center text-[0.68rem] text-bone/55 shadow-lg backdrop-blur">
              {selectionSummary}
            </p>
          )}

          {hasContextActions && (
            <div className="pointer-events-auto flex max-w-full flex-wrap justify-center gap-1.5 rounded-sm border border-gold/20 bg-night-900/95 p-1.5 shadow-xl backdrop-blur">
              {canMakeSelectedFall && (
                <button
                  type="button"
                  onClick={() => {
                    // Congela también la altura sugerida: si el golpe elimina el
                    // token, la recarga del mapa no debe borrar el resultado.
                    setFallTarget({ token: selectedToken, suggestedFeet: suggestedFallFeet });
                    setCombatTarget(null);
                    setInteractTarget(null);
                    setMovePreview(null);
                  }}
                  className="min-h-9 rounded-sm border border-blood/60 bg-blood/10 px-2.5 text-xs text-blood hover:bg-blood/20"
                >
                  Hacer caer…
                </button>
              )}
              {canShowSelectedVision && (
                <button
                  type="button"
                  onClick={() => setShowSelectedVision((visible) => !visible)}
                  aria-pressed={showSelectedVision}
                  className="min-h-9 rounded-sm border border-sky-400/50 bg-sky-400/10 px-2.5 text-xs text-sky-200 hover:bg-sky-400/20"
                >
                  {showSelectedVision ? 'Ocultar visión' : `Mostrar visión (${selectedToken.visionRadius})`}
                </button>
              )}
            </div>
          )}

          {hudNotices.length > 0 && (
            <div className="max-w-full rounded-sm border border-blood/30 bg-night-900/95 px-3 py-1.5 text-center text-xs text-blood shadow-xl backdrop-blur">
              {hudNotices.map((notice) => <p key={notice}>{notice}</p>)}
            </div>
          )}
        </div>
      )}

      {/* Vista previa de movimiento (estilo Baldur's Gate): coste del camino
          y confirmación antes de mover; el servidor re-valida al confirmar */}
      {movePreview && selectedToken && (
        <div className="absolute bottom-[12rem] left-1/2 z-20 w-[19rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-sm border border-gold/30 bg-night-900/95 p-3 text-bone shadow-2xl backdrop-blur sm:bottom-[9rem] md:bottom-[5.5rem]">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate font-display text-sm tracking-wide text-gold">
              Mover a {selectedToken.name}
            </p>
            <button
              onClick={() => setMovePreview(null)}
              aria-label="Cancelar movimiento"
              className="px-1 text-bone/60 hover:text-bone"
            >
              ✕
            </button>
          </div>
          {movePreview.cost === null ? (
            <p className="text-sm text-blood">No hay camino hasta esa casilla.</p>
          ) : (
            <>
              <p className="text-sm text-bone/80">
                Coste: <span className="font-mono text-gold">{movePreview.cost}</span> de movimiento
                {movePreview.remaining != null && (
                  <span
                    className={`ml-1 font-mono text-xs ${
                      movePreview.cost > movePreview.remaining ? 'text-blood' : 'text-bone/50'
                    }`}
                  >
                    (te quedan {movePreview.remaining})
                  </span>
                )}
              </p>
              {moveFluidWarnings.length > 0 && (
                <div className="mt-2 rounded-sm border border-blood/30 bg-blood/10 px-2 py-1.5 text-xs text-bone/70">
                  <p className="font-medium text-blood/90">El trayecto activa fluidos:</p>
                  {moveFluidWarnings.map((warning) => (
                    <p key={warning.type} className="mt-0.5">
                      {warning.label}: {warning.summary}.
                    </p>
                  ))}
                  <p className="mt-1 text-bone/45">El servidor resuelve tiradas, daño y estados al confirmar.</p>
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => confirmMove()}
                  disabled={movePreview.remaining != null && movePreview.cost > movePreview.remaining}
                  className="flex-1 rounded-sm bg-gold px-3 py-1.5 font-display text-sm tracking-wide text-night-950 hover:bg-gold/90 disabled:opacity-40"
                >
                  Mover
                </button>
                <button
                  onClick={() => setMovePreview(null)}
                  className="rounded-sm border border-bone/25 px-3 py-1.5 text-sm text-bone/70 hover:bg-bone/5"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {fallTarget && (
        <FallPanel
          target={fallTarget.token}
          suggestedFeet={fallTarget.suggestedFeet}
          onClose={() => setFallTarget(null)}
        />
      )}

      {combatTarget && selectedToken?.characterId && (
        <AttackPanel
          attacker={selectedToken}
          target={combatTarget}
          attackerCombatant={selectedCombatant}
          targetCombatant={targetCombatant}
          distance={attackDistance}
          highGround={selectedHasHighGround}
          lineOfSight={attackLineOfSight}
          weaponId={aimingWeaponId}
          helpedBy={attackHelperName}
          onClose={() => setCombatTarget(null)}
        />
      )}

      {combatTarget && !selectedToken?.characterId && selectedToken?.serverId && (
        <MonsterAttackPanel
          attacker={selectedToken}
          target={combatTarget}
          attackerCombatant={selectedCombatant}
          targetCombatant={targetCombatant}
          distance={attackDistance}
          highGround={selectedHasHighGround}
          lineOfSight={attackLineOfSight}
          helpedBy={attackHelperName}
          onClose={() => setCombatTarget(null)}
        />
      )}

      {interactTarget && ownCharacterId && (
        <InteractPanel
          type={interactTarget.type}
          target={interactTarget.target}
          campaignId={campaignId}
          characterId={ownCharacterId}
          combat={combat}
          onLooted={reloadHudCharacter}
          onClose={() => setInteractTarget(null)}
        />
      )}

      {inventoryOpen && hudToken && (
        <InventoryPanel
          token={hudToken}
          isOwner={hudToken.ownerUserId === user?.id}
          isDm={isDm}
          combat={combat}
          onInventoryChange={reloadHudCharacter}
          onClose={() => setInventoryOpen(false)}
        />
      )}

      {notesOpen && canSeeHudNotes && (
        <NotesPanel characterId={ownCharacterId} onClose={() => setNotesOpen(false)} />
      )}

      {sheetOpen && hudCharacterId && (
        <CharacterQuickView characterId={hudCharacterId} onClose={() => setSheetOpen(false)} />
      )}

      {/* Ayudar (Fase 4c): a qué aliado. Gasta la acción al elegirlo. */}
      {helpPickerOpen && hudCombatant && (
        <div className="absolute bottom-[13rem] left-1/2 z-30 w-[17rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-sm border border-moss/50 bg-night-900/95 p-3 text-bone shadow-2xl backdrop-blur sm:bottom-[10rem] md:bottom-[6.5rem]">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-display text-xs uppercase tracking-widest text-moss">¿A quién ayudas?</p>
            <button type="button" onClick={() => setHelpPickerOpen(false)} aria-label="Cancelar" className="px-1 text-bone/60 hover:text-bone">
              ✕
            </button>
          </div>
          <p className="mb-2 text-[0.65rem] leading-snug text-bone/50">
            Ventaja en su próxima prueba, o en su próximo ataque contra una criatura a 5 pies de ti, antes de tu siguiente turno.
          </p>
          <div className="space-y-1">
            {combat.combatants
              .filter((c) => c.id !== hudCombatant.id && (c.kind === 'pj' || c.kind === 'aliado') && !c.dead)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={async () => {
                    setHelpPickerOpen(false);
                    const resp = await specialAction(hudCombatant.id, 'ayudar', { targetId: c.id });
                    if (resp?.error) showHudNotice(resp.error);
                  }}
                  className="flex w-full items-center justify-between rounded-sm border border-bone/15 px-2 py-1.5 text-left text-sm hover:border-moss/60 hover:bg-moss/10"
                >
                  <span>{c.name}</span>
                  {c.helpFrom && <span className="text-[0.65rem] text-moss">ya ayudado</span>}
                </button>
              ))}
          </div>
        </div>
      )}

      {requestRollOpen && isDm && (
        <RequestRollDialog
          characters={map.tokens
            .filter((token) => token.characterId)
            .map((token) => ({ id: token.characterId, name: token.name }))}
          onClose={() => setRequestRollOpen(false)}
        />
      )}

      {drawerOpen && (
        <GameDrawer
          campaignId={campaignId}
          isDm={isDm}
          userId={user?.id}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {/* Abajo-izquierda: dock estrecho de cámara y sistema, pegado al borde
          como en un videojuego. En móvil sube para dejar sitio al hotbar. */}
      <div className="pointer-events-none absolute bottom-[17rem] left-3 z-10 sm:left-4 lg:bottom-[5rem]">
        <MapControls
          showGrid={showGrid}
          selectedToken={selectedToken}
          canNudgeSelected={canControlSelected && selectedGate.move.allowed}
          isDm={isDm}
          measureMode={measureMode}
          onToggleMeasureMode={toggleMeasureMode}
          editorHref={editorHref}
          showArchive={showArchive}
          onCenter={() => sendCameraCommand('center')}
          onZoomIn={() => sendCameraCommand('zoom-in')}
          onZoomOut={() => sendCameraCommand('zoom-out')}
          onRotateLeft={() => sendCameraCommand('rotate', { dir: -1 })}
          onRotateRight={() => sendCameraCommand('rotate', { dir: 1 })}
          tiltLabel={(() => {
            const deg = freeTilt ?? TILT_STEPS_DEG[tiltIndex];
            return deg === 0 ? 'Cenital' : `${deg}°`;
          })()}
          canTiltDown={(freeTilt ?? TILT_STEPS_DEG[tiltIndex]) > 0}
          canTiltUp={(freeTilt ?? TILT_STEPS_DEG[tiltIndex]) < TILT_STEPS_DEG.at(-1)}
          onTiltDown={() => adjustTilt(-1)}
          onTiltUp={() => adjustTilt(1)}
          onToggleGrid={() => setShowGrid((value) => !value)}
          onClearSelection={() => {
            setSelectedTokenId(null);
            setCombatTarget(null);
            setFallTarget(null);
            setInteractTarget(null);
          }}
          onNudgeToken={nudgeSelectedToken}
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((v) => !v)}
        />
      </div>

      {/* Abajo-centro: el personaje queda centrado respecto de toda la mesa,
          independientemente del tamaño de los controles de la izquierda. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex items-end justify-center px-3 sm:bottom-4 sm:px-4">
        <div className="pointer-events-auto flex max-w-full items-end justify-center">
          {dmOnPjTurn ? (
            // Turno de un PJ visto por el DM: barra mínima, sin ficha ni
            // inventario del jugador. Solo "Saltar turno" por si está ausente.
            <div className="tactical-surface flex w-fit items-center gap-3 rounded-sm border border-gold/25 bg-night-900/95 px-3 py-2 shadow-xl backdrop-blur">
              <span className="font-display text-sm tracking-wide text-gold">
                Turno de <span className="text-bone">{activeCombatant?.name}</span>
              </span>
              <button
                onClick={async () => {
                  const resp = await endTurn();
                  if (resp?.error) toastError(resp.error);
                }}
                className="rounded-sm border border-gold/40 px-2.5 py-1 text-xs text-gold hover:bg-gold/10"
              >
                Saltar turno
              </button>
            </div>
          ) : (
            <PlayerHud
              token={hudDisplay}
              combatant={hudCombatant}
              control={hudGate}
              combatActive={combat.active}
              // El botón de terminar turno es de quien de verdad puede pulsarlo:
              // el dueño del PJ mostrado, o el DM (controla enemigos y, si hace
              // falta, PJ ausentes)
              isMyTurn={Boolean(hudCombatant) && combat.turnId === hudCombatant.id && (isDm || isOwnCharacterTurn)}
              onEndTurn={async () => {
                const resp = await endTurn();
                if (resp?.error) showHudNotice(resp.error);
              }}
              // Acciones especiales del turno (gastan la acción): las lanza el
              // controlador del combatiente activo (su dueño, o el DM con enemigos)
              onSpecialAction={async (kind) => {
                // Ayudar necesita a quién: el tablero lo pregunta antes
                if (kind === 'ayudar') {
                  setHelpPickerOpen(true);
                  return;
                }
                const resp = await specialAction(hudCombatant.id, kind);
                if (resp?.error) showHudNotice(resp.error);
              }}
              // Salvación de muerte de un PJ agonizante mostrado en el HUD
              onDeathSave={rollHudDeathSave}
              // Ficha/Inventario son conceptos de personaje: no existen para un
              // enemigo, solo se ofrecen si hay un characterId (aunque sea el de
              // otro PJ, se ven en solo lectura); Notas es siempre tuyo y punto
              characterId={hudCharacterId}
              canSeeNotes={canSeeHudNotes}
              // Buscar trampas gasta la acción del turno (trySpendAction), así
              // que es un slot más del hotbar y no un botón suelto del tablero.
              weapons={hudWeapons}
              aimingWeaponId={aimingWeaponId}
              onAimWeapon={aimWeapon}
              target={
                combatTarget
                  ? { name: combatTarget.name, distance: attackDistance, lineOfSight: attackLineOfSight }
                  : null
              }
              canSearchTraps={!isDm && Boolean(ownCharacterId) && hudCharacterId === ownCharacterId}
              searching={perceptionState.busy}
              onSearchTraps={handleSearchTraps}
              onOpenSheet={() => setSheetOpen(true)}
              onOpenInventory={() => setInventoryOpen((v) => !v)}
              onOpenSpells={() => {
                setSpellOpen((open) => !open);
                setSpellCast(null);
                setSpellError('');
                if (hudToken) setSelectedTokenId(hudToken.id);
              }}
              onOpenNotes={() => setNotesOpen((v) => !v)}
              notice={hudNotice}
            />
          )}
        </div>
      </div>
    </section>
  );
}
