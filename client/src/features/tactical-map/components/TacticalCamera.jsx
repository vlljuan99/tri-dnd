import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';

const DEFAULT_ZOOM = 52;
const MIN_ZOOM = 24;
const MAX_ZOOM = 120;
const CAMERA_HEIGHT = 60;

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
  const { gl, invalidate } = useThree();
  const center = useMemo(() => ({ x: map.width / 2, z: map.height / 2 }), [map.height, map.width]);

  function applyCamera() {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.position.set(targetRef.current.x, CAMERA_HEIGHT, targetRef.current.z);
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
      targetRef.current.x -= dx / cameraRef.current.zoom;
      targetRef.current.z -= dy / cameraRef.current.zoom;
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

  return <orthographicCamera ref={cameraRef} makeDefault near={0.1} far={200} />;
}
