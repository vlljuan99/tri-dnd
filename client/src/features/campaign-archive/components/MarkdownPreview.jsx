import { useMemo } from 'react';
import { parseMarkdown } from '../lib/markdown.js';

function normalizeTitle(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es');
}

function resolveReference(token, entries) {
  if (token.targetId != null) return entries.find((entry) => Number(entry.id) === token.targetId) ?? null;
  const title = normalizeTitle(token.targetTitle);
  return entries.find((entry) => normalizeTitle(entry.title) === title) ?? null;
}

function InlineContent({ tokens, entries, onNavigateReference }) {
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === 'text') return <span key={key}>{token.value}</span>;
    if (token.type === 'break') return <br key={key} />;
    if (token.type === 'strong') {
      return <strong key={key} className="font-semibold text-bone"><InlineContent tokens={token.children} entries={entries} onNavigateReference={onNavigateReference} /></strong>;
    }
    if (token.type === 'emphasis') {
      return <em key={key}><InlineContent tokens={token.children} entries={entries} onNavigateReference={onNavigateReference} /></em>;
    }
    if (token.type === 'strike') {
      return <s key={key} className="text-bone/55"><InlineContent tokens={token.children} entries={entries} onNavigateReference={onNavigateReference} /></s>;
    }
    if (token.type === 'code') {
      return <code key={key} className="rounded bg-black/35 px-1 py-0.5 font-mono text-[0.9em] text-ochre">{token.value}</code>;
    }
    if (token.type === 'link') {
      return (
        <a
          key={key}
          href={token.href}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-gold underline decoration-gold/35 underline-offset-2 hover:decoration-gold"
        >
          <InlineContent tokens={token.children} entries={entries} onNavigateReference={onNavigateReference} />
        </a>
      );
    }
    if (token.type === 'reference') {
      const target = resolveReference(token, entries);
      if (!target || !onNavigateReference) {
        return (
          <span
            key={key}
            title={target ? 'Referencia interna' : 'La entrada referenciada no está disponible'}
            className={target ? 'font-medium text-sage' : 'cursor-help border-b border-dashed border-blood/60 text-blood/80'}
          >
            {token.label}
          </span>
        );
      }
      return (
        <button
          key={key}
          type="button"
          onClick={() => onNavigateReference(target)}
          title={`Abrir «${target.title}»`}
          className="inline rounded-sm border-b border-sage/55 font-medium text-sage transition-colors hover:bg-sage/10 hover:text-bone"
        >
          {token.label}
          <span aria-hidden="true" className="ml-0.5 text-[0.75em]">↗</span>
        </button>
      );
    }
    return null;
  });
}

function MarkdownBlocks({ blocks, entries, onNavigateReference }) {
  return blocks.map((block, index) => {
    const key = `${block.type}-${index}`;
    const inline = (tokens) => (
      <InlineContent tokens={tokens} entries={entries} onNavigateReference={onNavigateReference} />
    );

    if (block.type === 'heading') {
      if (block.level === 1) return <h2 key={key} className="font-display text-2xl leading-tight text-gold">{inline(block.children)}</h2>;
      if (block.level === 2) return <h3 key={key} className="font-display text-xl leading-tight text-gold/90">{inline(block.children)}</h3>;
      return <h4 key={key} className="font-display text-base uppercase tracking-wide text-ochre">{inline(block.children)}</h4>;
    }
    if (block.type === 'paragraph') {
      return <p key={key} className="text-sm leading-7 text-bone/80 [overflow-wrap:anywhere]">{inline(block.children)}</p>;
    }
    if (block.type === 'list') {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List key={key} className={`space-y-1 pl-6 text-sm leading-6 text-bone/80 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}
        </List>
      );
    }
    if (block.type === 'blockquote') {
      return (
        <blockquote key={key} className="space-y-2 border-l-2 border-gold/45 bg-gold/5 py-2 pl-4 pr-3 italic text-bone/70">
          <MarkdownBlocks blocks={block.children} entries={entries} onNavigateReference={onNavigateReference} />
        </blockquote>
      );
    }
    if (block.type === 'codeBlock') {
      return (
        <pre key={key} className="max-w-full overflow-x-auto rounded-sm border border-bone/10 bg-black/40 p-3 text-xs leading-5 text-sage">
          <code>{block.value}</code>
        </pre>
      );
    }
    if (block.type === 'rule') return <hr key={key} className="border-gold/20" />;
    return null;
  });
}

export default function MarkdownPreview({ value, entries = [], onNavigateReference, className = '' }) {
  const blocks = useMemo(() => parseMarkdown(value), [value]);
  if (!blocks.length) return null;
  return (
    <div className={`min-w-0 space-y-3 ${className}`}>
      <MarkdownBlocks blocks={blocks} entries={entries} onNavigateReference={onNavigateReference} />
    </div>
  );
}
