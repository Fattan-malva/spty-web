import asyncio
import hashlib
import os
import time
from collections import OrderedDict
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SPOTIFY_PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query"
SPCLIENT_LYRICS_URL = (
    "https://spclient.wg.spotify.com/color-lyrics/v2/track/{track_id}"
    "?format=json&vocalRemoval=false&market=from_token"
)
SPOTIFY_TOKEN_URL = "https://open.spotify.com/api/token"
SPOTIFY_SERVER_TIME_URL = "https://open.spotify.com/api/server-time"
SPOTIFY_CLIENT_TOKEN_URL = "https://clienttoken.spotify.com/v1/clienttoken"
SPOTIFY_WEB_PLAYER_URL = "https://open.spotify.com/"
SPOTIFY_CLIENT_ID = "d8a5ed958d274c2e8ee717e6a4b0971d"
SPOTIFY_CLIENT_VERSION = "1.2.49.460"
SPOTIFY_PRODUCT_TYPE = "web-player"

# Known persisted-query hashes. At runtime the web player bundle is also
# scanned (regex) so a freshly-rotated hash is discovered automatically.
PERSISTED_HASHES = {
    "getTrack": "a8ef9e9f02b836feb0da3003c31dbb30decc6f4b473ef89ca88c882386d668de",
    "searchDesktop": "d9f785900f0710b31c07818d617f4f7600c1e21217e80f5b043d1e78d74e6026",
    "libraryV3": "390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455",
    "fetchPlaylist": "86dde7b9d9356e2369414647cf6950cfed96e778e129cfdfc99aea6c1613b3b0",
    "fetchLibraryTracks": "087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240",
}

# TOTP secrets used to mint web player access tokens, newest first.
# If an issue fails, they are re-extracted from the live bundle at runtime.
TOTP_SECRETS = [
    (61, ',7/*F("rLJ2oxaKL^f+E1xvP@N'),
    (60, 'OmE{ZA.J^":0FG\\Uz?[@WW'),
    (59, "{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH"),
]
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36")
SPOTIFY_HEADERS = {
    "accept": "application/json",
    "accept-language": "en-US,en;q=0.9",
    "app-platform": "WebPlayer",
    "origin": "https://open.spotify.com",
    "referer": "https://open.spotify.com/",
    "user-agent": UA,
}

SPOTIFY_HTTP_CONCURRENCY = int(os.getenv("SPOTIFY_HTTP_CONCURRENCY", "20"))
EMBED_CONCURRENCY = int(os.getenv("EMBED_CONCURRENCY", "12"))

HTTP_CONNECT_TIMEOUT = float(os.getenv("HTTP_CONNECT_TIMEOUT", "5"))
HTTP_READ_TIMEOUT = float(os.getenv("HTTP_READ_TIMEOUT", "15"))
HTTP_WRITE_TIMEOUT = float(os.getenv("HTTP_WRITE_TIMEOUT", "15"))
HTTP_POOL_TIMEOUT = float(os.getenv("HTTP_POOL_TIMEOUT", "5"))

SEARCH_CACHE_TTL = int(os.getenv("SEARCH_CACHE_TTL", "300"))
TRACK_META_CACHE_TTL = int(os.getenv("TRACK_META_CACHE_TTL", "600"))
EMBED_CACHE_TTL = int(os.getenv("EMBED_CACHE_TTL", "600"))
LYRICS_CACHE_TTL = int(os.getenv("LYRICS_CACHE_TTL", "600"))

MAX_SEARCH_CACHE = int(os.getenv("MAX_SEARCH_CACHE", "500"))
MAX_TRACK_CACHE = int(os.getenv("MAX_TRACK_CACHE", "2000"))
MAX_EMBED_CACHE = int(os.getenv("MAX_EMBED_CACHE", "500"))
MAX_LYRICS_CACHE = int(os.getenv("MAX_LYRICS_CACHE", "1000"))
MAX_LIMIT = 50

SEARCH_CACHE: OrderedDict[str, dict] = OrderedDict()
TRACK_META_CACHE: OrderedDict[str, dict] = OrderedDict()
EMBED_CACHE: OrderedDict[str, dict] = OrderedDict()
LYRICS_CACHE: OrderedDict[str, dict] = OrderedDict()

SPOTIFY_HTTP_SEMAPHORE: Optional[asyncio.Semaphore] = None
EMBED_SEMAPHORE: Optional[asyncio.Semaphore] = None


def cred_key(value: str) -> str:
    if not value:
        return "anon"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def now() -> float:
    return time.time()


def log(message: str):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}", flush=True)


def cache_put(cache: OrderedDict, key: str, value: dict, max_items: int):
    cache[key] = value
    cache.move_to_end(key)
    while len(cache) > max_items:
        cache.popitem(last=False)