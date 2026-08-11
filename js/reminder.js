(function () {
  "use strict";

  const DISPLAY_MS = 5200;

  function frenchTime(t) {
    const [h, m] = t.split(":").map(Number);
    return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // An original grumpy little character in the spirit of a single
  // continuous white-line silhouette (round belly, pointy nose, thin
  // limbs) - not a reproduction of any copyrighted character design.
  function characterSVG() {
    return `
      <svg class="mt-linea-svg" viewBox="0 0 120 140" aria-hidden="true">
        <g class="mt-linea-leg mt-linea-leg-back">
          <path d="M58 92 L52 128" />
        </g>
        <g class="mt-linea-leg mt-linea-leg-front">
          <path d="M66 92 L74 128" />
        </g>
        <g class="mt-linea-arm mt-linea-arm-back">
          <path d="M52 62 C44 66, 38 74, 36 84" />
        </g>
        <path class="mt-linea-body" d="M45 60
                 C40 78, 42 96, 62 96
                 C82 96, 84 78, 79 60
                 C76 48, 68 42, 62 42
                 C56 42, 48 48, 45 60 Z" />
        <g class="mt-linea-head">
          <circle class="mt-linea-skull" cx="62" cy="26" r="16" />
          <path class="mt-linea-nose" d="M78 25 L97 20" />
          <path class="mt-linea-brow" d="M52 17 L61 21 M71 17 L62 21" />
          <circle class="mt-linea-eye" cx="58" cy="25" r="1.7" />
        </g>
        <g class="mt-linea-arm mt-linea-arm-front">
          <path d="M70 62 C80 64, 88 58, 92 46" />
        </g>
      </svg>`;
  }

  function show(ev, minutesBefore) {
    const existing = document.querySelector(".mt-linea-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "mt-linea-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = `
      <div class="mt-linea-bubble">
        <strong>Dans ${minutesBefore} min !</strong>
        <span>${escapeHtml(ev.title)} · ${frenchTime(ev.start)}</span>
      </div>
      <div class="mt-linea-figure">${characterSVG()}</div>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("is-in")));

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      toast.classList.remove("is-in");
      toast.classList.add("is-out");
      setTimeout(() => toast.remove(), 450);
    };
    toast.addEventListener("click", dismiss);
    setTimeout(dismiss, DISPLAY_MS);
  }

  window.MemoTempsReminder = { show };
})();
