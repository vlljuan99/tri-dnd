export function findActiveMention(text, cursor, references = []) {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) return null;
  if (references.some((reference) => cursor >= reference.start && cursor <= reference.end)) return null;
  const start = text.lastIndexOf('@', Math.max(0, cursor - 1));
  if (start < 0) return null;
  const before = text[start - 1];
  if (start > 0 && before && !/\s/.test(before)) return null;
  const fragment = text.slice(start + 1, cursor);
  if (fragment.includes('\n') || fragment.length > 60) return null;
  return { start, end: cursor, query: fragment.trim() };
}

export function replaceMention(text, mention, entry) {
  const inserted = `@${entry.name}`;
  const nextText = `${text.slice(0, mention.start)}${inserted}${text.slice(mention.end)}`;
  return {
    text: nextText,
    cursor: mention.start + inserted.length,
    reference: {
      start: mention.start,
      end: mention.start + inserted.length,
      category: entry.category,
      index: entry.index,
    },
  };
}

// Conserva los chips que quedan completamente antes/después de una edición y
// descarta el chip tocado. Es suficiente para un input controlado sin imponer
// un editor enriquecido ni guardar marcas visibles en el texto.
export function reconcileReferenceRanges(oldText, newText, references) {
  let prefix = 0;
  const shared = Math.min(oldText.length, newText.length);
  while (prefix < shared && oldText[prefix] === newText[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < oldText.length - prefix
    && suffix < newText.length - prefix
    && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) suffix += 1;

  const oldEditEnd = oldText.length - suffix;
  const delta = newText.length - oldText.length;
  return references.flatMap((reference) => {
    if (reference.end <= prefix) return [reference];
    if (reference.start >= oldEditEnd) {
      return [{ ...reference, start: reference.start + delta, end: reference.end + delta }];
    }
    return [];
  });
}

export function prepareChatMessage(text, references) {
  const start = text.search(/\S/);
  if (start < 0) return { text: '', references: [] };
  const end = text.search(/\s+$/);
  const trimmedEnd = end < 0 ? text.length : end;
  const clean = text.slice(start, trimmedEnd);
  return {
    text: clean,
    references: references
      .filter((reference) => reference.start >= start && reference.end <= trimmedEnd)
      .map((reference) => ({
        ...reference,
        start: reference.start - start,
        end: reference.end - start,
      })),
  };
}

export function splitMessageReferences(text, references = []) {
  const valid = references
    .filter((reference) => Number.isInteger(reference.start) && Number.isInteger(reference.end))
    .sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  for (const reference of valid) {
    if (reference.start < cursor || reference.end > text.length || reference.end <= reference.start) continue;
    if (reference.start > cursor) parts.push({ type: 'text', text: text.slice(cursor, reference.start) });
    parts.push({ type: 'reference', text: text.slice(reference.start, reference.end), reference });
    cursor = reference.end;
  }
  if (cursor < text.length) parts.push({ type: 'text', text: text.slice(cursor) });
  return parts;
}
