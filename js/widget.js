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
    { id: uid(), title: "Point équipe", date: todayKey, start: "09:00", end: "09:30", category: "rdv", notes: "", done: false },
    { id: uid(), title: "Finir la maquette", date: todayKey, start: "14:00", end: "16:00", category: "objectif", notes: "", done: false },
    { id: uid(), title: "Appeler le client", date: tomorrowKey, start: "11:00", end: "", category: "rdv", notes: "", done: false }
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

      this.applyTheme();
      this.events = this.loadEvents();
      this.buildDom();
      this.render();
      this.centerOnToday(false);
      this.startClock();
    }

    loadEvents() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* ignore corrupted storage */ }
      const sample = SAMPLE_EVENTS(dateKey(this.today), dateKey(addDays(this.today, 1)));
      localStorage.setItem(this.storageKey, JSON.stringify(sample));
      return sample;
    }

    saveEvents() {
      localStorage.setItem(this.storageKey, JSON.stringify(this.events));
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

      this.el.prevBtn.addEventListener("click", () => this.el.viewport.scrollBy({ left: -DAY_WIDTH, behavior: "smooth" }));
      this.el.nextBtn.addEventListener("click", () => this.el.viewport.scrollBy({ left: DAY_WIDTH, behavior: "smooth" }));
      this.el.todayBtn.addEventListener("click", () => this.centerOnToday(true));
      this.el.addBtn.addEventListener("click", () => this.openModal(null, this.today));

      this.el.viewport.addEventListener("wheel", (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          this.el.viewport.scrollLeft += e.deltaY;
        }
      }, { passive: false });

      this.attachDrag();
    }

    attachDrag() {
      const vp = this.el.viewport;
      let isDown = false, startX = 0, startScroll = 0, moved = false;
      vp.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".mt-event")) return;
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

    centerOnToday(smooth) {
      const todayX = diffDays(this.rangeStart, this.today) * DAY_WIDTH;
      const target = todayX - this.el.viewport.clientWidth / 2 + DAY_WIDTH / 2;
      this.el.viewport.scrollTo({ left: Math.max(0, target), behavior: smooth ? "smooth" : "auto" });
    }

    startClock() {
      this.renderNowLine();
      this.checkAnnouncements();
      setInterval(() => { this.renderNowLine(); this.checkAnnouncements(); }, 30000);
    }

    checkAnnouncements() {
      if (!this.soundEnabled) return;
      const now = new Date();
      const todayKey = dateKey(now);
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      this.events.forEach((ev) => {
        if (ev.date !== todayKey) return;
        const key = `${ev.date}_${ev.id}`;
        if (this.announced.has(key)) return;
        const startMinutes = timeToHours(ev.start) * 60;
        if (nowMinutes >= startMinutes && nowMinutes - startMinutes < ANNOUNCE_WINDOW_MIN) {
          this.announced.add(key);
          Sound.chime();
          speak(`C'est l'heure : ${ev.title}.`);
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
      const { items, laneCount } = this.layoutLanes(this.events);
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
        html += `<div class="mt-event cat-${ev.category}${hasEnd ? "" : " is-point"}${ev.done ? " is-done" : ""}"
                      style="left:${startX}px;top:${lane * LANE_H}px;${styleWidth}"
                      data-id="${ev.id}" tabindex="0" role="button" title="${escapeHtml(ev.title)}">
          <span class="mt-event-time">${ev.start}</span><span class="mt-event-title">${escapeHtml(ev.title)}</span>
          <button type="button" class="mt-event-speak" aria-label="Écouter cet événement">🔊</button>
        </div>`;
      });
      html += `</div><div class="mt-now-line" style="display:none"></div>`;

      this.el.content.innerHTML = html;

      this.el.content.querySelectorAll(".mt-event").forEach((node) => {
        const openIt = () => {
          const ev = this.events.find((e) => e.id === node.dataset.id);
          if (ev) this.openModal(ev);
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
          const ev = this.events.find((e2) => e2.id === node.dataset.id);
          if (ev) speakEvent(ev);
        });
      });

      this.el.nowLine = this.el.content.querySelector(".mt-now-line");
      this.renderNowLine();
    }

    renderNowLine() {
      if (!this.el.nowLine) return;
      const now = new Date();
      const x = this.xForDateTime(startOfDay(now), now.getHours() + now.getMinutes() / 60);
      this.el.nowLine.style.left = x + "px";
      this.el.nowLine.style.display = "";
    }

    openModal(existingEvent, defaultDate) {
      if (this.soundEnabled) Sound.open();
      this.editingId = existingEvent ? existingEvent.id : null;
      const ev = existingEvent || {
        title: "", category: "objectif",
        date: dateKey(defaultDate || this.today),
        start: "09:00", end: "", notes: "", done: false
      };

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
          this.events = this.events.filter((e) => e.id !== this.editingId);
          this.saveEvents();
          this.render();
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
        this.saveEvents();
        this.render();
        close();
      });

      overlay.querySelector('input[name="title"]').focus();
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(str) { return escapeHtml(str); }

  window.MemoTempsWidget = MemoTempsWidget;
})();
