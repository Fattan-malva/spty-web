import re
from typing import Any


def sanitize_track_id(raw: str) -> str:
    tid = raw.strip()
    if tid.startswith("spotify:track:"):
        tid = tid.split(":")[-1]
    elif "open.spotify.com/track/" in tid:
        tid = tid.split("/track/")[-1].split("?")[0].split("/")[0]
    return re.sub(r"[^a-zA-Z0-9]+", "", tid)


def format_duration(ms: int | None) -> str:
    if not ms:
        return "0:00"
    total_sec = ms // 1000
    h, rem = divmod(total_sec, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def best_image(sources):
    if not sources:
        return None
    return max(sources, key=lambda x: x.get("width") or 0).get("url")


def extract_artists(value):
    if isinstance(value, dict):
        items = value.get("items") or []
    elif isinstance(value, list):
        items = value
    else:
        items = []
    result = []
    for artist in items:
        if not isinstance(artist, dict):
            continue
        name = ((artist.get("profile") or {}).get("name") or artist.get("name"))
        if name:
            result.append(name)
    return result


def extract_thumbnail(album):
    album = album or {}
    sources = album.get("coverArt", {}).get("sources", [])
    if not sources:
        sources = album.get("images") or []
    return best_image(sources)


def map_track(d: dict[str, Any]) -> dict[str, Any]:
    track_id = d.get("id")
    artists = extract_artists(d.get("artists"))
    album = d.get("albumOfTrack") or d.get("album") or {}
    album_uri = album.get("uri")
    duration_ms = (
        (d.get("duration") or {}).get("totalMilliseconds")
        or d.get("duration_ms") or 0
    )
    explicit = (d.get("contentRating") or {}).get("label") == "EXPLICIT"
    album_id = album_uri.split(":")[-1] if album_uri and ":" in album_uri else None
    return {
        "title": d.get("name"),
        "trackId": track_id,
        "link": f"https://open.spotify.com/track/{track_id}" if track_id else None,
        "thumbnail": extract_thumbnail(album),
        "artist": ", ".join(artists),
        "artistList": artists,
        "album": album.get("name"),
        "albumUrl": f"https://open.spotify.com/album/{album_id}" if album_id else None,
        "duration": format_duration(duration_ms),
        "durationMs": duration_ms,
        "explicit": explicit,
        "type": "track",
    }


def extract_search(data):
    root = data.get("data") or {}
    search = root.get("searchV2") or root.get("search")
    if not search:
        return [], 0
    tracks = search.get("tracksV2") or search.get("tracks") or {}
    items = tracks.get("items") or []
    total = tracks.get("totalCount") or 0
    result = []
    for item in items:
        if not isinstance(item, dict):
            continue
        track = ((item.get("item") or {}).get("data")
                 or item.get("track") or item.get("data") or item)
        if isinstance(track, dict) and str(track.get("uri", "")).startswith("spotify:track:"):
            result.append(track)
    return result, total


def find_track_objs(obj, depth=0, out=None):
    if out is None:
        out = []
    if depth > 9 or not isinstance(obj, (dict, list)):
        return out
    if isinstance(obj, dict):
        if (str(obj.get("uri", "")).startswith("spotify:track:")
                and "albumOfTrack" in obj and "duration" in obj):
            out.append(obj)
        for value in obj.values():
            find_track_objs(value, depth + 1, out)
    else:
        for item in obj:
            find_track_objs(item, depth + 1, out)
    return out


def normalize_lyrics_payload(track_id: str, data: dict) -> dict:
    node = (data.get("lyrics") or {}) if isinstance(data, dict) else {}
    sync_type = node.get("syncType") or "UNSYNCED"
    raw_lines = node.get("lines") or []
    lines: list[dict[str, Any]] = []
    for ln in raw_lines:
        if not isinstance(ln, dict):
            continue
        text = (ln.get("words") or "").strip()
        # Keep empty lines as instrumental breaks so timing gaps stay visible.
        # Frontend renders them as spacer glyph.
        try:
            start_ms = int(ln.get("startTimeMs") or 0)
        except (ValueError, TypeError):
            start_ms = 0
        try:
            dur_ms = int(ln.get("durationMs") or 0)
        except (ValueError, TypeError):
            dur_ms = 0
        lines.append({
            "startMs": max(0, start_ms),
            "durationMs": max(0, dur_ms),
            "endMs": max(0, start_ms) + max(0, dur_ms),
            "text": text,
        })
    # Ensure chronological order for binary-search sync on frontend.
    lines.sort(key=lambda x: x["startMs"])
    has_sync = sync_type == "LINE_SYNCED" and any(
        ln["startMs"] > 0 or ln["text"] for ln in lines
    )
    return {
        "trackId": track_id,
        "syncType": sync_type,
        "hasSync": bool(has_sync),
        "lines": lines,
        "provider": node.get("provider") or data.get("provider") if isinstance(data, dict) else None,
        "colors": data.get("colors") if isinstance(data, dict) else None,
    }