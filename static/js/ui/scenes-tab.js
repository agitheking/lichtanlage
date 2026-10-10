// Tab „Szenen“: Lichtstimmungen speichern und mit Überblendzeit abrufen.
import { api } from '../api.js';
import { emit, on, store } from '../store.js';
import { clear, h } from '../util/dom.js';

export function mountScenesTab(root) {
  const list = h('div', { class: 'scene-list' });
  const name = h('input', { type: 'text', placeholder: 'Name, z. B. „Akt 1 – Abend“', style: { flex: 1 } });
  const fade = h('input', { type: 'number', min: 0, max: 60, step: 0.5, value: 2 });
  const othersOff = h('input', { type: 'checkbox', checked: true });

  async function capture() {
    if (!name.value.trim()) return emit('toast', { text: 'Bitte einen Namen eingeben.' });
    await api.post('/api/scenes/capture', { name: name.value.trim(), fade: Number(fade.value) || 0 });
    emit('toast', { text: `Szene „${name.value.trim()}“ gespeichert.` });
    name.value = '';
  }
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') capture(); });

  root.append(h('div', { class: 'scenes-layout' }, h('div', { class: 'inner' },
    h('div', { class: 'card stack' },
      h('h2', {}, 'Aktuelles Licht als Szene speichern'),
      h('div', { class: 'row' }, name,
        h('label', { class: 'row muted small' }, 'Überblendung', fade, 's'),
        h('button', { class: 'btn primary', onclick: capture }, 'Speichern')),
      h('label', { class: 'row muted small' }, othersOff, 'Beim Abrufen Scheinwerfer ausschalten, die nicht in der Szene vorkommen')),
    h('h2', {}, 'Szenen'),
    list)));

  function render() {
    if (!store.scenes.length) {
      clear(list, h('p', { class: 'muted' }, 'Noch keine Szenen. Stelle im Tab „Bühne“ ein Licht ein und speichere es hier.'));
      return;
    }
    clear(list, store.scenes.map((sc, i) => {
      const lit = Object.values(sc.levels).filter((l) => l.dimmer > 0).length;
      return h('div', { class: `scene${store.lastScene === sc.id ? ' active' : ''}` },
        h('div', {},
          h('div', { class: 'name' }, `${i + 1}. ${sc.name}`),
          h('div', { class: 'meta' }, `${lit} Scheinwerfer an · Überblendung ${sc.fadeSeconds} s`)),
        h('button', {
          class: 'btn primary big',
          onclick: async () => {
            await api.post(`/api/scenes/${sc.id}/recall`, { othersOff: othersOff.checked });
            store.lastScene = sc.id;
            render();
          },
        }, 'Abrufen ▶'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', title: 'Nach oben', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'btn small', title: 'Nach unten', disabled: i === store.scenes.length - 1, onclick: () => move(i, 1) }, '↓'),
          h('button', {
            class: 'btn small',
            title: 'Aktuelles Licht in diese Szene übernehmen',
            onclick: async () => {
              if (!confirm(`Szene „${sc.name}“ mit dem aktuellen Licht überschreiben?`)) return;
              await api.post('/api/scenes/capture', { name: sc.name, fade: sc.fadeSeconds, sceneId: sc.id });
              emit('toast', { text: 'Überschrieben.' });
            },
          }, 'Überschreiben'),
          h('button', {
            class: 'btn small',
            onclick: async () => {
              const n = prompt('Neuer Name', sc.name);
              const f = n === null ? null : prompt('Überblendzeit in Sekunden', sc.fadeSeconds);
              if (n !== null) await api.put(`/api/scenes/${sc.id}`, { name: n, fadeSeconds: f === null ? null : Number(f) });
            },
          }, 'Bearbeiten'),
          h('button', {
            class: 'btn small danger',
            onclick: async () => { if (confirm(`Szene „${sc.name}“ löschen?`)) await api.del(`/api/scenes/${sc.id}`); },
          }, 'Löschen')));
    }));
  }

  async function move(i, d) {
    const ids = store.scenes.map((s) => s.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    await api.post('/api/scenes/reorder', { ids });
  }

  on('scenes', render);
  return {
    key(e) {
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && store.scenes[n - 1]) api.post(`/api/scenes/${store.scenes[n - 1].id}/recall`, { othersOff: othersOff.checked });
    },
  };
}
