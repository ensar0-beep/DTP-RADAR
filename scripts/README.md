# Adres bazlı geocoding (tam adres → sokak/bina seviyesi konum)

`geocode.js`, DİİB + Turquality firmalarının adresini **Google Geocoding API** ile çözüp
sonucu Firebase'e (`addrGeo/<firmaKey>`) yazan, elle çalıştırılan bir script. Site bu
düğümü okuyup varsa il/ilçe/mahalle tahmininin önüne alır — bkz. `index_39.html` içinde
`geocodeVisible()`.

Bu script **deploy edilmez**, sadece senin bilgisayarından bir kereye mahsus (ya da yeni
ay verisi geldiğinde tekrar) çalıştırılır. Böylece ücretli API anahtarı hiçbir zaman
sitenin kaynak koduna ya da repoya girmez.

## Bir kerelik kurulum

**1) Google Geocoding API anahtarı al**
- https://console.cloud.google.com → yeni proje ya da mevcut bir proje seç
- "APIs & Services → Library" → **Geocoding API**'yi etkinleştir
- "APIs & Services → Credentials" → **Create credentials → API key**
- (Önerilir) Anahtarı "Application restrictions" altında kendi IP adresinle sınırla,
  "API restrictions" altında sadece Geocoding API'ye izin ver.
- Faturalandırmayı aktif etmen gerekir (kredi kartı) — ama Google her ay $200 ücretsiz
  kredi veriyor, bu da ~40.000 sorgu demek; muhtemelen hiç ücret ödemeyeceksin.

**2) Firebase servis hesabı anahtarı al**
- https://console.firebase.google.com → `diib-d006d` projesi
- Project Settings (⚙️) → Service Accounts → **Generate new private key**
- İnen JSON dosyasını bu klasöre (`scripts/`) `serviceAccountKey.json` adıyla koy.
  (Bu dosya `.gitignore`'da — asla commit'lenmez.)

**3) Bağımlılıkları kur**
```bash
cd scripts
npm install
```

**4) .env dosyasını hazırla**
```bash
cp .env.example .env
```
`.env` içine Google API anahtarını yapıştır. `FIREBASE_SERVICE_ACCOUNT_PATH` ve
`FIREBASE_DATABASE_URL` zaten doğru varsayılanlarla geliyor.

## Çalıştırma

```bash
node geocode.js
```

Script:
1. Firebase'deki tüm aylık DİİB kayıtlarını + Turquality listesini okur,
2. Her benzersiz firma için en uzun/dolu adresi seçer,
3. Daha önce çözülmemiş (ya da `--force` ile hepsini) Google Geocoding'e sorar,
4. Sonuçları `addrGeo/<firmaKey>` altına yazar,
5. Bulunamayanları `scripts/not_found.json`'a listeler (adres kalitesi kontrolü için).

**Faydalı parametreler:**
```bash
node geocode.js --dry           # hiçbir şey yazmaz, sadece rapor verir (önce bunu dene)
node geocode.js --limit=50      # ilk 50 yeni firmayla test et (maliyet kontrolü)
node geocode.js --force         # daha önce çözülmüş firmaları da yeniden dener
```

## Ne zaman tekrar çalıştırmalı?

Yeni bir ay verisi yüklendiğinde ya da yeni firmalar eklendiğinde tekrar `node geocode.js`
çalıştır — script zaten çözülmüş firmaları otomatik atlar, sadece yeni/eksik olanlar için
API'ye gider (maliyet sadece yeni firmalar kadar).

## Sonuç sitede nasıl görünür?

Firma listesinde mesafe rozetinin yanında:
- **📍** → tam adres (bu script ile) — en hassas
- **•** → mahalle bazlı (tarayıcıdan canlı Nominatim sorgusu)
- rozet yok → ilçe/il merkezi (offline tablo)
