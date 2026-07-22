import { SRD_CATEGORY_KEYS } from './srdShape.js';

const CATEGORIES = new Set(SRD_CATEGORY_KEYS);
const MAX_REFERENCES = 8;

function invalid(error) {
  return { error, references: [] };
}

/**
 * Valida y canoniza los chips SRD que acompañan a un mensaje de chat.
 * `lookup` debe devolver { idx, name_es, name_en } para una clave pública del
 * SRD. Los rangos usan índices UTF-16, igual que selectionStart y slice en el
 * navegador. El texto visible debe coincidir con el nombre canónico: así un
 * cliente manipulado no puede usar el chip para ocultar otro fragmento.
 */
export function sanitizeChatReferences(text, references, lookup) {
  if (references == null) return { references: [] };
  if (!Array.isArray(references)) return invalid('Las referencias del mensaje no son válidas');
  if (references.length > MAX_REFERENCES) {
    return invalid(`Un mensaje admite como máximo ${MAX_REFERENCES} referencias`);
  }

  const result = [];
  for (const candidate of references) {
    const start = Number(candidate?.start);
    const end = Number(candidate?.end);
    const category = typeof candidate?.category === 'string' ? candidate.category : '';
    const index = typeof candidate?.index === 'string' ? candidate.index : '';
    if (
      !Number.isInteger(start)
      || !Number.isInteger(end)
      || start < 0
      || end <= start
      || end > text.length
      || !CATEGORIES.has(category)
      || !index
      || index.length > 160
    ) {
      return invalid('Una referencia del mensaje no es válida');
    }

    const row = lookup(category, index);
    const name = row?.name_es || row?.name_en;
    if (!row || !name || text.slice(start, end) !== `@${name}`) {
      return invalid('La referencia ya no coincide con una entrada del compendio');
    }

    result.push({
      start,
      end,
      category,
      index: row.idx,
      name,
      translated: Boolean(row.name_es),
    });
  }

  result.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < result.length; i += 1) {
    if (result[i].start < result[i - 1].end) {
      return invalid('Las referencias del mensaje se solapan');
    }
  }
  return { references: result };
}

export function standaloneChatReference(row) {
  const name = row?.name_es || row?.name_en;
  if (!name) return null;
  const text = `@${name}`;
  return {
    text,
    references: [{
      start: 0,
      end: text.length,
      category: row.category,
      index: row.idx,
      name,
      translated: Boolean(row.name_es),
    }],
  };
}
