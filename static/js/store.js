// Zentraler Client-Zustand. Der Server ist die Quelle der Wahrheit; der Store
// spiegelt ihn und verteilt Änderungen per subscribe().
import { Socket } from './ws.js';

const listeners = new Map();

export const store = {
  clientId: null,
  online: false,
  status: null,
  rig: { fixtures: [], groups: [] },
  conflicts: [],
  types: {},
  stage: null,
  levels: { grandMaster: 1, blackout: false, fixtures: {} },
  scenes: [],
  productions: [],
  activeProductionId: null,
  raw: { channels: {}, solo: false, identify: [] },
  selection: new Set(),
  lastScene: null,
};

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  for (const fn of listeners.get(event) ?? []) {
    try { fn(payload); } catch (e) { console.error(e); }
  }
}

export const fixtureById = (id) => store.rig.fixtures.find((f) => f.id === id);
export const typeOf = (fx) => store.types[fx?.typeId];
export const levelOf = (id) => store.levels.fixtures[id] ?? { dimmer: 0, r: 1, g: 1, b: 1, w: 1, a: 0, cct: 0.5, strobe: 0 };

function applyRig(msg) {
  store.rig = msg.rig;
  store.conflicts = msg.conflicts ?? [];
  const ids = new Set(store.rig.fixtures.map((f) => f.id));
  for (const id of [...store.selection]) if (!ids.has(id)) store.selection.delete(id);
  emit('rig');
}

function applyTypes(list) {
  store.types = Object.fromEntries(list.map((t) => [t.id, t]));
  emit('types');
}

function applyProductions(msg) {
  store.productions = msg.productions ?? [];
  store.activeProductionId = msg.activeProductionId ?? null;
  emit('productions');
}

export const activeProduction = () => store.productions.find((p) => p.id === store.activeProductionId) ?? null;

function handle(msg) {
  switch (msg.type) {
    case 'hello':
      store.clientId = msg.clientId;
      store.status = msg.status;
      applyTypes(msg.types);
      store.stage = msg.stage;
      emit('stage');
      applyRig(msg);
      store.levels = msg.state;
      store.scenes = msg.scenes;
      store.raw = msg.raw;
      emit('levels', { all: true });
      emit('scenes');
      applyProductions(msg);
      emit('raw');
      emit('status');
      emit('ready');
      break;
    case 'levels':
      Object.assign(store.levels.fixtures, msg.fixtures);
      store.levels.grandMaster = msg.grandMaster;
      store.levels.blackout = msg.blackout;
      emit('levels', { ids: Object.keys(msg.fixtures), remote: msg.origin !== store.clientId });
      break;
    case 'rig': applyRig(msg); break;
    case 'types': applyTypes(msg.types); break;
    case 'stage': store.stage = msg.stage; emit('stage'); break;
    case 'scenes': store.scenes = msg.scenes; emit('scenes'); break;
    case 'productions': applyProductions(msg); break;
    case 'raw': store.raw = msg; emit('raw'); break;
    case 'status': store.status = msg; emit('status'); break;
    case 'dmx_frame': emit('frame', Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0))); break;
    case 'error': emit('toast', { text: msg.message, error: true }); break;
  }
}

export const socket = new Socket(handle, (online) => { store.online = online; emit('status'); });

// ---- Werte setzen (optimistisch, gedrosselt auf einen Versand pro Frame) ----

let pending = null;

export function setLevels(levels, fade = 0) {
  for (const [id, upd] of Object.entries(levels)) {
    store.levels.fixtures[id] = { ...levelOf(id), ...upd };
  }
  emit('levels', { ids: Object.keys(levels), remote: false });
  if (fade > 0) {
    socket.send({ type: 'set_levels', levels, fade });
    return;
  }
  if (!pending) {
    pending = {};
    requestAnimationFrame(() => {
      socket.send({ type: 'set_levels', levels: pending, fade: 0 });
      pending = null;
    });
  }
  for (const [id, upd] of Object.entries(levels)) pending[id] = { ...pending[id], ...upd };
}

export function setGrandMaster(value) {
  store.levels.grandMaster = value;
  emit('levels', { ids: [], remote: false });
  socket.send({ type: 'grandmaster', value });
}

export function setBlackout(on) {
  store.levels.blackout = on;
  emit('levels', { ids: [], remote: false });
  socket.send({ type: 'blackout', on });
}

export function select(ids, mode = 'set') {
  if (mode === 'set') store.selection = new Set(ids);
  else if (mode === 'toggle') for (const id of ids) store.selection.has(id) ? store.selection.delete(id) : store.selection.add(id);
  else if (mode === 'add') for (const id of ids) store.selection.add(id);
  emit('selection');
}

export function toast(text, error = false) {
  emit('toast', { text, error });
}
