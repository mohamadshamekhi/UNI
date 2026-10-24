// Jalali display with ISO/UTC storage (UX-02); Persian digits for display only.

const dateFmt = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Tehran" });
const dateTimeFmt = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tehran",
});
const numFmt = new Intl.NumberFormat("fa-IR");

export const fmtDate = (iso?: string | null) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDateTime = (iso?: string | null) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");
export const fmtNum = (n?: number | null) => (n === undefined || n === null ? "—" : numFmt.format(n));

export function fmtBytes(n: number) {
  const units = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${numFmt.format(Math.round(v * 10) / 10)} ${units[i]}`;
}

export const toFaDigits = (s: string) => s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);

export const shortId = (id?: string | null) => (id ? id.slice(0, 8) : "—");
