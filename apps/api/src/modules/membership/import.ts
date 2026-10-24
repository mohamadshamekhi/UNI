// Bulk member import (AUTH-16): CSV or XLSX with a header row. Persian or English headers.
import readXlsxFile from 'read-excel-file/node';
import { AppError } from '../../common/errors/app-error.js';
import { normalizeFa, toAsciiDigits } from '../../common/util/normalize.js';

export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

export type ImportKind = 'student' | 'faculty' | 'staff';

export interface ImportRow {
  row: number;
  kind?: ImportKind;
  fullName?: string;
  mobile?: string;
  email?: string;
  unit?: string;
  memberNo?: string;
}

const HEADERS: Record<string, keyof Omit<ImportRow, 'row'>> = {
  kind: 'kind',
  'نوع': 'kind',
  'نوع عضویت': 'kind',
  fullname: 'fullName',
  name: 'fullName',
  'نام و نام خانوادگی': 'fullName',
  'نام': 'fullName',
  mobile: 'mobile',
  'موبایل': 'mobile',
  'شماره موبایل': 'mobile',
  email: 'email',
  'ایمیل': 'email',
  unit: 'unit',
  'واحد': 'unit',
  'کد واحد': 'unit',
  'دانشکده': 'unit',
  memberno: 'memberNo',
  'شماره': 'memberNo',
  'شماره دانشجویی': 'memberNo',
  'شماره پرسنلی': 'memberNo',
  'شماره دانشجویی/پرسنلی': 'memberNo',
};

const KINDS: Record<string, ImportKind> = {
  student: 'student',
  'دانشجو': 'student',
  faculty: 'faculty',
  'استاد': 'faculty',
  'هیئت علمی': 'faculty',
  staff: 'staff',
  'کارمند': 'staff',
};

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';' || c === '\t') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const cell = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v)).trim();

export async function readImportFile(buffer: Buffer): Promise<ImportRow[]> {
  if (buffer.length === 0) throw new AppError('VALIDATION_FAILED', { field: 'file' });
  if (buffer.length > IMPORT_MAX_BYTES) throw new AppError('FILE_TOO_LARGE', { maxBytes: IMPORT_MAX_BYTES });
  const isXlsx = buffer[0] === 0x50 && buffer[1] === 0x4b;
  let table: string[][];
  if (isXlsx) {
    try {
      const sheets = await readXlsxFile(buffer);
      table = (sheets[0]?.data ?? []).map((r) => r.map(cell));
    } catch {
      throw new AppError('FILE_TYPE_NOT_ALLOWED', { allowed: ['xlsx', 'csv'] });
    }
  } else {
    table = parseCsv(buffer.toString('utf8').replace(/^﻿/, ''));
  }
  const [header, ...body] = table;
  if (!header) throw new AppError('VALIDATION_FAILED', { reason: 'empty_file' });
  const columns = header.map((h) => HEADERS[normalizeFa(h).toLowerCase().replace(/[\s_-]/g, '')] ?? HEADERS[normalizeFa(h)]);
  if (!columns.includes('fullName') || !columns.includes('mobile') || !columns.includes('unit')) {
    throw new AppError('VALIDATION_FAILED', { reason: 'missing_columns', required: ['fullName', 'mobile', 'unit'] });
  }
  if (body.length > IMPORT_MAX_ROWS) throw new AppError('VALIDATION_FAILED', { reason: 'too_many_rows', max: IMPORT_MAX_ROWS });
  return body.map((r, i) => {
    const out: ImportRow = { row: i + 2 };
    columns.forEach((col, j) => {
      const v = cell(r[j]);
      if (!col || !v) return;
      if (col === 'kind') out.kind = KINDS[normalizeFa(v).toLowerCase()];
      else if (col === 'mobile' || col === 'memberNo') out[col] = toAsciiDigits(v);
      else out[col] = normalizeFa(v);
    });
    if (!out.kind && !columns.includes('kind')) out.kind = 'faculty';
    return out;
  });
}
