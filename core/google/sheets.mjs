import { StudioError } from '../errors.mjs';
import { fileId, gfetch, hosts } from './api.mjs';

// Google Sheets for shot lists, deliverable trackers and batch inputs: rows come back as objects
// keyed by the header row; results (status, links) can be written back to cells.

export async function readSheet(ref, { range, limit = 2000 } = {}) {
  const id = fileId(ref);
  let r = range;
  if (!r) {
    const meta = await gfetch(`${hosts().sheets}/spreadsheets/${id}?fields=sheets.properties.title`);
    r = meta.sheets?.[0]?.properties?.title;
    if (!r) throw new StudioError('That spreadsheet has no sheets.');
  }
  const v = await gfetch(`${hosts().sheets}/spreadsheets/${id}/values/${encodeURIComponent(r)}?majorDimension=ROWS`);
  const [header = [], ...rows] = v.values ?? [];
  const keys = header.map((h, i) => String(h).trim() || `col${i + 1}`);
  return {
    range: v.range ?? r,
    columns: keys,
    rows: rows.slice(0, limit).map((row, i) => ({ _row: i + 2, ...Object.fromEntries(keys.map((k, j) => [k, row[j] ?? ''])) })),
    total: rows.length,
  };
}

/** Writes values into a range, e.g. range "Shots!F2:G2", values [["Done", "https://..."]]. */
export async function writeSheet(ref, { range, values }) {
  if (!range || !Array.isArray(values)) throw new StudioError('Give a range and a list of rows.');
  const id = fileId(ref);
  const r = await gfetch(`${hosts().sheets}/spreadsheets/${id}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ range, majorDimension: 'ROWS', values }), retry: false });
  return { updated_range: r.updatedRange, updated_cells: r.updatedCells };
}
