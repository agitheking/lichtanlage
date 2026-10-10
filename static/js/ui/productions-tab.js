// Tab „Produktionen“: mehrere Produktionen mit eigenen Szenen (Untertab „Szenen“) und Ablauf (Untertab „Ablauf“).
import { api } from '../api.js';
import { activeProduction, emit, on, store } from '../store.js';
import { clear, dialog, h } from '../util/dom.js';
import { mountCuesTab } from './cues-tab.js';
import { createSceneList } from './scene-list.js';
import { exportProduction, importProduction, sceneTransferButtons } from './transfer.js';

const SUBTABS = [['szenen', 'Szenen'], ['ablauf', 'Ablauf']];

export function mountProductionsTab(root) {
  const pid = () => store.activeProductionId;
  const base = () => `/api/productions/${pid()}`;

  // ---- Kopfzeile ----
  const select = h('select', {
    title: 'Aktive Produktion',
    onchange: () => api.post(`/api/productions/${select.value}/activate`),
  });
  const btnRename = h('button', { class: 'btn small', onclick: rename }, 'Umbenennen');
  const btnDelete = h('button', { class: 'btn small danger', onclick: remove }, 'Löschen');
  const btnExport = h('button', {
    class: 'btn small',
    title: 'Ganze Produktion (Szenen und Ablauf) als Datei speichern',
    onclick: () => activeProduction() && exportProduction(activeProduction()),
  }, 'Exportieren');
  const btnImport = h('button', { class: 'btn small', title: 'Produktion aus einer Datei laden', onclick: importProduction }, 'Importieren');
  const subnav = h('nav', { class: 'subtabs' },
    SUBTABS.map(([k, l]) => h('a', { href: `#produktionen/${k}`, 'data-sub': k }, l)));
  const header = h('div', { class: 'prod-header' },
    h('label', { class: 'row' }, h('span', { class: 'muted small' }, 'Produktion'), select),
    h('button', { class: 'btn small', onclick: create }, '+ Neu'),
    btnRename, btnDelete, btnExport, btnImport,
    h('div', { class: 'spacer' }),
    subnav);

  // ---- Untertab Szenen ----
  let lastRecalled = { pid: null, id: null };  // zuletzt abgerufene Szene, je Produktion (IDs sind nur dort eindeutig)
  const scenes = createSceneList({
    scenes: () => activeProduction()?.scenes ?? [],
    api: {
      recall: (id, othersOff) => api.post(`${base()}/scenes/${id}/recall`, { othersOff }),
      capture: (body) => api.post(`${base()}/scenes/capture`, body),
      update: (id, body) => api.put(`${base()}/scenes/${id}`, body),
      remove: (id) => api.del(`${base()}/scenes/${id}`),
      reorder: (ids) => api.post(`${base()}/scenes/reorder`, { ids }),
    },
    getActive: () => (lastRecalled.pid === pid() ? lastRecalled.id : null),
    setActive: (id) => { lastRecalled = { pid: pid(), id }; },
    headerExtras: [
      h('button', { class: 'btn small', onclick: copyFromLibrary }, 'Aus Bibliothek kopieren'),
      sceneTransferButtons({
        base: () => `${base()}/scenes`,
        filename: () => `${pid()}.szenen.json`,
        label: () => `„${activeProduction()?.name}“`,
        scenes: () => activeProduction()?.scenes ?? [],
        replaceHint: 'Ablauf-Einträge, deren Szene dabei wegfällt, bleiben als Notiz erhalten.',
      }),
    ],
    emptyText: 'Noch keine Szenen in dieser Produktion. Speichere oben das aktuelle Licht oder kopiere Szenen aus der Bibliothek.',
  });
  const empty = h('div', { class: 'card stack' },
    h('h2', {}, 'Noch keine Produktion'),
    h('p', { class: 'muted' }, 'Lege mit „+ Neu“ eine Produktion an, z. B. „Hamlet“.'));

  const panes = { szenen: h('div', { class: 'inner' }, scenes.el), ablauf: h('div', { class: 'inner' }) };
  const cues = mountCuesTab(panes.ablauf);
  const body = h('div', { class: 'scenes-layout prod-body' }, empty, ...Object.values(panes));
  root.append(h('div', { class: 'prod-layout' }, header, body));

  let sub = 'szenen';
  let visible = false;

  function render() {
    const has = store.productions.length > 0;
    clear(select, store.productions.map((p) => h('option', { value: p.id, selected: p.id === pid() }, p.name)));
    select.disabled = btnRename.disabled = btnDelete.disabled = btnExport.disabled = !has;
    empty.hidden = has;
    for (const [k, el] of Object.entries(panes)) el.hidden = !has || k !== sub;
    for (const a of subnav.children) a.classList.toggle('active', a.dataset.sub === sub);
    scenes.render();
  }

  async function create() {
    const name = prompt('Name der neuen Produktion', '')?.trim();
    if (!name) return;
    const p = await api.post('/api/productions', { name });
    await api.post(`/api/productions/${p.id}/activate`);
    emit('toast', { text: `Produktion „${p.name}“ angelegt.` });
  }

  async function rename() {
    const p = activeProduction();
    if (!p) return;
    const name = prompt('Neuer Name', p.name)?.trim();
    if (name && name !== p.name) await api.put(`/api/productions/${p.id}`, { name });
  }

  async function remove() {
    const p = activeProduction();
    if (!p) return;
    if (!confirm(`Produktion „${p.name}“ mit ${p.scenes.length} Szenen und ${p.cues.length} Ablauf-Einträgen löschen?`)) return;
    await api.del(`/api/productions/${p.id}`);
    emit('toast', { text: `Produktion „${p.name}“ gelöscht.` });
  }

  function copyFromLibrary() {
    if (!store.scenes.length) return emit('toast', { text: 'Die Bibliothek enthält keine Szenen.', error: true });
    const boxes = store.scenes.map((sc) => h('input', { type: 'checkbox', value: sc.id }));
    const all = h('input', {
      type: 'checkbox',
      onchange: () => boxes.forEach((b) => { b.checked = all.checked; }),
    });
    dialog(`Aus Bibliothek in „${activeProduction()?.name}“ kopieren`, [
      h('label', { class: 'check' }, all, h('b', {}, 'Alle auswählen')),
      h('div', { class: 'pick-list' }, store.scenes.map((sc, i) =>
        h('label', { class: 'check' }, boxes[i], `${i + 1}. ${sc.name}`))),
    ], [{
      label: 'Kopieren',
      class: 'primary',
      onclick: async () => {
        const sceneIds = boxes.filter((b) => b.checked).map((b) => b.value);
        if (!sceneIds.length) { emit('toast', { text: 'Bitte mindestens eine Szene auswählen.' }); return false; }
        const copies = await api.post(`${base()}/scenes/copy-from-library`, { sceneIds });
        emit('toast', { text: `${copies.length} ${copies.length === 1 ? 'Szene' : 'Szenen'} kopiert.` });
      },
    }]);
  }

  on('productions', render);
  render();

  // Der Ablauf erfährt per show/hide, ob er gerade sichtbar ist.
  let cuesShown = false;
  function syncCues() {
    const want = visible && sub === 'ablauf';
    if (want !== cuesShown) cues[want ? 'show' : 'hide']?.();
    cuesShown = want;
  }

  return {
    show() { visible = true; syncCues(); },
    hide() { visible = false; syncCues(); },
    route(name) {
      sub = SUBTABS.some(([k]) => k === name) ? name : 'szenen';
      render();
      syncCues();
    },
    key(e) {
      if (sub === 'szenen') {
        if (store.show.running) return;  // Kürzel 1–9 im Show-Modus aus
        const n = Number(e.key);
        if (n >= 1 && n <= 9) scenes.recallNumber(n);
      } else cues.key?.(e);
    },
  };
}
