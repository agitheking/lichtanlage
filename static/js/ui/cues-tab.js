// Untertab „Ablauf“ einer Produktion. Platzhalter – Ablauf-Editor und Show-Modus folgen (T4).

export function mountCuesTab(root) {
  root.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Ablauf folgt.' }));
  return {};
}
