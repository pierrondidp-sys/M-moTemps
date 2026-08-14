#!/usr/bin/env node
"use strict";

// One-time LOCAL helper (do not run this in CI) to obtain the Gmail OAuth2
// refresh token used by scripts/send-reminders.mjs. Run it once on your own
// machine, sign in with the Gmail account that should send the reminders,
// and copy the printed refresh token into the GMAIL_OAUTH_REFRESH_TOKEN
// GitHub secret.
//
// Prerequisite: an OAuth 2.0 Client ID of type "Desktop app" created in
// Google Cloud Console, with the consent screen's user type set to
// "Interne" (internal to the Workspace org) and scope gmail.send added.
//
// Usage:
//   GMAIL_OAUTH_CLIENT_ID=... GMAIL_OAUTH_CLIENT_SECRET=... node scripts/get-gmail-refresh-token.mjs

import { createServer } from "node:http";

const CLIENT_ID = process.env.GMAIL_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_OAUTH_CLIENT_SECRET;
const PORT = Number(process.env.PORT || 53682);
const REDIRECT_URI = `http://localhost:${PORT}`;

function requireEnv(name, value) {
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

async function waitForAuthorizationCode(authUrl) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.end(error
        ? "Autorisation refusée. Vous pouvez fermer cet onglet."
        : "Autorisation reçue, vous pouvez fermer cet onglet et revenir au terminal.");
      server.close();
      if (error) reject(new Error(error));
      else if (code) resolve(code);
      else reject(new Error("Aucun code d'autorisation reçu."));
    });
    server.listen(PORT, () => {
      console.log("Ouvrez cette URL dans un navigateur connecté avec le compte Gmail d'envoi, puis autorisez l'accès :\n");
      console.log(authUrl.toString());
      console.log("\nEn attente de l'autorisation (laissez ce terminal ouvert)...");
    });
  });
}

async function exchangeCodeForTokens(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Échange du code a échoué (${res.status}) : ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  requireEnv("GMAIL_OAUTH_CLIENT_ID", CLIENT_ID);
  requireEnv("GMAIL_OAUTH_CLIENT_SECRET", CLIENT_SECRET);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.send");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  const code = await waitForAuthorizationCode(authUrl);
  const tokens = await exchangeCodeForTokens(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Aucun refresh_token reçu (Google n'en renvoie qu'à la première autorisation). " +
      "Révoquez l'accès existant sur https://myaccount.google.com/permissions puis relancez ce script."
    );
  }

  console.log("\nRefresh token obtenu - copiez-le dans le secret GitHub GMAIL_OAUTH_REFRESH_TOKEN :\n");
  console.log(tokens.refresh_token);
}

main().catch((err) => {
  console.error("Échec :", err.message);
  process.exit(1);
});
