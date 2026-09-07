# oplab backend — Render.com dağıtım rehberi

Bu dosyalar (`main.py`, `engine.py`, `requirements.txt`, `__init__.py`),
canlı yarışma sitesinin (rekabet-testi) backend'inden **tamamen bağımsız,
ikinci bir kopyadır**. Aynı `oplab` GitHub reposunun KÖK dizinine, mevcut
frontend dosyalarının (`index.html`, `config.js` vb.) yanına eklenmiştir —
Vercel bu Python dosyalarını yok sayıp siteyi statik olarak yayınlamaya
devam eder, hiçbir çakışma olmaz.

## Render'da yeni servis kurulumu

1. https://dashboard.render.com → **New +** → **Web Service**
2. GitHub hesabını bağla (bağlı değilse) ve **sukocrc06-cmd/oplab** reposunu seç
3. Ayarlar:
   - **Name:** `oplab-backend` (istediğin bir isim — Render bunu URL'ye ekler, ör. `https://oplab-backend-xxxx.onrender.com`)
   - **Root Directory:** boş bırak (dosyalar reponun kök dizininde)
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** Free
4. **Create Web Service** — ilk build birkaç dakika sürer.
5. Build bitince Render sana bir URL verir, ör: `https://oplab-backend-xxxx.onrender.com`

## Frontend'i yeni backend'e bağlama

Render URL'sini aldıktan sonra `config.js` içindeki şu iki satırı güncelle:

```js
BACKEND_HTTP: 'https://oplab-backend-xxxx.onrender.com',
BACKEND_WS:   'wss://oplab-backend-xxxx.onrender.com',
```

(`https://` → `BACKEND_HTTP`, `wss://` → `BACKEND_WS` — adres aynı, sadece
protokol öneki farklı.)

Değişikliği GitHub'a push ettiğinde Vercel otomatik yeniden yayınlar.

## Bilinmesi gerekenler

- Bu backend, canlı sitenin backend'iyle (rekabet-testi.onrender.com) hiçbir
  kod/veri/kilit paylaşmaz — tamamen ayrı bir Render servisi, ayrı bir
  süreç, ayrı bellek. Hangi hisseyi çekersen çek, canlı yarışmayı etkilemez.
- Render'ın ücretsiz katmanı 15 dakika boşta kalınca uyur; ilk istekte
  ~50 saniye+ uyanma gecikmesi olabilir. `main.py` içinde zaten bir
  self-ping döngüsü var (10 dakikada bir kendine istek atar) — bu servis
  de aynı korumayla gelir, ekstra bir şey yapmana gerek yok.
- Yahoo Finance (yfinance) verisine bağımlılık aynı şekilde geçerli: bazen
  geçici olarak veri gelmeyebilir, ama frontend tarafında (tradingChart.js)
  zaten sonsuz kendi kendini iyileştiren yeniden deneme mekanizması var —
  veri geldiğinde otomatik yakalar.
