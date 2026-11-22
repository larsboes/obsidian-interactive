import { localPath, MAX_DATA_BYTES, publicLink } from '../src/view-data';

/** Capture metadata from a page already saved locally. Never fetches or keeps remote images. */
export async function captureLink(href: string, html: string, image?: string, now = new Date()) {
  const url = publicLink(href);
  if (!url) throw new Error('Expected an HTTP(S) URL without credentials.');
  if (new TextEncoder().encode(html).length > MAX_DATA_BYTES) throw new Error('HTML exceeds 1 MiB.');
  if (image && !/\.(?:avif|gif|jpe?g|png|webp)$/i.test(localPath(image, 'cache.json'))) {
    throw new Error('Supply a vault-local raster thumbnail.');
  }
  const tags = new Map<string, string>();
  let title = '';
  await new HTMLRewriter()
    .on('meta[property], meta[name]', {
      element(el) {
        const key = (el.getAttribute('property') ?? el.getAttribute('name'))?.toLowerCase();
        if (key && ['og:title', 'og:description', 'description'].includes(key) && !tags.has(key)) {
          const value = el.getAttribute('content')?.trim();
          if (value) tags.set(key, value);
        }
      },
    })
    .on('title', { text(chunk) { title = (title + chunk.text).slice(0, 200); } })
    .transform(new Response(html)).text();
  return {
    url: url.href,
    title: (tags.get('og:title') || title.trim() || url.hostname).slice(0, 200),
    description: (tags.get('og:description') || tags.get('description'))?.slice(0, 420),
    image,
    captured: now.toISOString().slice(0, 10),
  };
}

if (import.meta.main) {
  const [url, source, image, ...extra] = Bun.argv.slice(2);
  try {
    if (!url || !source || extra.length) throw new Error('Usage: bun run capture-link <page-url> <saved.html> [vault-thumbnail]');
    const file = Bun.file(source);
    if (!(await file.exists())) throw new Error('Saved HTML file not found.');
    if (file.size > MAX_DATA_BYTES) throw new Error('HTML exceeds 1 MiB.');
    console.log(JSON.stringify([await captureLink(url, await file.text(), image)], null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
