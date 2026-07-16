import { describeMedia, safeHttpUrl } from '../lib/media.js';

function ExternalLink({ href, label = 'Abrir recurso en otra pestaña ↗' }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="block break-all rounded-sm border border-gold/20 bg-night-950/60 px-3 py-2 text-sm text-gold hover:border-gold"
    >
      {label}
      <span className="mt-1 block text-xs text-bone/45">{href}</span>
    </a>
  );
}

export default function MediaPreview({ block, privateImageUrl }) {
  if (block.type === 'texto') {
    return block.content ? (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-bone/80">{block.content}</p>
    ) : null;
  }

  if (block.type === 'imagen') {
    const external = safeHttpUrl(block.url);
    const src = block.hasPrivateImage || block.hasImage ? block.imageUrl || privateImageUrl : external?.href;
    if (!src) return null;
    return (
      <figure className="overflow-hidden rounded-sm border border-bone/10 bg-night-950/50">
        <img src={src} alt={block.altText || block.caption || ''} className="max-h-80 w-full object-contain" />
        {block.caption && <figcaption className="px-3 py-2 text-xs text-bone/55">{block.caption}</figcaption>}
      </figure>
    );
  }

  if (block.type === 'enlace') {
    const url = safeHttpUrl(block.url);
    return url ? <ExternalLink href={url.href} label={block.content || 'Abrir enlace ↗'} /> : null;
  }

  const media = describeMedia(block.url, block.type);
  if (media.type === 'iframe') {
    return (
      <div
        className={`overflow-hidden rounded-sm border border-bone/10 bg-black ${
          media.ratio === 'audio' ? 'h-40' : 'aspect-video'
        }`}
      >
        <iframe
          src={media.src}
          title={media.title}
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen={media.ratio === 'video'}
          referrerPolicy="strict-origin-when-cross-origin"
          className="h-full w-full"
        />
      </div>
    );
  }
  if (media.type === 'video') {
    return <video src={media.src} controls preload="metadata" className="max-h-80 w-full rounded-sm bg-black" />;
  }
  if (media.type === 'audio') {
    return <audio src={media.src} controls preload="metadata" className="w-full" />;
  }
  if (media.type === 'link') {
    return <ExternalLink href={media.href} label="Abrir recurso multimedia ↗" />;
  }
  if (media.type === 'invalid') {
    return <p className="text-xs text-blood">La URL no es válida. Usa una dirección http:// o https://.</p>;
  }
  return null;
}

