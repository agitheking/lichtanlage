// Wiederverwendbare Szenenliste: Speichern mit Überblendung, Abrufen, Reihenfolge, Bearbeiten, Löschen.
// Genutzt von der Bibliothek (Tab „Szenen“) und den Szenen einer Produktion.
import { emit } from '../store.js';
import { clear, h } from '../util/dom.js';

/**
 * @param {object} opts
 * @param {() => object[]} opts.scenes          aktuelle Szenen (Quelle, z. B. store.scenes)
 * @param {object} opts.api                     { recall(id, othersOff), capture(body), update(id, body), remove(id), reorder(ids) }
 * @param {(sc: object) => Node[]} [opts.extraButtons]  zusätzliche Knöpfe je Szene
 * @param {Node[]} [opts.headerExtras]          zusätzliche Elemente neben der Überschrift „Szenen“
 * @param {string} [opts.emptyText]
 * @param {() => string|null} [opts.getActive] / [opts.setActive]  zuletzt abgerufene Szene
 * @returns {{ el: HTMLElement, render: () => void, recallNumber: (n: number) => void }}
 */
export function createSceneList(opts) {
  let localActive = null;
  const getActive = opts.getActive ?? (() => localActive);
  const setActive = opts.setActive ?? ((id) => { localActive = id; });

  const list = h('div', { class: 'scene-list' });
  const name = h('input', { type: 'text', placeholder: 'Name, z. B. „Akt 1 – Abend“', style: { flex: 1 } });
  const fade = h('input', { type: 'number', min: 0, max: 60, step: 0.5, value: 2 });
  const othersOff = h('input', { type: 'checkbox', checked: true });

  async function capture() {
    if (!name.value.trim()) return emit('toast', { text: 'Bitte einen Namen eingeben.' });
    await opts.api.capture({ name: name.value.trim(), fade: Number(fade.value) || 0 });
    emit('toast', { text: `Szene „${name.value.trim()}“ gespeichert.` });
    name.value = '';
  }
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') capture(); });

  const el = h('div', { class: 'stack', style: { gap: '16px' } },
    h('div', { class: 'card stack' },
      h('h2', {}, 'Aktuelles Licht als Szene speichern'),
      h('div', { class: 'row' }, name,
        h('label', { class: 'row muted small' }, 'Überblendung', fade, 's'),
        h('button', { class: 'btn primary', onclick: capture }, 'Speichern')),
      h('label', { class: 'row muted small' }, othersOff, 'Beim Abrufen Scheinwerfer ausschalten, die nicht in der Szene vorkommen')),
    h('div', { class: 'row' }, h('h2', { style: { margin: 0, flex: 1 } }, 'Szenen'), opts.headerExtras ?? []),
    list);

  async function recall(sc) {
    await opts.api.recall(sc.id, othersOff.checked);
    setActive(sc.id);
    render();
  }

  function render() {
    const scenes = opts.scenes();
    if (!scenes.length) {
      clear(list, h('p', { class: 'muted' }, opts.emptyText ?? 'Noch keine Szenen.'));
      return;
    }
    clear(list, scenes.map((sc, i) => {
      const lit = Object.values(sc.levels).filter((l) => l.dimmer > 0).length;
      return h('div', { class: `scene${getActive() === sc.id ? ' active' : ''}` },
        h('div', {},
          h('div', { class: 'name' }, `${i + 1}. ${sc.name}`),
          h('div', { class: 'meta' }, `${lit} Scheinwerfer an · Überblendung ${sc.fadeSeconds} s`)),
        h('button', { class: 'btn primary big', onclick: () => recall(sc) }, 'Abrufen ▶'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', title: 'Nach oben', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'btn small', title: 'Nach unten', disabled: i === scenes.length - 1, onclick: () => move(i, 1) }, '↓'),
          h('button', {
            class: 'btn small',
            title: 'Aktuelles Licht in diese Szene übernehmen',
            onclick: async () => {
              if (!confirm(`Szene „${sc.name}“ mit dem aktuellen Licht überschreiben?`)) return;
              await opts.api.capture({ name: sc.name, fade: sc.fadeSeconds, sceneId: sc.id });
              emit('toast', { text: 'Überschrieben.' });
            },
          }, 'Überschreiben'),
          h('button', {
            class: 'btn small',
            onclick: async () => {
              const n = prompt('Neuer Name', sc.name);
              const f = n === null ? null : prompt('Überblendzeit in Sekunden', sc.fadeSeconds);
              if (n !== null) await opts.api.update(sc.id, { name: n, fadeSeconds: f === null ? null : Number(f) });
            },
          }, 'Bearbeiten'),
          opts.extraButtons?.(sc) ?? [],
          h('button', {
            class: 'btn small danger',
            onclick: async () => { if (confirm(`Szene „${sc.name}“ löschen?`)) await opts.api.remove(sc.id); },
          }, 'Löschen')));
    }));
  }

  async function move(i, d) {
    const ids = opts.scenes().map((s) => s.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    await opts.api.reorder(ids);
  }

  return {
    el,
    render,
    recallNumber(n) {
      const sc = opts.scenes()[n - 1];
      if (sc) opts.api.recall(sc.id, othersOff.checked);
    },
  };
}
