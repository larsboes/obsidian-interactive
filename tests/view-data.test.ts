import { describe, expect, test } from 'bun:test';
import { chartData, linkData, localPath, parseCsv, parseView, tableLinks, type ChartView, type LinkView } from '../src/view-data';

const chart = parseView('view: chart\ndata: ledger.csv\nx: date\ny: price_eur\nlabel: Cost\ncount: Trips\ngroup: month\nunit: EUR') as ChartView;
const gallery = parseView('view: links\ntable: Proposals\nlink: Link\nname: Event\ndetails: Date, Where\nlayout: gallery') as LinkView;

describe('local views', () => {
  test('rejects typos and paths that are not exact local vault paths', () => {
    expect(localPath('[[Areas/Travel/Journeys/2026.csv]]', 'Home.md')).toBe('Areas/Travel/Journeys/2026.csv');
    expect(localPath('./preview.json', 'Events/Proposals.md')).toBe('Events/preview.json');
    for (const bad of ['../secret.json', './a/../b.json', 'https://example.org/p.png', '/file.csv', '.obsidian/x.json']) {
      expect(() => localPath(bad, 'Owner.md')).toThrow();
    }
    expect(() => parseView('view: links\ntable: Links\nlayout: compact\nlayout: gallery')).toThrow();
    expect(() => parseView('view: links\ntable: Links\ncolour: red')).toThrow('Unknown option');
  });

  test('parses quotes, newlines, BOM and CRLF without changing cells', () => {
    const rows = parseCsv('\ufeffroute,description,price\r\n"A, B","one\n\"\"two\"\"",7.48\r\n');
    expect(Object.fromEntries(rows[0])).toEqual({ route: 'A, B', description: 'one\n"two"', price: '7.48' });
    expect(() => parseCsv('a,b\nx')).toThrow('wrong number');
    expect(() => parseCsv('a,b\n"unclosed')).toThrow('Unterminated');
    expect(() => parseCsv('a,b\n"ok"junk,value')).toThrow('Malformed');
  });

  test('month grouping counts rows and adds currency in integer cents', () => {
    const csv = 'date,price_eur,source\n2026-11-10,7.48,ignored\n2026-11-10,7.48,ignored\n2026-10-25,51.74,ignored';
    expect(chartData(csv, 'csv', chart)).toEqual([{ label: '2026-10', total: 51.74, count: 1 }, { label: '2026-11', total: 14.96, count: 2 }]);
    expect(chartData('date,price_eur', 'csv', chart)).toEqual([]);
    expect(() => chartData('date,price_eur\n2026-02-29,10', 'csv', chart)).toThrow('valid YYYY-MM-DD');
    expect(() => chartData('date,price_eur\n2026-01-01,', 'csv', chart)).toThrow('price in euros');
    expect(() => chartData('date,price_eur\n2026-01-01,1.005', 'csv', chart)).toThrow('price in euros');
  });

  test('flat JSON feeds a chart and rejects corrupted or duplicate rows', () => {
    const spec = parseView('view: chart\ndata: bars.json\nx: location\ny: delta\nlabel: Change') as ChartView;
    expect(chartData('[{"location":"A","delta":-12},{"location":"B","delta":15}]', 'json', spec)).toEqual([
      { label: 'A', total: -12, count: 1 }, { label: 'B', total: 15, count: 1 },
    ]);
    expect(() => chartData('[{"location":"A","delta":null}]', 'json', spec)).toThrow('a number');
    expect(() => chartData('[Unparseable]', 'json', spec)).toThrow('Invalid JSON');
    expect(() => chartData('[{"location":"A","delta":1},{"location":"A","delta":2}]', 'json', spec)).toThrow('duplicate label');
  });

  test('table data remains authoritative and preview metadata is optional', () => {
    const source = '# Options\n\n## Proposals\n\n| Date | Event | Where | Link |\n|---|---|---|---|\n| 2026-11-24 | Local title | Hall \\| A | [Open](https://example.org/a) |\n| 2026-11-26 | Other event | Town | <https://example.org/b> |\n| 2026-11-28 | No public URL | Hall | Email |\n\n## Older\n';
    const known = linkData('[{"url":"https://example.org/a","title":"External title","description":"External description","image":"./a.png","captured":"2026-11-22"}]');
    const cards = tableLinks(source, gallery, known);
    expect(cards[0]).toMatchObject({ title: 'Local title', image: './a.png', captured: '2026-11-22', details: [{ label: 'Date', value: '2026-11-24' }, { label: 'Where', value: 'Hall | A' }] });
    expect(cards[1].url.href).toBe('https://example.org/b');
    expect(cards[1].image).toBeUndefined();
    expect(tableLinks(source, gallery).map((x) => x.url.href)).toEqual(cards.map((x) => x.url.href));
  });

  test('standalone cards require a normal external link and fall back to the hostname', () => {
    expect(linkData('[{"url":"https://example.org/item","captured":"2026-02-30"}]')[0]).toMatchObject({ title: 'example.org', captured: undefined });
    for (const bad of ['javascript:alert(1)', 'file:///tmp/demo', 'https://key@example.org/']) {
      expect(() => linkData(JSON.stringify([{ url: bad }]))).toThrow('HTTP(S)');
    }
  });
});
