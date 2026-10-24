import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

const DIGIT_MAP: Record<string, string> = {};
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => (DIGIT_MAP[d] = String(i)));
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => (DIGIT_MAP[d] = String(i)));

/** Persian/Arabic digits -> ASCII (UX-03). */
export function toAsciiDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] ?? d);
}

/**
 * Canonical form for Persian text used in search, unique identifiers and comparisons (UX-03):
 * Arabic ي/ى/ك -> Persian ی/ک, unified digits, removed tatweel/diacritics, collapsed whitespace.
 */
export function normalizeFa(input: string): string {
  return toAsciiDigits(input)
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[ـً-ٟ]/g, '')
    .replace(/‌+/g, '‌')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalizes to E.164 (AUTH-03). Iranian local forms (0912…, 912…) default to +98. */
export function normalizeMobile(input: string): string | null {
  const raw = toAsciiDigits(input).replace(/[\s-]/g, '');
  const phone = parsePhoneNumberFromString(raw, 'IR');
  if (!phone || !phone.isValid()) return null;
  const type = phone.getType();
  if (type && type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') return null;
  return phone.number;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Iranian national id checksum (appendix 1). */
export function isValidNationalId(input: string): boolean {
  const code = toAsciiDigits(input).trim();
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits[9]!;
  const sum = digits.slice(0, 9).reduce((acc, d, i) => acc + d * (10 - i), 0) % 11;
  return sum < 2 ? check === sum : check === 11 - sum;
}

export function maskMobile(mobile: string): string {
  return mobile.length > 7 ? `${mobile.slice(0, 5)}***${mobile.slice(-3)}` : '***';
}
