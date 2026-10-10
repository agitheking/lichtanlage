// Geführte Einrichtung: Interface prüfen → Bestandsaufnahme → je Scheinwerfer
// Adresse finden, Typ, Position, Ausrichtung, Name → Abschluss.
import { api } from '../api.js';
import { emit, fixtureById, on, socket, store } from '../store.js';
import { clear, download, h } from '../util/dom.js';
import { arcPoint, beamAngle, colorTestValues, fixtureShape, highlightValues, rawChannels } from '../util/fixture.js';
import { channelExplorer } from './channel-explorer.js';

const SUBSTEPS = [
  ['address', 'DMX-Adresse'],
  ['type', 'Gerätetyp'],
  ['position', 'Position'],
  ['aim', 'Ausrichtung'],
  ['name', 'Name & Gruppen'],
  ['save', 'Prüfen & Speichern'],
];

const QUICK_TARGETS = [
  ['Bühnenmitte', [0, 0.4, -2.4]],
  ['Vorne Mitte', [0, 0.4, -0.8]],
  ['Links', [-2.2, 0.4, -2.2]],
  ['Rechts', [2.2, 0.4, -2.2]],
  ['Hinten Mitte', [0, 0.4, -3.8]],
];

const deep = (o) => JSON.parse(JSON.stringify(o));
const sendRaw = (channels, solo = true) => socket.send({ type: 'set_raw', channels, clear: true, solo });
const allOff = () => socket.send({ type: 'clear_raw' });

export function createWizard(panel, view) {
  const w = {
    step: 'start',
    mode: 'full', // full | single
    order: [],
    idx: 0,
    sub: 'address',
    draft: null,
    isNew: false,
    search: null,
    addrTab: 'read',
    explorer: null,
    readConfirm: null,
    chaseTimer: null,
    colorTimer: null,
  };
  let active = false;

  // ------------------------------------------------------------ Hilfen

  const typeOfDraft = () => store.types[w.draft?.typeId];

  function stopTimers() {
    clearInterval(w.chaseTimer);
    clearTimeout(w.colorTimer);
    w.chaseTimer = w.colorTimer = null;
  }

  function go(step) {
    stopTimers();
    allOff();
    w.step = step;
    w.search = null;
    w.explorer = null;
    render();
  }

  function startFixture(id, { isNew = false, draft = null } = {}) {
    stopTimers();
    allOff();
    w.step = 'fixture';
    w.sub = 'address';
    w.isNew = isNew;
    w.draft = draft ?? deep(fixtureById(id));
    w.search = null;
    w.explorer = null;
    w.readConfirm = null;
    w.addrTab = 'search';
    render();
  }

  function goSub(sub) {
    stopTimers();
    allOff();
    w.sub = sub;
    w.explorer = null;
    render();
  }

  function nextFixture() {
    if (w.mode === 'full' && w.idx + 1 < w.order.length) {
      w.idx++;
      startFixture(w.order[w.idx]);
    } else go('done');
  }

  /** Scheinwerfer im Saal mit Testwerten (Highlight) dauerhaft einschalten, alles andere aus. */
  function lightDraft(values) {
    const t = typeOfDraft();
    if (!t) return allOff();
    sendRaw(rawChannels(w.draft.address, values ?? highlightValues(t)));
  }

  function blinkDraft(on = true) {
    allOff();
    if (on && typeOfDraft()) {
      sendRaw({}, true);
      socket.send({ type: 'identify', fixtureId: w.draft.id, on: true, address: w.draft.address, typeId: w.draft.typeId });
    }
  }

  async function newFixtureDraft(mount) {
    const { id } = await api.get('/api/fixtures/new-id');
    const used = store.rig.fixtures.map((f) => f.address + (store.types[f.typeId]?.channels.length ?? 1));
    return {
      id,
      name: `Neuer Scheinwerfer ${id.replace(/^f0?/, '')}`,
      typeId: 'generic-dim-rgbw-5ch',
      address: Math.min(512, Math.max(1, ...used)),
      enabled: true,
      verified: false,
      mount,
      target: [0, 0.4, -2.4],
      beamAngleDeg: null,
      shape: null,
      groups: [],
      notes: '',
    };
  }

  async function saveDraft(verified = true) {
    const fx = { ...w.draft, verified };
    if (w.isNew) await api.post('/api/fixtures', fx);
    else await api.put(`/api/fixtures/${fx.id}`, fx);
    w.isNew = false;
    emit('toast', { text: `„${fx.name}“ gespeichert.` });
  }

  // ------------------------------------------------------------ 3D-Vorschau

  function preview() {
    if (!active) return;
    let fixtures = store.rig.fixtures;
    if (w.step === 'fixture' && w.draft) {
      fixtures = w.isNew ? [...fixtures, w.draft] : fixtures.map((f) => (f.id === w.draft.id ? w.draft : f));
    }
    view.setFixtures(fixtures, store.types);
    for (const f of fixtures) view.fixtures.setLight(f.id, 0, [1, 1, 1]);
    const focus = w.step === 'fixture' ? w.draft?.id : null;
    view.setFocus(focus);
    view.setSelection([]);
    view.fixtures.setShowTargets(w.step === 'fixture' && ['aim', 'save'].includes(w.sub) ? w.draft.id : false);
    if (focus && ['position', 'aim', 'name', 'save'].includes(w.sub)) view.fixtures.setLight(focus, 1, [1, 0.95, 0.85]);
    view.setMode('select');
    view.setHint(null);
    view.onPickFixture = null;
    view.onPickArc = null;
    view.onPickPoint = null;
    view.onPickEmpty = null;
    view.tooltipFor = (id) => fixtures.find((f) => f.id === id)?.name;

    if (w.step === 'start' || w.step === 'inventory' || w.step === 'done') {
      view.onPickFixture = (id) => {
        if (w.step === 'inventory') emit('toast', { text: `Nr. ${id.replace(/^f0?/, '')}: ${fixtureById(id)?.name}` });
        else { w.mode = 'single'; startFixture(id); }
      };
    }
    if (w.step === 'fixture' && w.sub === 'position') {
      if (w.draft.mount.kind === 'arc') {
        view.setMode('arc');
        view.setHint('Klicke auf das Rohr an die Stelle, wo der Scheinwerfer hängt.');
        view.onPickArc = (t) => { w.draft.mount.t = Math.round(t * 1000) / 1000; render(); };
      }
    }
    if (w.step === 'fixture' && w.sub === 'aim') {
      view.setMode('point');
      view.setHint('Klicke dorthin, wo der Lichtfleck im Saal wirklich ist.');
      view.onPickPoint = (p) => { w.draft.target = [p.x, p.y, p.z].map((v) => Math.round(v * 100) / 100); render(); };
    }
    if (w.step === 'fixture' && w.sub === 'address' && w.addrTab === 'pick') {
      view.onPickFixture = (id) => {
        if (id === w.draft.id) return;
        const addr = w.draft.address;
        if (confirm(`Du hast „${fixtureById(id)?.name}“ angeklickt. Diesen Scheinwerfer statt „${w.draft.name}“ einrichten (mit Adresse ${addr})?`)) {
          const other = deep(fixtureById(id));
          other.address = addr;
          w.mode = 'single';
          startFixture(id, { draft: other });
          w.sub = 'type';
          render();
        }
      };
    }
  }

  // ------------------------------------------------------------ Rendering

  function shell(progress, pctDone, body, navLeft, navRight) {
    clear(panel,
      h('div', { class: 'progress' }, progress),
      h('div', { class: 'bar' }, h('div', { style: { width: `${Math.round(pctDone * 100)}%` } })),
      body,
      h('div', { class: 'nav' }, h('div', { class: 'row' }, navLeft), h('div', { class: 'row' }, navRight)));
  }

  const btn = (label, onclick, cls = '') => h('button', { class: `btn ${cls}`, onclick }, label);
  const cancelBtn = () => btn('Abbrechen', () => { w.mode = 'full'; go('start'); });

  function render() {
    if (!active) return;
    ({ start: renderStart, interface: renderInterface, prep: renderPrep, inventory: renderInventory, fixture: renderFixture, done: renderDone })[w.step]();
    preview();
  }

  function renderStart() {
    const total = store.rig.fixtures.length;
    const ok = store.rig.fixtures.filter((f) => f.verified).length;
    shell('Einrichtung', 0, h('div', {},
      h('h2', {}, 'Was möchtest du tun?'),
      h('p', { class: 'muted' }, `${ok} von ${total} Scheinwerfern sind geprüft${store.conflicts.length ? ` · ${store.conflicts.length} Adressproblem(e)` : ''}.`),
      h('div', { class: 'choice-cards' },
        h('button', { onclick: () => { w.mode = 'full'; go('interface'); } },
          h('b', {}, '🧭 Komplette Einrichtung'),
          h('span', {}, 'Schritt für Schritt alle Scheinwerfer von links nach rechts durchgehen. Empfohlen beim ersten Mal (ca. 3 Minuten pro Scheinwerfer).')),
        h('button', { onclick: () => { w.mode = 'single'; go('inventory'); } },
          h('b', {}, '🔦 Einen Scheinwerfer einrichten'),
          h('span', {}, 'Klicke im Bild links auf den Scheinwerfer – oder wähle ihn aus der Liste.')),
        h('button', {
          onclick: async () => { w.mode = 'single'; startFixture(null, { isNew: true, draft: await newFixtureDraft({ kind: 'arc', t: 0.5 }) }); },
        }, h('b', {}, '➕ Neuen Scheinwerfer hinzufügen'), h('span', {}, 'Für ein Gerät, das noch nicht im Bild ist.'))),
      h('div', { class: 'tip' }, 'Während der Einrichtung steuert diese Seite die Scheinwerfer direkt. Die Lichtstimmung der Bühne ist danach wieder da.')),
    [], []);
  }

  function renderInterface() {
    const d = store.status?.dmx;
    const box = d?.connected
      ? h('div', { class: 'okbox' }, h('b', {}, '✔ DMX-Interface gefunden'), h('div', { class: 'small' }, d.port))
      : d?.mode === 'sim'
        ? h('div', { class: 'warn' }, h('b', {}, 'Simulationsmodus'), h('div', { class: 'small' }, 'Der Server wurde mit --sim gestartet. Du kannst alles durchspielen, aber im Saal passiert nichts.'))
        : h('div', { class: 'errbox' }, h('b', {}, '✘ Kein DMX-Interface verbunden'),
          h('div', { class: 'small' }, d?.lastError ?? ''),
          h('ul', { class: 'small' },
            h('li', {}, 'Steckt der USB-Stecker des ENTTEC-Interfaces am Laptop?'),
            h('li', {}, 'Steckt das DMX-Kabel vom Interface im DMX-Eingang des ersten Scheinwerfers?'),
            h('li', {}, 'Unter Linux: Ist der Benutzer in der Gruppe „uucp“ (bzw. „dialout“)?')),
          btn('Erneut suchen', async () => { await api.post('/api/dmx/reconnect'); setTimeout(render, 600); }));
    shell('Schritt 1 von 4 · Verbindung', 0.05, h('div', {},
      h('h2', {}, 'Ist das Lichtpult mit den Scheinwerfern verbunden?'),
      box,
      h('h3', {}, 'Schnelltest'),
      h('p', {}, 'Schaltet für 3 Sekunden alle 512 DMX-Kanäle auf voll. Wenn irgendein Scheinwerfer im Saal angeht, funktioniert die Verbindung.'),
      h('div', { class: 'warn' }, 'Achtung: Es kann hell werden und manche Geräte blitzen dabei – das ist normal.'),
      btn('Alles 3 Sekunden einschalten', () => {
        sendRaw(Object.fromEntries(Array.from({ length: 512 }, (_, i) => [i + 1, 255])));
        w.colorTimer = setTimeout(allOff, 3000);
      })),
    [cancelBtn()], [btn('Weiter', () => go('prep'), 'primary')]);
  }

  function renderPrep() {
    const items = [
      'Saallicht aus oder gedimmt, damit man die Lichtflecken gut sieht.',
      'Eine Person steht so, dass sie alle Scheinwerfer am Rohr sehen kann.',
      'Alle Scheinwerfer haben Strom und sind auf DMX-Betrieb gestellt (nicht „Auto“, „Sound“ oder „Master“).',
      'Die DMX-Kabel sind von Scheinwerfer zu Scheinwerfer durchgesteckt.',
    ];
    shell('Schritt 2 von 4 · Vorbereitung', 0.1, h('div', {},
      h('h2', {}, 'Kurz vorbereiten'),
      items.map((t) => h('label', { class: 'check' }, h('input', { type: 'checkbox' }), h('span', {}, t))),
      h('div', { class: 'tip' }, 'Bei LED-Scheinwerfern steht die DMX-Adresse meist im kleinen Display auf der Rückseite, z. B. „A001“ oder „d017“. Dann geht die Einrichtung noch schneller.')),
    [btn('Zurück', () => go('interface'))], [btn('Weiter', () => go('inventory'), 'primary')]);
  }

  function renderInventory() {
    const list = h('div', { class: 'fx-list' }, store.rig.fixtures.map((f) => h('div', { class: 'item' },
      h('b', {}, f.id.replace(/^f0?/, '')),
      h('span', {}, f.name, h('span', { class: 'muted small' }, ` · @${f.address}`)),
      h('span', { title: f.verified ? 'geprüft' : 'noch nicht geprüft' }, f.verified ? '✔' : '…'),
      h('div', { class: 'row' },
        btn('Einrichten', () => { w.mode = 'single'; startFixture(f.id); }, 'small'),
        btn('🗑', async () => {
          if (confirm(`„${f.name}“ wirklich entfernen?`)) await api.del(`/api/fixtures/${f.id}`);
        }, 'small danger')))));
    const full = w.mode === 'full';
    shell(full ? 'Schritt 3 von 4 · Bestandsaufnahme' : 'Scheinwerfer wählen', 0.15, h('div', {},
      h('h2', {}, full ? 'Stimmen die Scheinwerfer?' : 'Welchen Scheinwerfer einrichten?'),
      h('p', {}, full
        ? `Vom Foto wurden ${store.rig.fixtures.length} Scheinwerfer vorbereitet (Nummern im Bild). Füge fehlende hinzu oder entferne zu viele. Position, Adresse und Typ korrigieren wir gleich einzeln.`
        : 'Klicke einen Scheinwerfer im Bild an oder wähle ihn hier.'),
      list,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        btn('+ Scheinwerfer am Rohr', async () => startFixture(null, { isNew: true, draft: await newFixtureDraft({ kind: 'arc', t: 0.5 }) }), 'small'),
        btn('+ Scheinwerfer woanders (z. B. Decke)', async () => startFixture(null, { isNew: true, draft: await newFixtureDraft({ kind: 'free', position: [0, 2.8, 0.5] }) }), 'small'))),
    [full ? btn('Zurück', () => go('prep')) : cancelBtn()],
    full ? [btn('Weiter: einzeln einrichten ▶', () => {
      w.order = [...store.rig.fixtures].sort((a, b) => sortKey(a) - sortKey(b)).map((f) => f.id);
      w.idx = 0;
      if (w.order.length) startFixture(w.order[0]); else emit('toast', { text: 'Es gibt noch keine Scheinwerfer.' });
    }, 'primary')] : []);
  }

  const sortKey = (f) => (f.mount.kind === 'arc' ? f.mount.t : 2 + f.mount.position[0]);

  // ------------------------------------------------------------ Je Scheinwerfer

  function renderFixture() {
    const subIdx = SUBSTEPS.findIndex(([k]) => k === w.sub);
    const fxPos = w.mode === 'full' ? `Scheinwerfer ${w.idx + 1} von ${w.order.length}` : 'Einzelner Scheinwerfer';
    const done = w.mode === 'full' ? 0.2 + 0.75 * ((w.idx + subIdx / SUBSTEPS.length) / w.order.length) : 0.2 + 0.75 * (subIdx / SUBSTEPS.length);
    const steps = h('div', { class: 'row small', style: { marginBottom: '8px' } }, SUBSTEPS.map(([k, label], i) =>
      h('span', { class: `chip${k === w.sub ? ' on' : ''}`, onclick: () => goSub(k) }, `${i + 1}. ${label}`)));
    const body = { address: subAddress, type: subType, position: subPosition, aim: subAim, name: subName, save: subSave }[w.sub]();
    const prev = subIdx > 0 ? btn('Zurück', () => goSub(SUBSTEPS[subIdx - 1][0])) : null;
    const next = w.sub !== 'save' ? btn('Weiter', () => goSub(SUBSTEPS[subIdx + 1][0]), 'primary') : null;
    shell(`${fxPos} · ${w.draft.name}`, done, h('div', {}, steps, body), [cancelBtn(), prev], [
      w.mode === 'full' && w.sub !== 'save' ? btn('Überspringen', nextFixture) : null, next]);
  }

  // ---- a) Adresse
  function subAddress() {
    const tabs = h('div', { class: 'tabs-mini' },
      [['search', 'Adresse suchen'], ['read', 'Adresse ablesen'], ['pick', 'Anderer leuchtet?']].map(([k, l]) =>
        h('button', { class: `btn small${w.addrTab === k ? ' active' : ''}`, onclick: () => { w.addrTab = k; w.search = null; allOff(); render(); } }, l)));
    const wrap = h('div', {}, h('h2', {}, 'Welche DMX-Adresse hat er?'),
      h('p', { class: 'muted' }, 'Der Scheinwerfer, um den es geht, ist im Bild gelb markiert.'), tabs);

    if (w.addrTab === 'read') {
      const input = h('input', { type: 'number', min: 1, max: 512, value: w.draft.address });
      wrap.append(
        h('p', {}, 'Schau aufs Display des Scheinwerfers (oft auf der Rückseite). Steht dort z. B. „A017“ oder „d017“, ist die Adresse 17.'),
        h('div', { class: 'row' }, h('label', { class: 'field' }, 'Adresse', input),
          btn('Übernehmen & blinken lassen', () => {
            w.draft.address = Math.max(1, Math.min(512, Number(input.value) || 1));
            w.readConfirm = 'asking';
            blinkDraft(true);
            render();
          }, 'primary')));
      if (w.readConfirm === 'asking') {
        wrap.append(h('div', { class: 'question' }, `Blinkt jetzt der markierte Scheinwerfer (Adresse ${w.draft.address})?`),
          h('div', { class: 'yesno' },
            btn('Ja', () => { w.readConfirm = null; goSub('type'); }, 'primary'),
            btn('Nein', () => { w.readConfirm = 'no'; blinkDraft(false); render(); })));
      } else if (w.readConfirm === 'no') {
        wrap.append(h('div', { class: 'warn' }, 'Dann stimmt entweder die Adresse oder der Gerätetyp nicht. Probiere „Adresse suchen“ – das findet die Adresse ganz ohne Display.'));
      }
      return wrap;
    }

    if (w.addrTab === 'pick') {
      wrap.append(h('p', {}, 'Ist beim Suchen ein anderer Scheinwerfer angegangen als der markierte? Dann klicke ihn im Bild an – wir richten stattdessen diesen ein und übernehmen die gefundene Adresse.'),
        h('div', { class: 'tip' }, `Aktuelle Adresse: ${w.draft.address}`));
      return wrap;
    }

    // Suche per Halbierung: Kanäle m…512 an. Leuchtet er, liegt seine Adresse bei m oder darüber.
    const s = w.search;
    if (!s) {
      wrap.append(
        h('p', {}, 'Wir schalten Kanäle ein und du sagst jeweils nur „Ja, er leuchtet“ oder „Nein“. Nach etwa 9 Fragen kennen wir die Adresse.'),
        h('div', { class: 'tip' }, 'Andere Scheinwerfer gehen dabei auch an und aus – achte nur auf den gelb markierten.'),
        btn('Suche starten', () => {
          w.search = { L: 1, H: 513, phase: 'verify', q: 0 };
          sendRaw(rawRange(1));
          render();
        }, 'primary big'));
      return wrap;
    }
    if (s.phase === 'verify') {
      wrap.append(h('div', { class: 'question' }, 'Alle Kanäle sind an. Leuchtet der markierte Scheinwerfer?'),
        h('div', { class: 'yesno' },
          btn('Ja, er leuchtet', () => { s.phase = 'search'; askNext(); }, 'primary'),
          btn('Nein, er bleibt dunkel', () => { s.phase = 'dead'; allOff(); render(); })));
    } else if (s.phase === 'dead') {
      wrap.append(h('div', { class: 'errbox' }, h('b', {}, 'Der Scheinwerfer reagiert gar nicht auf DMX.'),
        h('ul', { class: 'small' },
          h('li', {}, 'Hat er Strom? Leuchtet sein Display?'),
          h('li', {}, 'Ist er auf DMX-Betrieb gestellt (nicht Auto/Sound/Master)?'),
          h('li', {}, 'Steckt das DMX-Kabel richtig? Wenn ein Gerät davor in der Kette ausfällt, sind oft alle dahinter tot.'))),
        h('div', { class: 'row' }, btn('Nochmal versuchen', () => { w.search = null; render(); }),
          w.mode === 'full' ? btn('Diesen überspringen', nextFixture) : null));
    } else if (s.phase === 'search') {
      wrap.append(
        h('div', { class: 'progress' }, `Frage ${s.q} von ca. 9 · Bereich ${s.L}–${s.H - 1}`),
        h('div', { class: 'question' }, 'Leuchtet der markierte Scheinwerfer noch?'),
        h('div', { class: 'yesno' },
          btn('Ja', () => { s.L = s.m; askNext(); }, 'primary'),
          btn('Nein', () => { s.H = s.m; askNext(); })));
    } else if (s.phase === 'found') {
      const conflict = store.rig.fixtures.find((f) => f.id !== w.draft.id && f.address === s.L);
      wrap.append(h('div', { class: 'okbox' }, 'Gefunden! Startadresse:', h('div', { class: 'bigaddr' }, s.L)),
        conflict ? h('div', { class: 'warn' }, `Hinweis: „${conflict.name}“ hat ebenfalls Adresse ${s.L}. Zwei Geräte mit gleicher Adresse reagieren immer gemeinsam – wenn das nicht gewollt ist, am Gerät umstellen.`) : null,
        h('div', { class: 'row' }, btn('Übernehmen ▶', () => { w.draft.address = s.L; goSub('type'); }, 'primary'),
          btn('Neu suchen', () => { w.search = null; allOff(); render(); })));
    }
    return wrap;

    function askNext() {
      if (s.H - s.L <= 1) {
        s.phase = 'found';
        allOff();
      } else {
        s.m = Math.floor((s.L + s.H) / 2);
        s.q++;
        sendRaw(rawRange(s.m));
      }
      render();
    }
  }

  const rawRange = (from) => Object.fromEntries(Array.from({ length: 513 - from }, (_, i) => [from + i, 255]));

  // ---- b) Typ
  function subType() {
    if (w.explorer) return channelExplorer(w, { onDone: render, onCancel: () => { w.explorer = null; allOff(); render(); } });
    const t = typeOfDraft();
    const list = h('div', { class: 'fx-list' }, Object.values(store.types).map((ty) =>
      h('label', { class: `item${ty.id === w.draft.typeId ? ' cur' : ''}`, style: { gridTemplateColumns: 'auto 1fr auto' } },
        h('input', {
          type: 'radio', name: 'ftype', checked: ty.id === w.draft.typeId,
          onchange: () => { w.draft.typeId = ty.id; allOff(); render(); },
        }),
        h('span', {}, ty.name, ty.builtin ? '' : h('span', { class: 'muted small' }, ' (eigener)')),
        h('span', { class: 'muted small' }, `${ty.channels.length} Kan.`))));
    let colorBtn = null;
    if (t && t.colorModel !== 'none') {
      colorBtn = btn('Farben testen', () => {
        stopTimers();
        const seq = ['red', 'green', 'blue', 'white', 'amber'].filter((r) => t.channels.some((c) => c.role === r));
        let i = 0;
        const stepColor = () => {
          if (i >= seq.length) { allOff(); return; }
          lightDraft(colorTestValues(t, seq[i]));
          emit('toast', { text: { red: 'Jetzt: Rot', green: 'Jetzt: Grün', blue: 'Jetzt: Blau', white: 'Jetzt: Weiß', amber: 'Jetzt: Amber' }[seq[i]] });
          i++;
          w.colorTimer = setTimeout(stepColor, 1500);
        };
        stepColor();
      });
    }
    return h('div', {},
      h('h2', {}, 'Was für ein Gerät ist es?'),
      h('p', {}, 'Der Gerätetyp sagt, wie viele Kanäle der Scheinwerfer belegt und was jeder Kanal macht. Welcher Modus eingestellt ist, steht oft im Display (z. B. „8CH“).'),
      list,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        btn('Blinken lassen', () => blinkDraft(true)),
        btn('Voll an', () => lightDraft()),
        colorBtn,
        btn('Aus', allOff)),
      h('div', { class: 'tip' }, 'Prüfen: Bei „Voll an“ sollte er hell weiß leuchten und nicht blitzen. Bei „Farben testen“ müssen Rot, Grün, Blau … in dieser Reihenfolge kommen. Wenn nicht, passt der Typ nicht.'),
      h('p', {}, 'Nichts passt? ', btn('Kanäle selbst erkunden …', () => { w.explorer = { count: 8, values: [], roles: [] }; render(); }, 'small')));
  }

  // ---- c) Position
  function subPosition() {
    const d = w.draft;
    const kindSel = h('div', { class: 'tabs-mini' },
      [['arc', 'Am Rohr'], ['free', 'Woanders (z. B. Decke)']].map(([k, l]) => h('button', {
        class: `btn small${d.mount.kind === k ? ' active' : ''}`,
        onclick: () => {
          if (k === d.mount.kind) return;
          d.mount = k === 'arc' ? { kind: 'arc', t: 0.5 } : { kind: 'free', position: arcPoint(store.stage, d.mount.t ?? 0.5).map((v) => Math.round(v * 100) / 100) };
          render();
        },
      }, l)));
    const shapeSel = h('select', { onchange: (e) => { d.shape = e.target.value || null; render(); } },
      [['', 'wie Gerätetyp'], ['round', 'rund'], ['square', 'eckig mit Klappen'], ['profile', 'Profilscheinwerfer (lang)']].map(([v, l]) =>
        h('option', { value: v, selected: (d.shape ?? '') === v }, l)));
    let ctl;
    if (d.mount.kind === 'arc') {
      const slider = h('input', { type: 'range', min: 0, max: 1000, value: Math.round(d.mount.t * 1000), style: { width: '100%' } });
      slider.addEventListener('input', () => { d.mount.t = slider.value / 1000; preview(); });
      ctl = h('div', {}, h('div', { class: 'row muted small', style: { justifyContent: 'space-between' } }, h('span', {}, '◀ ganz links'), h('span', {}, 'ganz rechts ▶')), slider,
        h('p', { class: 'muted small' }, '„Links“ und „rechts“ gelten aus Sicht des Publikums.'));
    } else {
      const inputs = ['x (links/rechts)', 'y (Höhe)', 'z (vor/zurück)'].map((label, i) => {
        const inp = h('input', { type: 'number', step: 0.05, value: d.mount.position[i] });
        inp.addEventListener('input', () => { d.mount.position[i] = Number(inp.value) || 0; preview(); });
        return h('label', { class: 'field' }, label, inp);
      });
      ctl = h('div', {}, h('div', { class: 'row' }, inputs),
        h('p', { class: 'muted small' }, 'Meter. x = 0 ist die Bühnenmitte, y = 0 der Saalboden, z = 0 die Bühnenvorderkante (positiv Richtung Publikum).'));
    }
    return h('div', {},
      h('h2', {}, 'Wo hängt er?'),
      h('div', { class: 'row' }, btn('Im Saal blinken lassen', () => blinkDraft(true)), btn('Aus', allOff)),
      h('p', {}, 'Lass ihn blinken und schiebe dann das Symbol im Bild dorthin, wo er wirklich hängt.'),
      kindSel, ctl,
      h('label', { class: 'field', style: { marginTop: '10px' } }, 'Darstellung im Bild', shapeSel));
  }

  // ---- d) Ausrichtung
  function subAim() {
    const d = w.draft;
    const t = typeOfDraft();
    const angle = beamAngle(d, t);
    const slider = h('input', { type: 'range', min: 5, max: 90, value: angle, style: { flex: 1 } });
    const out = h('output', {}, `${angle}°`);
    slider.addEventListener('input', () => { d.beamAngleDeg = Number(slider.value); out.textContent = `${slider.value}°`; preview(); });
    const props = (store.stage.props ?? []).filter((p) => p.kind !== 'rug').map((p) => [p.name, [p.position[0], p.position[1] + p.size[1], p.position[2]]]);
    return h('div', {},
      h('h2', {}, 'Wohin leuchtet er?'),
      h('div', { class: 'row' }, btn('Im Saal einschalten', () => lightDraft(), 'primary'), btn('Aus', allOff)),
      h('p', {}, 'Schalte ihn ein und schau, wo der Lichtfleck liegt. Klicke im Bild genau auf diese Stelle (Boden, Möbel oder Wand).'),
      h('div', { class: 'row small' }, 'Schnell:', [...QUICK_TARGETS, ...props].map(([name, p]) =>
        h('span', { class: 'chip', onclick: () => { d.target = p.map((v) => Math.round(v * 100) / 100); render(); } }, name))),
      h('p', { class: 'muted small' }, `Ziel: x ${d.target[0]} · y ${d.target[1]} · z ${d.target[2]}`),
      h('h3', {}, 'Breite des Lichtkegels'),
      h('div', { class: 'row' }, slider, out),
      h('p', { class: 'muted small' }, 'Ist der Fleck auf der Bühne größer als im Bild, Kegel breiter machen.'),
      d.beamAngleDeg !== null ? btn('Wie Gerätetyp', () => { d.beamAngleDeg = null; render(); }, 'small') : null);
  }

  // ---- e) Name & Gruppen
  function subName() {
    const d = w.draft;
    const name = h('input', { type: 'text', value: d.name, style: { width: '100%' } });
    name.addEventListener('input', () => { d.name = name.value; });
    const newGroup = h('input', { type: 'text', placeholder: 'neue Gruppe, z. B. „Front“' });
    return h('div', {},
      h('h2', {}, 'Wie soll er heißen?'),
      h('label', { class: 'field' }, 'Name (so erscheint er auf der Bühnen-Seite)', name),
      h('p', { class: 'muted small' }, 'Tipp: kurz und nach Ort, z. B. „Links 3“, „Mitte Sofa“, „Decke Profiler“.'),
      h('h3', { style: { marginTop: '14px' } }, 'Gruppen'),
      h('p', { class: 'muted small' }, 'Mit Gruppen kann man auf der Bühnen-Seite mehrere Scheinwerfer auf einmal wählen.'),
      h('div', { class: 'row' }, store.rig.groups.map((g) => h('span', {
        class: `chip${d.groups.includes(g.id) ? ' on' : ''}`,
        onclick: () => { d.groups = d.groups.includes(g.id) ? d.groups.filter((x) => x !== g.id) : [...d.groups, g.id]; render(); },
      }, h('span', { class: 'dot', style: { background: g.color } }), g.name))),
      h('div', { class: 'row', style: { marginTop: '8px' } }, newGroup, btn('Anlegen', async () => {
        const label = newGroup.value.trim();
        if (!label) return;
        const id = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gruppe';
        if (!store.rig.groups.some((g) => g.id === id)) {
          const color = `hsl(${Math.floor(Math.random() * 360)} 80% 60%)`;
          const rig = deep(store.rig);
          rig.groups.push({ id, name: label, color: hslToHex(color) });
          for (const f of rig.fixtures) { delete f.position; delete f.footprint; }
          await api.put('/api/rig', rig);
        }
        if (!d.groups.includes(id)) d.groups.push(id);
        render();
      }, 'small')));
  }

  // ---- f) Speichern
  function subSave() {
    const d = w.draft;
    const t = typeOfDraft();
    const end = d.address + (t?.channels.length ?? 1) - 1;
    const clash = store.rig.fixtures.filter((f) => {
      if (f.id === d.id || !f.enabled) return false;
      const fe = f.address + (store.types[f.typeId]?.channels.length ?? 1) - 1;
      return f.address <= end && d.address <= fe;
    });
    const row = (k, v) => h('tr', {}, h('th', {}, k), h('td', {}, v));
    return h('div', {},
      h('h2', {}, 'Alles richtig?'),
      h('table', { class: 'data' },
        row('Name', d.name),
        row('DMX', `${d.address}–${end}`),
        row('Gerätetyp', t?.name ?? d.typeId),
        row('Position', d.mount.kind === 'arc' ? `am Rohr, ${Math.round(d.mount.t * 100)} % von links` : d.mount.position.join(' / ')),
        row('Ziel', d.target.join(' / ')),
        row('Kegel', `${beamAngle(d, t)}°`),
        row('Gruppen', d.groups.map((g) => store.rig.groups.find((x) => x.id === g)?.name ?? g).join(', ') || '–')),
      clash.length ? h('div', { class: 'warn' }, `Kanäle überschneiden sich mit: ${clash.map((f) => f.name).join(', ')}. Diese Geräte beeinflussen sich gegenseitig.`) : null,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        btn('Kurz testen', () => { lightDraft(); w.colorTimer = setTimeout(allOff, 2000); })),
      h('div', { class: 'row', style: { marginTop: '14px' } },
        btn(w.mode === 'full' && w.idx + 1 < w.order.length ? 'Speichern & nächster ▶' : 'Speichern & fertig', async () => {
          await saveDraft(true);
          nextFixture();
        }, 'primary big'),
        w.mode === 'full' ? btn('Ohne Speichern weiter', nextFixture) : null));
  }

  // ------------------------------------------------------------ Abschluss

  function renderDone() {
    const rows = store.rig.fixtures.map((f) => {
      const t = store.types[f.typeId];
      const bad = store.conflicts.some((c) => c.fixtures.includes(f.id));
      return h('tr', { class: bad ? 'conflict' : '' },
        h('td', {}, f.id.replace(/^f0?/, '')), h('td', {}, f.name),
        h('td', {}, `${f.address}–${f.address + (t?.channels.length ?? 1) - 1}`),
        h('td', { class: 'small' }, t?.name ?? f.typeId), h('td', {}, f.verified ? '✔' : '–'));
    });
    const chase = () => {
      stopTimers();
      const fxs = [...store.rig.fixtures].sort((a, b) => sortKey(a) - sortKey(b));
      let i = 0;
      const tick = () => {
        if (i >= fxs.length) { stopTimers(); allOff(); view.setFocus(null); return; }
        const f = fxs[i++];
        const t = store.types[f.typeId];
        if (t) sendRaw(rawChannels(f.address, highlightValues(t)));
        view.setFocus(f.id);
      };
      tick();
      w.chaseTimer = setInterval(tick, 800);
    };
    shell('Schritt 4 von 4 · Fertig', 1, h('div', {},
      h('h2', {}, 'Geschafft! 🎉'),
      store.conflicts.length
        ? h('div', { class: 'warn' }, store.conflicts.map((c) => h('div', {}, c.message)))
        : h('div', { class: 'okbox' }, 'Keine Adresskonflikte.'),
      h('table', { class: 'data' }, h('tr', {}, ['Nr.', 'Name', 'DMX', 'Typ', 'geprüft'].map((x) => h('th', {}, x))), rows),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        btn('Lauflicht über alle', chase),
        btn('Sicherung herunterladen', async () => download('lichtpult-sicherung.json', await api.get('/api/export'))))),
    [btn('Nochmal von vorn', () => go('start'))], [btn('Zur Bühne ▶', () => { location.hash = '#stage'; }, 'primary')]);
  }

  // ------------------------------------------------------------ Ereignisse

  on('rig', () => { if (active && w.step !== 'fixture') render(); });
  on('view-rebuilt', () => { if (active) preview(); });
  on('status', () => { if (active && w.step === 'interface') render(); });

  return {
    show() { active = true; render(); },
    hide() { active = false; stopTimers(); allOff(); view.setFocus(null); view.setHint(null); view.setMode('select'); view.fixtures.setShowTargets(false); },
    get active() { return active; },
  };
}

function hslToHex(hsl) {
  const [hh, s, l] = hsl.match(/[\d.]+/g).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + hh / 30) % 12;
    const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
