const toAscii = (s: string) => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/** Iranian national ID (کد ملی) checksum; same rule as the API. */
export function isValidNationalId(input: string): boolean {
  const code = toAscii(input).trim();
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const sum = digits.slice(0, 9).reduce((acc, d, i) => acc + d * (10 - i), 0) % 11;
  return sum < 2 ? digits[9] === sum : digits[9] === 11 - sum;
}
