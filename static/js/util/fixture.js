// Gemeinsame Rechnungen für Scheinwerfer: Bogenposition, Kanalwerte, Lichtfarbe.

export function arcPoint(stage, t) {
  const a = stage.lightArc;
  const phi = (-a.phiMaxDeg + 2 * a.phiMaxDeg * Math.min(1, Math.max(0, t))) * Math.PI / 180;
  return [a.cx + a.r * Math.sin(phi), a.y - a.fixtureDrop, a.cz + a.r * Math.cos(phi)];
}

export function arcT(stage, x, z) {
  const a = stage.lightArc;
  const phi = Math.atan2(x - a.cx, z - a.cz) * 180 / Math.PI;
  return Math.min(1, Math.max(0, (phi + a.phiMaxDeg) / (2 * a.phiMaxDeg)));
}

export function fixturePosition(stage, fx) {
  return fx.mount.kind === 'arc' ? arcPoint(stage, fx.mount.t) : fx.mount.position;
}

export const beamAngle = (fx, type) => fx.beamAngleDeg ?? type?.beam?.angleDeg ?? 30;
export const fixtureShape = (fx, type) => fx.shape ?? type?.render?.shape ?? 'square';

/** Kanalwerte zum Hell-Schalten (Identify/Test). */
export function highlightValues(type) {
  return type.channels.map((c) => c.highlight);
}

/** Kanalwerte für eine Testfarbe: role ∈ red|green|blue|white|amber. */
export function colorTestValues(type, role) {
  const hasColor = type.channels.some((c) => c.role === role);
  return type.channels.map((c) => {
    if (c.role === 'dimmer') return 255;
    if (['red', 'green', 'blue', 'white', 'amber', 'uv', 'warm', 'cold'].includes(c.role)) return hasColor && c.role === role ? 255 : 0;
    if (c.role === 'strobe' || c.role === 'program') return c.default;
    return c.highlight;
  });
}

export function rawChannels(address, values) {
  const out = {};
  values.forEach((v, i) => { if (address + i <= 512) out[address + i] = v; });
  return out;
}

const WHITE = [1, 0.95, 0.85];
const AMBER = [1, 0.6, 0.1];

export function kelvinToRgb(k) {
  // Näherung nach Tanner Helland, ausreichend für die Vorschau
  const t = k / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * (t - 60) ** -0.1332; g = 288.12 * (t - 60) ** -0.0755; b = 255; }
  const c = (v) => Math.min(1, Math.max(0, v / 255));
  return [c(r), c(g), c(b)];
}

export const CCT_MIN = 2700;
export const CCT_MAX = 6500;
export const cctToKelvin = (cct) => Math.round(CCT_MIN + (CCT_MAX - CCT_MIN) * cct);

/** Lichtfarbe (0…1, normiert) eines Scheinwerfers für die 3D-Vorschau. */
export function lightColor(type, lv) {
  const model = type?.colorModel ?? 'none';
  if (model === 'none') return type?.render?.shape === 'round' && type.channels.length === 1 ? [1, 0.82, 0.6] : [1, 0.93, 0.82];
  if (model === 'cct') return kelvinToRgb(cctToKelvin(lv.cct));
  let r = lv.r, g = lv.g, b = lv.b;
  if (model === 'rgbw' || model === 'rgbaw') { r += lv.w * WHITE[0]; g += lv.w * WHITE[1]; b += lv.w * WHITE[2]; }
  if (model === 'rgbaw') { r += lv.a * AMBER[0]; g += lv.a * AMBER[1]; b += lv.a * AMBER[2]; }
  const m = Math.max(r, g, b);
  return m > 0 ? [r / m, g / m, b / m] : [0, 0, 0];
}

/** Helligkeit 0…1 eines Scheinwerfers inkl. Grand Master/Blackout (Farbsumme zählt mit). */
export function lightLevel(type, lv, levels) {
  if (levels.blackout) return 0;
  let k = lv.dimmer * levels.grandMaster;
  const model = type?.colorModel ?? 'none';
  if (model !== 'none' && model !== 'cct') {
    const sum = Math.max(lv.r, lv.g, lv.b, model === 'rgb' ? 0 : lv.w, model === 'rgbaw' ? lv.a : 0);
    k *= Math.min(1, sum);
  }
  return k;
}

export const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
