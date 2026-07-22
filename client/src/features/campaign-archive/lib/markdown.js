// Subconjunto de Markdown pensado para el Archivo de campaña. El parser crea
// una estructura de datos intermedia: la vista React la renderiza sin insertar
// HTML crudo, así que el contenido del DM no puede ejecutar scripts.

const BLOCK_START = /^(?:\s*$| {0,3}#{1,3}\s+| {0,3}>\s?|\s*[-*+]\s+|\s*\d+\.\s+|\s*```| {0,3}(?:[-*_]\s*){3,}$)/;

export function safeMarkdownUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function textTokens(value) {
  const parts = value.split('\n');
  const tokens = [];
  parts.forEach((part, index) => {
    if (part) tokens.push({ type: 'text', value: part });
    if (index < parts.length - 1) tokens.push({ type: 'break' });
  });
  return tokens;
}

function referenceToken(rawTarget) {
  const [rawReference, ...labelParts] = rawTarget.split('|');
  const reference = rawReference.trim();
  const explicitLabel = labelParts.join('|').trim();
  const idMatch = /^(?:entrada:)?(\d+)$/.exec(reference);
  if (idMatch) {
    const id = Number(idMatch[1]);
    return {
      type: 'reference',
      targetId: id,
      targetTitle: null,
      label: explicitLabel || `Entrada ${id}`,
    };
  }
  return {
    type: 'reference',
    targetId: null,
    targetTitle: reference,
    label: explicitLabel || reference,
  };
}

const INLINE_PATTERNS = [
  { type: 'reference', regex: /\[\[([^\]\n]+)\]\]/g },
  { type: 'link', regex: /\[([^\]\n]+)\]\(([^)\s]+)\)/g },
  { type: 'code', regex: /`([^`\n]+)`/g },
  { type: 'strong', regex: /\*\*([^*\n]+)\*\*|__([^_\n]+)__/g },
  { type: 'strike', regex: /~~([^~\n]+)~~/g },
  { type: 'emphasis', regex: /\*([^*\n]+)\*|_([^_\n]+)_/g },
];

function nextInlineMatch(source, offset) {
  let best = null;
  INLINE_PATTERNS.forEach((pattern, priority) => {
    pattern.regex.lastIndex = offset;
    const match = pattern.regex.exec(source);
    if (!match) return;
    if (!best || match.index < best.match.index || (match.index === best.match.index && priority < best.priority)) {
      best = { pattern, match, priority };
    }
  });
  return best;
}

export function parseInlineMarkdown(source) {
  const value = String(source ?? '');
  const tokens = [];
  let cursor = 0;

  while (cursor < value.length) {
    const found = nextInlineMatch(value, cursor);
    if (!found) {
      tokens.push(...textTokens(value.slice(cursor)));
      break;
    }
    if (found.match.index > cursor) tokens.push(...textTokens(value.slice(cursor, found.match.index)));

    const { type } = found.pattern;
    const match = found.match;
    if (type === 'reference') {
      tokens.push(referenceToken(match[1]));
    } else if (type === 'link') {
      const href = safeMarkdownUrl(match[2]);
      if (href) tokens.push({ type: 'link', href, children: parseInlineMarkdown(match[1]) });
      else tokens.push(...textTokens(match[0]));
    } else if (type === 'code') {
      tokens.push({ type: 'code', value: match[1] });
    } else {
      tokens.push({ type, children: parseInlineMarkdown(match[1] ?? match[2] ?? '') });
    }
    cursor = match.index + match[0].length;
  }

  return tokens.reduce((merged, token) => {
    const previous = merged[merged.length - 1];
    if (token.type === 'text' && previous?.type === 'text') previous.value += token.value;
    else merged.push(token);
    return merged;
  }, []);
}

function isHorizontalRule(line) {
  return /^ {0,3}(?:([-*_])\s*){3,}$/.test(line);
}

export function parseMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const content = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'codeBlock', language: fence[1] || null, value: content.join('\n') });
      continue;
    }

    const heading = /^ {0,3}(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, children: parseInlineMarkdown(heading[2].trim()) });
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^ {0,3}>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^ {0,3}>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', children: parseMarkdown(quote.join('\n')) });
      continue;
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      const itemPattern = isOrdered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      const items = [];
      while (index < lines.length) {
        const item = itemPattern.exec(lines[index]);
        if (!item) break;
        items.push(parseInlineMarkdown(item[1]));
        index += 1;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !BLOCK_START.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInlineMarkdown(paragraph.join('\n')) });
  }

  return blocks;
}

function selectedLineRange(value, start, end) {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf('\n', end);
  return { lineStart, lineEnd: nextBreak === -1 ? value.length : nextBreak };
}

function replaceRange(value, start, end, replacement, selectionStart = start, selectionEnd = start + replacement.length) {
  return {
    value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    selectionStart,
    selectionEnd,
  };
}

function wrapSelection(value, start, end, before, after, fallback) {
  const selected = value.slice(start, end) || fallback;
  return replaceRange(
    value,
    start,
    end,
    `${before}${selected}${after}`,
    start + before.length,
    start + before.length + selected.length
  );
}

function prefixSelectedLines(value, start, end, prefixFactory, { clearHeadings = false } = {}) {
  const { lineStart, lineEnd } = selectedLineRange(value, start, end);
  const original = value.slice(lineStart, lineEnd);
  const lines = original.split('\n');
  const replacement = lines
    .map((line, index) => {
      const clean = clearHeadings ? line.replace(/^ {0,3}#{1,3}\s+/, '') : line;
      return `${prefixFactory(index)}${clean}`;
    })
    .join('\n');
  return replaceRange(value, lineStart, lineEnd, replacement, lineStart, lineStart + replacement.length);
}

export function applyMarkdownAction({ value = '', start = 0, end = start, action, payload = {} }) {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));

  if (action === 'bold') return wrapSelection(value, safeStart, safeEnd, '**', '**', 'texto en negrita');
  if (action === 'italic') return wrapSelection(value, safeStart, safeEnd, '*', '*', 'texto en cursiva');
  if (action === 'strike') return wrapSelection(value, safeStart, safeEnd, '~~', '~~', 'texto tachado');
  if (action === 'code') {
    const selected = value.slice(safeStart, safeEnd);
    return selected.includes('\n')
      ? wrapSelection(value, safeStart, safeEnd, '```\n', '\n```', selected || 'código')
      : wrapSelection(value, safeStart, safeEnd, '`', '`', 'código');
  }
  if (action === 'link') {
    const selected = value.slice(safeStart, safeEnd) || 'texto del enlace';
    const href = payload.href || 'https://';
    const replacement = `[${selected}](${href})`;
    const hrefStart = safeStart + selected.length + 3;
    return replaceRange(value, safeStart, safeEnd, replacement, hrefStart, hrefStart + href.length);
  }
  if (action === 'reference') {
    const id = Number(payload.id);
    const title = String(payload.title ?? '').trim();
    if (!Number.isSafeInteger(id) || id <= 0 || !title) return { value, selectionStart: safeStart, selectionEnd: safeEnd };
    const label = value.slice(safeStart, safeEnd).trim() || title;
    const replacement = `[[entrada:${id}|${label}]]`;
    return replaceRange(value, safeStart, safeEnd, replacement, safeStart + replacement.length, safeStart + replacement.length);
  }
  if (action === 'heading1') {
    return prefixSelectedLines(value, safeStart, safeEnd, () => '# ', { clearHeadings: true });
  }
  if (action === 'heading2') {
    return prefixSelectedLines(value, safeStart, safeEnd, () => '## ', { clearHeadings: true });
  }
  if (action === 'heading3') {
    return prefixSelectedLines(value, safeStart, safeEnd, () => '### ', { clearHeadings: true });
  }
  if (action === 'paragraph') {
    return prefixSelectedLines(value, safeStart, safeEnd, () => '', { clearHeadings: true });
  }
  if (action === 'unorderedList') return prefixSelectedLines(value, safeStart, safeEnd, () => '- ');
  if (action === 'orderedList') return prefixSelectedLines(value, safeStart, safeEnd, (index) => `${index + 1}. `);
  if (action === 'quote') return prefixSelectedLines(value, safeStart, safeEnd, () => '> ');

  return { value, selectionStart: safeStart, selectionEnd: safeEnd };
}
