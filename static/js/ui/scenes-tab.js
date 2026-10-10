// Tab „Szenen“ (Bibliothek): Lichtstimmungen speichern und mit Überblendzeit abrufen.
import { api } from '../api.js';
import { emit, on, store } from '../store.js';
import { dialog, h } from '../util/dom.js';
import { createSceneList } from './scene-list.js';

export function mountScenesTab(root) {
  const list = createSceneList({
    scenes: () => store.scenes,
    api: {
      recall: (id, othersOff) => api.post(`/api/scenes/${id}/recall`, { othersOff }),
      capture: (body) => api.post('/api/scenes/capture', body),
      update: (id, body) => api.put(`/api/scenes/${id}`, body),
      remove: (id) => api.del(`/api/scenes/${id}`),
      reorder: (ids) => api.post('/api/scenes/reorder', { ids }),
    },
    extraButtons: (sc) => [h('button', {
      class: 'btn small',
      title: 'Eigenständige Kopie dieser Szene in einer Produktion anlegen',
      onclick: () => copyToProduction(sc),
    }, 'In Produktion kopieren')],
    getActive: () => store.lastScene,
    setActive: (id) => { store.lastScene = id; },
    emptyText: 'Noch keine Szenen. Stelle im Tab „Bühne“ ein Licht ein und speichere es hier.',
  });

  root.append(h('div', { class: 'scenes-layout' }, h('div', { class: 'inner' }, list.el)));

  function copyToProduction(sc) {
    if (!store.productions.length) {
      emit('toast', { text: 'Es gibt noch keine Produktion. Lege zuerst im Tab „Produktionen“ eine an.', error: true });
      return;
    }
    const target = h('select', {},
      store.productions.map((p) => h('option', { value: p.id, selected: p.id === store.activeProductionId }, p.name)));
    dialog(`Szene „${sc.name}“ in Produktion kopieren`,
      h('label', { class: 'field' }, 'Ziel-Produktion', target),
      [{
        label: 'Kopieren',
        class: 'primary',
        onclick: async () => {
          await api.post(`/api/productions/${target.value}/scenes/copy-from-library`, { sceneIds: [sc.id] });
          const p = store.productions.find((x) => x.id === target.value);
          emit('toast', { text: `„${sc.name}“ nach „${p?.name ?? target.value}“ kopiert.` });
        },
      }]);
  }

  on('scenes', list.render);
  return {
    key(e) {
      const n = Number(e.key);
      if (n >= 1 && n <= 9) list.recallNumber(n);
    },
  };
}
