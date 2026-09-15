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

PLAYWRIGHT_CONCURRENCY = int(os.getenv("PLAYWRIGHT_CONCURRENCY", "4"))
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

PLAYWRIGHT_SEMAPHORE: Optional[asyncio.Semaphore] = None
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