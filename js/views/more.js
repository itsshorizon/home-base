// More menu (#/more)
const ROWS = [
  { href: '#/household', icon: '👨‍👩‍👧', title: 'Household', sub: 'People, medications, pets' },
  { href: '#/comms', icon: '📻', title: 'Comms & Radio', sub: 'Listen, family plan, Meshtastic, ham' },
  { href: '#/plans', icon: '📋', title: 'Plans & Checklists', sub: "Go to Gram's, packing lists, scenarios" },
  { href: '#/print', icon: '🖨️', title: 'Print binder', sub: 'Paper backup for when the phone is dead' },
  { href: '#/settings', icon: '⚙️', title: 'Settings', sub: 'Backup, restore, storage, version' },
];

export function render(container) {
  container.innerHTML = `<h1>More</h1>${ROWS.map((r) => `
    <a class="card row-link big-row" href="${r.href}">
      <span class="emoji" aria-hidden="true">${r.icon}</span>
      <span class="grow"><span class="row-title">${r.title}</span><span class="muted small block">${r.sub}</span></span>
      <span class="chev" aria-hidden="true">›</span>
    </a>`).join('')}`;
}
