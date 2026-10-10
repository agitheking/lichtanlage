// Show-Modus: Ablauf einer Produktion Eintrag für Eintrag abfahren.
// Alle Aktionen gehen an /api/show/*; die Anzeige folgt ausschließlich store.show (WS-Event „show“),
// damit alle Browser synchron bleiben.
import { api } from '../api.js';
import { store } from '../store.js';
import { clear, h } from '../util/dom.js';

/**
 * @param {object} opts
 * @param {(p: object, cue: object) => { scene: object|null, label: string, missing: boolean }} opts.describe
 * @returns {{ el: HTMLElement, render: () => void, key: (e: KeyboardEvent) => void }}
 */
export function createShowMode(opts) {
  const action = (path, body) => api.post(`/api/show/${path}`, body);
  // Nach einem Klick den Fokus abgeben, damit die Leertaste den Knopf nicht erneut auslöst.
  const press = (fn) => (e) => { e.currentTarget.blur(); fn(); };

  const title = h('div', { class: 'show-title' });
  const now = h('div', { class: 'show-now' });
  const next = h('div', { class: 'show-next' });
  const btnPrev = h('button', { class: 'btn show-btn', onclick: press(() => action('prev')) }, '◀ Zurück');
  const btnNext = h('button', { class: 'btn primary show-btn show-go', onclick: press(() => action('next')) }, 'Weiter ▶');
  const list = h('div', { class: 'show-list' });

  const el = h('div', { class: 'show-mode' },
    h('div', { class: 'show-main' },
      h('div', { class: 'show-top' },
        title,
        h('button', { class: 'btn danger', title: 'Show beenden (Esc) – das Licht bleibt, wie es ist', onclick: press(() => action('stop')) }, 'Beenden')),
      now,
      next,
      h('div', { class: 'show-controls' }, btnPrev, btnNext),
      h('div', { class: 'muted small show-hint' },
        'Leertaste / → / Bild ab = weiter · ← / Rücktaste / Bild auf = zurück · Esc = beenden · Klick auf eine Zeile springt dorthin')),
    list);

  let lastIndex = null;

  function cueBlock(label, p, i) {
    const cue = p.cues[i];
    const d = opts.describe(p, cue);
    return [
      h('div', { class: 'show-label' }, label),
      h('div', { class: 'show-line' },
        h('span', { class: 'show-nr' }, i + 1),
        h('span', { class: `show-scene${d.missing ? ' missing' : d.scene ? '' : ' note-only'}` }, d.label)),
      cue.note ? h('div', { class: 'show-note' }, cue.note) : null,
    ];
  }

  function render() {
    const st = store.show;
    const p = store.productions.find((x) => x.id === st.productionId);
    if (!st.running || !p) return;
    const i = st.cueIndex ?? 0;
    title.textContent = `Show: ${p.name}`;
    clear(now, cueBlock('AKTUELL', p, i));
    if (i + 1 < p.cues.length) clear(next, cueBlock('NÄCHSTER', p, i + 1));
    else clear(next, h('div', { class: 'show-label' }, 'NÄCHSTER'), h('div', { class: 'show-end' }, 'Ende des Ablaufs'));
    next.classList.toggle('at-end', i + 1 >= p.cues.length);
    btnPrev.disabled = i === 0;
    btnNext.disabled = i + 1 >= p.cues.length;

    const top = list.scrollTop;
    clear(list, p.cues.map((cue, n) => {
      const d = opts.describe(p, cue);
      const fade = cue.fadeSeconds ?? d.scene?.fadeSeconds;
      return h('div', {
        class: `show-row${n === i ? ' current' : n < i ? ' done' : ''}${d.missing ? ' missing' : ''}`,
        title: 'Zu diesem Eintrag springen',
        onclick: () => action('goto', { cueIndex: n }),
      },
      h('span', { class: 'nr' }, n + 1),
      h('span', { class: 'scene-name' }, d.label),
      h('span', { class: 'fade' }, d.scene && fade !== undefined ? `${fade} s` : ''),
      h('span', { class: 'note' }, cue.note));
    }));
    list.scrollTop = top;
    const row = list.children[i];
    if (row && i !== lastIndex) {
      list.scrollTo({ top: row.offsetTop - (list.clientHeight - row.offsetHeight) / 2, behavior: lastIndex === null ? 'auto' : 'smooth' });
    }
    lastIndex = i;
  }

  return {
    el,
    render,
    reset() { lastIndex = null; },
    key(e) {
      if (e.repeat) { if (e.key === ' ') e.preventDefault(); return; }
      if ([' ', 'ArrowRight', 'PageDown'].includes(e.key)) action('next');
      else if (['ArrowLeft', 'Backspace', 'PageUp'].includes(e.key)) action('prev');
      else if (e.key === 'Escape') action('stop');
      else return;
      e.preventDefault();
    },
  };
}
