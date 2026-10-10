// Kleine DOM-Helfer, damit die UI-Module ohne Framework auskommen.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else if (k in el && typeof el[k] !== 'function' && !k.includes('-')) el[k] = v;
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const pct = (v) => `${Math.round(v * 100)} %`;

export function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Modaler Dialog. buttons: [{ label, class, onclick }] – onclick darf ein Promise liefern;
// liefert es false, bleibt der Dialog offen. Esc/„Abbrechen“ schließt ohne Aktion.
export function dialog(title, content, buttons) {
  const dlg = h('dialog', { class: 'dialog' });
  const close = () => { dlg.close(); };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.append(
    h('h2', {}, title),
    h('div', { class: 'stack' }, content),
    h('div', { class: 'row end', style: { marginTop: '16px' } },
      h('button', { class: 'btn', onclick: close }, 'Abbrechen'),
      buttons.map((b) => h('button', {
        class: `btn ${b.class ?? ''}`,
        onclick: async () => { if ((await b.onclick()) !== false) close(); },
      }, b.label))));
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
