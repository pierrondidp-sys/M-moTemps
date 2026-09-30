#!/usr/bin/env node
"use strict";

// Runs on a GitHub Actions schedule (see .github/workflows/event-reminders.yml)
// completely independently of whether the app or phone is open. It:
//  1. reads the user's memo-temps-events.json straight from Google Drive,
//     authenticating as a service account (no interactive login, no
//     refresh-token expiry issues - unlike the app's own OAuth popup flow);
//  2. finds events starting soon that haven't been notified yet;
//  3. notifies on whichever channel(s) are configured, independently of
//     each other - neither blocks the other:
//       - e-mail via Gmail SMTP (GMAIL_USER/GMAIL_APP_PASSWORD), if set;
//       - Web Push (VAPID_*), to every device subscribed via the app's
//         Drive-connected "🔔 Activer les notifications" button (js/push.js
//         + js/drive.js upload the subscription into the same Drive file
//         this script reads) - this is what makes a *closed* phone/PC app
//         still get a real OS notification, not just e-mail;
//  4. records what it just notified in automation/notified-state.json so
//     the next run (a few minutes later) doesn't repeat it. That file is
//     committed back to the repo by the workflow step that calls this
//     script - kept entirely separate from the app's own Drive file so the
//     two systems never fight over the same JSON shape;
//  5. drops push subscriptions the push service reports as gone (410/404)
//     and writes the trimmed list back to the same Drive file, so dead
//     devices don't accumulate forever and get retried every run.

import { readFile, writeFile } from "node:fs/promises";
import { GoogleAuth } from "google-auth-library";
import nodemailer from "nodemailer";
import webpush from "web-push";

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

// Needs read+write (not just drive.readonly): pruning expired push
// subscriptions means patching the same Drive file back. The file is
// shared with the service account directly (not created by it), so this
// needs the general "drive" scope rather than the more restrictive
// "drive.file" (which only covers files the app itself created/opened).
async function getDriveAccessToken() {
  const credentials = parseServiceAccountKey();
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"]
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
      `Fichier "${DRIVE_FILE_NAME}" introuvable. Vérifiez qu'il a bien été partagé avec l'adresse e-mail du ` +
      `compte de service (client_email de la clé JSON), avec le rôle Éditeur (pas seulement Lecteur - ` +
      `nécessaire pour que ce script puisse retirer les abonnements aux notifications push expirés).`
    );
  }
  return file.id;
}

async function downloadDriveFile(token, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: "Bearer " + token }
  });
  if (!res.ok) throw new Error(`Drive files.get a échoué (${res.status}) : ${await res.text()}`);
  const text = await res.text();
  if (!text.trim()) return { events: [], pushSubscriptions: [] };
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return { events: parsed, pushSubscriptions: [] };
  return {
    events: parsed.events || [],
    pushSubscriptions: parsed.pushSubscriptions || [],
    raw: parsed
  };
}

async function uploadPushSubscriptions(token, fileId, file, subscriptions) {
  const payload = Object.assign({}, file.raw, { pushSubscriptions: subscriptions });
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Drive files.update a échoué (${res.status}) : ${await res.text()}`);
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

function formatPushPayload(ev) {
  const timeLabel = ev.end ? `${ev.start} – ${ev.end}` : ev.start;
  return {
    title: `⏰ ${ev.title}`,
    body: ev.notes ? `${timeLabel} aujourd'hui — ${ev.notes}` : `${timeLabel} aujourd'hui`,
    tag: `mt-reminder-${ev.id}`
  };
}

async function sendReminderEmail(transporter, ev) {
  const { subject, text } = formatEmail(ev);
  const fromName = process.env.GMAIL_FROM_NAME || "Mémo Temps";
  await transporter.sendMail({
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
    to: process.env.REMINDER_EMAIL_TO || process.env.GMAIL_USER,
    subject,
    text
  });
}

// Sends to every subscription; a subscription the push service reports as
// gone (410/404 - uninstalled app, revoked permission, expired) is dropped
// from the list returned. Any other error (rate limit, transient network
// issue) leaves that subscription in place for the next run to retry.
async function sendPushToAll(subscriptions, payload) {
  const stillValid = [];
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      stillValid.push(sub);
    } catch (err) {
      const short = (sub.endpoint || "").slice(-24);
      if (err.statusCode === 404 || err.statusCode === 410) {
        console.log(`Abonnement push expiré, retiré (…${short}).`);
      } else {
        console.error(`Envoi push échoué pour …${short} : ${err.message}`);
        stillValid.push(sub);
      }
    }
  }
  return stillValid;
}

async function main() {
  const now = Date.now();
  const token = await getDriveAccessToken();
  const fileId = await findFileId(token);
  const file = await downloadDriveFile(token, fileId);
  const events = file.events;
  let subscriptions = file.pushSubscriptions;

  let state = pruneState(await loadState(), now);
  const due = dueEvents(events, state, now);

  if (!due.length) {
    console.log(`Rien à envoyer (${events.length} évènement(s) au total, fenêtre ${MIN_MINUTES}-${MAX_MINUTES} min).`);
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
    return;
  }

  const emailReady = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  const pushReady = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
  if (!emailReady && !pushReady) {
    console.log("Aucun canal de notification configuré (ni e-mail, ni notifications push) - rien n'est envoyé.");
  }

  const transporter = emailReady
    ? nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
    : null;

  if (pushReady) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  }

  for (const ev of due) {
    if (transporter) {
      try {
        await sendReminderEmail(transporter, ev);
        console.log(`E-mail envoyé pour "${ev.title}" (${ev.date} ${ev.start}).`);
      } catch (err) {
        console.error(`Échec de l'e-mail pour "${ev.title}" : ${err.message}`);
      }
    }
    if (pushReady && subscriptions.length) {
      subscriptions = await sendPushToAll(subscriptions, formatPushPayload(ev));
      console.log(`Notification push envoyée pour "${ev.title}" à ${subscriptions.length} appareil(s).`);
    }
    state[`${ev.id}:${ev.updatedAt || 0}`] = { notifiedAt: now, eventStart: eventStartMs(ev) };
  }

  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n");

  if (pushReady && file.raw) {
    await uploadPushSubscriptions(token, fileId, file, subscriptions);
  }
}

export {
  eventStartMs, dueEvents, pruneState, formatEmail, formatPushPayload,
  findFileId, downloadDriveFile, sendPushToAll, main
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("Échec de l'envoi des rappels :", err.message);
    process.exit(1);
  });
}
