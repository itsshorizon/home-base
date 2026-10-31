// Settings: backup/restore, AI key, storage, version, danger zone (#/settings)
import { exportAll, importAll, getSettings, saveSettings, requestPersist, eraseAll } from '../db.js';
import { esc, fmtNum, toISODate } from '../format.js';
import { BUILD_ID, checkForUpdate } from '../app.js';
import { MODELS, DEFAULT_MODEL, KEY_TEST_URL, buildHeaders, buildKeyTestRequest } from '../ai.js';

const toast = (message) => window.dispatchEvent(new CustomEvent('hb:toast', { detail: { message } }));

let cleanup = null;
export function destroy() { if (cleanup) cleanup(); cleanup = null; }

function lastBackupText(iso) {
  if (!iso) return 'No backup yet.';
  const d = new Date(iso);
  return `Last backup: ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

async function storageText() {
  let used = 'unknown';
  let persisted = 'unknown';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      used = `${fmtNum((est.usage || 0) / 1048576, 1)} MB`;
    }
    if (navigator.storage && navigator.storage.persisted) persisted = (await navigator.storage.persisted()) ? 'protected' : 'not protected';
  } catch { /* leave as unknown */ }
  return { used, persisted };
}

export async function render(container) {
  const settings = await getSettings();
  container.innerHTML = `
    <a class="back" href="#/more">← More</a>
    <h1>Settings</h1>

    <section class="card">
      <h2>Backup</h2>
      <p class="muted">Your data lives only on this phone. Download a backup now and then: share it to Files or AirDrop it to your Mac.</p>
      <button class="btn primary" id="backup">Download backup</button>
      <p class="muted small" id="last-backup">${esc(lastBackupText(settings.lastBackupAt))}</p>
      <h3>Restore</h3>
      <label class="btn file-btn">Choose backup file<input type="file" id="restore" accept="application/json,.json" hidden></label>
      <p class="error" id="restore-error" role="alert" hidden></p>
    </section>

    <section class="card">
      <h2>AI photo ID</h2>
      <label class="field"><span>Anthropic API key</span>
        <div class="input-row"><input type="password" id="apikey" value="${esc(settings.apiKey)}" autocomplete="off" autocapitalize="none" spellcheck="false">
        <button type="button" class="btn small" id="showkey">Show</button></div></label>
      <div class="btn-row"><button class="btn" id="savekey">Save key</button><button class="btn" id="testkey">Test key</button></div>
      <p class="small" id="key-msg" role="status" hidden></p>
      <label class="field" style="margin-top:14px"><span>Model</span>
        <select id="aimodel">${MODELS.map((m) => `<option value="${esc(m.id)}"${(settings.aiModel || DEFAULT_MODEL) === m.id ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
        <small class="hint" id="model-blurb">${esc((MODELS.find((m) => m.id === (settings.aiModel || DEFAULT_MODEL)) || MODELS[0]).blurb)}</small></label>
      <p class="muted small">The key is stored only on this phone. It is sent to Anthropic, and nowhere else, when you identify a photo or test the key.</p>
      <p class="muted small">Get a key: <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com → API Keys</a>. Add a few dollars of credit; ~200 photos ≈ $4 on the default model.</p>
    </section>

    <section class="card">
      <h2>Storage</h2>
      <p id="storage">Checking…</p>
      <button class="btn" id="persist">Protect my data</button>
      <p class="muted small">Asks the phone not to clear Home Base's data when space runs low. Adding the app to your Home Screen helps too.</p>
    </section>

    <section class="card">
      <h2>App version</h2>
      <p>Home Base v${esc(BUILD_ID)}</p>
      <button class="btn" id="update">Check for update</button>
      <p class="muted small" id="update-msg"></p>
    </section>

    <section class="card danger-zone">
      <h2>Danger zone</h2>
      <p class="muted">Erase everything on this device: items, household, settings. Download a backup first.</p>
      <label class="field"><span>Type ERASE to confirm</span><input type="text" id="erase-text" autocapitalize="characters" autocomplete="off"></label>
      <button class="btn danger" id="erase" disabled>Erase all data</button>
    </section>`;

  const $ = (s) => container.querySelector(s);

  async function paintStorage() {
    const { used, persisted } = await storageText();
    const el = $('#storage');
    if (el) el.textContent = `Using ${used}. Storage is ${persisted}.`;
  }
  paintStorage();

  const onClick = async (e) => {
    const id = e.target.closest('button')?.id;
    if (id === 'backup') {
      try {
        const data = await exportAll();
        const text = JSON.stringify(data, null, 1);
        const name = `home-base-backup-${toISODate(new Date())}.json`;
        const file = new File([text], name, { type: 'application/json' });
        let shared = false;
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: 'Home Base backup' }); shared = true; } catch (err) {
            if (err && err.name === 'AbortError') return; // user closed the share sheet: no backup made
          }
        }
        if (!shared) {
          const url = URL.createObjectURL(file);
          const a = document.createElement('a');
          a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
        const when = new Date().toISOString();
        await saveSettings({ lastBackupAt: when });
        $('#last-backup').textContent = lastBackupText(when);
        toast('Backup saved');
      } catch (err) { toast(`Backup failed: ${err.message}`); }
    } else if (id === 'showkey') {
      const k = $('#apikey');
      k.type = k.type === 'password' ? 'text' : 'password';
      e.target.textContent = k.type === 'password' ? 'Show' : 'Hide';
    } else if (id === 'savekey') {
      await saveSettings({ apiKey: $('#apikey').value.trim() });
      toast('Key saved');
    } else if (id === 'testkey') {
      const msg = $('#key-msg');
      const key = $('#apikey').value.trim();
      msg.hidden = false; msg.className = 'small muted';
      if (!key) { msg.textContent = 'Type your key above first.'; return; }
      if (navigator.onLine === false) { msg.textContent = 'You are offline. Try again with a connection.'; return; }
      msg.textContent = 'Testing…';
      try {
        const res = await fetch(KEY_TEST_URL, { // free: counts the tokens of one tiny message
          method: 'POST', headers: buildHeaders(key), body: JSON.stringify(buildKeyTestRequest($('#aimodel').value)),
        });
        if (res.ok) { msg.textContent = 'Key works ✓'; msg.className = 'small ok'; }
        else if (res.status === 401 || res.status === 403) { msg.textContent = 'Your API key was rejected. Check it in Settings.'; msg.className = 'small error'; }
        else {
          let detail = '';
          try { detail = (await res.json()).error.message; } catch { /* no body */ }
          msg.textContent = `Anthropic answered with an error (${res.status}). ${detail}`.trim(); msg.className = 'small error';
        }
      } catch {
        msg.textContent = "Couldn't reach Anthropic. Check your connection and try again."; msg.className = 'small error';
      }
    } else if (id === 'persist') {
      const ok = await requestPersist();
      toast(ok ? 'Storage protected' : 'The browser did not grant protection. Try adding the app to your Home Screen.');
      paintStorage();
    } else if (id === 'update') {
      $('#update-msg').textContent = 'Checking…';
      const r = await checkForUpdate();
      $('#update-msg').textContent = r.error ? r.error : r.latest === r.current ? 'You have the latest version.' : `Version ${r.latest} found. Updating… the app will offer to reload.`;
    } else if (id === 'erase') {
      if ($('#erase-text').value !== 'ERASE') return;
      await eraseAll();
      try { sessionStorage.clear(); } catch { /* ignore */ }
      toast('All data erased');
      location.hash = '#/';
      setTimeout(() => location.reload(), 400);
    }
  };

  const onChange = async (e) => {
    if (e.target.id === 'aimodel') {
      await saveSettings({ aiModel: e.target.value });
      $('#model-blurb').textContent = (MODELS.find((m) => m.id === e.target.value) || MODELS[0]).blurb;
      toast('Model saved');
      return;
    }
    if (e.target.id !== 'restore' || !e.target.files.length) return;
    const err = $('#restore-error');
    err.hidden = true;
    const file = e.target.files[0];
    e.target.value = '';
    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch {
      err.textContent = 'That file is not a readable backup (it is not valid JSON).'; err.hidden = false; return;
    }
    if (!obj || obj.app !== 'home-base') { err.textContent = 'That file is not a Home Base backup.'; err.hidden = false; return; }
    if (!confirm('Replace everything on this device with this backup?')) return;
    try {
      await importAll(obj);
      toast('Backup restored');
      setTimeout(() => location.reload(), 500);
    } catch (ex) {
      err.textContent = `Restore failed: ${ex.message}`; err.hidden = false;
    }
  };

  const onInput = (e) => {
    if (e.target.id === 'erase-text') $('#erase').disabled = e.target.value !== 'ERASE';
  };

  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container.addEventListener('input', onInput);
  cleanup = () => {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
    container.removeEventListener('input', onInput);
  };
}
