// Untertab „Ablauf“ einer Produktion: Editor für die Einträge (Cues) und Show-Modus.
import { api } from '../api.js';
import { activeProduction, applyShow, emit, on, store } from '../store.js';
import { clear, h } from '../util/dom.js';
import { createShowMode } from './show-mode.js';

const NOTE_ONLY = '';
const MISSING = '__missing';

export function mountCuesTab(root) {
  const base = () => `/api/productions/${store.activeProductionId}`;
  // Cues, deren Szene gelöscht wurde: Der Server macht daraus Notiz-Cues (sceneId → null).
  // Wir merken uns den alten Szenennamen, damit der Eintrag als „Szene fehlt“ markiert bleibt,
  // bis eine Szene oder ausdrücklich „nur Notiz“ gewählt wird.
  const missing = new Map();  // cueId → Name der gelöschten Szene
  let visible = false;  // Untertab sichtbar (show/hide aus dem Produktionen-Tab)

  function describe(p, cue) {
    const scene = cue.sceneId ? p.scenes.find((s) => s.id === cue.sceneId) ?? null : null;
    if (scene) return { scene, label: scene.name, missing: false };
    if (cue.sceneId || missing.has(cue.id)) {
      const name = missing.get(cue.id);
      return { scene: null, label: `Szene fehlt${name ? ` („${name}“)` : ''}`, missing: true };
    }
    return { scene: null, label: 'nur Notiz', missing: false };
  }

  // ---- Editor ----
  const tbody = h('tbody');
  const table = h('table', { class: 'cue-table' },
    h('thead', {}, h('tr', {},
      h('th', { class: 'nr' }, 'Nr.'), h('th', {}, 'Szene'), h('th', {}, 'Fade (s)'), h('th', {}, 'Notiz'), h('th', {}))),
    tbody);
  const emptyText = h('p', { class: 'muted' }, 'Noch keine Einträge. Lege mit „+ Eintrag“ den ersten an.');
  const btnStart = h('button', {
    class: 'btn primary big',
    title: 'Ersten Eintrag abrufen und in den Show-Modus wechseln',
    onclick: (e) => { e.currentTarget.blur(); api.post('/api/show/start', { productionId: store.activeProductionId }); },
  }, 'Show starten ▶');
  const editor = h('div', { class: 'stack', style: { gap: '16px' } },
    h('div', { class: 'card stack' },
      h('div', { class: 'row' },
        h('h2', { style: { margin: 0, flex: 1 } }, 'Ablauf'),
        h('button', { class: 'btn', onclick: addCue }, '+ Eintrag'),
        btnStart),
      h('p', { class: 'muted small', style: { margin: 0 } },
        'Jeder Eintrag ruft eine Szene der Produktion ab (Fade leer = Überblendzeit der Szene) oder ist eine reine Notiz, '
        + 'die das Licht nicht ändert. Eine Szene darf mehrfach vorkommen.')),
    h('div', { class: 'card cue-card' }, table, emptyText));

  const show = createShowMode({ describe });
  root.append(editor, show.el);

  const rows = new Map();  // cueId → { tr, update(cue, i, n) }

  function makeRow(cueId) {
    const nr = h('td', { class: 'nr' });
    const scene = h('select', { onchange: () => {
      missing.delete(cueId);
      if (scene.value === MISSING) return;
      save(cueId, { sceneId: scene.value || null });
    } });
    const fade = h('input', {
      type: 'number', min: 0, max: 120, step: 0.5,
      onchange: () => save(cueId, { fadeSeconds: fade.value === '' ? null : Number(fade.value) }),
    });
    let noteTimer;
    const note = h('input', {
      type: 'text', maxlength: 300, placeholder: 'z. B. „Stichwort: Eisenbahn“',
      oninput: () => { clearTimeout(noteTimer); noteTimer = setTimeout(() => save(cueId, { note: note.value }), 600); },
      onchange: () => { clearTimeout(noteTimer); save(cueId, { note: note.value }); },
      onkeydown: (e) => { if (e.key === 'Enter') note.blur(); },
    });
    const up = h('button', { class: 'btn small', title: 'Nach oben', onclick: () => move(cueId, -1) }, '↑');
    const down = h('button', { class: 'btn small', title: 'Nach unten', onclick: () => move(cueId, 1) }, '↓');
    const del = h('button', { class: 'btn small danger', onclick: () => remove(cueId) }, 'Löschen');
    const tr = h('tr', {},
      nr,
      h('td', { class: 'scene-cell' }, scene),
      h('td', {}, fade),
      h('td', { class: 'note-cell' }, note),
      h('td', { class: 'actions' }, h('div', { class: 'row' }, up, down, del)));

    // Felder mit Fokus nicht überschreiben, damit Eingaben (auch aus anderen Browsern) nicht verloren gehen.
    const idle = (input) => document.activeElement !== input;
    function update(p, cue, i) {
      const d = describe(p, cue);
      nr.textContent = i + 1;
      tr.classList.toggle('missing', d.missing);
      if (idle(scene)) {
        clear(scene,
          d.missing ? h('option', { value: MISSING, selected: true }, `⚠ ${d.label}`) : null,
          h('option', { value: NOTE_ONLY, selected: !d.missing && !cue.sceneId }, '– nur Notiz –'),
          p.scenes.map((s, n) => h('option', { value: s.id, selected: s.id === cue.sceneId }, `${n + 1}. ${s.name}`)));
      }
      if (idle(fade)) fade.value = cue.fadeSeconds ?? '';
      fade.placeholder = d.scene ? `${d.scene.fadeSeconds} (Szene)` : '–';
      fade.disabled = !d.scene;
      if (idle(note)) note.value = cue.note;
      up.disabled = i === 0;
      down.disabled = i === p.cues.length - 1;
    }
    return { tr, update };
  }

  function renderEditor() {
    const p = activeProduction();
    if (!p) return;
    const ids = new Set(p.cues.map((c) => c.id));
    for (const id of rows.keys()) if (!ids.has(id)) rows.delete(id);
    const trs = p.cues.map((cue, i) => {
      if (!rows.has(cue.id)) rows.set(cue.id, makeRow(cue.id));
      const row = rows.get(cue.id);
      row.update(p, cue, i);
      return row.tr;
    });
    // Nur umsortieren, wenn nötig (sonst verliert ein fokussiertes Feld den Fokus).
    if (trs.length !== tbody.children.length || trs.some((tr, i) => tbody.children[i] !== tr)) tbody.replaceChildren(...trs);
    table.hidden = !p.cues.length;
    emptyText.hidden = p.cues.length > 0;
    btnStart.disabled = !p.cues.length;
  }

  async function save(cueId, body) {
    try {
      await api.put(`${base()}/cues/${cueId}`, body);
    } catch (e) {
      emit('toast', { text: e.message, error: true });
      renderEditor();  // Anzeige auf den gespeicherten Stand zurücksetzen
    }
  }

  async function addCue() {
    const p = activeProduction();
    if (!p) return;
    // Vorschlag: die Szene nach der des letzten Eintrags, sonst die erste
    const lastScene = [...p.cues].reverse().find((c) => c.sceneId)?.sceneId;
    const idx = p.scenes.findIndex((s) => s.id === lastScene);
    const sceneId = p.scenes[idx + 1]?.id ?? p.scenes[0]?.id ?? null;
    await api.post(`${base()}/cues`, { sceneId, note: '' });
  }

  async function move(cueId, d) {
    const ids = activeProduction().cues.map((c) => c.id);
    const i = ids.indexOf(cueId);
    if (i + d < 0 || i + d >= ids.length) return;
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    await api.post(`${base()}/cues/reorder`, { ids });
  }

  async function remove(cueId) {
    const p = activeProduction();
    const i = p.cues.findIndex((c) => c.id === cueId);
    if (!confirm(`Eintrag ${i + 1} löschen?`)) return;
    await api.del(`${base()}/cues/${cueId}`);
    missing.delete(cueId);
  }

  // ---- Zustand ----
  let prev = new Map();  // pid → { cues, scenes } vom letzten Stand, um gelöschte Szenen zu erkennen
  function trackMissing() {
    for (const p of store.productions) {
      const old = prev.get(p.id);
      if (!old) continue;
      const sceneIds = new Set(p.scenes.map((s) => s.id));
      for (const cue of p.cues) {
        const was = old.cues.find((c) => c.id === cue.id)?.sceneId;
        if (was && !cue.sceneId && !sceneIds.has(was)) missing.set(cue.id, old.scenes.find((s) => s.id === was)?.name ?? '');
      }
    }
    prev = new Map(store.productions.map((p) => [p.id, { cues: p.cues, scenes: p.scenes }]));
  }

  function render() {
    const running = store.show.running;
    editor.hidden = running;
    show.el.hidden = !running;
    if (running) { if (visible) show.render(); }
    else { show.reset(); renderEditor(); }
  }

  on('productions', () => { trackMissing(); render(); });
  on('show', render);
  trackMissing();
  render();

  // Reload: Show-Zustand per GET /api/show wiederherstellen (ein inzwischen eingetroffenes WS-Event hat Vorrang).
  let showEvents = 0;
  on('show', () => { showEvents += 1; });
  const before = showEvents;
  api.get('/api/show').then((st) => { if (showEvents === before) applyShow(st); }).catch(() => {});

  return {
    show() { visible = true; show.reset(); render(); },
    hide() { visible = false; },
    key(e) {
      if (store.show.running) show.key(e);
    },
  };
}
