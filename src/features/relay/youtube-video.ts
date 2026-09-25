export function youtubeVideoId(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] ?? null;
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else if (/^\/(embed|shorts)\//.test(url.pathname)) id = url.pathname.split('/')[2] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function youtubeEmbedUrl(value: string | null | undefined) {
  const id = youtubeVideoId(value);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}
