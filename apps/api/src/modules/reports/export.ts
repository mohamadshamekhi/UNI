import { strToU8, zipSync } from 'fflate';

export interface Column {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date';
}

export interface Table {
  title: string;
  columns: Column[];
  rows: Record<string, unknown>[];
}

const cell = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v));

/** CSV with a BOM so Excel opens Persian text correctly. */
export function toCsv(t: Table): string {
  const esc = (v: unknown) => `"${cell(v).replace(/"/g, '""')}"`;
  const lines = [t.columns.map((c) => esc(c.label)).join(','), ...t.rows.map((r) => t.columns.map((c) => esc(r[c.key])).join(','))];
  return `﻿${lines.join('\r\n')}`;
}

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Minimal single-sheet XLSX (inline strings, right-to-left sheet), no external dependency. */
export function toXlsx(t: Table): Buffer {
  const row = (cells: string[], r: number) => `<row r="${r}">${cells.join('')}</row>`;
  const str = (v: string, ref: string) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  const num = (v: number, ref: string) => `<c r="${ref}"><v>${v}</v></c>`;
  const header = row(t.columns.map((c, i) => str(c.label, `${colName(i)}1`)), 1);
  const body = t.rows.map((r, ri) =>
    row(
      t.columns.map((c, i) => {
        const ref = `${colName(i)}${ri + 2}`;
        const v = r[c.key];
        return c.type === 'number' && typeof v === 'number' && Number.isFinite(v) ? num(v, ref) : str(cell(v), ref);
      }),
      ri + 2,
    ),
  );
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetData>${header}${body.join('')}</sheetData></worksheet>`;
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  return Buffer.from(zipSync(files));
}
