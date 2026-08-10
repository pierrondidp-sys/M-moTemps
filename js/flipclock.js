(function () {
  "use strict";

  const FLIP_DURATION_MS = 620;
  const pendingTimeouts = new WeakMap();

  function pad2(n) { return String(n).padStart(2, "0"); }

  function buildPanelHTML(value) {
    return `
      <div class="mt-flip">
        <div class="mt-flip-static mt-flip-static-top"><span>${value}</span></div>
        <div class="mt-flip-static mt-flip-static-bottom"><span>${value}</span></div>
        <div class="mt-flip-leaf mt-flip-leaf-top"><span>${value}</span></div>
        <div class="mt-flip-leaf mt-flip-leaf-bottom"><span>${value}</span></div>
        <div class="mt-flip-seam"></div>
      </div>`;
  }

  function panelSpans(panelEl) {
    return {
      staticTop: panelEl.querySelector(".mt-flip-static-top span"),
      staticBottom: panelEl.querySelector(".mt-flip-static-bottom span"),
      leafTop: panelEl.querySelector(".mt-flip-leaf-top span"),
      leafBottom: panelEl.querySelector(".mt-flip-leaf-bottom span")
    };
  }

  function clearPending(panelEl) {
    const pending = pendingTimeouts.get(panelEl);
    if (pending) { clearTimeout(pending); pendingTimeouts.delete(panelEl); }
  }

  // Snaps a panel straight to a value with no animation - used for the
  // initial render and as a safe fallback so a value is never left stuck
  // mid-flip (e.g. after the tab was backgrounded and missed ticks).
  function setInstant(panelEl, value) {
    clearPending(panelEl);
    const { staticTop, staticBottom, leafTop, leafBottom } = panelSpans(panelEl);
    staticTop.textContent = value;
    staticBottom.textContent = value;
    leafTop.textContent = value;
    leafBottom.textContent = value;
    panelEl.classList.remove("is-flipping");
  }

  function updatePanel(panelEl, newValue) {
    const { staticTop, staticBottom, leafTop, leafBottom } = panelSpans(panelEl);
    if (staticTop.textContent === newValue) return;

    // A previous flip is still mid-animation (most likely because the tab
    // was backgrounded and several ticks queued up) - don't layer a new
    // animation on top of it, just land on the correct value directly.
    if (panelEl.classList.contains("is-flipping") || document.hidden) {
      setInstant(panelEl, newValue);
      return;
    }

    const oldValue = staticTop.textContent;
    leafTop.textContent = oldValue;
    leafBottom.textContent = newValue;
    staticTop.textContent = newValue;

    panelEl.classList.add("is-flipping");

    clearPending(panelEl);
    const timeoutId = setTimeout(() => {
      staticBottom.textContent = newValue;
      panelEl.classList.remove("is-flipping");
      pendingTimeouts.delete(panelEl);
    }, FLIP_DURATION_MS);
    pendingTimeouts.set(panelEl, timeoutId);
  }

  function mount(headerEl) {
    if (!headerEl || headerEl.querySelector(".mt-clock")) return;
    const now = new Date();

    const wrap = document.createElement("div");
    wrap.className = "mt-clock";
    wrap.setAttribute("role", "timer");
    wrap.setAttribute("aria-label", "Heure actuelle");
    wrap.innerHTML = buildPanelHTML(pad2(now.getHours()))
      + `<div class="mt-clock-sep">:</div>`
      + buildPanelHTML(pad2(now.getMinutes()));

    const title = headerEl.querySelector(".mt-header-title");
    if (title) title.insertAdjacentElement("afterend", wrap);
    else headerEl.insertBefore(wrap, headerEl.firstChild);

    const [hourPanel, minutePanel] = wrap.querySelectorAll(".mt-flip");

    function tick() {
      const d = new Date();
      updatePanel(hourPanel, pad2(d.getHours()));
      updatePanel(minutePanel, pad2(d.getMinutes()));
    }

    function resyncInstantly() {
      const d = new Date();
      setInstant(hourPanel, pad2(d.getHours()));
      setInstant(minutePanel, pad2(d.getMinutes()));
    }

    // Whenever the tab regains visibility, force an immediate, unanimated
    // resync - this is the safety net against any timer throttling that
    // happened while hidden, so the clock is always correct the instant
    // it's looked at again.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) resyncInstantly();
    });

    function scheduleNextTick() {
      const d = new Date();
      const msToNextMinute = (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 50;
      setTimeout(() => { tick(); setInterval(tick, 60000); }, msToNextMinute);
    }
    scheduleNextTick();
  }

  window.MemoTempsFlipClock = { mount };
})();
