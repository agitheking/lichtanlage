// Einstieg: Kopfleiste, Tab-Routing, gemeinsame 3D-Ansicht.
import { api } from './api.js';
import { emit, on, setBlackout, setGrandMaster, store, toast } from './store.js';
import { StageView } from './scene/StageView.js';
import { mountStageTab } from './ui/stage-tab.js';
import { mountScenesTab } from './ui/scenes-tab.js';
import { mountAdminTab } from './ui/admin-tab.js';

const $ = (sel) => document.querySelector(sel);
const view = new StageView();

const tabs = {
  stage: mountStageTab($('#tab-stage'), view),
  scenes: mountScenesTab($('#tab-scenes')),
  admin: mountAdminTab($('#tab-admin'), view),
};
let current = null;

function route() {
  const name = (location.hash.slice(1).split('/')[0] || 'stage');
  const next = tabs[name] ? name : 'stage';
  if (next === current) return;
  if (current) {
    tabs[current].hide?.();
    $(`#tab-${current}`).hidden = true;
  }
  current = next;
  $(`#tab-${current}`).hidden = false;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === current));
  tabs[current].show?.();
}
window.addEventListener('hashchange', route);

// Szene/Fixtures der 3D-Ansicht aktuell halten
on('stage', () => { view.setStage(store.stage); view.setFixtures(store.rig.fixtures, store.types); emit('view-rebuilt'); });
on('rig', () => { view.setFixtures(store.rig.fixtures, store.types); emit('view-rebuilt'); });
on('types', () => { if (store.stage) { view.setFixtures(store.rig.fixtures, store.types); emit('view-rebuilt'); } });
on('ready', route);

// ---- Kopfleiste ----
const gm = $('#gm');
const gmOut = $('#gm-out');
const btnBo = $('#btn-blackout');
gm.addEventListener('input', () => setGrandMaster(gm.value / 100));
btnBo.addEventListener('click', () => setBlackout(!store.levels.blackout));
on('levels', () => {
  if (document.activeElement !== gm) gm.value = Math.round(store.levels.grandMaster * 100);
  gmOut.textContent = `${Math.round(store.levels.grandMaster * 100)} %`;
  btnBo.classList.toggle('on', store.levels.blackout);
  btnBo.textContent = store.levels.blackout ? 'Blackout AN' : 'Blackout';
});

on('status', () => {
  const pill = $('#dmx-status');
  const banner = $('#banner-sim');
  const dmx = store.status?.dmx;
  if (!store.online) {
    pill.className = 'status-pill err';
    pill.textContent = 'Server getrennt';
    banner.hidden = false;
    banner.textContent = 'Keine Verbindung zum Lichtpult-Server – wird automatisch neu verbunden …';
    return;
  }
  if (!dmx) return;
  if (dmx.connected) {
    pill.className = 'status-pill ok';
    pill.textContent = 'DMX verbunden';
    pill.title = `${dmx.port} · ${dmx.fps} Hz`;
    banner.hidden = true;
  } else {
    pill.className = `status-pill ${dmx.mode === 'sim' ? 'sim' : 'err'}`;
    pill.textContent = dmx.mode === 'sim' ? 'Simulation' : 'Kein DMX';
    pill.title = dmx.lastError ?? '';
    banner.hidden = false;
    banner.textContent = dmx.mode === 'sim'
      ? 'Simulationsmodus: Es wird kein echtes Licht gesteuert.'
      : `DMX-Interface nicht verbunden${dmx.lastError ? ` (${dmx.lastError})` : ''} – es wird automatisch neu gesucht.`;
  }
});

on('raw', () => {
  const active = Object.keys(store.raw.channels).length > 0 || store.raw.solo || store.raw.identify.length > 0;
  $('#banner-raw').hidden = !active || current === 'admin';
});
$('#btn-clear-raw').addEventListener('click', () => api.del('/api/dmx/raw'));

// ---- Toast ----
let toastTimer;
on('toast', ({ text, error }) => {
  const t = $('#toast');
  t.textContent = text;
  t.className = `toast${error ? ' error' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, error ? 6000 : 2500);
});
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message ?? String(e.reason), true));

// ---- Tastatur ----
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'b' || e.key === 'B') { setBlackout(!store.levels.blackout); e.preventDefault(); }
  else tabs[current]?.key?.(e);
});
