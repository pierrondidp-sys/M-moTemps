(function () {
  "use strict";

  let plateEl = null;
  let normalHTML = null;
  let currentEventId = null;

  function frenchTime(t) {
    const [h, m] = t.split(":").map(Number);
    return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function bulbSVG() {
    return `
      <svg class="mt-bulb-svg" viewBox="0 0 64 64" aria-hidden="true">
        <g class="mt-bulb-rays">
          <line x1="32" y1="2" x2="32" y2="9" />
          <line x1="9" y1="9" x2="15" y2="15" />
          <line x1="55" y1="9" x2="49" y2="15" />
          <line x1="3" y1="29" x2="11" y2="29" />
          <line x1="61" y1="29" x2="53" y2="29" />
        </g>
        <path class="mt-bulb-glass" d="M32 8
          C20 8, 13 17, 13 27
          C13 35, 17 40, 21 44
          C23 46, 24 48, 24 51
          L40 51
          C40 48, 41 46, 43 44
          C47 40, 51 35, 51 27
          C51 17, 44 8, 32 8 Z" />
        <path class="mt-bulb-filament" d="M25 27 L30 35 L26 35 L31 43 M31 27 L34 33" />
        <rect class="mt-bulb-base" x="24" y="51" width="16" height="4" rx="1.5" />
        <rect class="mt-bulb-base" x="25" y="56" width="14" height="4" rx="1.5" />
        <rect class="mt-bulb-cap" x="26.5" y="61" width="11" height="3" rx="1.5" />
      </svg>`;
  }

  function ensurePlate() {
    if (plateEl) return;
    plateEl = document.querySelector(".mt-header-title");
    if (plateEl && normalHTML === null) normalHTML = plateEl.innerHTML;
  }

  function show(ev) {
    ensurePlate();
    if (!plateEl || currentEventId === ev.id) return;

    currentEventId = ev.id;
    plateEl.classList.add("is-reminder");
    plateEl.innerHTML = `
      <div class="mt-bulb-reminder" role="button" tabindex="0" aria-label="Rappel : ${escapeHtml(ev.title)} à ${frenchTime(ev.start)}. Cliquer pour masquer.">
        <div class="mt-bulb-figure">${bulbSVG()}</div>
        <div class="mt-bulb-text">
          <strong>${escapeHtml(ev.title)}</strong>
          <span>${frenchTime(ev.start)}</span>
        </div>
      </div>`;

    const trigger = plateEl.querySelector(".mt-bulb-reminder");
    trigger.addEventListener("click", hide);
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hide(); }
    });
  }

  function hide() {
    if (!plateEl || currentEventId === null) return;
    plateEl.classList.remove("is-reminder");
    plateEl.innerHTML = normalHTML;
    currentEventId = null;
  }

  // Called on every clock tick once an event's start time has actually
  // arrived, regardless of whether the user already dismissed it by
  // clicking - a no-op if it isn't the one currently shown (or already gone).
  function hideIfShowing(eventId) {
    if (currentEventId === eventId) hide();
  }

  window.MemoTempsReminder = { show, hide, hideIfShowing };
})();
