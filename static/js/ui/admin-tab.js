// Tab „Einrichtung“: geführte Tour plus Expertenseiten.
import { api } from '../api.js';
import { emit, on, socket, store } from '../store.js';
import { clear, download, h } from '../util/dom.js';
import { ROLE_LABELS } from './channel-explorer.js';
import { isBackup, readJsonFile } from './transfer.js';
import { createWizard } from './wizard.js';

const PAGES = [
  ['wizard', '🧭 Geführte Einrichtung'],
  ['fixtures', 'Scheinwerfer-Liste'],
  ['types', 'Gerätetypen'],
  ['stage', 'Bühnenmaße'],
  ['monitor', 'DMX-Monitor'],
  ['backup', 'Sicherung'],
];

export function mountAdminTab(root, view) {
  const nav = h('nav', { class: 'admin-nav' });
  const body = h('div', { class: 'admin-body' });
  root.append(h('div', { class: 'admin-layout' }, nav, body));

  // Seite „Geführte Einrichtung“: 3D links, Wizard rechts
  const viewHost = h('div', { style: { display: 'contents' } });
  const wizardPanel = h('div', { class: 'wizard' });
  const pages = {
    wizard: h('div', { class: 'admin-page split' }, viewHost, wizardPanel),
    fixtures: h('div', { class: 'admin-page' }),
    types: h('div', { class: 'admin-page' }),
    stage: h('div', { class: 'admin-page' }),
    monitor: h('div', { class: 'admin-page' }),
    backup: h('div', { class: 'admin-page' }),
  };
  body.append(...Object.values(pages));
  const wizard = createWizard(wizardPanel, view);
  let page = 'wizard';
  let active = false;

  function showPage(name) {
    if (page === 'wizard' && name !== 'wizard') wizard.hide();
    if (page === 'monitor' && name !== 'monitor') socket.send({ type: 'subscribe_frame', on: false });
    page = name;
    for (const [k, el] of Object.entries(pages)) el.hidden = k !== name;
    for (const b of nav.children) b.classList.toggle('active', b.dataset.page === name);
    if (name === 'wizard') {
      view.attach(viewHost);
      view.el.style.gridArea = '';
      wizard.show();
    }
    if (name === 'monitor') socket.send({ type: 'subscribe_frame', on: true });
    renderPage();
  }

  nav.append(...PAGES.map(([k, l]) => h('button', { 'data-page': k, onclick: () => showPage(k) }, l)));

  function renderPage() {
    if (!active) return;
    ({ fixtures: renderFixtures, types: renderTypes, stage: renderStage, monitor: renderMonitor, backup: renderBackup })[page]?.();
  }

  // ------------------------------------------------------------ Scheinwerfer-Liste

  function renderFixtures() {
    const typeOpts = Object.values(store.types);
    const conflictIds = new Set(store.conflicts.flatMap((c) => c.fixtures));
    const save = async (fx, patch) => {
      const next = { ...fx, ...patch };
      delete next.position;
      delete next.footprint;
      await api.put(`/api/fixtures/${fx.id}`, next);
    };
    clear(pages.fixtures,
      h('h2', {}, 'Scheinwerfer-Liste'),
      h('p', { class: 'muted' }, 'Direkt bearbeiten. Position und Ausrichtung am einfachsten über die geführte Einrichtung.'),
      store.conflicts.length ? h('div', { class: 'card', style: { borderColor: '#7a2424', marginBottom: '12px' } }, store.conflicts.map((c) => h('div', {}, '⚠ ', c.message))) : null,
      h('table', { class: 'data' },
        h('tr', {}, ['Nr.', 'Name', 'Adresse', 'Gerätetyp', 'Kanäle', 'Aktiv', 'Geprüft', ''].map((x) => h('th', {}, x))),
        store.rig.fixtures.map((fx) => {
          const t = store.types[fx.typeId];
          return h('tr', { class: conflictIds.has(fx.id) ? 'conflict' : '' },
            h('td', {}, fx.id),
            h('td', {}, h('input', { type: 'text', value: fx.name, onchange: (e) => save(fx, { name: e.target.value }) })),
            h('td', {}, h('input', { type: 'number', min: 1, max: 512, value: fx.address, onchange: (e) => save(fx, { address: Number(e.target.value) }) })),
            h('td', {}, h('select', { onchange: (e) => save(fx, { typeId: e.target.value }) },
              typeOpts.map((ty) => h('option', { value: ty.id, selected: ty.id === fx.typeId }, ty.name)))),
            h('td', {}, t ? `${fx.address}–${fx.address + t.channels.length - 1}` : '?'),
            h('td', {}, h('input', { type: 'checkbox', checked: fx.enabled, onchange: (e) => save(fx, { enabled: e.target.checked }) })),
            h('td', {}, fx.verified ? '✔' : '–'),
            h('td', {}, h('div', { class: 'row' },
              h('button', { class: 'btn small', onclick: () => socket.send({ type: 'identify', fixtureId: fx.id, on: !store.raw.identify.includes(fx.id) }) },
                store.raw.identify.includes(fx.id) ? 'Stopp' : 'Blinken'),
              h('button', {
                class: 'btn small danger',
                onclick: async () => { if (confirm(`„${fx.name}“ entfernen?`)) await api.del(`/api/fixtures/${fx.id}`); },
              }, '🗑'))));
        })),
      h('div', { class: 'row', style: { marginTop: '16px' } },
        h('button', {
          class: 'btn danger',
          onclick: async () => {
            if (confirm('Alle Scheinwerfer auf den Stand vom Foto zurücksetzen? Eigene Änderungen gehen verloren.')) await api.post('/api/rig/reset-default');
          },
        }, 'Auf Foto-Stand zurücksetzen')));
  }

  // ------------------------------------------------------------ Gerätetypen

  let editType = null;
  function renderTypes() {
    const types = Object.values(store.types);
    const list = h('table', { class: 'data' },
      h('tr', {}, ['Name', 'Kanäle', 'Farbe', 'Verwendet', ''].map((x) => h('th', {}, x))),
      types.map((t) => {
        const used = store.rig.fixtures.filter((f) => f.typeId === t.id).length;
        return h('tr', {},
          h('td', {}, t.name, t.builtin ? h('span', { class: 'muted small' }, ' · eingebaut') : null),
          h('td', { class: 'small' }, t.channels.map((c, i) => `${i + 1}:${c.name}`).join(' · ')),
          h('td', {}, t.colorModel),
          h('td', {}, used || '–'),
          h('td', {}, h('div', { class: 'row' },
            h('button', {
              class: 'btn small',
              onclick: async () => {
                const name = prompt('Name der Kopie', `${t.name} (Kopie)`);
                if (name) { const c = await api.post(`/api/fixture-types/${t.id}/duplicate`, { name }); editType = structuredClone(c); renderTypes(); }
              },
            }, 'Kopieren'),
            t.builtin ? null : h('button', { class: 'btn small', onclick: () => { editType = structuredClone(t); renderTypes(); } }, 'Bearbeiten'),
            t.builtin ? null : h('button', {
              class: 'btn small danger',
              onclick: async () => { if (confirm(`Typ „${t.name}“ löschen?`)) await api.del(`/api/fixture-types/${t.id}`); },
            }, '🗑'))));
      }));
    clear(pages.types,
      h('h2', {}, 'Gerätetypen'),
      h('p', { class: 'muted' }, 'Eingebaute Typen kann man kopieren und die Kopie anpassen. Neue Typen entstehen am einfachsten in der geführten Einrichtung über „Kanäle selbst erkunden“.'),
      editType ? typeEditor() : null,
      list);
  }

  function typeEditor() {
    const t = editType;
    const chans = h('div', {});
    const draw = () => clear(chans, t.channels.map((c, i) => h('div', { class: 'chan' },
      h('b', {}, i + 1),
      h('input', { type: 'text', value: c.name, oninput: (e) => { c.name = e.target.value; } }),
      h('select', { onchange: (e) => { c.role = e.target.value; } },
        Object.entries(ROLE_LABELS).map(([k, l]) => h('option', { value: k, selected: c.role === k }, l))),
      h('input', { type: 'number', min: 0, max: 255, value: c.default, title: 'Grundwert', oninput: (e) => { c.default = Number(e.target.value); } }),
      h('input', { type: 'number', min: 0, max: 255, value: c.highlight, title: 'Wert beim Testen', oninput: (e) => { c.highlight = Number(e.target.value); } }),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', disabled: i === 0, onclick: () => { [t.channels[i - 1], t.channels[i]] = [t.channels[i], t.channels[i - 1]]; draw(); } }, '↑'),
        h('button', { class: 'btn small danger', onclick: () => { t.channels.splice(i, 1); draw(); } }, '✕')))));
    draw();
    return h('div', { class: 'card type-editor', style: { marginBottom: '16px' } },
      h('h3', {}, `Bearbeiten: ${t.name}`),
      h('div', { class: 'row' },
        h('label', { class: 'field' }, 'Name', h('input', { type: 'text', value: t.name, oninput: (e) => { t.name = e.target.value; } })),
        h('label', { class: 'field' }, 'Farbmodell', h('select', { onchange: (e) => { t.colorModel = e.target.value; } },
          ['none', 'rgb', 'rgbw', 'rgbaw', 'cct'].map((m) => h('option', { value: m, selected: t.colorModel === m }, m)))),
        h('label', { class: 'field' }, 'Kegel (°)', h('input', { type: 'number', min: 2, max: 160, value: t.beam.angleDeg, oninput: (e) => { t.beam.angleDeg = Number(e.target.value); } })),
        h('label', { class: 'field' }, 'Form', h('select', { onchange: (e) => { t.render.shape = e.target.value; } },
          [['round', 'rund'], ['square', 'eckig'], ['profile', 'Profiler']].map(([v, l]) => h('option', { value: v, selected: t.render.shape === v }, l))))),
      h('p', { class: 'muted small', style: { marginTop: '10px' } }, 'Kanal · Name · Funktion · Grundwert · Testwert'),
      chans,
      h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'btn small', onclick: () => { t.channels.push({ name: `Kanal ${t.channels.length + 1}`, role: 'other', default: 0, highlight: 0 }); draw(); } }, '+ Kanal'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => { editType = null; renderTypes(); } }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            const { footprint, ...payload } = t;
            await api.put(`/api/fixture-types/${t.id}`, payload);
            editType = null;
            emit('toast', { text: 'Gerätetyp gespeichert.' });
            renderTypes();
          },
        }, 'Speichern')));
  }

  // ------------------------------------------------------------ Bühnenmaße

  function renderStage() {
    const st = structuredClone(store.stage);
    const num = (label, obj, key, step = 0.05) => h('label', { class: 'field' }, label,
      h('input', { type: 'number', step, value: obj[key], oninput: (e) => { obj[key] = Number(e.target.value); } }));
    clear(pages.stage,
      h('h2', {}, 'Bühnenmaße'),
      h('p', { class: 'muted' }, 'Alle Angaben in Metern. Ursprung: Mitte der Bühnenvorderkante auf Saalbodenhöhe. Die Werte sind vom Foto geschätzt – nachmessen lohnt sich vor allem für das Rohr (Lichtbogen).'),
      h('div', { class: 'card stack' },
        h('h3', {}, 'Podest'),
        h('div', { class: 'row' }, num('Breite', st, 'stageWidth'), num('Tiefe', st, 'stageDepth'), num('Höhe', st, 'stageHeight', 0.01)),
        h('h3', {}, 'Rohr mit Scheinwerfern (Lichtbogen)'),
        h('div', { class: 'row' }, num('Radius', st.lightArc, 'r'), num('Mittelpunkt z', st.lightArc, 'cz'), num('Höhe', st.lightArc, 'y'),
          num('Öffnungswinkel ±°', st.lightArc, 'phiMaxDeg', 0.5), num('Scheinwerfer hängen tiefer um', st.lightArc, 'fixtureDrop', 0.01)),
        h('h3', {}, 'Vorderkante (Bogen)'),
        h('div', { class: 'row' }, num('Radius', st.frontArc, 'r'), num('Mittelpunkt z', st.frontArc, 'cz')),
        h('h3', {}, 'Gewölbe'),
        h('div', { class: 'row' }, num('halbe Breite', st.vault, 'halfWidth'), num('Kämpferhöhe', st.vault, 'springY'), num('Scheitelhöhe', st.vault, 'apexY'))),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn primary', onclick: async () => { await api.put('/api/stage', st); emit('toast', { text: 'Bühne gespeichert.' }); } }, 'Speichern'),
        h('button', { class: 'btn danger', onclick: async () => { if (confirm('Bühnenmaße auf Foto-Schätzung zurücksetzen?')) await api.post('/api/stage/reset-default'); } }, 'Zurücksetzen')));
  }

  // ------------------------------------------------------------ DMX-Monitor

  const cells = [];
  let monitorBuilt = false;
  function renderMonitor() {
    if (!monitorBuilt) {
      const grid = h('div', { class: 'dmx-grid' });
      for (let i = 0; i < 512; i++) {
        const fill = h('div', { class: 'fill' });
        const v = h('div', { class: 'v' }, '0');
        const cell = h('div', { class: 'dmx-cell', title: `Kanal ${i + 1}` }, fill, h('div', { class: 'n' }, i + 1), v);
        cells.push({ cell, fill, v });
        grid.append(cell);
      }
      const ch = h('input', { type: 'number', min: 1, max: 512, value: 1 });
      const val = h('input', { type: 'range', min: 0, max: 255, value: 0, style: { width: '220px' } });
      const out = h('output', {}, '0');
      val.addEventListener('input', () => { out.textContent = val.value; socket.send({ type: 'set_raw', channels: { [ch.value]: Number(val.value) } }); });
      pages.monitor.append(
        h('h2', {}, 'DMX-Monitor'),
        h('p', { class: 'muted' }, 'Zeigt live, was an das Interface geht (5× pro Sekunde). Blau hinterlegt = von einem Scheinwerfer belegt.'),
        h('div', { class: 'card row', style: { marginBottom: '12px' } },
          h('b', {}, 'Einzelkanal testen:'), 'Kanal', ch, val, out,
          h('button', { class: 'btn small', onclick: () => { val.value = 0; out.textContent = '0'; socket.send({ type: 'clear_raw' }); } }, 'Alle Tests aus')),
        grid);
      monitorBuilt = true;
    }
    const used = new Set();
    for (const f of store.rig.fixtures) {
      const n = store.types[f.typeId]?.channels.length ?? 1;
      for (let i = 0; i < n; i++) used.add(f.address - 1 + i);
    }
    cells.forEach((c, i) => c.cell.classList.toggle('used', used.has(i)));
  }

  on('frame', (data) => {
    if (!active || page !== 'monitor') return;
    for (let i = 0; i < 512; i++) {
      const c = cells[i];
      if (!c) break;
      c.v.textContent = data[i];
      c.fill.style.height = `${(data[i] / 255) * 100}%`;
    }
  });

  // ------------------------------------------------------------ Sicherung

  function renderBackup() {
    const file = h('input', { type: 'file', accept: 'application/json,.json' });
    clear(pages.backup,
      h('h2', {}, 'Sicherung'),
      h('div', { class: 'card stack' },
        h('p', {}, 'Speichert Scheinwerfer, Gerätetypen, Bühne, die Szenen-Bibliothek und alle Produktionen '
          + '(mit ihren Szenen und dem Ablauf) in eine Datei.'),
        h('p', { class: 'muted small' }, 'Einzelne Produktionen oder Szenen lassen sich auch direkt in den Tabs '
          + '„Produktionen“ und „Szenen“ exportieren und importieren.'),
        h('div', {}, h('button', { class: 'btn primary', onclick: async () => download(`lichtpult-sicherung-${new Date().toISOString().slice(0, 10)}.json`, await api.get('/api/export')) }, 'Sicherung herunterladen'))),
      h('div', { class: 'card stack', style: { marginTop: '12px' } },
        h('p', {}, 'Sicherung wiederherstellen (überschreibt den aktuellen Stand einschließlich der Produktionen):'),
        h('div', { class: 'row' }, file, h('button', {
          class: 'btn danger',
          onclick: async () => {
            const f = file.files[0];
            if (!f) return emit('toast', { text: 'Bitte zuerst eine Datei wählen.' });
            const read = await readJsonFile(f);
            if (!read) return;
            const { data } = read;
            if (!isBackup(data)) {
              const hint = data?.format === 'lichtpult-production' ? ' Eine Produktion bitte im Tab „Produktionen“ importieren.'
                : data?.format === 'lichtpult-scenes' ? ' Szenen bitte im Tab „Szenen“ oder bei einer Produktion importieren.' : '';
              return emit('toast', { text: `„${f.name}“ ist keine Lichtpult-Sicherung.${hint}`, error: true });
            }
            delete data['state.json'];
            const withProductions = 'productions.json' in data;
            const msg = withProductions
              ? 'Aktuellen Stand wirklich ersetzen? Auch alle Produktionen werden durch die aus der Sicherung ersetzt.'
              : 'Aktuellen Stand wirklich ersetzen? Diese ältere Sicherung enthält keine Produktionen – die vorhandenen Produktionen bleiben unverändert.';
            if (!confirm(msg)) return;
            try {
              await api.post('/api/import', data);
            } catch (e) {
              return emit('toast', { text: `Wiederherstellen fehlgeschlagen: ${e.message.replace(/^Import fehlgeschlagen:\s*/, '')}`, error: true });
            }
            emit('toast', { text: withProductions ? 'Sicherung wiederhergestellt (inkl. Produktionen).' : 'Sicherung wiederhergestellt.' });
          },
        }, 'Wiederherstellen'))));
  }

  on('rig', () => { if (active && page !== 'wizard') renderPage(); });
  on('types', () => { if (active && page === 'types' && !editType) renderTypes(); });
  on('raw', () => { if (active && page === 'fixtures') renderFixtures(); });
  on('stage', () => { if (active && page === 'stage') renderStage(); });

  return {
    show() { active = true; showPage(page); },
    hide() {
      active = false;
      wizard.hide();
      socket.send({ type: 'subscribe_frame', on: false });
      socket.send({ type: 'clear_raw' });
    },
  };
}
