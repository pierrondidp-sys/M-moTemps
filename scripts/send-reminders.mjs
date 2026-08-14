#!/usr/bin/env node
"use strict";

// Runs on a GitHub Actions schedule (see .github/workflows/event-reminders.yml)
// completely independently of whether the app or phone is open. It:
//  1. reads the user's memo-temps-events.json straight from Google Drive,
//     authenticating as a service account (no interactive login, no
//     refresh-token expiry issues - unlike the app's own OAuth popup flow);
//  2. finds events starting soon that haven't been e-mailed yet;
//  3. sends a reminder e-mail for each one via Gmail SMTP;
//  4. records what it just sent in automation/notified-state.json so the
//     next run (a few minutes later) doesn't send it again. That file is
//     committed back to the repo by the workflow step that calls this
//     script - kept entirely separate from the app's own Drive file so the
//     two systems never fight over the same JSON shape.

import { readFile, writeFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";
import nodemailer from "nodemailer";

const DRIVE_FILE_NAME = process.env.DRIVE_FILE_NAME || "memo-temps-events.json";
const STATE_PATH = new URL("../automation/notified-state.json", import.meta.url);
const REMINDER_MINUTES_TARGET = Number(process.env.REMINDER_MINUTES_BEFORE || 15);
const REMINDER_WINDOW_MINUTES = Number(process.env.REMINDER_WINDOW_MINUTES || 5);
const MIN_MINUTES = REMINDER_MINUTES_TARGET - REMINDER_WINDOW_MINUTES;
const MAX_MINUTES = REMINDER_MINUTES_TARGET + REMINDER_WINDOW_MINUTES;
const STATE_RETENTION_MS = 2 * 24 * 60 * 60 * 1000; // keep old entries 2 days, then prune

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

function parseServiceAccountKey() {
  const raw = requireEnv("GOOGLE_SERVICE_ACCOUNT_KEY").trim();
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(json);
}

async function getDriveAccessToken() {
  const credentials = parseServiceAccountKey();
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"]
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Impossible d'obtenir un jeton d'accès Google (compte de service).");
  return token;
}

async function findFileId(token) {
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`, {
    headers: { Authorization: "Bearer " + token }
  });
  if (!res.ok) throw new Error(`Drive files.list a échoué (${res.status}) : ${await res.text()}`);
  const data = await res.json();
  const file = data.files && data.files[0];
  if (!file) {
    throw new Error(
      `Fichier "${DRIVE_FILE_NAME}" introuvable. Vérifiez qu'il a bien été partagé (au moins en lecture) ` +
      `avec l'adresse e-mail du compte de service (client_email de la clé JSON).`
    );
  }
  return file.id;
}

async function downloadEvents(token, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: "Bearer " + token }
  });
  if (!res.ok) throw new Error(`Drive files.get a échoué (${res.status}) : ${await res.text()}`);
  const text = await res.text();
  if (!text.trim()) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : (parsed.events || []);
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch (e) {
    return {};
  }
}

function pruneState(state, now) {
  const pruned = {};
  for (const [key, entry] of Object.entries(state)) {
    if (entry && typeof entry.eventStart === "number" && now - entry.eventStart < STATE_RETENTION_MS) {
      pruned[key] = entry;
    }
  }
  return pruned;
}

function eventStartMs(ev) {
  const [y, m, d] = ev.date.split("-").map(Number);
  const [h, min] = ev.start.split(":").map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
}

function dueEvents(events, state, now) {
  return events.filter((ev) => {
    if (!ev || !ev.id || !ev.date || !ev.start || ev.done) return false;
    const key = `${ev.id}:${ev.updatedAt || 0}`;
    if (state[key]) return false;
    const minutesUntil = (eventStartMs(ev) - now) / 60000;
    return minutesUntil >= MIN_MINUTES && minutesUntil <= MAX_MINUTES;
  });
}

function formatEmail(ev) {
  const catLabel = ev.category === "objectif" ? "Objectif" : "Rendez-vous";
  const timeLabel = ev.end ? `${ev.start} – ${ev.end}` : ev.start;
  const dateLabel = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(eventStartMs(ev)));
  const subject = `⏰ Rappel : ${ev.title} (${ev.start})`;
  const lines = [
    `${catLabel} — ${ev.title}`,
    ``,
    `${dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)} à ${timeLabel}`,
  ];
  if (ev.notes) lines.push(``, ev.notes);
  lines.push(``, `— Mémo Temps`);
  return { subject, text: lines.join("\n") };
}

async function sendReminder(transporter, ev) {
  const { subject, text } = formatEmail(ev);
  await transporter.sendMail({
    from: requireEnv("GMAIL_USER"),
    to: process.env.REMINDER_EMAIL_TO || requireEnv("GMAIL_USER"),
    subject,
    text
  });
}

async function main() {
  const now = Date.now();
  const token = await getDriveAccessToken();
  const fileId = await findFileId(token);
  const events = await downloadEvents(token, fileId);

  let state = pruneState(await loadState(), now);
  const due = dueEvents(events, state, now);

  if (!due.length) {
    console.log(`Rien à envoyer (${events.length} évènement(s) au total, fenêtre ${MIN_MINUTES}-${MAX_MINUTES} min).`);
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: requireEnv("GMAIL_USER"), pass: requireEnv("GMAIL_APP_PASSWORD") }
  });

  for (const ev of due) {
    await sendReminder(transporter, ev);
    state[`${ev.id}:${ev.updatedAt || 0}`] = { notifiedAt: now, eventStart: eventStartMs(ev) };
    console.log(`E-mail envoyé pour "${ev.title}" (${ev.date} ${ev.start}).`);
  }

  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

export { eventStartMs, dueEvents, pruneState, formatEmail, findFileId, downloadEvents, main };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Échec de l'envoi des rappels :", err.message);
    process.exit(1);
  });
}
