#!/bin/bash
# Çift tıklanabilir: yeni firmaların konumlarını Google'dan çözüp Firebase'e yazar.
# Yönetim panelindeki "Konum Denetimi" ekranı bu dosyayı işaret eder.
# Mevcut kayıtlara dokunmaz — yalnızca koordinatı olmayan firmalar işlenir.

cd "$(dirname "$0")" || exit 1

echo "=============================================="
echo "  Dış Ticaret Radar — Konumları Güncelle"
echo "=============================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "HATA: Bu bilgisayarda Node.js kurulu değil."
  echo "nodejs.org adresinden kurup tekrar deneyebilirsin."
  echo
  read -r -p "Kapatmak için Enter'a bas..."
  exit 1
fi

if [ ! -f .env ]; then
  echo "HATA: scripts/.env dosyası yok (Google anahtarı ve veritabanı adresi orada tutulur)."
  echo
  read -r -p "Kapatmak için Enter'a bas..."
  exit 1
fi

echo "1/2 · Mevcut konumların yedeği alınıyor…"
node addrgeo_yedekle.js || { echo; echo "Yedek alınamadı, işlem durduruldu."; read -r -p "Enter…"; exit 1; }
echo

echo "2/2 · Koordinatı olmayan firmalar çözülüyor…"
echo "(Mevcut kayıtlara dokunulmaz. Durdurmak için Ctrl+C)"
echo
node geocode.js

echo
echo "=============================================="
echo "  Bitti. Yönetim panelinde Konum Denetimi →"
echo "  'Yeniden tara' diyerek sonucu görebilirsin."
echo "=============================================="
echo
read -r -p "Kapatmak için Enter'a bas..."
