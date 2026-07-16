// Decisión de dominio compartida con el panel de interacción. Mantenerla
// fuera del JSX permite comprobar que la información del mapa compuesto llega
// hasta el flujo de saqueo.
export function isLootInteraction(type, target) {
  return type === 'token' && Boolean(target?.hasLoot);
}

