#!/usr/bin/env node
/*
 * scripts/apply_rules.js — Firebase Realtime Database güvenlik kurallarını uygular.
 * Elle çalıştırılır:  cd scripts && node apply_rules.js
 *   1) Mevcut kuralları scripts/current_rules.json'a yedekler
 *   2) scripts/new_rules.json içindekini uygular
 *   3) Uygulanan kuralları geri okuyup doğrular
 * Geri almak için: node apply_rules.js --restore   (current_rules.json'ı geri yükler)
 */
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const RESTORE = process.argv.includes("--restore");
const SA_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json";
const cred = admin.credential.cert(require(path.resolve(SA_PATH)));

(async () => {
  const token = (await cred.getAccessToken()).access_token;
  const url = process.env.FIREBASE_DATABASE_URL + "/.settings/rules.json?access_token=" + token;

  const current = await (await fetch(url)).text();
  if (!RESTORE) {
    fs.writeFileSync(path.join(__dirname, "current_rules.json"), current);
    console.log("Eski kurallar yedeklendi → scripts/current_rules.json");
  }

  const file = RESTORE ? "current_rules.json" : "new_rules.json";
  const body = fs.readFileSync(path.join(__dirname, file), "utf8");
  JSON.parse(body); // geçersiz JSON'u göndermeden yakala

  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
  const txt = await res.text();
  if (!res.ok) { console.error("HATA:", res.status, txt); process.exit(1); }
  console.log(RESTORE ? "Eski kurallar geri yüklendi." : "Yeni kurallar uygulandı.");

  const check = JSON.parse(await (await fetch(url)).text());
  console.log("Aktif düğümler:", Object.keys(check.rules).join(", "));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
