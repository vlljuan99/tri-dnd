export const TUTORIAL_SEEN_KEY = 'tridnd_sheet_tutorial_seen';

/**
 * La guía posterior al asistente solo puede arrancar cuando la ficha y los
 * catálogos que completan sus controles ya han terminado de cargar. La URL se
 * conserva hasta ese momento para no perder la intención si la petición tarda
 * o falla.
 */
export function canStartSheetTutorial({ requested, characterReady, compendiumSettled }) {
  return Boolean(requested && characterReady && compendiumSettled);
}
