// Kanal-Erkunder: unbekanntes Gerät Kanal für Kanal ausprobieren und daraus einen Gerätetyp bauen.
import { api } from '../api.js';
import { emit, socket, store } from '../store.js';
import { h } from '../util/dom.js';

export const ROLE_LABELS = {
  dimmer: 'Helligkeit (Dimmer)',
  red: 'Rot',
  green: 'Grün',
  blue: 'Blau',
  white: 'Weiß',
  amber: 'Amber',
  uv: 'UV',
  cct: 'Farbtemperatur',
  warm: 'Warmweiß',
  cold: 'Kaltweiß',
  strobe: 'Blitz/Strobe',
  zoom: 'Zoom',
  pan: 'Schwenken (Pan)',
  tilt: 'Neigen (Tilt)',
  program: 'Programm/Makro (nicht nutzen)',
  other: 'Unbekannt/Sonstiges',
};

function colorModelFor(roles) {
  const has = (r) => roles.includes(r);
  if (has('red') && has('green') && has('blue')) {
    if (has('amber') && has('white')) return 'rgbaw';
    return has('white') ? 'rgbw' : 'rgb';
  }
  if (has('cct') || (has('warm') && has('cold'))) return 'cct';
  return 'none';
}

export function channelExplorer(w, { onDone, onCancel }) {
  const ex = w.explorer;
  const base = w.draft.address;
  const send = () => {
    const channels = {};
    for (let i = 0; i < ex.count; i++) if (base + i <= 512) channels[base + i] = ex.values[i] ?? 0;
    socket.send({ type: 'set_raw', channels, clear: true, solo: true });
  };

  const count = h('input', { type: 'number', min: 1, max: 32, value: ex.count });
  count.addEventListener('change', () => { ex.count = Math.max(1, Math.min(32, Number(count.value) || 1)); onDone(); });

  const rows = [];
  for (let i = 0; i < ex.count; i++) {
    const slider = h('input', { type: 'range', min: 0, max: 255, value: ex.values[i] ?? 0 });
    const out = h('output', {}, ex.values[i] ?? 0);
    slider.addEventListener('input', () => { ex.values[i] = Number(slider.value); out.textContent = slider.value; send(); });
    const role = h('select', { onchange: (e) => { ex.roles[i] = e.target.value; } },
      Object.entries(ROLE_LABELS).map(([k, l]) => h('option', { value: k, selected: (ex.roles[i] ?? (i === 0 ? 'dimmer' : 'other')) === k }, l)));
    ex.roles[i] = ex.roles[i] ?? (i === 0 ? 'dimmer' : 'other');
    rows.push(h('div', { class: 'explorer-row' }, h('b', {}, `${i + 1}`), slider, out, role));
  }

  const name = h('input', { type: 'text', placeholder: 'z. B. „Cameo Flat 8-Kanal“', value: ex.name ?? '', style: { width: '100%' } });
  name.addEventListener('input', () => { ex.name = name.value; });

  async function save() {
    const label = name.value.trim();
    if (!label) return emit('toast', { text: 'Bitte einen Namen für den Gerätetyp eingeben.' });
    const roles = ex.roles.slice(0, ex.count);
    let id = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'eigener-typ';
    while (store.types[id]) id += '-2';
    const type = {
      id,
      name: label,
      manufacturer: 'eigener',
      mode: `${ex.count}ch`,
      channels: roles.map((r, i) => ({
        name: ROLE_LABELS[r].split(' (')[0] + (roles.filter((x) => x === r).length > 1 ? ` ${i + 1}` : ''),
        role: r,
        default: 0,
        highlight: ['strobe', 'program', 'other', 'pan', 'tilt', 'zoom', 'uv'].includes(r) ? 0 : r === 'cct' ? 128 : 255,
      })),
      beam: { kind: 'par', angleDeg: 30 },
      render: { shape: w.draft.shape ?? 'square', color: '#1c1c1c' },
      colorModel: colorModelFor(roles),
    };
    await api.post('/api/fixture-types', type);
    w.draft.typeId = id;
    w.explorer = null;
    socket.send({ type: 'clear_raw' });
    emit('toast', { text: `Gerätetyp „${label}“ angelegt.` });
    onDone();
  }

  send();
  return h('div', {},
    h('h2', {}, 'Kanäle erkunden'),
    h('p', {}, `Ab Adresse ${base}: Schiebe jeden Regler hoch und schau, was der Scheinwerfer macht. Wähle rechts, wofür der Kanal ist.`),
    h('div', { class: 'tip' }, 'Viele Geräte leuchten erst, wenn Helligkeit UND eine Farbe hochgeschoben sind. Kanal 1 ist meistens die Helligkeit. Reagiert ein Kanal gar nicht mehr, ist das Gerät dort zu Ende – dann die Anzahl verringern.'),
    h('label', { class: 'row small' }, 'Anzahl Kanäle', count),
    h('div', { class: 'stack', style: { gap: '4px', margin: '10px 0' } }, rows),
    h('label', { class: 'field' }, 'Name des neuen Gerätetyps', name),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn primary', onclick: save }, 'Als Gerätetyp speichern'),
      h('button', { class: 'btn', onclick: onCancel }, 'Abbrechen')));
}
