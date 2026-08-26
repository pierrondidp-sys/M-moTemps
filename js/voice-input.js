(function () {
  "use strict";

  // Adds a mic button next to Titre/Date/Heure/Notes in the add/rendez-vous
  // form (see widget.js's "mt:event-modal-opened" event) so they can be
  // filled by voice on a phone. Uses the browser's built-in Web Speech API -
  // no server, no key. Widely supported on Android Chrome; unsupported
  // browsers (older Safari, most desktop Firefox) simply don't get the mic
  // buttons rather than showing something broken.
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

  const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
  const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

  function stripAccents(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function toDateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // Best-effort French date parsing: "aujourd'hui", "demain", "après-demain",
  // weekday names (optionally + "prochain"), "15 mars [2026]", "15/03[/2026]".
  // Speech engines transcribe spoken numbers as digits already, so no
  // word-to-number mapping is needed here.
  function parseSpokenDate(rawText, today) {
    const text = stripAccents(rawText.toLowerCase().trim());

    if (/\baujourd ?'? ?hui\b/.test(text)) return toDateKey(today);
    if (/\bapres[ -]?demain\b/.test(text)) return toDateKey(addDays(today, 2));
    if (/\bdemain\b/.test(text)) return toDateKey(addDays(today, 1));

    for (let i = 0; i < WEEKDAYS.length; i++) {
      if (new RegExp("\\b" + WEEKDAYS[i] + "\\b").test(text)) {
        let delta = (i - today.getDay() + 7) % 7;
        if (delta === 0) delta = 7;
        if (/\bprochain e?\b|\bprochaine?\b/.test(text)) delta += 7;
        return toDateKey(addDays(today, delta));
      }
    }

    for (let i = 0; i < MONTHS.length; i++) {
      const m = text.match(new RegExp("\\b(\\d{1,2})\\s+" + MONTHS[i] + "\\b(?:\\s+(\\d{4}))?"));
      if (m) {
        const day = parseInt(m[1], 10);
        if (day < 1 || day > 31) continue;
        const year = m[2] ? parseInt(m[2], 10) : today.getFullYear();
        let d = new Date(year, i, day);
        if (!m[2] && d < startOfDay(today)) d = new Date(year + 1, i, day);
        if (d.getMonth() === i) return toDateKey(d);
      }
    }

    const num = text.match(/\b(\d{1,2})[\/\-. ](\d{1,2})(?:[\/\-. ](\d{2,4}))?\b/);
    if (num) {
      const day = parseInt(num[1], 10);
      const month = parseInt(num[2], 10) - 1;
      let year = num[3] ? parseInt(num[3], 10) : today.getFullYear();
      if (year < 100) year += 2000;
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        let d = new Date(year, month, day);
        if (!num[3] && d < startOfDay(today)) d = new Date(year + 1, month, day);
        return toDateKey(d);
      }
    }

    return null;
  }

  // Best-effort French time parsing: "14h30", "14 heures 30", "9h", "midi",
  // "minuit", with "après-midi"/"soir" bumping a 1-12 hour into 24h.
  function parseSpokenTime(rawText) {
    const text = stripAccents(rawText.toLowerCase().trim());

    // Check for "après-midi" first: "midi" alone is a substring of it, and
    // would otherwise wrongly short-circuit to noon.
    const isAfternoon = /\bapres[ -]?midi\b/.test(text);
    if (!isAfternoon && /\bmidi\b/.test(text)) return "12:00";
    if (/\bminuit\b/.test(text)) return "00:00";

    // "heures?" must be tried before the bare "h" alternative, otherwise "h"
    // matches first (it's a prefix of "heures") and swallows only one
    // character, leaving the minutes uncaptured.
    const m = text.match(/\b(\d{1,2})\s*(?:heures?|h)\s*(\d{1,2})?/);
    if (!m) return null;

    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    if (hour > 23 || minute > 59) return null;

    if ((isAfternoon || /\bsoir\b/.test(text)) && hour < 12) hour += 12;
    if (/\bmatin\b/.test(text) && hour === 12) hour = 0;

    return `${pad2(hour)}:${pad2(minute)}`;
  }

  function createMicButton(label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mt-icon-btn mt-mic-btn";
    btn.setAttribute("aria-label", label);
    btn.title = label;
    btn.textContent = "🎤";
    return btn;
  }

  function showFieldError(field, message) {
    // Anchor on the .mt-mic-row, not the field itself: the field now lives
    // inside that flex row (see wireField), so inserting "afterend" the
    // field would squeeze the message in as a third flex column instead of
    // a full-width line below the row.
    const anchor = field.closest(".mt-mic-row") || field;
    const existing = anchor.parentElement.querySelector(".mt-mic-error");
    if (existing) existing.remove();
    const p = document.createElement("p");
    p.className = "mt-outlook-error mt-mic-error";
    p.textContent = message;
    anchor.insertAdjacentElement("afterend", p);
    setTimeout(() => p.remove(), 4000);
  }

  // Wraps `field` with a mic button. `apply(transcript, field)` turns the
  // recognized text into the field's new value, or returns false to signal
  // it couldn't be understood (an inline error is then shown).
  function wireField(field, label, apply) {
    const row = document.createElement("div");
    row.className = "mt-mic-row";
    field.parentElement.insertBefore(row, field);
    row.appendChild(field);
    const btn = createMicButton(label);
    row.appendChild(btn);

    let recognition = null;

    btn.addEventListener("click", () => {
      if (recognition) { recognition.stop(); return; }

      recognition = new SpeechRecognitionImpl();
      recognition.lang = "fr-FR";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      btn.classList.add("is-listening");

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.trim();
        if (apply(transcript, field) === false) {
          showFieldError(field, `Non reconnu : « ${transcript} ». Réessayez ou saisissez à la main.`);
        }
      };
      recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          showFieldError(field, "Micro refusé - autorisez l'accès au micro dans les réglages du navigateur.");
        }
      };
      recognition.onend = () => {
        btn.classList.remove("is-listening");
        recognition = null;
      };

      recognition.start();
    });
  }

  function enhanceModal(overlay) {
    if (overlay.querySelector(".mt-mic-row")) return; // already wired

    const titleField = overlay.querySelector('input[name="title"]');
    const dateField = overlay.querySelector('input[name="date"]');
    const startField = overlay.querySelector('input[name="start"]');
    const notesField = overlay.querySelector('textarea[name="notes"]');
    if (!titleField || !dateField || !startField || !notesField) return;

    wireField(titleField, "Dicter le titre", (text, field) => {
      field.value = text.charAt(0).toUpperCase() + text.slice(1);
    });

    wireField(dateField, "Dicter la date", (text, field) => {
      const parsed = parseSpokenDate(text, new Date());
      if (!parsed) return false;
      field.value = parsed;
    });

    wireField(startField, "Dicter l'heure", (text, field) => {
      const parsed = parseSpokenTime(text);
      if (!parsed) return false;
      field.value = parsed;
    });

    wireField(notesField, "Dicter les notes", (text, field) => {
      field.value = field.value.trim() ? `${field.value.trim()}\n${text}` : text;
    });
  }

  function attach() {
    if (!SpeechRecognitionImpl) return; // no mic buttons on unsupported browsers
    window.addEventListener("mt:event-modal-opened", (e) => enhanceModal(e.detail.overlay));
  }

  window.MemoTempsVoiceInput = { attach, parseSpokenDate, parseSpokenTime };
})();
