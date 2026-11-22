import { App, MarkdownRenderChild, TFile } from 'obsidian';
import { chartData, linkData, localPath, MAX_DATA_BYTES, parseView, tableLinks, type Bar, type Card, type ChartView, type LinkView } from './view-data';

export class InteractiveView extends MarkdownRenderChild {
  private active = false;
  private revision = 0;
  private watched = new Set<string>();
  private chartState = { metric: 'total', period: '' };

  constructor(el: HTMLElement, private app: App, private source: string, private owner: string) { super(el); }

  onload() {
    this.active = true;
    const vault = this.app.vault;
    const refresh = (file: { path: string }, oldPath?: string) => {
      if (this.watched.has(file.path) || (oldPath && this.watched.has(oldPath))) void this.render();
    };
    this.registerEvent(vault.on('modify', refresh));
    this.registerEvent(vault.on('create', refresh));
    this.registerEvent(vault.on('delete', refresh));
    this.registerEvent(vault.on('rename', refresh));
    void this.render();
  }

  onunload() { this.active = false; this.revision++; }

  private async read(path: string, extensions: string[]) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Local file not found: ${path}`);
    if (!extensions.includes(file.extension.toLowerCase())) throw new Error(`Supported file types: ${extensions.join(', ')}.`);
    if (file.stat.size > MAX_DATA_BYTES) throw new Error('Data exceeds 1 MiB. Choose a smaller input.');
    const raw = await this.app.vault.read(file).catch(() => { throw new Error(`Could not read local file: ${path}`); });
    if (raw.length > MAX_DATA_BYTES) throw new Error('Data exceeds 1 MiB. Choose a smaller input.');
    return { raw, format: file.extension.toLowerCase() };
  }

  private async render() {
    const revision = ++this.revision;
    const el = this.containerEl;
    const current = () => this.active && revision === this.revision;
    const watched = this.watched = new Set();
    try {
      const spec = parseView(this.source);
      const data = spec.data ? localPath(spec.data, this.owner) : undefined;
      if (data) watched.add(data);
      if (spec.view === 'links' && spec.table) watched.add(this.owner);
      let paint: (root: HTMLElement) => void;
      if (spec.view === 'chart' && data) {
        const file = await this.read(data, ['csv', 'json']);
        const bars = chartData(file.raw, file.format === 'csv' ? 'csv' : 'json', spec);
        paint = (root) => renderChart(root, spec, bars, this.chartState);
      } else if (spec.view === 'links') {
        let cards: Card[] = [];
        let cacheError = false;
        if (data) {
          try { cards = linkData((await this.read(data, ['json'])).raw); }
          catch (error) { if (!spec.table) throw error; cacheError = true; }
        }
        if (spec.table) cards = tableLinks((await this.read(this.owner, ['md'])).raw, spec, cards);
        const preview = (image: string) => {
          try {
            const path = localPath(image, data ?? this.owner);
            if (!/\.(?:avif|gif|jpe?g|png|webp)$/i.test(path)) return null;
            watched.add(path);
            const file = this.app.vault.getAbstractFileByPath(path);
            return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
          } catch { return null; }
        };
        paint = (root) => {
          if (cacheError) root.createEl('p', { cls: 'interactive-view-muted', text: 'Preview cache unavailable; showing the original links.' });
          renderCards(root, spec, cards, preview);
        };
      } else throw new Error('Missing chart data.');
      if (!current()) return;
      el.empty();
      const root = el.createDiv({ cls: 'interactive-view' });
      if (spec.title) root.createDiv({ cls: 'interactive-view-title', text: spec.title });
      paint(root);
    } catch (error) {
      if (!current()) return;
      el.empty();
      el.createEl('p', { cls: 'html-embed-error', text: error instanceof Error ? error.message : 'Could not render the local view.' });
    }
  }
}

function renderChart(root: HTMLElement, spec: ChartView, bars: Bar[], state: { metric: string; period: string }) {
  if (!bars.length) { root.createEl('p', { text: 'No data rows.' }); return; }
  const toolbar = root.createDiv({ cls: 'interactive-view-controls' });
  function select(label: string, options: [string, string][], value: string) {
    const field = toolbar.createEl('label', { text: label });
    const input = field.createEl('select');
    for (const [value, text] of options) input.createEl('option', { text, attr: { value } });
    if (options.some(([option]) => option === value)) input.value = value;
    return input;
  }
  const month = spec.group === 'month' ? select('Period', [['', 'All months'], ...bars.map((bar): [string, string] => [bar.label, bar.label])], state.period) : null;
  const metric = spec.count ? select('Measure', [['total', spec.label], ['count', spec.count]], state.metric) : null;
  if (!toolbar.childElementCount) toolbar.remove();
  const summary = root.createEl('p', { attr: { 'aria-live': 'polite' } });
  const plot = root.createEl('ul', { cls: 'interactive-bars' });
  function paint() {
    state.metric = metric?.value ?? 'total';
    state.period = month?.value ?? '';
    const count = state.metric === 'count';
    const filtered = bars.filter((bar) => !state.period || state.period === bar.label);
    const value = (bar: Bar) => count ? bar.count : bar.total;
    const format = new Intl.NumberFormat(undefined, spec.unit && !count ? { style: 'currency', currency: spec.unit } : { maximumFractionDigits: 4 });
    // Keep the scale stable while filtering a period; a negative value extends left from zero.
    const lo = Math.min(0, ...bars.map(value)), hi = Math.max(0, ...bars.map(value));
    const position = (n: number) => hi === lo ? 0 : (n - lo) / (hi - lo) * 100;
    const name = count ? spec.count! : spec.label;
    summary.textContent = `${name} total: ${format.format(filtered.reduce((sum, bar) => sum + value(bar), 0))}`;
    plot.setAttribute('aria-label', name);
    plot.replaceChildren();
    for (const bar of filtered) {
      const row = plot.createEl('li', { cls: 'interactive-bar' });
      row.createSpan({ text: bar.label });
      const track = row.createSpan({ cls: 'interactive-bar-track', attr: { 'aria-hidden': 'true' } });
      const fill = track.createSpan({ cls: 'interactive-bar-fill' });
      fill.style.left = `${position(Math.min(0, value(bar)))}%`;
      fill.style.width = `${Math.abs(position(value(bar)) - position(0))}%`;
      row.createSpan({ text: format.format(value(bar)) });
    }
  }
  metric?.addEventListener('change', paint);
  month?.addEventListener('change', paint);
  paint();
}

function renderCards(root: HTMLElement, spec: LinkView, cards: Card[], resource: (image: string) => string | null) {
  if (!cards.length) { root.createEl('p', { text: 'No links to preview.' }); return; }
  const list = root.createEl('ul', { cls: `interactive-links is-${spec.layout}` });
  for (const card of cards) {
    const item = list.createEl('li');
    const anchor = item.createEl('a', {
      cls: 'interactive-link-card',
      attr: { href: card.url.href, target: '_blank', rel: 'noopener noreferrer' },
    });
    const preview = anchor.createSpan({ cls: 'interactive-link-image', attr: { 'aria-hidden': 'true' } });
    preview.createSpan({ text: card.url.hostname.slice(0, 1).toUpperCase() });
    const src = card.image ? resource(card.image) : null;
    if (src) {
      const image = preview.createEl('img', { attr: { alt: '', loading: 'lazy', decoding: 'async' } });
      image.addEventListener('error', () => image.remove(), { once: true });
      image.src = src;
    }
    const body = anchor.createSpan({ cls: 'interactive-link-body' });
    body.createEl('strong', { text: card.title });
    body.createSpan({ cls: 'interactive-view-muted', text: card.url.hostname });
    if (card.details.length) body.createSpan({ text: card.details.map(({ label, value }) => `${label}: ${value}`).join(' · ') });
    if (card.description) body.createSpan({ text: card.description });
    if (card.captured) body.createSpan({ cls: 'interactive-view-muted', text: `Preview captured ${card.captured}` });
  }
}
