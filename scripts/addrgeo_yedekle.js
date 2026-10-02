#!/usr/bin/env node
/*
 * scripts/addrgeo_yedekle.js — addrGeo düğümünün tam yedeğini yerel dosyaya alır.
 * Yeniden geocode öncesi geri dönüş noktası. Çalıştır: cd scripts && node addrgeo_yedekle.js
 * Geri yüklemek için: node addrgeo_yedekle.js --geri-yukle <dosya>
 */
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const SA_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json";
admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(SA_PATH))),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.database();

(async () => {
  const geri = process.argv.includes("--geri-yukle");
  if (geri) {
    const dosya = process.argv[process.argv.indexOf("--geri-yukle") + 1];
    if (!dosya || !fs.existsSync(dosya)) { console.error("Yedek dosyası bulunamadı:", dosya); process.exit(1); }
    const veri = JSON.parse(fs.readFileSync(dosya, "utf8"));
    await db.ref("addrGeo").set(veri);
    console.log(`Geri yüklendi: ${Object.keys(veri).length} kayıt ← ${dosya}`);
    process.exit(0);
  }
  const snap = await db.ref("addrGeo").once("value");
  const veri = snap.val() || {};
  const damga = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const out = path.join(__dirname, `addrgeo_yedek_${damga}.json`);
  fs.writeFileSync(out, JSON.stringify(veri, null, 1), "utf8");
  console.log(`Yedeklendi: ${Object.keys(veri).length} kayıt → ${out}`);
  console.log(`Geri yüklemek için: node addrgeo_yedekle.js --geri-yukle "${out}"`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
