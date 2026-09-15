import json
import os
import threading
from typing import Any

from fastapi import HTTPException

from .config import BASE_DIR
from .mappers import sanitize_track_id

QUEUE_FILE = os.path.join(BASE_DIR, "queue.json")
MAX_QUEUE_ITEMS = 200
_LOCK = threading.RLock()


def _default() -> list[dict[str, Any]]:
    return []


def _read_unlocked() -> list[dict[str, Any]]:
    try:
        with open(QUEUE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return _default()

    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return _default()
    return [item for item in items if isinstance(item, dict) and item.get("trackId")]


def _write_unlocked(items: list[dict[str, Any]]) -> None:
    payload = {"items": items}
    tmp_file = QUEUE_FILE + ".tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp_file, QUEUE_FILE)


def read() -> list[dict[str, Any]]:
    with _LOCK:
        return _read_unlocked()


def add(item: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    track_id = sanitize_track_id(str(item.get("trackId") or ""))
    if not track_id:
        raise HTTPException(status_code=400, detail="Invalid trackId")

    normalized = {
        "trackId": track_id,
        "title": str(item.get("title") or "Unknown"),
        "artist": str(item.get("artist") or ""),
        "thumbnail": str(item.get("thumbnail") or ""),
    }

    with _LOCK:
        items = _read_unlocked()
        if any(existing.get("trackId") == track_id for existing in items):
            return items, False
        if len(items) >= MAX_QUEUE_ITEMS:
            raise HTTPException(status_code=409, detail="Queue is full")
        items.append(normalized)
        _write_unlocked(items)
        return items, True


def update(track_id: str, data: dict[str, Any]) -> list[dict[str, Any]]:
    track_id = sanitize_track_id(track_id)
    if not track_id:
        raise HTTPException(status_code=400, detail="Invalid trackId")

    with _LOCK:
        items = _read_unlocked()
        for item in items:
            if item.get("trackId") == track_id:
                for key in ("title", "artist", "thumbnail"):
                    if key in data:
                        item[key] = str(data.get(key) or "")
                _write_unlocked(items)
                return items
        raise HTTPException(status_code=404, detail="Queue item not found")


def remove(track_id: str) -> list[dict[str, Any]]:
    track_id = sanitize_track_id(track_id)
    if not track_id:
        raise HTTPException(status_code=400, detail="Invalid trackId")

    with _LOCK:
        items = _read_unlocked()
        next_items = [item for item in items if item.get("trackId") != track_id]
        if len(next_items) != len(items):
            _write_unlocked(next_items)
        return next_items


def clear() -> list[dict[str, Any]]:
    with _LOCK:
        items: list[dict[str, Any]] = []
        _write_unlocked(items)
        return items


def take_next() -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    with _LOCK:
        items = _read_unlocked()
        if not items:
            return None, []
        item = items.pop(0)
        _write_unlocked(items)
        return item, items
