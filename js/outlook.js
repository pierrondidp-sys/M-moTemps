(function () {
  "use strict";

  const MSAL_CDN = "https://alcdn.msauth.net/browser/3.18.0/js/msal-browser.min.js";
  const CONFIG_KEY = "mt_outlook_config";
  const GRAPH_SCOPES = ["Calendars.Read"];
  const SYNC_INTERVAL_MS = 10 * 60 * 1000;
  const SYNC_DAYS_BEFORE = 7;
  const SYNC_DAYS_AFTER = 21;

  let msalInstance = null;
  let scriptLoadPromise = null;
  let widget = null;
  let syncTimer = null;

  function loadMsalScript() {
    if (window.msal) return Promise.resolve();
    if (scriptLoadPromise) return scriptLoadPromise;
    scriptLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = MSAL_CDN;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Impossible de charger la bibliothèque Microsoft (MSAL). Vérifiez votre connexion."));
      document.head.appendChild(s);
    });
    return scriptLoadPromise;
  }

  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"); } catch (e) { return null; }
  }
  function saveConfig(cfg) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }
  function clearConfig() { localStorage.removeItem(CONFIG_KEY); }

  async function getMsal(config) {
    await loadMsalScript();
    if (!msalInstance) {
      msalInstance = new window.msal.PublicClientApplication({
        auth: {
          clientId: config.clientId,
          authority: `https://login.microsoftonline.com/${config.tenantId}`,
          redirectUri: window.location.origin + window.location.pathname
        },
        cache: { cacheLocation: "localStorage" }
      });
      await msalInstance.initialize();
    }
    return msalInstance;
  }

  async function login(config) {
    const msal = await getMsal(config);
    const result = await msal.loginPopup({ scopes: GRAPH_SCOPES });
    msal.setActiveAccount(result.account);
    return result.account;
  }

  async function logout() {
    if (msalInstance) {
      const account = msalInstance.getActiveAccount();
      if (account) await msalInstance.logoutPopup({ account }).catch(() => {});
    }
    clearConfig();
    msalInstance = null;
    stopAutoSync();
    if (widget) widget.setExternalEvents([]);
  }

  async function getToken(config) {
    const msal = await getMsal(config);
    const account = msal.getActiveAccount() || msal.getAllAccounts()[0];
    if (!account) throw new Error("not-authenticated");
    try {
      const res = await msal.acquireTokenSilent({ scopes: GRAPH_SCOPES, account });
      return res.accessToken;
    } catch (e) {
      const res = await msal.acquireTokenPopup({ scopes: GRAPH_SCOPES, account });
      return res.accessToken;
    }
  }

  function graphEventToLocal(e) {
    const start = e.start.dateTime;
    const end = e.end.dateTime;
    return {
      id: "outlook_" + e.id,
      title: e.subject || "(Sans titre)",
      date: start.slice(0, 10),
      start: start.slice(11, 16),
      end: end.slice(0, 10) === start.slice(0, 10) ? end.slice(11, 16) : "",
      category: "rdv",
      notes: e.location && e.location.displayName ? e.location.displayName : "",
      done: false,
      source: "outlook"
    };
  }

  async function fetchEvents(config) {
    const token = await getToken(config);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rangeStart = new Date(today);
    rangeStart.setDate(rangeStart.getDate() - SYNC_DAYS_BEFORE);
    const rangeEnd = new Date(today);
    rangeEnd.setDate(rangeEnd.getDate() + SYNC_DAYS_AFTER + 1);

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const url = "https://graph.microsoft.com/v1.0/me/calendarView"
      + `?startDateTime=${encodeURIComponent(rangeStart.toISOString())}`
      + `&endDateTime=${encodeURIComponent(rangeEnd.toISOString())}`
      + "&$select=id,subject,start,end,isAllDay,location"
      + "&$top=250&$orderby=start/dateTime";

    const res = await fetch(url, {
      headers: {
        Authorization: "Bearer " + token,
        Prefer: `outlook.timezone="${tz}"`
      }
    });
    if (!res.ok) throw new Error("graph-" + res.status);
    const data = await res.json();
    return (data.value || []).filter((e) => !e.isAllDay).map(graphEventToLocal);
  }

  function startAutoSync(config) {
    stopAutoSync();
    syncTimer = setInterval(() => sync(config, { silent: true }), SYNC_INTERVAL_MS);
  }
  function stopAutoSync() {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  }

  async function sync(config, opts = {}) {
    try {
      const events = await fetchEvents(config);
      if (widget) widget.setExternalEvents(events);
      return { ok: true, count: events.length };
    } catch (err) {
      if (!opts.silent) throw err;
      return { ok: false, error: err };
    }
  }

  function attach(widgetInstance) {
    widget = widgetInstance;
    injectButton();
    const config = loadConfig();
    if (config) {
      sync(config, { silent: true }).then((r) => { if (r.ok) startAutoSync(config); });
    }
  }

  function injectButton() {
    const actions = document.querySelector(".mt-header-actions");
    if (!actions || actions.querySelector(".mt-outlook-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mt-icon-btn mt-outlook-btn";
    btn.setAttribute("aria-label", "Connecter Outlook");
    btn.title = "Connecter Outlook";
    btn.textContent = "📅";
    const addBtn = actions.querySelector(".mt-add-btn");
    actions.insertBefore(btn, addBtn);
    btn.addEventListener("click", openSettingsModal);
    updateButtonState(btn);
  }

  function updateButtonState(btn) {
    btn = btn || document.querySelector(".mt-outlook-btn");
    if (!btn) return;
    const connected = !!loadConfig() && !!(msalInstance && msalInstance.getActiveAccount());
    btn.classList.toggle("is-connected", connected);
  }

  function openSettingsModal() {
    const config = loadConfig() || { clientId: "", tenantId: "" };
    const account = msalInstance && msalInstance.getActiveAccount();

    const overlay = document.createElement("div");
    overlay.className = "mt-modal-overlay";
    overlay.innerHTML = `
      <div class="mt-modal" role="dialog" aria-modal="true" aria-labelledby="mt-outlook-title">
        <h2 id="mt-outlook-title">Connecter Outlook</h2>
        ${account
          ? `<p class="mt-readonly-note">Connecté en tant que ${escapeHtml(account.username || account.name || "")}.</p>`
          : `<p class="mt-readonly-note">Renseignez les identifiants de votre inscription d'application Azure (ID client et ID de locataire), puis connectez-vous. Aucune de ces valeurs n'est un secret.</p>`
        }
        <form>
          <div class="mt-field">
            <label>ID d'application (client)</label>
            <input type="text" name="clientId" required value="${escapeAttr(config.clientId)}" placeholder="ex. 3b1a...-...">
          </div>
          <div class="mt-field">
            <label>ID d'annuaire (locataire)</label>
            <input type="text" name="tenantId" required value="${escapeAttr(config.tenantId)}" placeholder="ex. 7c2e...-...">
          </div>
          <p class="mt-outlook-error" hidden></p>
          <div class="mt-modal-actions">
            <div class="mt-modal-actions-left">
              ${account ? `<button type="button" class="mt-btn mt-btn-danger" data-action="disconnect">Se déconnecter</button>` : ""}
            </div>
            <div class="mt-modal-actions-left">
              <button type="button" class="mt-btn mt-btn-ghost" data-action="cancel">Annuler</button>
              <button type="submit" class="mt-btn mt-btn-primary" data-action="connect">${account ? "Resynchroniser" : "Se connecter"}</button>
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
      disconnectBtn.addEventListener("click", async () => {
        disconnectBtn.disabled = true;
        await logout();
        updateButtonState();
        close();
      });
    }

    overlay.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const newConfig = { clientId: fd.get("clientId").trim(), tenantId: fd.get("tenantId").trim() };
      if (!newConfig.clientId || !newConfig.tenantId) return;

      const connectBtn = overlay.querySelector('[data-action="connect"]');
      connectBtn.disabled = true;
      connectBtn.textContent = "Connexion…";
      errorEl.hidden = true;

      try {
        saveConfig(newConfig);
        await login(newConfig);
        await sync(newConfig);
        startAutoSync(newConfig);
        updateButtonState();
        close();
      } catch (err) {
        connectBtn.disabled = false;
        connectBtn.textContent = account ? "Resynchroniser" : "Se connecter";
        showError(describeError(err));
      }
    });

    overlay.querySelector('input[name="clientId"]').focus();
  }

  function describeError(err) {
    const msg = (err && err.message) || String(err);
    if (msg.includes("graph-401") || msg.includes("graph-403")) return "Accès refusé par Microsoft Graph. Vérifiez la permission Calendars.Read dans Azure.";
    if (msg.includes("graph-")) return "Microsoft Graph a renvoyé une erreur (" + msg + ").";
    if (msg.includes("popup_window_error") || msg.includes("popup")) return "La fenêtre de connexion a été bloquée. Autorisez les popups pour ce site et réessayez.";
    if (msg.includes("Impossible de charger")) return msg;
    return "Échec de la connexion : " + msg;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(str) { return escapeHtml(str); }

  window.MemoTempsOutlook = { attach };
})();
