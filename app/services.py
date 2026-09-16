import asyncio

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse

from . import config, locks, spotify
from .config import MAX_EMBED_CACHE, MAX_LYRICS_CACHE, MAX_TRACK_CACHE, cache_put, now
from .mappers import extract_search, find_track_objs, map_track, sanitize_track_id

SEARCH_PAGE_LIMIT = 25


def get_search_cache(query: str):
    cache = config.SEARCH_CACHE.get(query)
    if not cache:
        return None
    if now() - cache["updated_at"] > config.SEARCH_CACHE_TTL:
        config.SEARCH_CACHE.pop(query, None)
        return None
    config.SEARCH_CACHE.move_to_end(query)
    return cache


def create_search_cache(query: str):
    cache = {"tracks": [], "seen": set(), "continuation_offset": 0,
             "total_results": 0, "has_more": True, "updated_at": now()}
    cache_put(config.SEARCH_CACHE, query, cache, config.MAX_SEARCH_CACHE)
    return cache


async def fetch_next_spotify_page(app, query, cache, fetch_limit=50):
    if not cache["has_more"]:
        return False
    data = await spotify.spotify_query(
        app, "searchDesktop",
        {"searchTerm": query, "offset": cache["continuation_offset"],
         "limit": fetch_limit, "numberOfTopResults": fetch_limit,
         "includeAudiobooks": False, "includeAuthors": False,
         "includePreReleases": False},
        sp_dc=None,
    )
    items, total = extract_search(data)
    cache["total_results"] = total
    for track in items:
        track_id = track.get("id")
        if not track_id or track_id in cache["seen"]:
            continue
        cache["seen"].add(track_id)
        cache["tracks"].append(map_track(track))
    cache["continuation_offset"] += len(items)
    cache["updated_at"] = now()
    if len(items) < fetch_limit or (total and cache["continuation_offset"] >= total):
        cache["has_more"] = False
    return bool(items)


async def fetch_search_page(app, query, page, limit):
    query = query.strip()
    if not query:
        return {"data": [], "page": page, "limit": limit, "total": 0, "hasNext": False}

    lock = await locks.get_search_lock(query)
    async with lock:
        cache = get_search_cache(query) or create_search_cache(query)
        start = (page - 1) * limit
        end = start + limit
        fetched = 0
        while len(cache["tracks"]) < end and cache["has_more"] and fetched < SEARCH_PAGE_LIMIT:
            fetched += 1
            if not await fetch_next_spotify_page(app, query, cache):
                break
        data = cache["tracks"][start:end]
        return {"data": data, "page": page, "limit": limit,
                "total": len(cache["tracks"]),
                "totalResults": cache.get("total_results", 0),
                "hasNext": len(cache["tracks"]) > end or cache["has_more"]}


async def get_track_metadata(app, track_id: str, sp_dc: str):
    tid = sanitize_track_id(track_id)
    now_ts = now()
    cached = config.TRACK_META_CACHE.get(tid)
    if cached and now_ts < cached["expiresAt"]:
        config.TRACK_META_CACHE.move_to_end(tid)
        return cached["data"]
    if cached:
        config.TRACK_META_CACHE.pop(tid, None)

    for cache in config.SEARCH_CACHE.values():
        for track in cache.get("tracks", []):
            if track.get("trackId") == tid:
                cache_put(config.TRACK_META_CACHE, tid,
                          {"data": track, "expiresAt": now_ts + config.TRACK_META_CACHE_TTL},
                          MAX_TRACK_CACHE)
                return track

    oembed_thumb = None
    oembed_title = "Unknown"
    oembed_artist = ""

    try:
        response = await app.state.http.get(
            f"https://open.spotify.com/oembed?url=https://open.spotify.com/track/{tid}",
            headers={"User-Agent": config.UA}, timeout=10.0)
        if response.status_code == 200:
            data = response.json()
            oembed_thumb = data.get("thumbnail_url")
            title = data.get("title") or "Unknown"
            if " - " in title:
                oembed_title, oembed_artist = title.split(" - ", 1)
            elif data.get("author_name"):
                oembed_title, oembed_artist = title, data["author_name"]
            else:
                oembed_title = title
    except Exception:
        pass

    try:
        data = await asyncio.wait_for(
            spotify.spotify_query(app, "getTrack",
                                  {"uri": f"spotify:track:{tid}",
                                   "includeVideoAssociationItems": False},
                                  sp_dc=sp_dc),
            timeout=15.0)
        objects = find_track_objs(data.get("data"))
        found = next((item for item in objects if item.get("id") == tid), None)
        root = data.get("data") or {}
        if not found:
            track_union = root.get("trackUnion") or {}
            if track_union.get("id") == tid:
                found = track_union
        if found:
            if not found.get("artists"):
                first_artist = ((root.get("trackUnion") or {}).get("firstArtist")
                                or found.get("firstArtist") or {})
                if isinstance(first_artist, dict) and first_artist.get("items"):
                    found = dict(found)
                    found["artists"] = {"items": first_artist["items"]}
            metadata = map_track(found)
            if not metadata.get("thumbnail") and oembed_thumb:
                metadata["thumbnail"] = oembed_thumb
            cache_put(config.TRACK_META_CACHE, tid,
                      {"data": metadata, "expiresAt": now() + config.TRACK_META_CACHE_TTL},
                      MAX_TRACK_CACHE)
            return metadata
    except Exception:
        pass

    if oembed_thumb:
        metadata = {
            "title": oembed_title, "trackId": tid,
            "link": f"https://open.spotify.com/track/{tid}",
            "thumbnail": oembed_thumb, "artist": oembed_artist,
            "artistList": [oembed_artist] if oembed_artist else [],
            "album": None, "albumUrl": None, "duration": "0:00",
            "durationMs": 0, "explicit": False, "type": "track",
        }
        cache_put(config.TRACK_META_CACHE, tid,
                  {"data": metadata, "expiresAt": now() + 30},
                  MAX_TRACK_CACHE)
        return metadata
    return None


async def get_lyrics(app, track_id: str, sp_dc: str) -> dict:
    tid = sanitize_track_id(track_id)
    cached = config.LYRICS_CACHE.get(tid)
    if cached and now() < cached["expiresAt"]:
        config.LYRICS_CACHE.move_to_end(tid)
        return cached["data"]
    if cached:
        config.LYRICS_CACHE.pop(tid, None)

    payload = await spotify.fetch_spotify_lyrics(app, tid, sp_dc)
    if not payload or not payload.get("lines"):
        # Cache negative result briefly to avoid hammering upstream.
        cache_put(config.LYRICS_CACHE, tid,
                  {"data": {"trackId": tid, "syncType": "NONE",
                            "hasSync": False, "lines": [], "provider": None},
                   "expiresAt": now() + 60},
                  MAX_LYRICS_CACHE)
        raise HTTPException(status_code=404, detail="Lyrics not available for this track")
    cache_put(config.LYRICS_CACHE, tid,
              {"data": payload, "expiresAt": now() + config.LYRICS_CACHE_TTL},
              MAX_LYRICS_CACHE)
    return payload


async def get_embed_html(app, track_id: str, sp_dc: str) -> HTMLResponse:
    tid = sanitize_track_id(track_id)
    cache_key = f"{tid}:{config.cred_key(sp_dc)}"
    cached = config.EMBED_CACHE.get(cache_key)
    if cached and now() < cached["expiresAt"]:
        config.EMBED_CACHE.move_to_end(cache_key)
        return HTMLResponse(content=cached["html"], headers=cached["headers"])
    if cached:
        config.EMBED_CACHE.pop(cache_key, None)

    target = f"https://open.spotify.com/embed/track/{tid}?utm_source=generator&theme=0"
    headers = {"User-Agent": config.UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
               "Accept-Language": "en-US,en;q=0.9", "Referer": "https://open.spotify.com/"}
    try:
        async with config.EMBED_SEMAPHORE:
            response = await app.state.http.get(target, headers=headers,
                                                cookies={"sp_dc": sp_dc}, timeout=25.0)
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.PoolTimeout) as exc:
        raise HTTPException(status_code=504, detail=f"Spotify embed timeout: {type(exc).__name__}")

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Embed fetch {response.status_code}")

    html = response.text
    if "</head>" in html:
        html = html.replace(
            "</head>",
            '<style>'
            '[data-testid="embed-widget-container"]{opacity:1 !important}'
            '[data-testid="embed-widget-skeleton"],'
            '[data-testid="skeleton"],'
            '</style></head>',
            1
        )

    response_headers = {
        "X-Frame-Options": "ALLOWALL",
        "Content-Security-Policy": "frame-ancestors *",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
    }
    cache_put(config.EMBED_CACHE, cache_key,
              {"html": html, "headers": response_headers,
               "expiresAt": now() + config.EMBED_CACHE_TTL},
              MAX_EMBED_CACHE)
    return HTMLResponse(content=html, headers=response_headers)