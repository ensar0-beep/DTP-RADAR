#!/usr/bin/env node
/*
 * scripts/geocode.js
 * ------------------------------------------------------------------
 * TEK SEFERLİK / ELLE ÇALIŞTIRILAN yerel script. Sitenin bir parçası
 * DEĞİLDİR — deploy edilmez, tarayıcıda çalışmaz. Amacı:
 *
 *   1) Firebase'deki tüm DİİB aylık kayıtlarını + Turquality listesini oku,
 *   2) Her benzersiz firma için TEK bir "temsilci adres" belirle,
 *   3) Google Geocoding API ile o adresi sokak/bina seviyesinde çöz,
 *   4) Sonucu Firebase'e `addrGeo/<firmaKey>` altına yaz.
 *
 * index_39.html (client) bu düğümü herkese açık okur ve varsa il/ilçe/
 * mahalle tahmininin ÖNÜNE alır (bkz. geocodeVisible()).
 *
 * Neden ayrı bir script, admin panelinde buton değil?
 *   Google API anahtarı ücretlidir (kullanım = fatura). Tarayıcı koduna
 *   gömülürse herkes kaynak koddan okuyup kötüye kullanabilir. Bu script
 *   sadece SENİN bilgisayarında, .env içindeki anahtarla çalışır — anahtar
 *   asla repoya/siteye girmez.
 *
 * Kurulum (bkz. scripts/README.md için daha ayrıntılısı):
 *   cd scripts
 *   npm install
 *   cp .env.example .env   # sonra .env'i doldur
 *   node geocode.js
 *
 * Parametreler:
 *   --force        Daha önce çözülmüş firmaları da yeniden geocode eder.
 *   --limit=N      En fazla N yeni API çağrısı yapar (maliyet/test kontrolü).
 *   --dry          Hiçbir şey yazmaz, sadece ne yapılacağını raporlar.
 *   --only=k1,k2   Sadece verilen firmaKey'leri (virgülle) işler, --force gibi zorlar.
 *
 * Adres sorgusuna, adresten çıkarılan İL bilgisi "administrative_area" olarak
 * eklenir — bu, aynı isimli sokak/mahallenin başka bir ilde yanlış eşleşmesini
 * (ör. "X Caddesi" hem Pendik'te hem Beylikdüzü'nde varsa) büyük ölçüde önler.
 */
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

/* ---------------- CLI argümanları ---------------- */
const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const DRY = argv.includes("--dry");
const limitArg = argv.find(a => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
const onlyArg = argv.find(a => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(",").filter(Boolean)) : null;

/* ---------------- Ortam değişkenleri ---------------- */
const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const SA_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json";
const DB_URL = process.env.FIREBASE_DATABASE_URL;

if (!API_KEY) { console.error("HATA: .env içinde GOOGLE_MAPS_API_KEY eksik."); process.exit(1); }
if (!DB_URL) { console.error("HATA: .env içinde FIREBASE_DATABASE_URL eksik."); process.exit(1); }
if (!fs.existsSync(SA_PATH)) {
  console.error(`HATA: Firebase servis hesabı anahtarı bulunamadı: ${SA_PATH}`);
  console.error("Firebase Console → Project Settings → Service Accounts → Generate new private key");
  process.exit(1);
}
if (typeof fetch !== "function") {
  console.error("HATA: global fetch yok — Node 18+ ile çalıştır.");
  process.exit(1);
}

/* ---------------- index_39.html ile BİREBİR aynı olmalı: anahtar üretimi ---------------- */
// Türkçe büyük harfe çevirme — index_39.html'deki trUp ile aynı.
const trUp = s => String(s ?? "").toLocaleUpperCase("tr-TR");
// DİİB kaynaklı firma satırlarının anahtarı (aggregate() → r.key ile birebir aynı olmalı).
const stripKey = firma => trUp(firma).replace(/[^A-ZÇĞİÖŞÜ0-9]/g, "");
// Turquality kaynaklı satırların anahtarı normName() kullanır (index_39.html'deki ile birebir aynı olmalı).
const TIM_STOP = new Set(["VE","İLE","SAN","SANAYİ","SANAYI","SANAYII","TİC","TİCARET","TICARET","LTD","ŞTİ","STI","AŞ","AS","AO","TAŞ","TAS","DIŞ","DIS","İTH","İTHALAT","ITHALAT","İHR","İHRACAT","IHRACAT","PAZ","PAZARLAMA","HOLDİNG","HOLDING","GRUP","GROUP","İNŞ","İNŞAAT","INSAAT","NAK","NAKLİYAT","LİMİTED","LIMITED","ANONİM","ANONIM","ORTAKLIĞI","ORTAKLIGI","ŞİRKETİ","SIRKETI","KOLL","KOMANDİT","SANTİC"]);
function normName(s) {
  let u = trUp(s);
  u = u.replace(/\b(?:[A-ZÇĞİÖŞÜ]\.){2,}/g, m => m.replace(/\./g, ""));
  u = u.replace(/[.\-,/&()'"’`]/g, " ").replace(/\s+/g, " ").trim();
  const toks = u.split(" ").filter(t => t && !TIM_STOP.has(t) && t.length > 1);
  return toks.join(" ");
}

// Adresten İL çıkarımı — index_39.html'deki extractIl() ile birebir aynı olmalı.
// Sorguyu bu ile kısıtlamak, aynı isimli sokağın başka bir ildeki yanlış eşleşmesini önler.
const ILLER = ["ADANA","ADIYAMAN","AFYONKARAHİSAR","AFYON","AĞRI","AKSARAY","AMASYA","ANKARA","ANTALYA","ARDAHAN","ARTVİN","AYDIN","BALIKESİR","BARTIN","BATMAN","BAYBURT","BİLECİK","BİNGÖL","BİTLİS","BOLU","BURDUR","BURSA","ÇANAKKALE","ÇANKIRI","ÇORUM","DENİZLİ","DİYARBAKIR","DÜZCE","EDİRNE","ELAZIĞ","ERZİNCAN","ERZURUM","ESKİŞEHİR","GAZİANTEP","GİRESUN","GÜMÜŞHANE","HAKKARİ","HATAY","IĞDIR","ISPARTA","İSTANBUL","İZMİR","KAHRAMANMARAŞ","KARABÜK","KARAMAN","KARS","KASTAMONU","KAYSERİ","KIRIKKALE","KIRKLARELİ","KIRŞEHİR","KİLİS","KOCAELİ","KONYA","KÜTAHYA","MALATYA","MANİSA","MARDİN","MERSİN","İÇEL","MUĞLA","MUŞ","NEVŞEHİR","NİĞDE","ORDU","OSMANİYE","RİZE","SAKARYA","SAMSUN","SİİRT","SİNOP","SİVAS","ŞANLIURFA","ŞIRNAK","TEKİRDAĞ","TOKAT","TRABZON","TUNCELİ","UŞAK","VAN","YALOVA","YOZGAT","ZONGULDAK"];
function extractIl(adres) {
  const u = trUp(adres);
  let best = null, pos = -1;
  for (const il of ILLER) {
    const i = u.lastIndexOf(il);
    if (i > pos) {
      const before = i === 0 ? " " : u[i - 1], after = u[i + il.length] || " ";
      if (!/[A-ZÇĞİÖŞÜ]/.test(before) && !/[A-ZÇĞİÖŞÜ]/.test(after)) { pos = i; best = il; }
    }
  }
  if (best === "AFYON") best = "AFYONKARAHİSAR";
  if (best === "İÇEL") best = "MERSİN";
  return best;
}

/* ---------------- Firebase Admin ---------------- */
admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(SA_PATH))),
  databaseURL: DB_URL,
});
const db = admin.database();

/* ---------------- Yardımcılar ---------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- Adres temizleme ---------------- */
// Google, adreste birden fazla numara ifadesi görünce ("NO: 3  İÇ KAPI NO: 1") yanlış sokağı
// eşleştirebiliyordu (ör. SANİPAK: Çam Pınarı Sk. No:3 yerine İmtiyaz Sk. No:17). Bina içi
// ayrıntılar (iç kapı, kat, daire, blok) adresin yerini belirlemeye katkı sağlamadığı için atılır.
function temizleAdres(adres) {
  let a = " " + trUp(adres).replace(/\s+/g, " ") + " ";
  a = a.replace(/İÇ\s*KAPI\s*(NO|NUMARA)?\s*:?\s*[0-9A-ZÇĞİÖŞÜ/\-]+/g, " ");
  a = a.replace(/\bKAT\s*:?\s*[0-9A-ZÇĞİÖŞÜ/\-]+/g, " ");
  a = a.replace(/\bDAİRE\s*:?\s*[0-9A-ZÇĞİÖŞÜ/\-]+/g, " ");
  a = a.replace(/\bD\s*:\s*[0-9A-ZÇĞİÖŞÜ/\-]+/g, " ");
  a = a.replace(/\b([A-ZÇĞİÖŞÜ0-9]+\s+)?BLOK\b/g, " ");
  a = a.replace(/\bPOSTA\s*KUTUSU\s*:?\s*[0-9]+/g, " ");
  a = a.replace(/\bNO\s*:?\s*/g, "NO:");
  return a.replace(/\s+/g, " ").trim();
}

// Adresten ilçe — index_147.html'deki extractIlce ile birebir aynı olmalı
function extractIlce(adres, il) {
  if (!il) return null;
  const u = trUp(adres);
  let m = u.match(new RegExp("([A-ZÇĞİÖŞÜ]{3,20})\\s*[\\/\\\\-]\\s*" + il));
  if (m && !ILLER.includes(m[1])) return m[1];
  const i = u.lastIndexOf(il);
  if (i > 0) {
    const before = u.slice(0, i).replace(/[,.\s]+$/, "").trim();
    m = before.match(/([A-ZÇĞİÖŞÜ]{3,20})$/);
    if (m && !ILLER.includes(m[1]) && !["MAH","CAD","SOK","BLOK","APT","OSB","NO","KAT","SAN","TİC","SİT"].includes(m[1])) return m[1];
  }
  return null;
}

// Adresten mahalle adı — index_147.html'deki extractMahalle ile aynı mantık (…MAH./MAHALLESİ öncesi sözcük)
function extractMahalle(adres) {
  const u = trUp(adres).replace(/\s+/g, " ");
  const m = u.match(/([A-ZÇĞİÖŞÜ0-9.\-]+(?:\s+[A-ZÇĞİÖŞÜ0-9.\-]+)?)\s+MAH(?:\.|ALLESİ|ALLESI)?\b/);
  return m ? m[1].replace(/\.$/, "").trim() : null;
}

// Karşılaştırma için sadeleştirme: boşluk/noktalama atılır, Türkçe harfler düzleştirilir
const sadeleştir = s => trUp(String(s || ""))
  .replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
  .replace(/[^A-Z0-9]/g, "");
const sadeIlce = s => sadeleştir(s).replace(/MERKEZ/g, "").replace(/OSB/g, "");

function bilesen(r, ...tipler) {
  for (const t of tipler) {
    const c = (r.address_components || []).find(x => (x.types || []).includes(t));
    if (c) return c.long_name;
  }
  return "";
}

/* ---------------- Google Geocoding ---------------- */
// Ham sonucu döndürür; doğrulama çağıran tarafta yapılır.
async function sorgula(query, il) {
  const components = il ? `country:TR|administrative_area:${il}` : "country:TR";
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=tr&components=${encodeURIComponent(components)}&key=${API_KEY}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res, data;
    try {
      res = await fetch(url);
      data = await res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1000 * attempt);
      continue;
    }
    if (data.status === "OK" && data.results && data.results[0]) {
      const r = data.results[0];
      return {
        lat: r.geometry.location.lat,
        lon: r.geometry.location.lng,
        formatted: r.formatted_address || "",
        precision: r.geometry.location_type || "",
        gelenIlce: bilesen(r, "administrative_area_level_2", "locality"),
        gelenIl: bilesen(r, "administrative_area_level_1"),
      };
    }
    if (data.status === "ZERO_RESULTS") return null;
    if (data.status === "OVER_QUERY_LIMIT" || data.status === "UNKNOWN_ERROR") {
      console.warn(`  ⚠ ${data.status}, ${attempt}. deneme, bekleniyor…`);
      await sleep(2000 * attempt);
      continue;
    }
    console.warn(`  ⚠ Geocoding hatası: ${data.status} ${data.error_message || ""}`);
    return null;
  }
  return null;
}

// Sonucun beklenen il/ilçeye düşüp düşmediğini doğrular.
function dogrula(geo, il, ilce) {
  if (!geo) return { ok: false, neden: "sonuç yok" };
  const f = sadeleştir(geo.formatted);
  if (il) {
    const ilOk = sadeleştir(geo.gelenIl).includes(sadeleştir(il)) || f.includes(sadeleştir(il));
    if (!ilOk) return { ok: false, neden: `il tutmadı (${geo.gelenIl || "?"})` };
  }
  if (ilce && sadeIlce(ilce).length >= 3) {
    const b = sadeIlce(ilce);
    const ilceOk = sadeIlce(geo.gelenIlce).includes(b) || b.includes(sadeIlce(geo.gelenIlce)) || f.includes(b);
    if (!ilceOk) return { ok: false, neden: `ilçe tutmadı (${geo.gelenIlce || "?"})` };
  }
  return { ok: true };
}

/* Kademeli çözüm: bina → mahalle → ilçe. Her kademede sonuç beklenen il/ilçeye düşmüyorsa
   bir alt kademeye inilir; böylece yanlış bir sokağa "kesin adres" damgası vurulmaz. */
async function coz(adres, il, ilce) {
  const temiz = temizleAdres(adres);
  const mah = extractMahalle(adres);
  const denemeler = [];
  denemeler.push({ seviye: "bina", q: `${temiz}, Türkiye` });
  if (mah && ilce) denemeler.push({ seviye: "mahalle", q: `${mah} Mahallesi, ${ilce}, ${il || ""}, Türkiye` });
  if (ilce) denemeler.push({ seviye: "ilce", q: `${ilce}, ${il || ""}, Türkiye` });

  let sorguSayisi = 0, sonHata = "";
  for (const d of denemeler) {
    const geo = await sorgula(d.q, il);
    sorguSayisi++;
    const v = dogrula(geo, il, ilce);
    if (geo && v.ok) return { geo, seviye: d.seviye, sorguSayisi };
    sonHata = v.neden || "sonuç yok";
    await sleep(120);
  }
  return { geo: null, seviye: null, sorguSayisi, neden: sonHata };
}

/* ---------------- Ana akış ---------------- */
async function main() {
  console.log("Firebase'den veri okunuyor…");
  const [monthsSnap, tqSnap, addrGeoSnap] = await Promise.all([
    db.ref("months").once("value"),
    db.ref("tq").once("value"),
    db.ref("addrGeo").once("value"),
  ]);
  const monthsData = monthsSnap.val() || {};
  const tqData = (tqSnap.val() && tqSnap.val().map) || {};
  const existingAddrGeo = addrGeoSnap.val() || {};

  // 1) Aylık DİİB kayıtlarını birleştir — index_39.html'deki aggregate()'in adres seçim
  //    kuralıyla birebir aynı: en uzun adres kazanır.
  const baseMap = new Map(); // key -> {firma, adres}
  for (const monthKey of Object.keys(monthsData)) {
    const packed = (monthsData[monthKey] && monthsData[monthKey].r) || [];
    for (const row of packed) {
      const firma = String(row[0] || "").trim();
      const adres = String(row[1] || "").trim();
      if (!firma) continue;
      const key = stripKey(firma);
      if (!key) continue;
      let a = baseMap.get(key);
      if (!a) { a = { key, firma, adres }; baseMap.set(key, a); }
      else if (adres.length > a.adres.length) { a.adres = adres; }
    }
  }

  // 2) Turquality: index_39.html'deki aggregate()'teki gibi — DİİB'de yoksa
  //    normName() anahtarıyla yeni satır, varsa (nadiren aynı anahtara denk gelirse) adres tamamlama.
  for (const [tqKey, t] of Object.entries(tqData)) {
    const fullAddr = [t.adres, t.ilce, t.il].filter(Boolean).join(" ").trim();
    let a = baseMap.get(tqKey);
    if (!a) {
      if (!fullAddr) continue;
      baseMap.set(tqKey, { key: tqKey, firma: t.firma || tqKey, adres: fullAddr });
    } else if (!a.adres && fullAddr) {
      a.adres = fullAddr;
    }
  }

  const all = [...baseMap.values()].filter(a => a.adres && a.adres.trim().length >= 6);
  console.log(`Toplam benzersiz firma (adresli): ${all.length}`);

  const todo = ONLY
    ? all.filter(a => ONLY.has(a.key))
    : all.filter(a => FORCE || !existingAddrGeo[a.key]);
  if (ONLY) console.log(`--only: ${ONLY.size} anahtar istendi, ${todo.length} tanesi bulundu.`);
  console.log(`Zaten çözülmüş, atlanacak: ${ONLY ? 0 : all.length - todo.length}`);
  console.log(`Bu çalıştırmada denenecek: ${Math.min(todo.length, LIMIT)}${LIMIT < todo.length ? ` (--limit=${LIMIT})` : ""}`);

  if (DRY) {
    // --dry: API'ye hiç gitme (ücretli), sadece rapor ver.
    const n = Math.min(todo.length, LIMIT);
    console.log(`(--dry: API'ye istek atılmadı, hiçbir şey yazılmadı)`);
    console.log(`Tahmini maliyet (gerçek çalıştırılsaydı): ~$${(n * 0.005).toFixed(2)}`);
    console.log("\nÖrnek firmalar:");
    todo.slice(0, 10).forEach(a => console.log(`  - ${a.firma} | ${a.adres.slice(0, 70)}`));
    process.exit(0);
  }

  let done = 0, toplamSorgu = 0, notFound = 0;
  const sayac = { bina: 0, mahalle: 0, ilce: 0 };
  const notFoundList = [];
  const rapor = [];
  let pendingWrite = {};

  const flush = async () => {
    if (DRY || !Object.keys(pendingWrite).length) { pendingWrite = {}; return; }
    await db.ref().update(pendingWrite);
    pendingWrite = {};
  };

  for (const a of todo) {
    if (done >= LIMIT) break;
    done++;
    const il = extractIl(a.adres);
    const ilce = extractIlce(a.adres, il);
    process.stdout.write(`[${done}/${Math.min(todo.length, LIMIT)}] ${a.firma.slice(0, 38).padEnd(38)} `);
    let sonuc = { geo: null, seviye: null, sorguSayisi: 0 };
    try { sonuc = await coz(a.adres, il, ilce); }
    catch (e) { console.log(`HATA: ${e.message}`); }
    toplamSorgu += sonuc.sorguSayisi;

    const eski = existingAddrGeo[a.key];
    if (sonuc.geo) {
      sayac[sonuc.seviye]++;
      const etiket = sonuc.seviye === "bina" ? "✓ bina" : (sonuc.seviye === "mahalle" ? "~ mahalle" : "· ilçe");
      console.log(`${etiket}  ${sonuc.geo.precision}  (${sonuc.geo.lat.toFixed(5)}, ${sonuc.geo.lon.toFixed(5)})`);
      // seviye: koordinatın hangi kademede doğrulandığı — istemci buna göre "tam adres" der ya da demez
      pendingWrite[`addrGeo/${a.key}`] = {
        lat: sonuc.geo.lat, lon: sonuc.geo.lon,
        formatted: sonuc.geo.formatted, precision: sonuc.geo.precision,
        seviye: sonuc.seviye, ts: Date.now(),
      };
      rapor.push([a.firma, il || "", ilce || "", sonuc.seviye, sonuc.geo.precision, sonuc.geo.formatted,
        eski ? eski.formatted || "" : "", sonuc.geo.lat, sonuc.geo.lon]);
    } else {
      notFound++;
      notFoundList.push({ key: a.key, firma: a.firma, adres: a.adres, neden: sonuc.neden || "" });
      console.log(`— çözülemedi (${sonuc.neden || ""})`);
      rapor.push([a.firma, il || "", ilce || "", "YOK", "", "", eski ? eski.formatted || "" : "", "", ""]);
    }

    if (Object.keys(pendingWrite).length >= 25) await flush();
    await sleep(120);
  }
  await flush();

  if (notFoundList.length) {
    const outPath = path.join(__dirname, "not_found.json");
    fs.writeFileSync(outPath, JSON.stringify(notFoundList, null, 2), "utf8");
    console.log(`\nÇözülemeyen ${notFoundList.length} adres → ${outPath}`);
  }
  const esc = s => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
  const csv = "﻿" + ["Firma;Il;Ilce;Seviye;Hassasiyet;Yeni adres;Eski adres;Enlem;Boylam"]
    .concat(rapor.map(r => r.map(esc).join(";"))).join("\n");
  const raporYolu = path.join(__dirname, "geocode_rapor.csv");
  fs.writeFileSync(raporYolu, csv, "utf8");

  console.log(`\nBitti. Firma: ${done} · Google sorgusu: ${toplamSorgu}`);
  console.log(`  bina seviyesi : ${sayac.bina}`);
  console.log(`  mahalle       : ${sayac.mahalle}`);
  console.log(`  ilçe          : ${sayac.ilce}`);
  console.log(`  çözülemeyen   : ${notFound}`);
  console.log(`Rapor: ${raporYolu}`);
  console.log(`Tahmini maliyet: ~$${(toplamSorgu * 0.005).toFixed(2)} (aylık ücretsiz kota kapsıyorsa $0)`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
