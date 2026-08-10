(function () {
  "use strict";

  const FLIP_DURATION_MS = 620;

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

  function updatePanel(panelEl, newValue) {
    const staticTop = panelEl.querySelector(".mt-flip-static-top span");
    const staticBottom = panelEl.querySelector(".mt-flip-static-bottom span");
    const leafTop = panelEl.querySelector(".mt-flip-leaf-top span");
    const leafBottom = panelEl.querySelector(".mt-flip-leaf-bottom span");
    const oldValue = staticTop.textContent;
    if (oldValue === newValue) return;

    leafTop.textContent = oldValue;
    leafBottom.textContent = newValue;
    staticTop.textContent = newValue;

    panelEl.classList.remove("is-flipping");
    void panelEl.offsetWidth;
    panelEl.classList.add("is-flipping");

    setTimeout(() => {
      staticBottom.textContent = newValue;
      panelEl.classList.remove("is-flipping");
    }, FLIP_DURATION_MS);
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

    function scheduleNextTick() {
      const d = new Date();
      const msToNextMinute = (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 50;
      setTimeout(() => { tick(); setInterval(tick, 60000); }, msToNextMinute);
    }
    scheduleNextTick();
  }

  window.MemoTempsFlipClock = { mount };
})();
