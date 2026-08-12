(function () {
  "use strict";

  const GIS_CDN = "https://accounts.google.com/gsi/client";
  const CONFIG_KEY = "mt_drive_config";
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const FILE_NAME = "memo-temps-events.json";
  const SYNC_INTERVAL_MS = 8 * 60 * 1000;
  const BOUNDARY = "mtdriveboundary";

  let widget = null;
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;
  let fileId = null;
  let syncTimer = null;
  let gisLoadPromise = null;
  let connectedEmail = null;

  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (gisLoadPromise) return gisLoadPromise;
    gisLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GIS_CDN;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Impossible de charger la bibliothèque Google. Vérifiez votre connexion."));
      document.head.appendChild(s);
    });
    return gisLoadPromise;
  }

  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"); } catch (e) { return null; }
  }
  function saveConfig(cfg) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }
  function clearConfig() { localStorage.removeItem(CONFIG_KEY); }

  async function ensureTokenClient(config) {
    await loadGis();
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: SCOPE,
        callback: () => {}
      });
    }
    return tokenClient;
  }

  function requestToken(config, opts) {
    return new Promise((resolve, reject) => {
      ensureTokenClient(config).then((client) => {
        client.callback = (resp) => {
          if (resp.error) { reject(new Error(resp.error)); return; }
          accessToken = resp.access_token;
          tokenExpiry = Date.now() + ((resp.expires_in || 3600) * 1000) - 30000;
          resolve(accessToken);
        };
        client.error_callback = (err) => reject(new Error((err && err.type) || "popup_blocked"));
        client.requestAccessToken({ prompt: opts && opts.silent ? "" : "consent" });
      }, reject);
    });
  }

  async function getToken(config, opts = {}) {
    if (accessToken && Date.now() < tokenExpiry) return accessToken;
    return requestToken(config, opts);
  }

  async function fetchProfile(token) {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.email || null;
  }

  function multipartBody(metadata, content) {
    return `--${BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
      + `--${BOUNDARY}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${BOUNDARY}--`;
  }

  async function findOrCreateFile(token) {
    if (fileId) return fileId;
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`, {
      headers: { Authorization: "Bearer " + token }
    });
    if (!listRes.ok) throw new Error("drive-" + listRes.status);
    const listData = await listRes.json();
    if (listData.files && listData.files.length) {
      fileId = listData.files[0].id;
      return fileId;
    }

    const createRes = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": `multipart/related; boundary=${BOUNDARY}` },
      body: multipartBody(
        { name: FILE_NAME, mimeType: "application/json" },
        JSON.stringify({ app: "MemoTemps", version: 1, events: [] })
      )
    });
    if (!createRes.ok) throw new Error("drive-" + createRes.status);
    const createData = await createRes.json();
    fileId = createData.id;
    return fileId;
  }

  async function downloadFile(token, id) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
      headers: { Authorization: "Bearer " + token }
    });
    if (!res.ok) throw new Error("drive-" + res.status);
    const text = await res.text();
    if (!text.trim()) return { events: [] };
    try { return JSON.parse(text); } catch (e) { return { events: [] }; }
  }

  async function uploadFile(token, id, payload) {
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: "PATCH",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("drive-" + res.status);
  }

  // Pulls the remote file, merges it into the local events (upsert by id,
  // never deletes - same safe merge widget.js already uses for JSON
  // import/export), then pushes the merged result back so both sides end
  // up consistent - a lightweight two-way sync around a single shared file.
  async function sync(config, opts = {}) {
    const token = await getToken(config, opts);
    const id = await findOrCreateFile(token);
    const remote = await downloadFile(token, id);
    widget.importEvents(remote);
    const merged = widget.exportEvents();
    await uploadFile(token, id, merged);
    return merged.events.length;
  }

  function startAutoSync(config) {
    stopAutoSync();
    syncTimer = setInterval(() => {
      sync(config, { silent: true }).catch(() => { /* next manual sync or reconnect will retry */ });
    }, SYNC_INTERVAL_MS);
  }
  function stopAutoSync() {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  }

  function attach(widgetInstance) {
    widget = widgetInstance;
    injectButton();
    const config = loadConfig();
    if (config) {
      sync(config, { silent: true }).then(() => { updateButtonState(); startAutoSync(config); }).catch(() => {});
    }
  }

  function injectButton() {
    const actions = document.querySelector(".mt-header-actions");
    if (!actions || actions.querySelector(".mt-drive-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mt-icon-btn mt-drive-btn";
    btn.setAttribute("aria-label", "Connecter Google Drive");
    btn.title = "Connecter Google Drive";
    btn.textContent = "📁";
    const addBtn = actions.querySelector(".mt-add-btn");
    actions.insertBefore(btn, addBtn);
    btn.addEventListener("click", openSettingsModal);
    updateButtonState(btn);
  }

  function updateButtonState(btn) {
    btn = btn || document.querySelector(".mt-drive-btn");
    if (!btn) return;
    btn.classList.toggle("is-connected", !!(loadConfig() && accessToken));
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function describeError(err) {
    const msg = (err && err.message) || String(err);
    if (msg.includes("popup_blocked") || msg.includes("popup_closed")) return "La fenêtre de connexion a été bloquée ou fermée. Autorisez les popups pour ce site et réessayez.";
    if (msg.includes("access_denied")) return "Connexion refusée. Vérifiez que votre adresse est bien ajoutée comme utilisateur de test dans l'écran de consentement OAuth.";
    if (msg.includes("drive-401") || msg.includes("drive-403")) return "Accès refusé par Google Drive. Vérifiez que l'API Drive est activée et l'écran de consentement configuré.";
    if (msg.includes("drive-")) return "Google Drive a renvoyé une erreur (" + msg + ").";
    if (msg.includes("Impossible de charger")) return msg;
    return "Échec de la connexion : " + msg;
  }

  function openSettingsModal() {
    const config = loadConfig() || { clientId: "" };
    const connected = !!accessToken;

    const overlay = document.createElement("div");
    overlay.className = "mt-modal-overlay";
    overlay.innerHTML = `
      <div class="mt-modal" role="dialog" aria-modal="true" aria-labelledby="mt-drive-title">
        <h2 id="mt-drive-title">Connecter Google Drive</h2>
        ${connected
          ? `<p class="mt-readonly-note">Connecté${connectedEmail ? " en tant que " + escapeHtml(connectedEmail) : ""}. Le fichier <strong>${FILE_NAME}</strong> de votre Drive est synchronisé avec vos objectifs et rendez-vous.</p>`
          : `<p class="mt-readonly-note">Renseignez l'ID client de votre application Google Cloud, puis connectez-vous. Un fichier "${FILE_NAME}" sera créé (ou réutilisé) dans votre Drive pour la synchronisation.</p>`
        }
        <form>
          <div class="mt-field">
            <label>ID client OAuth</label>
            <input type="text" name="clientId" required value="${escapeHtml(config.clientId || "")}" placeholder="ex. 123...-....apps.googleusercontent.com">
          </div>
          <p class="mt-outlook-error" hidden></p>
          <div class="mt-modal-actions">
            <div class="mt-modal-actions-left">
              ${connected ? `<button type="button" class="mt-btn mt-btn-danger" data-action="disconnect">Se déconnecter</button>` : ""}
            </div>
            <div class="mt-modal-actions-left">
              <button type="button" class="mt-btn mt-btn-ghost" data-action="cancel">Annuler</button>
              <button type="submit" class="mt-btn mt-btn-primary" data-action="connect">${connected ? "Resynchroniser" : "Se connecter"}</button>
            </div>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => { document.removeEventListener("keydown", onKeydown); overlay.remove(); };
    const onKeydown = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKeydown);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", close);

    const errorEl = overlay.querySelector(".mt-outlook-error");
    const showError = (msg) => { errorEl.textContent = msg; errorEl.hidden = false; };

    const disconnectBtn = overlay.querySelector('[data-action="disconnect"]');
    if (disconnectBtn) {
      disconnectBtn.addEventListener("click", () => {
        stopAutoSync();
        clearConfig();
        accessToken = null;
        tokenExpiry = 0;
        fileId = null;
        connectedEmail = null;
        updateButtonState();
        close();
      });
    }

    overlay.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const newConfig = { clientId: fd.get("clientId").trim() };
      if (!newConfig.clientId) return;

      const connectBtn = overlay.querySelector('[data-action="connect"]');
      connectBtn.disabled = true;
      connectBtn.textContent = "Connexion…";
      errorEl.hidden = true;

      try {
        saveConfig(newConfig);
        const token = await getToken(newConfig);
        connectedEmail = await fetchProfile(token);
        await sync(newConfig);
        startAutoSync(newConfig);
        updateButtonState();
        close();
      } catch (err) {
        connectBtn.disabled = false;
        connectBtn.textContent = connected ? "Resynchroniser" : "Se connecter";
        showError(describeError(err));
      }
    });

    overlay.querySelector('input[name="clientId"]').focus();
  }

  window.MemoTempsDrive = { attach };
})();
