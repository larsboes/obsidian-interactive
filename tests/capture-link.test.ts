import { expect, test } from 'bun:test';
import { captureLink } from '../tools/capture-link';

test('captures local metadata without requesting the page, scripts or its remote image', async () => {
  const captured = await captureLink('https://example.org/p', `
    <title>Basic title</title>
    <meta property="og:title" content="Rich title">
    <meta name="description" content="Alt description">
    <meta property="og:image" content="https://example.org/photo">
    <script src="https://example.org/remote.js"></script>
  `, './cover.webp', new Date('2026-02-10T00:00:00Z'));
  expect(captured).toEqual({
    url: 'https://example.org/p', title: 'Rich title', description: 'Alt description',
    image: './cover.webp', captured: '2026-02-10',
  });
  expect((await captureLink('https://example.org', '<title>A title</title>')).title).toBe('A title');
  expect((await captureLink('https://example.org', '')).title).toBe('example.org');
  await expect(captureLink('https://example.org', '', 'https://example.org/image')).rejects.toThrow();
});
