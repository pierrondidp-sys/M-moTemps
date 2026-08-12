(function () {
  "use strict";

  let widget = null;

  function pad2(n) { return String(n).padStart(2, "0"); }

  function attach(widgetInstance) {
    widget = widgetInstance;
    injectButton();
  }

  function injectButton() {
    const actions = document.querySelector(".mt-header-actions");
    if (!actions || actions.querySelector(".mt-backup-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mt-icon-btn mt-backup-btn";
    btn.setAttribute("aria-label", "Exporter ou importer mes données");
    btn.title = "Exporter / importer mes données";
    btn.textContent = "💾";
    const addBtn = actions.querySelector(".mt-add-btn");
    actions.insertBefore(btn, addBtn);
    btn.addEventListener("click", openModal);
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openModal() {
    const overlay = document.createElement("div");
    overlay.className = "mt-modal-overlay";
    overlay.innerHTML = `
      <div class="mt-modal" role="dialog" aria-modal="true" aria-labelledby="mt-backup-title">
        <h2 id="mt-backup-title">Exporter / importer</h2>
        <p class="mt-readonly-note">Sauvegardez vos objectifs et rendez-vous dans un fichier, à ranger par exemple dans votre dossier OneDrive, pour les retrouver sur un autre appareil.</p>
        <div class="mt-field">
          <label>Exporter</label>
          <button type="button" class="mt-btn mt-btn-primary" data-action="export">Télécharger mes données (.json)</button>
        </div>
        <div class="mt-field">
          <label>Importer</label>
          <input type="file" accept="application/json,.json" data-action="file">
        </div>
        <p class="mt-backup-status" hidden></p>
        <div class="mt-modal-actions">
          <div class="mt-modal-actions-left"></div>
          <div class="mt-modal-actions-left">
            <button type="button" class="mt-btn mt-btn-ghost" data-action="close">Fermer</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => { document.removeEventListener("keydown", onKeydown); overlay.remove(); };
    const onKeydown = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKeydown);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-action="close"]').addEventListener("click", close);

    const statusEl = overlay.querySelector(".mt-backup-status");
    const showStatus = (msg, isError) => {
      statusEl.textContent = msg;
      statusEl.hidden = false;
      statusEl.classList.toggle("is-error", !!isError);
    };

    overlay.querySelector('[data-action="export"]').addEventListener("click", () => {
      const payload = widget.exportEvents();
      const now = new Date();
      const filename = `memo-temps-${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}.json`;
      download(filename, JSON.stringify(payload, null, 2));
      showStatus(`Fichier téléchargé (${payload.events.length} événement(s)). Déplacez-le dans votre dossier OneDrive pour le synchroniser.`, false);
    });

    overlay.querySelector('[data-action="file"]').addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const payload = JSON.parse(reader.result);
          const result = widget.importEvents(payload);
          const deletedNote = result.deleted ? `, ${result.deleted} supprimé(s)` : "";
          const skippedNote = result.skipped ? ` (${result.skipped} ignoré(s), format invalide)` : "";
          showStatus(`Import réussi : ${result.added} ajouté(s), ${result.updated} mis à jour${deletedNote}${skippedNote}.`, false);
        } catch (err) {
          showStatus("Fichier invalide ou illisible. Vérifiez qu'il s'agit bien d'un export de Mémo Temps.", true);
        }
        e.target.value = "";
      };
      reader.onerror = () => showStatus("Impossible de lire le fichier.", true);
      reader.readAsText(file);
    });
  }

  window.MemoTempsBackup = { attach };
})();
