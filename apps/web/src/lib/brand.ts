// Visual identity for a university card: its own brand colour when set, otherwise a stable
// colour from an accessible palette (all ≥ 4.5:1 against white text).

const PALETTE = ["#1e40af", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#0369a1", "#4d7c0f", "#a21caf"];
const HEX = /^#[0-9a-f]{6}$/i;

export function brandColor(slug: string, custom?: string) {
  if (custom && HEX.test(custom)) return custom;
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
