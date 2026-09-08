import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { TACTICAL_CAMERA_DISTANCE } from '../domain/weather.js';
import { TILT_INITIAL, MIN_ZOOM, MAX_ZOOM, fitBoardZoom, orbitBy as orbitView, rotateBy, viewDegrees, withTilt } from '../domain/camera.js';

// Orientación (inclinación y azimut) y sus topes viven en domain/camera.js:
// el comando 'tilt' trae el ángulo elegido en radianes (0 = cenital puro) y
// 'rotate' gira el tablero en pasos de 45°; la geometría de abajo generaliza
// el caso cenital (tilt 0 y azimut 0 reproducen la vista y el `up` originales).

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pointerDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export default function TacticalCamera({ map, command, onViewChange }) {
  const cameraRef = useRef(null);
  const pointersRef = useRef(new Map());
  const lastPointerRef = useRef(null);
  const lastPinchDistanceRef = useRef(null);
  const lastPinchCenterRef = useRef(null);
  // Botón derecho (o dos dedos) = orbitar; botón izquierdo = arrastrar el mapa
  const orbitingRef = useRef(false);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const targetRef = useRef({ x: map.width / 2, z: map.height / 2 });
  const focusRef = useRef(null);
  const autoFitRef = useRef(true);
  const shakeUntilRef = useRef(0);
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
      targetRef.current.x + TACTICAL_CAMERA_DISTANCE * sinT * sinA,
      TACTICAL_CAMERA_DISTANCE * cosT,
      targetRef.current.z + TACTICAL_CAMERA_DISTANCE * sinT * cosA
    );
    camera.up.set(-sinA * cosT, sinT, -cosA * cosT);
    camera.lookAt(targetRef.current.x, 0, targetRef.current.z);
    camera.updateProjectionMatrix();
    invalidate();
  }

  // Órbita: el arrastre gira el tablero (azimut) y gradúa la inclinación, con
  // los mismos topes que los botones del dock. El HUD necesita saber el ángulo
  // real para no seguir enseñando el del último escalón.
  function orbitBy(dx, dy) {
    viewRef.current = orbitView(viewRef.current, dx, dy);
    applyCamera();
    onViewChangeRef.current?.(viewDegrees(viewRef.current));
  }

  function clampTarget() {
    const margin = 2;
    targetRef.current.x = clamp(targetRef.current.x, -margin, map.width + margin);
    targetRef.current.z = clamp(targetRef.current.z, -margin, map.height + margin);
  }

  function setZoom(zoom) {
    const camera = cameraRef.current;
    if (!camera) return;
    autoFitRef.current = false;
    camera.zoom = clamp(zoom, Math.min(MIN_ZOOM, fitBoardZoom(map, size, viewRef.current)), MAX_ZOOM);
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
    if (autoFitRef.current) camera.zoom = fitBoardZoom(map, size, viewRef.current);
    applyCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  useEffect(() => {
    targetRef.current = { ...center };
    const camera = cameraRef.current;
    autoFitRef.current = true;
    if (camera) camera.zoom = fitBoardZoom(map, size, viewRef.current);
    applyCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center]);

  useEffect(() => {
    if (!command) return;
    if (command.type === 'center') {
      targetRef.current = { ...center };
      autoFitRef.current = true;
      if (cameraRef.current) cameraRef.current.zoom = fitBoardZoom(map, size, viewRef.current);
      applyCamera();
    }
    if (command.type === 'zoom-in' && cameraRef.current) setZoom(cameraRef.current.zoom * 1.2);
    if (command.type === 'zoom-out' && cameraRef.current) setZoom(cameraRef.current.zoom / 1.2);
    if (command.type === 'focus' && Number.isFinite(command.x) && Number.isFinite(command.z)) {
      focusRef.current = { x: command.x, z: command.z };
    }
    if (command.type === 'shake') {
      shakeUntilRef.current = performance.now() + (command.strong ? 420 : 240);
    }
    // Rotar el tablero 45° por pulsación (dir +1 = horario en pantalla)
    if (command.type === 'rotate') {
      viewRef.current = rotateBy(viewRef.current, command.dir);
      applyCamera();
    }
    // Graduar la inclinación: el comando trae el ángulo en radianes (0 = cenital)
    if (command.type === 'tilt') {
      viewRef.current = withTilt(viewRef.current, command.tilt);
      applyCamera();
    }
    if (command.type === 'reset-view') {
      viewRef.current = { tilt: TILT_INITIAL, azimuth: 0 };
      applyCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, command]);

  useFrame(() => {
    let changed = false;
    if (focusRef.current) {
      targetRef.current.x += (focusRef.current.x - targetRef.current.x) * 0.085;
      targetRef.current.z += (focusRef.current.z - targetRef.current.z) * 0.085;
      changed = true;
      if (Math.hypot(focusRef.current.x - targetRef.current.x, focusRef.current.z - targetRef.current.z) < 0.015) {
        targetRef.current = { ...focusRef.current };
        focusRef.current = null;
      }
    }
    const shaking = shakeUntilRef.current > performance.now();
    if (changed || shaking) applyCamera();
    if (shaking && cameraRef.current) {
      const remaining = shakeUntilRef.current - performance.now();
      const strength = Math.min(0.16, remaining / 1700);
      cameraRef.current.position.x += (Math.random() - 0.5) * strength;
      cameraRef.current.position.z += (Math.random() - 0.5) * strength;
    }
  });

  useEffect(() => {
    const element = gl.domElement;

    function handleWheel(event) {
      event.preventDefault();
      if (!cameraRef.current) return;
      const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom(cameraRef.current.zoom * zoomFactor);
    }

    function handleContextMenu(event) {
      // El botón derecho orbita: sin esto el menú del navegador se come el gesto
      event.preventDefault();
    }

    function handlePointerDown(event) {
      if (event.pointerType === 'mouse' && event.button === 0) orbitingRef.current = false;
      else if (event.pointerType === 'mouse' && (event.button === 2 || event.button === 1)) orbitingRef.current = true;
      else if (event.pointerType === 'mouse') return;
      pointersRef.current.set(event.pointerId, event);
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      const pointers = [...pointersRef.current.values()];
      if (pointers.length === 2) {
        lastPinchDistanceRef.current = pointerDistance(pointers[0], pointers[1]);
        lastPinchCenterRef.current = {
          x: (pointers[0].clientX + pointers[1].clientX) / 2,
          y: (pointers[0].clientY + pointers[1].clientY) / 2,
        };
      }
    }

    function handlePointerMove(event) {
      if (!pointersRef.current.has(event.pointerId)) return;
      pointersRef.current.set(event.pointerId, event);
      const pointers = [...pointersRef.current.values()];

      // Dos dedos: separarlos/juntarlos acerca y aleja; moverlos a la vez
      // orbita. Es el equivalente táctil del botón derecho, para que el móvil
      // llegue a la misma cámara sin más botones en pantalla.
      if (pointers.length >= 2 && cameraRef.current) {
        const distance = pointerDistance(pointers[0], pointers[1]);
        const center = {
          x: (pointers[0].clientX + pointers[1].clientX) / 2,
          y: (pointers[0].clientY + pointers[1].clientY) / 2,
        };
        if (lastPinchDistanceRef.current) {
          setZoom(cameraRef.current.zoom * (distance / lastPinchDistanceRef.current));
        }
        if (lastPinchCenterRef.current) {
          orbitBy(center.x - lastPinchCenterRef.current.x, center.y - lastPinchCenterRef.current.y);
        }
        lastPinchDistanceRef.current = distance;
        lastPinchCenterRef.current = center;
        return;
      }

      if (!lastPointerRef.current || !cameraRef.current) return;

      if (orbitingRef.current) {
        orbitBy(event.clientX - lastPointerRef.current.x, event.clientY - lastPointerRef.current.y);
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
        return;
      }

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
      lastPinchCenterRef.current = null;
      if (pointersRef.current.size === 0) orbitingRef.current = false;
    }

    element.addEventListener('wheel', handleWheel, { passive: false });
    element.addEventListener('contextmenu', handleContextMenu);
    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', handlePointerUp);
    element.addEventListener('pointercancel', handlePointerUp);

    return () => {
      element.removeEventListener('wheel', handleWheel);
      element.removeEventListener('contextmenu', handleContextMenu);
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointercancel', handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl.domElement, map.height, map.width]);

  return <orthographicCamera ref={cameraRef} near={0.1} far={200} />;
}
