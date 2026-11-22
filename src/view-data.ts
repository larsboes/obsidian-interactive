export const MAX_DATA_BYTES = 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_CARDS = 120;

interface Base { title?: string; data?: string }
export interface ChartView extends Base {
  view: 'chart'; data: string; x: string; y: string; label: string; count?: string; group?: 'month'; unit?: 'EUR';
}
export interface LinkView extends Base {
  view: 'links'; layout: 'compact' | 'gallery'; table?: string; link: string; name: string; details: string[];
}
export type ViewSpec = ChartView | LinkView;

/** No link resolution heuristics: paths are exact vault paths, or explicitly owner-relative. */
export function localPath(value: string, owner: string): string {
  const path = value.trim().replace(/^\[\[(.+)\]\]$/, '$1');
  const relative = path.startsWith('./');
  const rest = relative ? path.slice(2) : path;
  if (/[:\\#|\[\]\x00-\x1f]/.test(rest) || rest.split('/').some((part) => !part || part.startsWith('.'))) {
    throw new Error('Use an exact vault path or a path starting with ./, without hidden or parent segments.');
  }
  const slash = owner.lastIndexOf('/');
  return relative && slash !== -1 ? `${owner.slice(0, slash)}/${rest}` : rest;
}

export function parseView(source: string): ViewSpec {
  if (source.length > 4096) throw new Error('View configuration is too long.');
  const opts = new Map<string, string>();
  for (const line of source.trim().split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^([a-z]+):\s*(.+)$/.exec(line.trim());
    if (!m || !m[2].trim() || opts.has(m[1])) throw new Error('Use one key: value per line, without duplicate keys.');
    opts.set(m[1], m[2].trim());
  }
  const get = (key: string) => { const value = opts.get(key); opts.delete(key); return value; };
  const need = (key: string) => { const value = get(key); if (!value) throw new Error(`Missing ${key}:`); return value; };
  const view = get('view');
  const base = { title: get('title'), data: get('data') };
  let spec: ViewSpec;
  if (view === 'chart') {
    const group = get('group');
    const unit = get('unit');
    if (group !== undefined && group !== 'month') throw new Error('Supported grouping: month.');
    if (unit !== undefined && unit !== 'EUR') throw new Error('Supported currency: EUR.');
    if (!base.data) throw new Error('Missing data:');
    const count = get('count');
    if (count && !group) throw new Error('count: requires group: month.');
    spec = { ...base, view, data: base.data, x: need('x'), y: need('y'), label: need('label'), count, group, unit };
  } else if (view === 'links') {
    const layout = get('layout') ?? 'compact';
    if (layout !== 'compact' && layout !== 'gallery') throw new Error('Supported layouts: compact, gallery.');
    const table = get('table');
    if (!table && !base.data) throw new Error('Supply a note table heading or a JSON data file.');
    const link = get('link') ?? 'Link';
    const name = get('name') ?? 'Title';
    const details = (get('details') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (details.length > 6) throw new Error('Use at most six detail columns.');
    spec = { ...base, view, layout, table, link, name, details };
  } else throw new Error('Supported views: chart, links.');
  if (opts.size) throw new Error(`Unknown option: ${opts.keys().next().value}`);
  return spec;
}

type Cell = string | number | boolean | null;
type Row = Map<string, Cell>;

/** Quoted delimiters, escaped quotes, CRLF records and newlines inside quoted fields. */
export function parseCsv(input: string): Row[] {
  let records: string[][] = [];
  let cells: string[] = [], cell = '';
  let quoted = false, closedQuote = false;
  const field = () => { cells.push(cell); cell = ''; closedQuote = false; };
  const record = () => {
    field();
    if (cells.length > 1 || cells[0].trim()) records.push(cells);
    if (records.length > MAX_ROWS + 1) throw new Error('Too many data rows.');
    cells = [];
  };
  const text = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else cell += c;
    } else if (c === ',') field();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record();
    } else if (c === '"' && !cell && !closedQuote) quoted = true;
    else if (closedQuote || c === '"') throw new Error('Malformed quoted CSV field.');
    else cell += c;
  }
  if (quoted) throw new Error('Unterminated CSV quote.');
  if (cell || cells.length || closedQuote) record();
  const head = records.shift()?.map((x) => x.trim()) ?? [];
  if (head.some((x) => !x) || new Set(head).size !== head.length) throw new Error('CSV needs nonempty, unique column names.');
  return records.map((row, i) => {
    if (row.length !== head.length) throw new Error(`CSV record ${i + 2} has the wrong number of fields.`);
    return new Map(head.map((key, j) => [key, row[j]]));
  });
}

function jsonRows(raw: string): Row[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Invalid JSON data.'); }
  if (!Array.isArray(value) || value.length > MAX_ROWS) throw new Error('Use a JSON array of records.');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each record must be an object.');
    return new Map(Object.entries(item).map(([key, value]) => {
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Use flat JSON records.');
      return [key, value as Cell];
    }));
  });
}

function isoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export interface Bar { label: string; total: number; count: number }
export function chartData(raw: string, format: 'csv' | 'json', spec: ChartView): Bar[] {
  const records = format === 'csv' ? parseCsv(raw) : jsonRows(raw);
  const bars = new Map<string, Bar>();
  for (const [i, row] of records.entries()) {
    const x = row.get(spec.x);
    const y = row.get(spec.y);
    const label = typeof x === 'number' || typeof x === 'string' ? String(x).trim() : '';
    const numeric = typeof y === 'number' ? String(y) : typeof y === 'string' ? y.trim() : '';
    const money = spec.unit === 'EUR';
    // Sum currency as integer cents; don't silently turn empty/invalid values into zero.
    const value = Number(numeric);
    const scaled = money ? Math.round(value * 100) : value;
    if (!label || label.length > 120 || !/^[+-]?\d+(?:\.\d+)?$/.test(numeric) || !Number.isFinite(scaled)
      || (money && (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(numeric) || !Number.isSafeInteger(scaled)))) {
      throw new Error(`Record ${i + 1}: expected a label in ${spec.x} and ${money ? 'a price in euros' : 'a number'} in ${spec.y}.`);
    }
    if (spec.group && !isoDate(label)) throw new Error(`Record ${i + 1}: ${spec.x} needs a valid YYYY-MM-DD date.`);
    const key = spec.group ? label.slice(0, 7) : label;
    if (!spec.group && bars.has(key)) throw new Error(`Record ${i + 1}: duplicate label without grouping.`);
    const bar = bars.get(key) ?? { label: key, total: 0, count: 0 };
    bar.total += scaled;
    bar.count++;
    if (!Number.isFinite(bar.total) || (money && !Number.isSafeInteger(bar.total))) throw new Error('Chart total is out of range.');
    bars.set(key, bar);
    if (bars.size > 120) throw new Error('Chart has more than 120 groups. Use a smaller input.');
  }
  const result = Array.from(bars.values(), (bar) => ({ ...bar, total: spec.unit === 'EUR' ? bar.total / 100 : bar.total }));
  return spec.group ? result.sort((a, b) => a.label.localeCompare(b.label)) : result;
}

export interface Card {
  url: URL;
  title: string;
  image?: string;
  description?: string;
  captured?: string;
  details: { label: string; value: string }[];
}

export function publicLink(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) && url.hostname && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function linkData(raw: string): Card[] {
  const records = jsonRows(raw);
  if (records.length > MAX_CARDS) throw new Error('There are more than 120 link cards.');
  return records.map((row, i) => {
    const str = (key: string, max: number) => typeof row.get(key) === 'string' ? String(row.get(key)).trim().slice(0, max) : '';
    const url = publicLink(str('url', 4096));
    if (!url) throw new Error(`Link record ${i + 1}: expected an HTTP(S) URL without credentials.`);
    const captured = str('captured', 11);
    return { url, title: str('title', 200) || url.hostname, description: str('description', 420), image: str('image', 512),
      captured: isoDate(captured) ? captured : undefined, details: [] };
  });
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((s) => s.trim().replace(/\\\|/g, '|'));

/** Cards are a view of the owner's table; facts are never copied into the optional web cache. */
export function tableLinks(markdown: string, spec: LinkView, cache: Card[] = []): Card[] {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex((s) => /^#{1,6}\s+/.test(s) && s.replace(/^#+\s+/, '').trim() === spec.table);
  if (heading < 0) throw new Error('Link table heading not found.');
  const end = lines.findIndex((s, i) => i > heading && /^#{1,6}\s+/.test(s));
  const section = lines.slice(heading + 1, end < 0 ? undefined : end);
  const header = section.findIndex((s, i) => s.trim().startsWith('|') && section[i + 1]?.trim().startsWith('|')
    && cells(section[i + 1]).every((c) => /^:?-{3,}:?$/.test(c)));
  if (header < 0) throw new Error('No Markdown pipe table under that heading.');
  const columns = cells(section[header]);
  const index = (name: string) => {
    const i = columns.indexOf(name);
    if (i < 0) throw new Error(`Link table has no ${name} column.`);
    return i;
  };
  const link = index(spec.link), name = index(spec.name);
  const details = spec.details.map((label) => ({ label, i: index(label) }));
  const metadata = new Map(cache.map((card) => [card.url.href, card]));
  const cards: Card[] = [];
  for (const line of section.slice(header + 2)) {
    if (!line.trim().startsWith('|')) break;
    const row = cells(line);
    if (row.length !== columns.length) throw new Error('A link-table row has the wrong number of cells.');
    const cell = row[link];
    const href = /^\[[^\]]+\]\((?:<([^>]+)>|(.+))\)$/.exec(cell)?.slice(1).find(Boolean) ?? cell.replace(/^<|>$/g, '');
    const url = publicLink(href);
    if (!url) continue; // The original table still shows entries without a web link.
    const cached = metadata.get(url.href);
    cards.push({ ...cached, url, title: row[name] || cached?.title || url.hostname,
      details: details.flatMap(({ label, i }) => row[i] ? [{ label, value: row[i] }] : []) });
    if (cards.length > MAX_CARDS) throw new Error('There are more than 120 link cards.');
  }
  return cards;
}
