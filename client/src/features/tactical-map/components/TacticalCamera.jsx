import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';

const DEFAULT_ZOOM = 52;
const MIN_ZOOM = 24;
const MAX_ZOOM = 120;
const CAMERA_HEIGHT = 60;
// Inclinación inicial de la cámara respecto a la vertical (debe coincidir
// con el escalón inicial de TILT_STEPS_DEG en TacticalMap, 26°). El comando
// 'tilt' trae el ángulo elegido en radianes (0 = cenital puro) y 'rotate'
// gira el tablero en pasos de 45°; la geometría generaliza el caso cenital
// (tilt 0 y azimut 0 reproducen exactamente la vista y el `up` originales).
const TILT_INITIAL = (26 * Math.PI) / 180;
const TILT_MAX = 1.1; // tope de seguridad (~63°)
const AZIMUTH_STEP = Math.PI / 4; // 45° por pulsación

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pointerDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export default function TacticalCamera({ map, command }) {
  const cameraRef = useRef(null);
  const pointersRef = useRef(new Map());
  const lastPointerRef = useRef(null);
  const lastPinchDistanceRef = useRef(null);
  const targetRef = useRef({ x: map.width / 2, z: map.height / 2 });
  // Orientación de la vista: inclinada por defecto (se ve el relieve); el DM
  // gradúa la inclinación por escalones o rota el tablero en pasos de 45°
  const viewRef = useRef({ tilt: TILT_INITIAL, azimuth: 0 });
  const { gl, invalidate, size, set, camera: previousCamera } = useThree();
  const center = useMemo(() => ({ x: map.width / 2, z: map.height / 2 }), [map.height, map.width]);

  // `makeDefault` es una convención de @react-three/drei, no de fiber puro:
  // sin este registro manual, el Canvas sigue usando su cámara por defecto.
  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return undefined;
    set({ camera });
    return () => set({ camera: previousCamera });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set]);

  function applyCamera() {
    const camera = cameraRef.current;
    if (!camera) return;
    // Cámara en órbita sobre el objetivo: azimut φ (rotación del tablero en
    // pantalla) e inclinación tilt respecto de la vertical. Con φ=0 y tilt=0
    // se recupera la cenital original (pos (x,H,z), up (0,0,-1)); con tilt>0
    // la cámara se retira hacia el lado φ y mira en diagonal hacia abajo.
    const { tilt, azimuth } = viewRef.current;
    const sinT = Math.sin(tilt);
    const cosT = Math.cos(tilt);
    const sinA = Math.sin(azimuth);
    const cosA = Math.cos(azimuth);
    camera.position.set(
      targetRef.current.x + CAMERA_HEIGHT * sinT * sinA,
      CAMERA_HEIGHT * cosT,
      targetRef.current.z + CAMERA_HEIGHT * sinT * cosA
    );
    camera.up.set(-sinA * cosT, sinT, -cosA * cosT);
    camera.lookAt(targetRef.current.x, 0, targetRef.current.z);
    camera.updateProjectionMatrix();
    invalidate();
  }

  function clampTarget() {
    const margin = 2;
    targetRef.current.x = clamp(targetRef.current.x, -margin, map.width + margin);
    targetRef.current.z = clamp(targetRef.current.z, -margin, map.height + margin);
  }

  function setZoom(zoom) {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    applyCamera();
  }

  // El frustum ortográfico se define en píxeles de canvas; `zoom` actúa
  // entonces como una escala de píxeles por unidad de mundo (rejilla).
  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.left = -size.width / 2;
    camera.right = size.width / 2;
    camera.top = size.height / 2;
    camera.bottom = -size.height / 2;
    applyCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  useEffect(() => {
    targetRef.current = { ...center };
    const camera = cameraRef.current;
    if (camera) camera.zoom = DEFAULT_ZOOM;
    applyCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center]);

  useEffect(() => {
    if (!command) return;
    if (command.type === 'center') {
      targetRef.current = { ...center };
      if (cameraRef.current) cameraRef.current.zoom = DEFAULT_ZOOM;
      applyCamera();
    }
    if (command.type === 'zoom-in' && cameraRef.current) setZoom(cameraRef.current.zoom * 1.2);
    if (command.type === 'zoom-out' && cameraRef.current) setZoom(cameraRef.current.zoom / 1.2);
    // Rotar el tablero 45° por pulsación (dir +1 = horario en pantalla)
    if (command.type === 'rotate') {
      viewRef.current.azimuth += AZIMUTH_STEP * (command.dir === -1 ? -1 : 1);
      applyCamera();
    }
    // Graduar la inclinación: el comando trae el ángulo en radianes (0 = cenital)
    if (command.type === 'tilt') {
      viewRef.current.tilt = Math.min(TILT_MAX, Math.max(0, Number(command.tilt) || 0));
      applyCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, command]);

  useEffect(() => {
    const element = gl.domElement;

    function handleWheel(event) {
      event.preventDefault();
      if (!cameraRef.current) return;
      const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom(cameraRef.current.zoom * zoomFactor);
    }

    function handlePointerDown(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointersRef.current.set(event.pointerId, event);
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      const pointers = [...pointersRef.current.values()];
      if (pointers.length === 2) lastPinchDistanceRef.current = pointerDistance(pointers[0], pointers[1]);
    }

    function handlePointerMove(event) {
      if (!pointersRef.current.has(event.pointerId)) return;
      pointersRef.current.set(event.pointerId, event);
      const pointers = [...pointersRef.current.values()];

      if (pointers.length >= 2 && cameraRef.current) {
        const distance = pointerDistance(pointers[0], pointers[1]);
        if (lastPinchDistanceRef.current) {
          setZoom(cameraRef.current.zoom * (distance / lastPinchDistanceRef.current));
        }
        lastPinchDistanceRef.current = distance;
        return;
      }

      if (!lastPointerRef.current || !cameraRef.current) return;
      const dx = event.clientX - lastPointerRef.current.x;
      const dy = event.clientY - lastPointerRef.current.y;
      // El arrastre se traduce a mundo según la orientación de la vista: el
      // eje horizontal de pantalla es (cosφ, −sinφ) en el suelo y el vertical
      // (sinφ, cosφ) escorzado por cos(tilt), para seguir 1:1 al tablero
      const { tilt, azimuth } = viewRef.current;
      const dxW = dx / cameraRef.current.zoom;
      const dyW = dy / cameraRef.current.zoom / Math.cos(tilt);
      const sinA = Math.sin(azimuth);
      const cosA = Math.cos(azimuth);
      targetRef.current.x -= dxW * cosA + dyW * sinA;
      targetRef.current.z -= -dxW * sinA + dyW * cosA;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      clampTarget();
      applyCamera();
    }

    function handlePointerUp(event) {
      pointersRef.current.delete(event.pointerId);
      lastPointerRef.current = null;
      lastPinchDistanceRef.current = null;
    }

    element.addEventListener('wheel', handleWheel, { passive: false });
    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', handlePointerUp);
    element.addEventListener('pointercancel', handlePointerUp);

    return () => {
      element.removeEventListener('wheel', handleWheel);
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointercancel', handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl.domElement, map.height, map.width]);

  return <orthographicCamera ref={cameraRef} near={0.1} far={200} />;
}
