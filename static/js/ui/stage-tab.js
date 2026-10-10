// Tab „Bühne“: Scheinwerfer im 3D-Bild anklicken und Helligkeit/Farbe stellen.
import { emit, fixtureById, levelOf, on, select, setLevels, socket, store, typeOf } from '../store.js';
import { clear, h, pct } from '../util/dom.js';
import { cctToKelvin, lightColor, toHex } from '../util/fixture.js';

const PRESETS = [
  ['Weiß', { r: 1, g: 1, b: 1, w: 1, a: 0 }],
  ['Warm', { r: 1, g: 0.55, b: 0.15, w: 1, a: 0.6 }],
  ['Rot', { r: 1, g: 0, b: 0, w: 0, a: 0 }],
  ['Orange', { r: 1, g: 0.35, b: 0, w: 0, a: 0.5 }],
  ['Gelb', { r: 1, g: 0.85, b: 0, w: 0, a: 0 }],
  ['Grün', { r: 0, g: 1, b: 0, w: 0, a: 0 }],
  ['Blau', { r: 0, g: 0.2, b: 1, w: 0, a: 0 }],
  ['Magenta', { r: 1, g: 0, b: 0.8, w: 0, a: 0 }],
];

export function mountStageTab(root, view) {
  const viewHost = h('div', { style: { display: 'contents' } });
  const side = h('aside', { class: 'stage-side' });
  const strip = h('div', { class: 'strip' });
  root.append(h('div', { class: 'stage-layout' }, viewHost, side, strip));

  let active = false;
  let identifying = new Set();

  // ---------------------------------------------------------------- Seitenleiste
  const selInfo = h('div', { class: 'sel-info' });
  const groupRow = h('div', { class: 'row' });
  const fader = h('input', { type: 'range', min: 0, max: 100, value: 0 });
  const faderOut = h('output', {}, '0 %');
  const colorBox = h('section');
  const toolsRow = h('div', { class: 'row' });
  const btnIdentify = h('button', { class: 'btn', title: 'Lässt die ausgewählten Scheinwerfer im Saal blinken' }, 'Blinken lassen');

  side.append(
    h('section', {}, h('h3', {}, 'Auswahl'), selInfo, groupRow),
    h('section', {}, h('h3', {}, 'Helligkeit'),
      h('div', { class: 'big-fader' }, fader, faderOut),
      h('div', { class: 'row' }, ...[0, 25, 50, 75, 100].map((v) =>
        h('button', { class: 'btn small', onclick: () => setSelected({ dimmer: v / 100 }) }, `${v} %`)))),
    colorBox,
    h('section', {}, h('h3', {}, 'Werkzeuge'), toolsRow),
    h('section', {}, h('h3', {}, 'Ganze Bühne'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => socket.send({ type: 'all', dimmer: 1, fade: 1.5 }) }, 'Alle an'),
        h('button', { class: 'btn', onclick: () => socket.send({ type: 'all', dimmer: 0, fade: 1.5 }) }, 'Alle aus (Fade)'),
        h('button', { class: 'btn', onclick: () => socket.send({ type: 'all', dimmer: 0 }) }, 'Alle sofort aus')),
      h('p', { class: 'muted small' }, 'Tipp: Klick auf einen Scheinwerfer wählt ihn aus, mit Umschalt mehrere. Taste A = alle, Esc = keine, B = Blackout.')),
  );
  toolsRow.append(btnIdentify);

  fader.addEventListener('input', () => {
    faderOut.textContent = `${fader.value} %`;
    setSelected({ dimmer: fader.value / 100 });
  });

  btnIdentify.addEventListener('click', () => {
    const ids = [...store.selection];
    const turnOn = !ids.every((id) => identifying.has(id)) && ids.length > 0;
    for (const id of new Set([...identifying, ...ids])) {
      const want = turnOn && ids.includes(id);
      if (want !== identifying.has(id)) socket.send({ type: 'identify', fixtureId: id, on: want });
    }
  });

  function setSelected(upd) {
    const ids = [...store.selection];
    if (!ids.length) return emit('toast', { text: 'Erst einen Scheinwerfer auswählen (im Bild anklicken).' });
    setLevels(Object.fromEntries(ids.map((id) => [id, upd])));
  }

  function renderGroups() {
    clear(groupRow,
      h('button', { class: 'btn small', onclick: () => select(store.rig.fixtures.map((f) => f.id)) }, 'Alle'),
      h('button', { class: 'btn small', onclick: () => select([]) }, 'Keine'),
      store.rig.groups.map((g) => h('span', {
        class: 'chip',
        onclick: (e) => select(store.rig.fixtures.filter((f) => f.groups.includes(g.id)).map((f) => f.id), e.shiftKey ? 'add' : 'set'),
      }, h('span', { class: 'dot', style: { background: g.color } }), g.name)),
      h('button', {
        class: 'btn small',
        title: 'Alle, die gerade leuchten',
        onclick: () => select(store.rig.fixtures.filter((f) => levelOf(f.id).dimmer > 0).map((f) => f.id)),
      }, 'Leuchtende'));
  }

  function renderSelection() {
    const ids = [...store.selection];
    view.setSelection(ids);
    if (!ids.length) selInfo.replaceChildren(h('span', { class: 'muted' }, 'Nichts ausgewählt – klicke einen Scheinwerfer im Bild an.'));
    else if (ids.length === 1) {
      const fx = fixtureById(ids[0]);
      const t = typeOf(fx);
      clear(selInfo, h('b', {}, fx.name), h('div', { class: 'muted small' }, `DMX ${fx.address}${t ? `–${fx.address + t.channels.length - 1}` : ''} · ${t?.name ?? fx.typeId}`));
    } else {
      clear(selInfo, h('b', {}, `${ids.length} Scheinwerfer`), h('div', { class: 'muted small' }, ids.map((id) => fixtureById(id)?.name).join(', ')));
    }
    btnIdentify.classList.toggle('active', ids.length > 0 && ids.every((id) => identifying.has(id)));
    renderColor();
    syncFader();
    for (const card of strip.children) card.classList.toggle('sel', store.selection.has(card.dataset.id));
  }

  function syncFader() {
    const ids = [...store.selection];
    if (document.activeElement === fader) return;
    const v = ids.length ? Math.max(...ids.map((id) => levelOf(id).dimmer)) : 0;
    fader.value = Math.round(v * 100);
    faderOut.textContent = `${fader.value} %`;
  }

  // ---------------------------------------------------------------- Farbe
  let colorInputs = [];
  function renderColor() {
    const fxs = [...store.selection].map(fixtureById).filter(Boolean);
    const models = new Set(fxs.map((f) => typeOf(f)?.colorModel ?? 'none'));
    colorInputs = [];
    clear(colorBox);
    const hasRgb = [...models].some((m) => m.startsWith('rgb'));
    const hasCct = models.has('cct');
    if (!hasRgb && !hasCct) return;
    colorBox.append(h('h3', {}, 'Farbe'));
    const lv = levelOf(fxs[0].id);
    if (hasRgb) {
      colorBox.append(h('div', { class: 'color-presets' }, PRESETS.map(([name, c]) =>
        h('button', { title: name, style: { background: toHex(lightColor({ colorModel: 'rgbaw' }, { ...c })) }, onclick: () => setSelected(c) }))));
      const chans = [['r', 'Rot'], ['g', 'Grün'], ['b', 'Blau']];
      if ([...models].some((m) => m === 'rgbw' || m === 'rgbaw')) chans.push(['w', 'Weiß']);
      if (models.has('rgbaw')) chans.push(['a', 'Amber']);
      for (const [k, label] of chans) colorBox.append(slider(label, k, lv[k], (v) => `${Math.round(v * 100)}`));
    }
    if (hasCct) colorBox.append(slider('Farbtemp.', 'cct', lv.cct, (v) => `${cctToKelvin(v)} K`));
  }

  function slider(label, key, value, fmt) {
    const input = h('input', { type: 'range', min: 0, max: 1000, value: Math.round(value * 1000) });
    const out = h('output', {}, fmt(value));
    input.addEventListener('input', () => {
      const v = input.value / 1000;
      out.textContent = fmt(v);
      setSelected({ [key]: v });
    });
    colorInputs.push({ input, out, key, fmt });
    return h('div', { class: 'slider-row' }, h('span', {}, label), input, out);
  }

  function syncColor() {
    const first = [...store.selection][0];
    if (!first) return;
    const lv = levelOf(first);
    for (const { input, out, key, fmt } of colorInputs) {
      if (document.activeElement === input) continue;
      input.value = Math.round(lv[key] * 1000);
      out.textContent = fmt(lv[key]);
    }
  }

  // ---------------------------------------------------------------- Fader-Leiste
  function renderStrip() {
    clear(strip, store.rig.fixtures.map((fx) => {
      const input = h('input', { type: 'range', min: 0, max: 100, value: Math.round(levelOf(fx.id).dimmer * 100) });
      const out = h('output', {}, pct(levelOf(fx.id).dimmer));
      const dot = h('span', { class: 'dot' });
      input.addEventListener('input', () => {
        out.textContent = `${input.value} %`;
        setLevels({ [fx.id]: { dimmer: input.value / 100 } });
      });
      const card = h('div', { class: 'fx', 'data-id': fx.id },
        h('div', { class: 'head', title: `${fx.name} – klicken zum Auswählen`, onclick: (e) => select([fx.id], e.shiftKey || e.ctrlKey ? 'toggle' : 'set') },
          fx.id.replace(/^f0?/, ''), ' ', fx.name),
        h('div', { class: 'sub' }, h('span', {}, `@${fx.address} `), dot),
        input, out);
      card._sync = () => {
        const lv = levelOf(fx.id);
        if (document.activeElement !== input) input.value = Math.round(lv.dimmer * 100);
        out.textContent = pct(lv.dimmer);
        dot.style.background = toHex(lightColor(typeOf(fx), lv));
      };
      card._sync();
      return card;
    }));
    renderSelection();
  }

  // ---------------------------------------------------------------- Ereignisse
  on('levels', (ev) => {
    for (const card of strip.children) if (!ev?.ids || ev.all || ev.ids.includes(card.dataset.id) || !ev.ids.length) card._sync?.();
    syncFader();
    syncColor();
    if (active) view.fixtures.update(store.levels, levelOf);
  });
  on('rig', () => { renderStrip(); renderGroups(); });
  on('types', renderStrip);
  on('selection', renderSelection);
  on('raw', () => {
    identifying = new Set(store.raw.identify);
    btnIdentify.classList.toggle('active', store.selection.size > 0 && [...store.selection].every((id) => identifying.has(id)));
  });
  on('view-rebuilt', () => { if (active) { view.fixtures.update(store.levels, levelOf); view.setSelection([...store.selection]); } });

  return {
    show() {
      active = true;
      view.attach(viewHost);
      // die Ansicht liegt in der Grid-Zelle „view“
      view.el.style.gridArea = 'view';
      view.setMode('select');
      view.setHint(null);
      view.setFocus(null);
      view.fixtures.setShowTargets(false);
      view.onPickFixture = (id, e) => select([id], e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'set');
      view.onPickEmpty = (e) => { if (!e.shiftKey) select([]); };
      view.tooltipFor = (id) => {
        const fx = fixtureById(id);
        return fx && `${fx.name} · DMX ${fx.address} · ${pct(levelOf(id).dimmer)}`;
      };
      view.fixtures.update(store.levels, levelOf);
      view.setSelection([...store.selection]);
    },
    hide() { active = false; },
    key(e) {
      if (e.key === 'a' || e.key === 'A') select(store.rig.fixtures.map((f) => f.id));
      else if (e.key === 'Escape') select([]);
    },
  };
}
