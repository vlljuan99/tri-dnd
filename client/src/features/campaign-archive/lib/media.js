// Previsualizaciones seguras para el Archivo de campaña. Nunca se incrusta una
// URL arbitraria en un iframe: solo proveedores conocidos o ficheros directos
// que el navegador puede reproducir con sus controles nativos.

export function safeHttpUrl(value) {
  if (!value?.trim() || value.trim().length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function youtubeId(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] ?? null;
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') return url.searchParams.get('v');
    const parts = url.pathname.split('/').filter(Boolean);
    if (['embed', 'shorts', 'live'].includes(parts[0])) return parts[1] ?? null;
  }
  return null;
}

function vimeoId(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const candidate = parts[0] === 'video' ? parts[1] : parts[0];
  return /^\d+$/.test(candidate ?? '') ? candidate : null;
}

function spotifyPath(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'open.spotify.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'embed') parts.shift();
  if (
    !['track', 'album', 'playlist', 'episode', 'show'].includes(parts[0]) ||
    !/^[a-zA-Z0-9]+$/.test(parts[1] ?? '')
  ) {
    return null;
  }
  return `${parts[0]}/${parts[1]}`;
}

function hasExtension(url, extensions) {
  const path = url.pathname.toLowerCase();
  return extensions.some((extension) => path.endsWith(`.${extension}`));
}

export function describeMedia(value, kind) {
  const url = safeHttpUrl(value);
  if (!url) return value?.trim() ? { type: 'invalid' } : { type: 'empty' };

  const yt = youtubeId(url);
  if (yt && /^[\w-]{6,20}$/.test(yt)) {
    return {
      type: 'iframe',
      src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}`,
      title: 'Video de YouTube',
      ratio: 'video',
    };
  }

  if (kind === 'video') {
    const vimeo = vimeoId(url);
    if (vimeo) {
      return {
        type: 'iframe',
        src: `https://player.vimeo.com/video/${vimeo}`,
        title: 'Video de Vimeo',
        ratio: 'video',
      };
    }
    if (hasExtension(url, ['mp4', 'webm', 'ogv', 'ogg'])) return { type: 'video', src: url.href };
  }

  if (kind === 'musica') {
    const spotify = spotifyPath(url);
    if (spotify) {
      return {
        type: 'iframe',
        src: `https://open.spotify.com/embed/${spotify}`,
      title: 'Música de Spotify',
        ratio: 'audio',
      };
    }
    if (hasExtension(url, ['mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac', 'flac'])) {
      return { type: 'audio', src: url.href };
    }
  }

  return { type: 'link', href: url.href };
}
