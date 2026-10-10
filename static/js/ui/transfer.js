// Export/Import als Datei: ganze Produktion, Szenen (Produktion oder Bibliothek) und Hilfen für die Sicherung.
import { api } from '../api.js';
import { emit, store } from '../store.js';
import { dialog, download, h } from '../util/dom.js';

const PRODUCTION_FORMAT = 'lichtpult-production';
const SCENES_FORMAT = 'lichtpult-scenes';
const BACKUP_KEYS = ['rig.json', 'stage.json', 'fixture_types.user.json', 'scenes.json', 'productions.json'];

const fail = (text) => emit('toast', { text, error: true });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const isBackup = (data) => !!data && !Array.isArray(data) && BACKUP_KEYS.some((k) => k in data);

/** Öffnet die Dateiauswahl und liefert { name, data } oder null (abgebrochen / ungültig, Toast schon gezeigt). */
export function pickJsonFile() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    input.addEventListener('change', async () => {
      input.remove();
      const f = input.files[0];
      if (!f) return resolve(null);
      resolve(await readJsonFile(f));
    });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    document.body.append(input);
    input.click();
  });
}

/** Liest eine JSON-Datei; bei Fehler Toast und null. */
export async function readJsonFile(f) {
  let text;
  try {
    text = await f.text();
  } catch {
    fail(`Die Datei „${f.name}“ konnte nicht gelesen werden.`);
    return null;
  }
  try {
    return { name: f.name, data: JSON.parse(text) };
  } catch {
    fail(`„${f.name}“ ist keine gültige Lichtpult-Datei (kein JSON). Bitte eine mit „Exportieren“ erzeugte .json-Datei wählen.`);
    return null;
  }
}

function describe(data) {
  if (data?.format === PRODUCTION_FORMAT) return 'eine Produktion';
  if (data?.format === SCENES_FORMAT || Array.isArray(data) || Array.isArray(data?.scenes)) return 'eine Szenen-Datei';
  if (isBackup(data)) return 'eine Gesamtsicherung (bitte unter Einrichtung → Sicherung wiederherstellen)';
  return null;
}

// ------------------------------------------------------------ Produktion

export async function exportProduction(p) {
  const data = await api.get(`/api/productions/${p.id}/export`);
  download(`${p.id}.produktion.json`, data);
  emit('toast', { text: `Produktion „${p.name}“ exportiert.` });
}

/** Datei wählen, prüfen, bei gleicher ID nachfragen (Ersetzen / Als Kopie), importieren und aktivieren. */
export async function importProduction() {
  const file = await pickJsonFile();
  if (!file) return;
  const { name, data } = file;
  if (data?.format !== PRODUCTION_FORMAT || typeof data.production !== 'object' || !data.production) {
    const what = describe(data);
    return fail(`„${name}“ ist keine Produktions-Datei${what ? ` – das ist ${what}` : ''}.`);
  }
  const incoming = data.production;
  const existing = store.productions.find((p) => p.id === incoming.id);
  const run = async (mode) => {
    let p;
    try {
      const body = mode === 'new' ? { ...data, production: { ...incoming, name: copyName(incoming.name ?? incoming.id) } } : data;
      p = await api.post('/api/productions/import', mode ? { ...body, mode } : body);
    } catch (e) {
      fail(`Import von „${name}“ fehlgeschlagen: ${e.message}`);
      return false;
    }
    await api.post(`/api/productions/${p.id}/activate`);
    emit('toast', {
      text: `Produktion „${p.name}“ ${mode === 'replace' ? 'ersetzt' : 'importiert'} `
        + `(${plural(p.scenes.length, 'Szene', 'Szenen')}, ${plural(p.cues.length, 'Ablauf-Eintrag', 'Ablauf-Einträge')}).`,
    });
  };
  if (!existing) return run(null);
  dialog(`Produktion „${incoming.name ?? incoming.id}“ gibt es schon`, [
    h('p', {}, `Es gibt bereits die Produktion „${existing.name}“ `
      + `(${plural(existing.scenes.length, 'Szene', 'Szenen')}, ${plural(existing.cues.length, 'Ablauf-Eintrag', 'Ablauf-Einträge')}).`),
    h('p', { class: 'muted small' }, '„Ersetzen“ überschreibt sie mit dem Inhalt der Datei. '
      + '„Als Kopie anlegen“ lässt sie unverändert und legt eine zweite Produktion an.'),
  ], [
    { label: 'Ersetzen', class: 'danger', onclick: () => run('replace') },
    { label: 'Als Kopie anlegen', class: 'primary', onclick: () => run('new') },
  ]);
}

function copyName(name) {
  const taken = new Set(store.productions.map((p) => p.name));
  let n = `${name} (Kopie)`;
  for (let i = 2; taken.has(n); i++) n = `${name} (Kopie ${i})`;
  return n;
}

// ------------------------------------------------------------ Szenen

/**
 * Kleine Leiste „Exportieren / Importieren“ für eine Szenenliste.
 * @param {object} t
 * @param {() => string} t.base       API-Basis, z. B. '/api/scenes' oder '/api/productions/hamlet/scenes'
 * @param {() => string} t.filename   Dateiname beim Export
 * @param {() => string} t.label      Bezeichnung des Ziels für Texte, z. B. „die Bibliothek“
 * @param {() => object[]} t.scenes   aktuelle Szenen des Ziels
 * @param {string} [t.replaceHint]    zusätzlicher Hinweis zu „Ersetzen“
 */
export function sceneTransferButtons(t) {
  async function exportScenes() {
    if (!t.scenes().length) return fail(`${cap(t.label())} enthält keine Szenen.`);
    download(t.filename(), await api.get(`${t.base()}/export`));
    emit('toast', { text: `${plural(t.scenes().length, 'Szene', 'Szenen')} exportiert.` });
  }

  async function importScenes() {
    const file = await pickJsonFile();
    if (!file) return;
    const { name, data } = file;
    const list = data?.format === PRODUCTION_FORMAT ? data.production?.scenes
      : Array.isArray(data) ? data : data?.scenes;
    if (!Array.isArray(list) || (data?.format && ![SCENES_FORMAT, PRODUCTION_FORMAT].includes(data.format))) {
      const what = describe(data);
      return fail(`„${name}“ enthält keine Szenen${what ? ` – das ist ${what}` : ''}.`);
    }
    if (!list.length) return fail(`„${name}“ enthält keine Szenen.`);
    const ids = new Set(t.scenes().map((s) => s.id));
    const same = list.filter((s) => ids.has(s?.id)).length;
    const merge = h('input', { type: 'radio', name: 'scene-import-mode', value: 'merge', checked: true });
    const replace = h('input', { type: 'radio', name: 'scene-import-mode', value: 'replace' });
    dialog(`Szenen in ${t.label()} importieren`, [
      h('p', {}, `„${name}“ enthält ${plural(list.length, 'Szene', 'Szenen')}`
        + (same ? `, davon ${same} mit gleicher Kennung wie vorhandene.` : '.')),
      h('label', { class: 'check transfer-mode' }, merge, h('span', {}, h('b', {}, 'Zusammenführen'),
        h('br'), h('span', { class: 'muted small' }, 'Neue Szenen hinten anhängen, Szenen mit gleicher Kennung überschreiben.'))),
      h('label', { class: 'check transfer-mode' }, replace, h('span', {}, h('b', {}, 'Ersetzen'),
        h('br'), h('span', { class: 'muted small' }, `${replaceText(t.scenes().length)} nur die aus der Datei behalten.`
          + (t.replaceHint ? ` ${t.replaceHint}` : '')))),
    ], [{
      label: 'Importieren',
      class: 'primary',
      onclick: async () => {
        const mode = replace.checked ? 'replace' : 'merge';
        try {
          await api.post(`${t.base()}/import?mode=${mode}`, data);
        } catch (e) {
          fail(`Import von „${name}“ fehlgeschlagen: ${e.message}`);
          return false;
        }
        emit('toast', { text: `${plural(list.length, 'Szene', 'Szenen')} ${mode === 'replace' ? 'übernommen (ersetzt)' : 'zusammengeführt'}.` });
      },
    }]);
  }

  return h('span', { class: 'transfer-bar' },
    h('button', { class: 'btn small', title: 'Szenen als Datei speichern', onclick: exportScenes }, 'Exportieren'),
    h('button', { class: 'btn small', title: 'Szenen aus einer Datei übernehmen', onclick: importScenes }, 'Importieren'));
}

function replaceText(n) {
  if (n === 0) return 'Bisher gibt es keine Szenen,';
  return n === 1 ? 'Die bisherige Szene entfernen,' : `Alle ${n} bisherigen Szenen entfernen,`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
