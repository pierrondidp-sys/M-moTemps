(function () {
  "use strict";

  const HOUR_WIDTH = 46;
  const DAY_WIDTH = HOUR_WIDTH * 24;
  const DAYS_BEFORE = 7;
  const DAYS_AFTER = 21;
  const HEADER_H = 34;
  const EVENTS_TOP = 58;
  const LANE_H = 42;
  const MIN_BAR_WIDTH = 200;
  const POINT_RESERVED_WIDTH = 190;
  const STORAGE_KEY = "mt_events_v1";
  const SOUND_KEY = "mt_sound_enabled";
  const THEME_KEY = "mt_theme";
  const THEME_CYCLE = ["system", "light", "dark"];
  const THEME_META = {
    system: { icon: "🖥️", label: "Thème : système (cliquer pour clair)" },
    light: { icon: "☀️", label: "Thème : clair (cliquer pour sombre)" },
    dark: { icon: "🌙", label: "Thème : sombre (cliquer pour système)" }
  };
  const ANNOUNCE_WINDOW_MIN = 2;
  const PRE_ANNOUNCE_MIN = 5;
  const FOLLOW_RESUME_IDLE_MS = 12000;

  const pad2 = (n) => String(n).padStart(2, "0");
  const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const startOfDay = (d) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
  const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
  const diffDays = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  const timeToHours = (t) => { const [h, m] = t.split(":").map(Number); return h + m / 60; };
  const uid = () => "ev_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function formatDayHeader(d, today) {
    const label = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" }).format(d);
    return diffDays(today, d) === 0 ? "Aujourd'hui" : capitalize(label.replace(".", ""));
  }

  let audioCtx = null;
  function getAudioCtx() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function playTone(freq, duration, opts = {}) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + duration);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(opts.volume || 0.12, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  const Sound = {
    open: () => playTone(660, 0.09, { slideTo: 880 }),
    save: () => { playTone(660, 0.08, { slideTo: 880 }); setTimeout(() => playTone(880, 0.12, { slideTo: 1175 }), 70); },
    delete: () => playTone(520, 0.14, { slideTo: 220, type: "triangle" }),
    chime: () => { playTone(784, 0.16, { slideTo: 988, volume: 0.14 }); setTimeout(() => playTone(988, 0.22, { slideTo: 1318, volume: 0.12 }), 110); }
  };

  function frenchTime(t) {
    const [h, m] = t.split(":").map(Number);
    return m === 0 ? `${h} heures` : `${h} heures ${pad2(m)}`;
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "fr-FR";
    const voices = window.speechSynthesis.getVoices();
    const frVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("fr"));
    if (frVoice) utter.voice = frVoice;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  function speakEvent(ev) {
    const catLabel = ev.category === "objectif" ? "Objectif" : "Rendez-vous";
    const timeLabel = ev.end ? `de ${frenchTime(ev.start)} à ${frenchTime(ev.end)}` : `à ${frenchTime(ev.start)}`;
    speak(`${catLabel} : ${ev.title}, ${timeLabel}.`);
  }

  const SAMPLE_EVENTS = (todayKey, tomorrowKey) => [
    { id: "sample_1", title: "Point équipe", date: todayKey, start: "09:00", end: "09:30", category: "rdv", notes: "", done: false },
    { id: "sample_2", title: "Finir la maquette", date: todayKey, start: "14:00", end: "16:00", category: "objectif", notes: "", done: false },
    { id: "sample_3", title: "Appeler le client", date: tomorrowKey, start: "11:00", end: "", category: "rdv", notes: "", done: false }
  ];

  class MemoTempsWidget {
    constructor(container, options = {}) {
      this.container = container;
      this.today = startOfDay(new Date());
      this.rangeStart = addDays(this.today, -DAYS_BEFORE);
      this.rangeEnd = addDays(this.today, DAYS_AFTER);
      this.totalDays = diffDays(this.rangeStart, this.rangeEnd) + 1;
      this.contentWidth = this.totalDays * DAY_WIDTH;
      this.editingId = null;
      this.storageKey = options.storageKey || STORAGE_KEY;
      this.soundEnabled = localStorage.getItem(SOUND_KEY) !== "0";
      this.theme = THEME_CYCLE.includes(localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : "system";
      this.announced = new Set();
      this.externalEvents = [];
      this.followNow = true;
      this.followResumeTimer = null;

      this.applyTheme();
      this.events = this.loadEvents();
      this.buildDom();
      this.render();
      this.centerOnToday(false);
      this.updateTodayBtnLabel();
      this.startClock();
    }

    loadEvents() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          // Legacy format: the key used to hold a bare events array. Treat
          // that as "no tombstones yet" rather than migrating explicitly.
          if (Array.isArray(parsed)) { this.tombstones = {}; return parsed; }
          this.tombstones = (parsed && parsed.tombstones) || {};
          return (parsed && parsed.events) || [];
        }
      } catch (e) { /* ignore corrupted storage */ }
      this.tombstones = {};
      const sample = SAMPLE_EVENTS(dateKey(this.today), dateKey(addDays(this.today, 1)));
      localStorage.setItem(this.storageKey, JSON.stringify({ events: sample, tombstones: {} }));
      return sample;
    }

    // Tombstones only need to outlive the longest realistic gap between two
    // syncs of the same device; a year is generous and keeps them from
    // growing local storage forever.
    pruneTombstones() {
      const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
      Object.keys(this.tombstones).forEach((id) => {
        if (this.tombstones[id] < cutoff) delete this.tombstones[id];
      });
    }

    saveEvents() {
      this.pruneTombstones();
      localStorage.setItem(this.storageKey, JSON.stringify({ events: this.events, tombstones: this.tombstones }));
    }

    deleteEvent(id) {
      this.events = this.events.filter((e) => e.id !== id);
      this.tombstones[id] = Date.now();
      this.saveEvents();
      this.render();
      this.emitChanged();
    }

    // Fired only for genuine local user edits (add/edit/delete an event),
    // never from the merge inside importEvents() - otherwise a sync pulling
    // in remote changes would immediately re-trigger another sync, and so
    // on. drive.js listens for this to push a change to Drive right away
    // instead of waiting for the next periodic sync.
    emitChanged() {
      window.dispatchEvent(new CustomEvent("mt:events-changed"));
    }

    exportEvents() {
      return {
        app: "MemoTemps",
        version: 1,
        exportedAt: new Date().toISOString(),
        events: this.events,
        tombstones: this.tombstones
      };
    }

    // Merges incoming events by id (upsert) and incoming deletions
    // (tombstones) by id. A tombstone always wins over an event with the
    // same id, on either side - so deleting an event on one device makes
    // it disappear everywhere once every device has synced, instead of
    // being silently resurrected by the next sync pulling the old copy
    // back in. The only exception is the untouched starter demo events
    // (id "sample_*") seeded on a fresh install: those are cleared out
    // once real data is imported, so they don't linger as clutter.
    importEvents(payload) {
      const list = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.events) ? payload.events : null);
      if (!list) throw new Error("format-invalide");
      const incomingTombstones = (!Array.isArray(payload) && payload && payload.tombstones) || {};

      Object.keys(incomingTombstones).forEach((id) => {
        if (!this.tombstones[id] || incomingTombstones[id] > this.tombstones[id]) this.tombstones[id] = incomingTombstones[id];
      });

      const byId = new Map(this.events.map((e) => [e.id, e]));
      let added = 0, updated = 0, skipped = 0, deleted = 0;
      list.forEach((ev) => {
        if (!ev || typeof ev !== "object" || !ev.id || !ev.title || !ev.date || !ev.start) { skipped++; return; }
        if (this.tombstones[ev.id]) { skipped++; return; }
        if (byId.has(ev.id)) updated++; else added++;
        byId.set(ev.id, ev);
      });

      Array.from(byId.keys()).forEach((id) => {
        if (this.tombstones[id]) { byId.delete(id); deleted++; }
        else if (id.startsWith("sample_") && !list.some((ev) => ev && ev.id === id)) byId.delete(id);
      });

      this.events = Array.from(byId.values());
      this.saveEvents();
      this.render();
      return { added, updated, skipped, deleted, total: this.events.length };
    }

    setExternalEvents(list) {
      this.externalEvents = list;
      this.render();
    }

    buildDom() {
      this.container.innerHTML = `
        <div class="mt-widget">
          <div class="mt-header">
            <div class="mt-header-title">
              <h1>Mémo Temps</h1>
              <div class="mt-today-label"></div>
            </div>
            <div class="mt-legend">
              <span><i class="mt-dot objectif"></i>Objectif</span>
              <span><i class="mt-dot rdv"></i>Rendez-vous</span>
            </div>
            <div class="mt-header-actions">
              <button type="button" class="mt-today-btn">Aujourd'hui</button>
              <button type="button" class="mt-icon-btn mt-theme-btn" aria-label="Changer le thème">🖥️</button>
              <button type="button" class="mt-icon-btn mt-sound-btn" aria-label="Activer ou couper le son" aria-pressed="true">🔊</button>
              <button type="button" class="mt-add-btn" aria-label="Ajouter un objectif ou rendez-vous">+</button>
            </div>
          </div>
          <div class="mt-timeline">
            <button type="button" class="mt-arrow mt-arrow-prev" aria-label="Jour précédent">&#8249;</button>
            <div class="mt-viewport">
              <div class="mt-content"></div>
            </div>
            <button type="button" class="mt-arrow mt-arrow-next" aria-label="Jour suivant">&#8250;</button>
            <div class="mt-now-line" aria-hidden="true"></div>
          </div>
        </div>
      `;

      this.el = {
        todayLabel: this.container.querySelector(".mt-today-label"),
        viewport: this.container.querySelector(".mt-viewport"),
        content: this.container.querySelector(".mt-content"),
        prevBtn: this.container.querySelector(".mt-arrow-prev"),
        nextBtn: this.container.querySelector(".mt-arrow-next"),
        todayBtn: this.container.querySelector(".mt-today-btn"),
        addBtn: this.container.querySelector(".mt-add-btn"),
        soundBtn: this.container.querySelector(".mt-sound-btn"),
        themeBtn: this.container.querySelector(".mt-theme-btn")
      };

      this.updateSoundBtn();
      this.el.soundBtn.addEventListener("click", () => {
        this.soundEnabled = !this.soundEnabled;
        localStorage.setItem(SOUND_KEY, this.soundEnabled ? "1" : "0");
        this.updateSoundBtn();
        if (this.soundEnabled) Sound.open();
      });

      this.updateThemeBtn();
      this.el.themeBtn.addEventListener("click", () => {
        const next = THEME_CYCLE[(THEME_CYCLE.indexOf(this.theme) + 1) % THEME_CYCLE.length];
        this.theme = next;
        localStorage.setItem(THEME_KEY, this.theme);
        this.applyTheme();
        this.updateThemeBtn();
        if (this.soundEnabled) Sound.open();
      });

      this.el.todayLabel.textContent = capitalize(
        new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(this.today)
      );

      this.el.prevBtn.addEventListener("click", () => {
        this.pauseFollow();
        this.el.viewport.scrollBy({ left: -DAY_WIDTH, behavior: "smooth" });
      });
      this.el.nextBtn.addEventListener("click", () => {
        this.pauseFollow();
        this.el.viewport.scrollBy({ left: DAY_WIDTH, behavior: "smooth" });
      });
      this.el.todayBtn.addEventListener("click", () => this.openDatePicker());
      this.el.addBtn.addEventListener("click", () => this.openModal(null, this.today));

      this.el.viewport.addEventListener("wheel", (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          this.pauseFollow();
          this.el.viewport.scrollLeft += e.deltaY;
        }
      }, { passive: false });

      this.el.viewport.addEventListener("scroll", () => this.updateTodayBtnLabel(), { passive: true });

      this.attachDrag();
    }

    attachDrag() {
      const vp = this.el.viewport;
      let isDown = false, startX = 0, startScroll = 0, moved = false;
      vp.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".mt-event")) return;
        this.pauseFollow();
        isDown = true; moved = false;
        startX = e.clientX;
        startScroll = vp.scrollLeft;
        vp.classList.add("mt-dragging");
        vp.setPointerCapture(e.pointerId);
      });
      vp.addEventListener("pointermove", (e) => {
        if (!isDown) return;
        const dx = e.clientX - startX;
        if (Math.abs(dx) > 3) moved = true;
        vp.scrollLeft = startScroll - dx;
      });
      const stop = (e) => {
        isDown = false;
        vp.classList.remove("mt-dragging");
      };
      vp.addEventListener("pointerup", stop);
      vp.addEventListener("pointercancel", stop);
      vp.addEventListener("click", (e) => {
        if (moved) { e.stopPropagation(); moved = false; }
      }, true);
    }

    updateSoundBtn() {
      this.el.soundBtn.textContent = this.soundEnabled ? "🔊" : "🔇";
      this.el.soundBtn.setAttribute("aria-pressed", String(this.soundEnabled));
      this.el.soundBtn.title = this.soundEnabled ? "Couper le son" : "Activer le son";
    }

    applyTheme() {
      if (this.theme === "system") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", this.theme);
    }

    updateThemeBtn() {
      if (!this.el.themeBtn) return;
      const meta = THEME_META[this.theme];
      this.el.themeBtn.textContent = meta.icon;
      this.el.themeBtn.title = meta.label;
      this.el.themeBtn.setAttribute("aria-label", meta.label);
    }

    // Centers the viewport on the exact current minute, so the fixed
    // "now" needle (see .mt-now-line) always points at the real time
    // whenever the timeline is following it.
    centerOnToday(smooth) {
      const now = new Date();
      const nowX = this.xForDateTime(startOfDay(now), now.getHours() + now.getMinutes() / 60);
      const target = nowX - this.el.viewport.clientWidth / 2;
      this.el.viewport.scrollTo({ left: Math.max(0, target), behavior: smooth ? "smooth" : "auto" });
    }

    prefersReducedMotion() {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }

    // Manual navigation (arrows, drag, wheel) temporarily stops the
    // timeline from auto-scrolling to keep "now" under the fixed needle,
    // so it doesn't fight the user mid-browse; it resumes on its own
    // after a short idle period, or immediately via the "Aujourd'hui" button.
    pauseFollow() {
      this.followNow = false;
      clearTimeout(this.followResumeTimer);
      this.followResumeTimer = setTimeout(() => this.resumeFollow(), FOLLOW_RESUME_IDLE_MS);
    }

    resumeFollow() {
      this.followNow = true;
      this.centerOnToday(!this.prefersReducedMotion());
    }

    // Scrolls to center a specific date under the fixed "now" needle.
    // Picking today itself resumes live-following rather than a one-off
    // scroll, since that's the more useful behavior when jumping back.
    goToDate(dateObj) {
      const target = startOfDay(dateObj);
      if (diffDays(this.today, target) === 0) {
        clearTimeout(this.followResumeTimer);
        this.resumeFollow();
        return;
      }
      this.pauseFollow();
      const clientW = this.el.viewport.clientWidth;
      const dayX = diffDays(this.rangeStart, target) * DAY_WIDTH;
      const scrollTarget = dayX + DAY_WIDTH / 2 - clientW / 2;
      const maxScroll = Math.max(0, this.contentWidth - clientW);
      this.el.viewport.scrollTo({
        left: Math.min(Math.max(0, scrollTarget), maxScroll),
        behavior: this.prefersReducedMotion() ? "auto" : "smooth"
      });
    }

    // rangeStart/rangeEnd/totalDays/contentWidth are fixed at load time
    // (today -DAYS_BEFORE to +DAYS_AFTER). Saving an event with a date
    // outside that window used to leave it positioned way past the
    // rendered day-blocks and ticks - technically in the DOM, but with no
    // visual context and often far beyond what's reachable by scrolling,
    // which looked exactly like the edit had silently done nothing. Grows
    // the window (never shrinks it) to always include a given date.
    ensureDateInRange(dateObj) {
      const target = startOfDay(dateObj);
      let changed = false;
      if (diffDays(this.rangeStart, target) < 0) { this.rangeStart = target; changed = true; }
      if (diffDays(target, this.rangeEnd) < 0) { this.rangeEnd = target; changed = true; }
      if (changed) {
        this.totalDays = diffDays(this.rangeStart, this.rangeEnd) + 1;
        this.contentWidth = this.totalDays * DAY_WIDTH;
      }
      return changed;
    }

    centeredDate() {
      const clientW = this.el.viewport.clientWidth;
      const centerX = this.el.viewport.scrollLeft + clientW / 2;
      const dayIndex = Math.min(Math.max(Math.floor(centerX / DAY_WIDTH), 0), this.totalDays - 1);
      return addDays(this.rangeStart, dayIndex);
    }

    updateTodayBtnLabel() {
      const viewed = this.centeredDate();
      const diff = diffDays(this.today, viewed);
      if (diff === 0) this.el.todayBtn.textContent = "Aujourd'hui";
      else if (diff === -1) this.el.todayBtn.textContent = "Hier";
      else if (diff === 1) this.el.todayBtn.textContent = "Demain";
      else {
        this.el.todayBtn.textContent = capitalize(
          new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(viewed).replace(".", "")
        );
      }
    }

    openDatePicker() {
      if (this.soundEnabled) Sound.open();
      const viewed = this.centeredDate();
      let displayYear = viewed.getFullYear();
      let displayMonth = viewed.getMonth();

      const overlay = document.createElement("div");
      overlay.className = "mt-modal-overlay";
      overlay.innerHTML = `
        <div class="mt-modal" role="dialog" aria-modal="true" aria-labelledby="mt-dp-title">
          <h2 id="mt-dp-title">Aller à une date</h2>
          <div class="mt-dp-quick">
            <button type="button" class="mt-btn mt-btn-ghost" data-quick="-1">Hier</button>
            <button type="button" class="mt-btn mt-btn-ghost" data-quick="0">Aujourd'hui</button>
            <button type="button" class="mt-btn mt-btn-ghost" data-quick="1">Demain</button>
          </div>
          <div class="mt-dp-cal">
            <div class="mt-dp-cal-head">
              <button type="button" class="mt-dp-nav" data-nav="-1" aria-label="Mois précédent">&#8249;</button>
              <span class="mt-dp-month"></span>
              <button type="button" class="mt-dp-nav" data-nav="1" aria-label="Mois suivant">&#8250;</button>
            </div>
            <div class="mt-dp-weekdays"><span>Lu</span><span>Ma</span><span>Me</span><span>Je</span><span>Ve</span><span>Sa</span><span>Di</span></div>
            <div class="mt-dp-grid"></div>
          </div>
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

      const goAndClose = (d) => {
        this.goToDate(d);
        if (this.soundEnabled) Sound.save();
        close();
      };

      overlay.querySelectorAll("[data-quick]").forEach((btn) => {
        btn.addEventListener("click", () => goAndClose(addDays(this.today, Number(btn.dataset.quick))));
      });

      const monthLabel = overlay.querySelector(".mt-dp-month");
      const gridEl = overlay.querySelector(".mt-dp-grid");
      const rangeStartKey = dateKey(this.rangeStart);
      const rangeEndKey = dateKey(this.rangeEnd);

      // Which dates have an objectif and/or a rendez-vous (own events and
      // any imported read-only ones), so the calendar can mark them - a
      // snapshot taken once when the picker opens is enough, since events
      // don't change while it's up.
      const eventDates = new Map();
      this.events.concat(this.externalEvents).forEach((ev) => {
        const info = eventDates.get(ev.date) || { objectif: false, rdv: false };
        if (ev.category === "objectif") info.objectif = true; else info.rdv = true;
        eventDates.set(ev.date, info);
      });

      const renderCalendar = () => {
        const first = new Date(displayYear, displayMonth, 1);
        monthLabel.textContent = capitalize(new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(first));
        const leading = (first.getDay() + 6) % 7; // Monday-first offset
        const gridStart = addDays(first, -leading);

        let html = "";
        for (let i = 0; i < 42; i++) {
          const d = addDays(gridStart, i);
          if (d.getMonth() !== displayMonth) { html += `<span class="mt-dp-day is-outside"></span>`; continue; }
          const key = dateKey(d);
          const inRange = key >= rangeStartKey && key <= rangeEndKey;
          const classes = ["mt-dp-day"];
          if (diffDays(this.today, d) === 0) classes.push("is-today");
          if (diffDays(viewed, d) === 0) classes.push("is-viewed");
          if (!inRange) classes.push("is-disabled");
          const info = eventDates.get(key);
          const dots = `<span class="mt-dp-day-dots">${info && info.objectif ? '<i class="mt-dp-dot objectif"></i>' : ""}${info && info.rdv ? '<i class="mt-dp-dot rdv"></i>' : ""}</span>`;
          html += `<button type="button" class="${classes.join(" ")}" ${inRange ? "" : "disabled"} data-date="${key}"><span class="mt-dp-day-num">${d.getDate()}</span>${dots}</button>`;
        }
        gridEl.innerHTML = html;

        gridEl.querySelectorAll(".mt-dp-day[data-date]").forEach((btn) => {
          btn.addEventListener("click", () => goAndClose(this.parseDate(btn.dataset.date)));
        });
      };

      overlay.querySelectorAll("[data-nav]").forEach((btn) => {
        btn.addEventListener("click", () => {
          displayMonth += Number(btn.dataset.nav);
          if (displayMonth < 0) { displayMonth = 11; displayYear--; }
          if (displayMonth > 11) { displayMonth = 0; displayYear++; }
          renderCalendar();
        });
      });

      renderCalendar();
    }

    startClock() {
      this.checkAnnouncements();
      setInterval(() => {
        if (this.followNow) this.centerOnToday(!this.prefersReducedMotion());
        this.checkAnnouncements();
      }, 30000);
    }

    checkAnnouncements() {
      if (!this.soundEnabled) return;
      const now = new Date();
      const todayKey = dateKey(now);
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      this.events.forEach((ev) => {
        if (ev.date !== todayKey) return;
        const startMinutes = timeToHours(ev.start) * 60;

        const startKey = `${ev.date}_${ev.id}`;
        if (!this.announced.has(startKey) && nowMinutes >= startMinutes && nowMinutes - startMinutes < ANNOUNCE_WINDOW_MIN) {
          this.announced.add(startKey);
          Sound.chime();
          speak(`C'est l'heure : ${ev.title}.`);
        }

        const preKey = `${startKey}_pre${PRE_ANNOUNCE_MIN}`;
        const minutesUntil = startMinutes - nowMinutes;
        if (!this.announced.has(preKey) && minutesUntil > 0 && minutesUntil <= PRE_ANNOUNCE_MIN) {
          this.announced.add(preKey);
          if (window.MemoTempsReminder) window.MemoTempsReminder.show(ev);
        }

        // Once the event's own start time actually arrives, clear the
        // reminder if it's still showing - whether or not the user
        // already dismissed it by clicking.
        if (minutesUntil <= 0 && window.MemoTempsReminder) {
          window.MemoTempsReminder.hideIfShowing(ev.id);
        }
      });
    }

    xForDateTime(dateObj, hours) {
      return diffDays(this.rangeStart, dateObj) * DAY_WIDTH + hours * HOUR_WIDTH;
    }

    layoutLanes(dayEvents) {
      const items = dayEvents.map((ev) => {
        const startH = timeToHours(ev.start);
        const startX = this.xForDateTime(this.parseDate(ev.date), startH);
        const hasEnd = !!ev.end;
        const endX = hasEnd
          ? startX + Math.max((timeToHours(ev.end) - startH) * HOUR_WIDTH, MIN_BAR_WIDTH)
          : startX + POINT_RESERVED_WIDTH;
        return { ev, startX, endX, hasEnd };
      }).sort((a, b) => a.startX - b.startX);

      const laneEnds = [];
      items.forEach((item) => {
        let lane = laneEnds.findIndex((end) => end + 6 <= item.startX);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.endX); }
        else { laneEnds[lane] = item.endX; }
        item.lane = lane;
      });
      return { items, laneCount: Math.max(1, laneEnds.length) };
    }

    parseDate(key) {
      const [y, m, d] = key.split("-").map(Number);
      return new Date(y, m - 1, d);
    }

    render() {
      const { items, laneCount } = this.layoutLanes(this.events.concat(this.externalEvents));
      const contentHeight = EVENTS_TOP + laneCount * LANE_H + 14;

      this.el.content.style.width = this.contentWidth + "px";
      this.el.content.style.height = contentHeight + "px";
      this.el.viewport.style.height = contentHeight + "px";

      let html = "";

      for (let i = 0; i < this.totalDays; i++) {
        const d = addDays(this.rangeStart, i);
        const isToday = diffDays(this.today, d) === 0;
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const left = i * DAY_WIDTH;
        html += `<div class="mt-day-block${isToday ? " is-today" : ""}${isWeekend ? " is-weekend" : ""}"
                      style="left:${left}px;width:${DAY_WIDTH}px" data-date="${dateKey(d)}">
          <div class="mt-day-header">${isToday ? '<i class="mt-day-dot"></i>' : ""}${formatDayHeader(d, this.today)}</div>
        </div>`;

        for (let h = 0; h <= 23; h++) {
          const x = left + h * HOUR_WIDTH;
          const major = h % 3 === 0;
          html += `<div class="mt-hour-tick${major ? " major" : ""}" style="left:${x}px"></div>`;
          if (major) html += `<div class="mt-hour-label" style="left:${x}px">${h}h</div>`;
        }
      }

      html += `<div class="mt-events-layer">`;
      items.forEach(({ ev, startX, lane, hasEnd }) => {
        const width = hasEnd ? Math.max((timeToHours(ev.end) - timeToHours(ev.start)) * HOUR_WIDTH, MIN_BAR_WIDTH) : null;
        const styleWidth = hasEnd ? `width:${width}px;` : "";
        const isExternal = ev.source === "outlook";
        html += `<div class="mt-event cat-${ev.category}${hasEnd ? "" : " is-point"}${ev.done ? " is-done" : ""}${isExternal ? " is-external" : ""}"
                      style="left:${startX}px;top:${lane * LANE_H}px;${styleWidth}"
                      data-id="${ev.id}" tabindex="0" role="button" title="${escapeHtml(ev.title)}${isExternal ? " (Outlook)" : ""}">
          <span class="mt-event-time">${ev.start}</span><span class="mt-event-title">${escapeHtml(ev.title)}</span>
          <button type="button" class="mt-event-speak" aria-label="Écouter cet événement">🔊</button>
        </div>`;
      });
      html += `</div>`;

      this.el.content.innerHTML = html;

      const findEvent = (id) => this.events.find((e) => e.id === id) || this.externalEvents.find((e) => e.id === id);

      this.el.content.querySelectorAll(".mt-event").forEach((node) => {
        const openIt = () => {
          const ev = findEvent(node.dataset.id);
          if (ev) this.openModal(ev, null, { readOnly: ev.source === "outlook" });
        };
        node.addEventListener("click", (e) => {
          if (e.target.closest(".mt-event-speak")) return;
          openIt();
        });
        node.addEventListener("keydown", (e) => {
          if (e.target.closest(".mt-event-speak")) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openIt(); }
        });
        const speakBtn = node.querySelector(".mt-event-speak");
        speakBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const ev = findEvent(node.dataset.id);
          if (ev) speakEvent(ev);
        });
      });

    }

    openModal(existingEvent, defaultDate, opts = {}) {
      if (this.soundEnabled) Sound.open();
      this.editingId = existingEvent ? existingEvent.id : null;
      const ev = existingEvent || {
        title: "", category: "objectif",
        date: dateKey(defaultDate || this.today),
        start: "09:00", end: "", notes: "", done: false
      };

      if (opts.readOnly) {
        this.openReadOnlyModal(ev);
        return;
      }

      const overlay = document.createElement("div");
      overlay.className = "mt-modal-overlay";
      overlay.innerHTML = `
        <div class="mt-modal" role="dialog" aria-modal="true" aria-labelledby="mt-modal-title">
          <h2 id="mt-modal-title">${existingEvent ? "Modifier" : "Ajouter"} un objectif / rendez-vous</h2>
          <form>
            <div class="mt-field">
              <label>Titre</label>
              <input type="text" name="title" required maxlength="80" value="${escapeAttr(ev.title)}" placeholder="Ex. Réunion budget">
            </div>
            <div class="mt-field">
              <label>Type</label>
              <div class="mt-type-choice">
                <label><input type="radio" name="category" value="objectif" ${ev.category === "objectif" ? "checked" : ""}><i class="mt-dot objectif"></i><span>Objectif</span></label>
                <label><input type="radio" name="category" value="rdv" ${ev.category === "rdv" ? "checked" : ""}><i class="mt-dot rdv"></i><span>Rendez-vous</span></label>
              </div>
            </div>
            <div class="mt-field">
              <label>Date</label>
              <input type="date" name="date" required value="${ev.date}">
            </div>
            <div class="mt-row">
              <div class="mt-field">
                <label>Heure de début</label>
                <input type="time" name="start" required value="${ev.start}">
              </div>
              <div class="mt-field">
                <label>Heure de fin (optionnel)</label>
                <input type="time" name="end" value="${ev.end || ""}">
              </div>
            </div>
            <div class="mt-field">
              <label>Notes</label>
              <textarea name="notes" maxlength="300" placeholder="Détails, lieu, contexte...">${escapeHtml(ev.notes || "")}</textarea>
            </div>
            <div class="mt-modal-actions">
              <div class="mt-modal-actions-left">
                ${existingEvent ? `<button type="button" class="mt-btn mt-btn-danger" data-action="delete">Supprimer</button>` : ""}
              </div>
              <div class="mt-modal-actions-left">
                <button type="button" class="mt-btn mt-btn-ghost" data-action="cancel">Annuler</button>
                <button type="submit" class="mt-btn mt-btn-primary">Enregistrer</button>
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

      const deleteBtn = overlay.querySelector('[data-action="delete"]');
      if (deleteBtn) {
        deleteBtn.addEventListener("click", () => {
          if (this.soundEnabled) Sound.delete();
          this.deleteEvent(this.editingId);
          close();
        });
      }

      overlay.querySelector("form").addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
          title: fd.get("title").trim(),
          category: fd.get("category"),
          date: fd.get("date"),
          start: fd.get("start"),
          end: fd.get("end") || "",
          notes: fd.get("notes").trim(),
          done: existingEvent ? existingEvent.done : false
        };
        if (payload.end && payload.end <= payload.start) payload.end = "";
        if (!payload.title || !payload.date || !payload.start) return;

        if (existingEvent) {
          Object.assign(existingEvent, payload);
        } else {
          this.events.push({ id: uid(), ...payload });
        }
        if (this.soundEnabled) Sound.save();
        this.ensureDateInRange(this.parseDate(payload.date));
        this.saveEvents();
        this.render();
        this.emitChanged();
        this.goToDate(this.parseDate(payload.date));
        close();
      });

      overlay.querySelector('input[name="title"]').focus();
    }

    openReadOnlyModal(ev) {
      const overlay = document.createElement("div");
      overlay.className = "mt-modal-overlay";
      const catLabel = ev.category === "objectif" ? "Objectif" : "Rendez-vous";
      const timeLabel = ev.end ? `${ev.start} – ${ev.end}` : ev.start;
      overlay.innerHTML = `
        <div class="mt-modal" role="dialog" aria-modal="true" aria-labelledby="mt-modal-title">
          <h2 id="mt-modal-title">${escapeHtml(ev.title)}</h2>
          <div class="mt-field"><label>Type</label><div>${catLabel}</div></div>
          <div class="mt-field"><label>Date</label><div>${ev.date}</div></div>
          <div class="mt-field"><label>Heure</label><div>${timeLabel}</div></div>
          ${ev.notes ? `<div class="mt-field"><label>Notes</label><div>${escapeHtml(ev.notes)}</div></div>` : ""}
          <p class="mt-readonly-note">Importé depuis Outlook — lecture seule, modifiable dans Outlook.</p>
          <div class="mt-modal-actions">
            <div class="mt-modal-actions-left"></div>
            <div class="mt-modal-actions-left">
              <button type="button" class="mt-btn mt-btn-primary" data-action="close">Fermer</button>
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
      overlay.querySelector('[data-action="close"]').focus();
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(str) { return escapeHtml(str); }

  // Every modal in the app (event form, date picker, Outlook/Drive/backup
  // settings) is built independently but shares the same .mt-modal-overlay
  // > .mt-modal > h2 markup, so a single observer here can add the zoom
  // toggle to all of them instead of repeating it in each file.
  function enhanceModal(overlay) {
    const modal = overlay.querySelector(".mt-modal");
    const h2 = modal && modal.querySelector("h2");
    if (!modal || !h2 || modal.querySelector(".mt-modal-zoom-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mt-modal-zoom-btn";
    const setLabel = (expanded) => {
      btn.textContent = expanded ? "⤡" : "⤢";
      const label = expanded ? "Réduire la fenêtre" : "Agrandir la fenêtre";
      btn.title = label;
      btn.setAttribute("aria-label", label);
    };
    setLabel(false);
    btn.addEventListener("click", () => setLabel(modal.classList.toggle("is-expanded")));
    h2.insertAdjacentElement("afterend", btn);
  }

  if (typeof MutationObserver !== "undefined") {
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && node.classList.contains("mt-modal-overlay")) enhanceModal(node);
        }
      }
    }).observe(document.body, { childList: true });
  }

  window.MemoTempsWidget = MemoTempsWidget;
})();
