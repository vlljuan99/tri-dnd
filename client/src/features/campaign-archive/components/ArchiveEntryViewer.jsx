import { useEffect, useRef } from 'react';
import ArchiveIcon from './ArchiveIcon.jsx';
import MarkdownPreview from './MarkdownPreview.jsx';
import MediaPreview from './MediaPreview.jsx';

const TYPE_LABELS = {
  texto: 'Texto',
  imagen: 'Imagen',
  video: 'Vídeo',
  enlace: 'Enlace',
  musica: 'Música',
};

export default function ArchiveEntryViewer({ entry, entries, privateImageUrl, onNavigateReference }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [entry?.id]);

  if (!entry) {
    return (
      <section className="flex h-full min-h-[18rem] items-center justify-center overflow-hidden bg-night-950/20 p-6 text-center">
        <div className="max-w-sm">
          <p className="font-display text-xl text-gold/70">Elige un artículo</p>
          <p className="mt-2 text-sm text-bone/45">Selecciona una entrada publicada para leer su contenido.</p>
        </div>
      </section>
    );
  }

  const blocks = [...(entry.blocks ?? [])].sort((a, b) => a.position - b.position || a.id - b.id);

  return (
    <article ref={scrollRef} className="h-full min-h-0 overflow-y-auto bg-night-950/20">
      <div className="mx-auto max-w-3xl space-y-6 p-5 sm:p-7">
        <header className="border-b border-gold/20 pb-5">
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-sage">Artículo compartido</p>
          <div className="mt-2 flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-gold/25 bg-gold/5 text-gold/75">
              <ArchiveIcon node={entry} className="h-6 w-6" />
            </span>
            <h2 className="min-w-0 font-display text-3xl leading-tight text-gold [overflow-wrap:anywhere]">{entry.title}</h2>
          </div>
          {entry.summary && <p className="mt-2 text-sm leading-6 text-bone/55 [overflow-wrap:anywhere]">{entry.summary}</p>}
        </header>

        {blocks.length === 0 ? (
          <p className="rounded-sm border border-dashed border-bone/15 p-6 text-center text-sm italic text-bone/40">Este artículo todavía no tiene contenido.</p>
        ) : (
          <div className="space-y-5">
            {blocks.map((block) => (
              <section key={block.id} className="min-w-0">
                <h3 className="sr-only">{TYPE_LABELS[block.type] ?? 'Contenido'}</h3>
                {block.type === 'texto' ? (
                  <MarkdownPreview value={block.content} entries={entries} onNavigateReference={onNavigateReference} />
                ) : (
                  <div className="space-y-3">
                    <MediaPreview block={block} privateImageUrl={block.imageUrl || privateImageUrl(block.id)} />
                    {(block.type === 'video' || block.type === 'musica') && block.content && (
                      <MarkdownPreview value={block.content} entries={entries} onNavigateReference={onNavigateReference} />
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
