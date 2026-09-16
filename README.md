# Spotify Web Player

Aplikasi web lokal untuk mencari lagu Spotify, memutar embed track, menampilkan lirik tersinkronisasi, dan mengelola antrean lagu. Backend menggunakan FastAPI; frontend menggunakan HTML, CSS, dan JavaScript vanilla.

> **Catatan penting:** aplikasi ini memerlukan nilai cookie `sp_dc` Spotify. Nilai tersebut adalah kredensial sensitif. Jangan commit `sp_dc`, `.env`, atau `settings.json` ke repository dan jangan membagikannya.

## Fitur

- Pencarian lagu dengan hasil bertahap dan suggestions.
- Pemutar lagu berbasis Spotify embed.
- Lirik tersinkronisasi jika tersedia.
- Mini player saat kembali ke halaman pencarian.
- Antrean lagu berikutnya.
- Cache metadata, hasil pencarian, embed, dan lirik di memory.
- Endpoint health check dan dokumentasi API FastAPI.
- Konfigurasi concurrency dan timeout melalui environment variables.

## Prasyarat

- Python 3.10 atau lebih baru.
- Koneksi internet.
- Akun Spotify yang memiliki cookie `sp_dc` aktif.

## Instalasi

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### Linux atau macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

## Konfigurasi

Cara yang direkomendasikan adalah membuka halaman aplikasi lalu mengisi `sp_dc` melalui menu Settings. Nilai tersebut disimpan ke `settings.json`, yang sudah diabaikan oleh Git.

Untuk request API, `sp_dc` juga dapat dikirim melalui query parameter `sp_dc`, cookie `sp_dc`, atau header `x-sp-dc`. Aplikasi memuat file `.env` untuk konfigurasi proses. Variabel runtime yang tersedia:

| Variable | Default | Keterangan |
| --- | ---: | --- |
| `SPOTIFY_HTTP_CONCURRENCY` | `20` | Batas request HTTP Spotify bersamaan |
| `EMBED_CONCURRENCY` | `12` | Batas pembuatan embed bersamaan |
| `HTTP_CONNECT_TIMEOUT` | `5` | Timeout koneksi HTTP, dalam detik |
| `HTTP_READ_TIMEOUT` | `15` | Timeout pembacaan response |
| `HTTP_WRITE_TIMEOUT` | `15` | Timeout pengiriman request |
| `HTTP_POOL_TIMEOUT` | `5` | Timeout menunggu koneksi pool |
| `SEARCH_CACHE_TTL` | `300` | TTL cache pencarian |
| `TRACK_META_CACHE_TTL` | `600` | TTL cache metadata track |
| `EMBED_CACHE_TTL` | `600` | TTL cache embed |
| `LYRICS_CACHE_TTL` | `600` | TTL cache lirik |

Nilai cache dalam hitungan detik. Variabel `MAX_SEARCH_CACHE`, `MAX_TRACK_CACHE`, `MAX_EMBED_CACHE`, dan `MAX_LYRICS_CACHE` juga dapat digunakan untuk mengatur jumlah maksimum item cache.

## Menjalankan aplikasi

```bash
python main.py
```

Aplikasi berjalan di:

- Web player: http://localhost:1404/
- Health check: http://localhost:1404/health
- API docs: http://localhost:1404/docs

Untuk menjalankan langsung dengan Uvicorn:

```bash
uvicorn app.application:app --host 0.0.0.0 --port 1404 --workers 1
```

Gunakan satu worker karena cache aplikasi dikelola dalam lifecycle proses.

## Endpoint utama

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| `GET` | `/` | Halaman pencarian |
| `GET` | `/player?trackId=...` | Halaman player |
| `GET` | `/search?q=...` | Pencarian track |
| `GET` | `/track?trackId=...` | Metadata track |
| `GET` | `/lyrics?trackId=...` | Lirik track |
| `GET` | `/embed-proxy?trackId=...` | Embed player melalui proxy |
| `GET` | `/settings` | Membaca konfigurasi lokal |
| `PUT` | `/settings` | Menyimpan `sp_dc` |
| `GET` | `/health` | Status service dan concurrency |
| `DELETE` | `/cache` | Menghapus seluruh cache |

Endpoint track, lyrics, dan embed menerima query `sp_dc` opsional untuk mode kredensial per-request. Jangan menaruh URL yang mengandung `sp_dc` di log, screenshot, issue, atau history shell.

## Struktur proyek

```text
.
├── app/
│   ├── application.py  # Factory FastAPI dan lifecycle
│   ├── config.py       # Konfigurasi, timeout, dan cache
│   ├── routes.py       # HTTP routes
│   ├── services.py     # Orkestrasi pencarian, metadata, lirik, dan embed
│   ├── spotify.py      # Integrasi request Spotify dan TOTP token
│   └── settings.py     # Penyimpanan settings lokal
├── static/
│   ├── app.css
│   ├── player.js
│   └── search.js
├── main.py             # Entry point aplikasi
├── player.html
├── search.html
├── requirements.txt
└── .gitignore
```

## Pengembangan

Setelah mengubah backend, cek aplikasi dan health endpoint dari browser atau curl. Untuk pemeriksaan sintaks Python:

```bash
python -m compileall app main.py
```

Untuk menghentikan server, tekan `Ctrl+C` pada terminal yang menjalankannya.

## Keamanan dan batasan

- `sp_dc` harus diperlakukan seperti password dan segera dicabut atau diganti jika bocor.
- Aplikasi ini ditujukan untuk penggunaan lokal atau jaringan tepercaya. Sebelum dipublikasikan, tambahkan autentikasi, batasi CORS, gunakan HTTPS, dan lindungi endpoint settings serta cache.
- Integrasi Spotify bergantung pada endpoint dan perilaku embed yang dapat berubah sewaktu-waktu.
- Pastikan penggunaan aplikasi mematuhi Terms of Use Spotify dan hak akses akun yang digunakan.
