// "Coming in a later phase" screen for Map, Comms and Plans.
const INFO = {
  map: { icon: '🗺️', title: 'Map', line: 'Offline Henrico map with water sources.' },
  comms: { icon: '📻', title: 'Comms & Radio', line: 'Ham, GMRS, Meshtastic, local frequencies.' },
  plans: { icon: '📋', title: 'Plans & Checklists', line: 'Scenario checklists and go-bags.' },
};

export function render(container, params) {
  const info = INFO[params.name] || INFO.map;
  container.innerHTML = `<div class="card placeholder">
    <div class="empty-icon" aria-hidden="true">${info.icon}</div>
    <h1>${info.title}</h1>
    <p class="strong">Coming in a later phase</p>
    <p class="muted">${info.line}</p>
    <a class="btn" href="#/">Back to Home</a>
  </div>`;
}
