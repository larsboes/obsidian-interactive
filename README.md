# Interactive

An Obsidian plugin that mounts interactive HTML figures, local charts and link cards inside
notes. It works offline and does not depend on Learn or pi. A figure can come from any skill or
from hand-written HTML. The [Anatomy](https://github.com/wheresryan22/anatomy) skill is one source.

## Obsidian: embed the interactive figure in the note

This plugin's `interactive` code block mounts local HTML, styles and scripts directly inside the note;
it follows Obsidian's theme and reloads when the asset changes. Produce a self-contained HTML
asset with inline CSS and JavaScript, then embed it in the owning note:

````markdown
```interactive
file: Knowledge/Computing/Systems/Platforms/Assets/dial-indicator.html
height: 560
```
````

The path above illustrates the installed block contract; resolve the actual destination from
the active vault's current rules. The optional `title:` names the figure; omit `height:` for
automatic height. Keep selectors and DOM lookups scoped to the figure's root so multiple embeds
do not interfere. Register a one-shot `interactive-dispose` listener on that root to clean up timers, animation
frames and listeners before a rerender or note teardown. Listen for `interactive-visibility` on the root to pause
animation while the figure is offscreen; `event.detail.visible` carries the state. Read `native-renderer.ts` before adding
lifecycle code. Inspect `theme.ts` and use the
plugin's theme variables and `obsidian-theme-change` event instead of fixing one theme.

Use the plugin's `html-embed` iframe mode when isolation is needed, and for any full HTML
document that styles `<body>`: an Anatomy page puts `class="iso"` and `data-theme` there, and
the native renderer keeps only the body's children. Check its script, resize
and asset-loading contract first; native and iframe mode are different renderers.
A static SVG or PNG is an optional export for print, sharing or a client without the plugin.
It does not replace the interactive note embed by default.

## Local charts and link cards

Use an `interactive-view` fence for read-only views that need no HTML or user script.
The legacy `interactive` and `html-embed` modes are unchanged and are for trusted figures,
not for unreviewed generated content. This plugin has no dependency on Learn or Pi.

````markdown
```interactive-view
view: chart
data: ./Journeys/2026.csv
x: date
y: price_eur
group: month
label: Ticket cost
unit: EUR
count: Journey legs
```
````

`data:` accepts an exact vault path or an explicit `./` path relative to the note.
CSV and flat JSON arrays are supported. Without `group:`, each row is a bar and labels
must be unique. `group: month` takes ISO dates, sums the values, and optionally adds a
count measure. `unit: EUR` sums integer cents and formats euro values. The chart updates
when its local data changes. Limits: 1 MiB per file, 10,000 records, 120 bars.

````markdown
```interactive-view
view: links
table: Proposals
link: Link
name: Event
details: Date, Where
layout: gallery
data: ./preview-cache.json
```
````

For `table:`, give the exact heading over the note's pipe table. `link:` and `name:` pick
columns (default Link and Title). `details:` picks up to six more columns. Rows without an
HTTP(S) link stay in the original table and do not get a card. Choose `compact` (default)
or `gallery`. With no `table:`, `data:` is a standalone list of cards. With both, the
optional JSON enriches existing links by URL without replacing the note's facts:

```json
[
  { "url": "https://example.org/page", "title": "Optional title",
    "description": "Optional excerpt", "image": "./cover.webp", "captured": "2026-11-22" }
]
```

Only a vault-local raster thumbnail is used; missing or remote images get a placeholder.
For a page already saved locally, `bun run capture-link https://example.org/page saved.html ./cover.webp`
prints a one-entry cache. It never requests the page, executes its scripts or saves its remote
images. Copy the item into the cache when useful. The captured date is not the page's publication
or event date. The view never fetches metadata and does not change the source. Keep the plain
Markdown links or ledger reference next to it as a fallback.

Run `bun run check` to test and build. `bun run deploy` installs into the local vault
(`OBSIDIAN_VAULT` can override the destination). Reload Interactive in Obsidian.

## Placement and verification

Read the vault's own rules before writing notes or assets. Update the owning note and use its
permitted asset location and link syntax. Local integration never authorizes publishing a private figure to the community gallery.

Run the figure's geometry and visual checks. Verify the embed in its actual note at the note's
width, including pointer and keyboard interaction, theme changes, reduced motion, navigation away
and back, and multiple copies. Check that local asset paths resolve. Check a static export only
when one is requested. State which host rendering was not verified instead of treating a browser
preview as proof that an Obsidian embed works.

## License

MIT. See [LICENSE](LICENSE).
