import asyncio
import json
import os
import threading
import uuid
from typing import Any, Optional

from fastapi import HTTPException

from .config import BASE_DIR

QUEUE_FILE = os.path.join(BASE_DIR, "queue.json")
MAX_ITEMS = 500
MAX_STRING_LEN = 5000

_lock = threading.Lock()
_subscribers: set[asyncio.Queue] = set()


def load_queue() -> list[dict[str, Any]]:
    try:
        with open(QUEUE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    items = []
    for entry in data:
        if isinstance(entry, dict) and entry.get("trackId"):
            items.append({
                "id": str(entry.get("id") or uuid.uuid4().hex[:8]),
                "trackId": str(entry.get("trackId", "")),
                "title": str(entry.get("title", "")),
                "artist": str(entry.get("artist", "")),
                "thumbnail": str(entry.get("thumbnail", "")),
            })
    return items


def write_queue(items: list[dict[str, Any]]) -> None:
    payload = items[:MAX_ITEMS]
    with open(QUEUE_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())


def _sanitize_item(item: Any) -> Optional[dict[str, str]]:
    if not isinstance(item, dict):
        return None
    track_id = str(item.get("trackId") or "").strip()
    if not track_id:
        return None
    return {
        "trackId": track_id[:200],
        "title": str(item.get("title") or "")[:MAX_STRING_LEN],
        "artist": str(item.get("artist") or "")[:MAX_STRING_LEN],
        "thumbnail": str(item.get("thumbnail") or "")[:MAX_STRING_LEN],
    }


def _action_add(items: list[dict], item_or_items) -> dict:
    batch = item_or_items if isinstance(item_or_items, list) else [item_or_items]
    added = 0
    for item in batch:
        clean = _sanitize_item(item)
        if not clean:
            continue
        clean["id"] = uuid.uuid4().hex[:8]
        items.append(clean)
        added += 1
    if added == 0:
        raise HTTPException(status_code=400, detail="Invalid queue item(s)")
    return {"items": items, "ok": True, "added": added}


def _action_remove(items: list[dict], index) -> dict:
    try:
        idx = int(index)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid index")
    if idx < 0 or idx >= len(items):
        raise HTTPException(status_code=400, detail="Index out of range")
    removed = items.pop(idx)
    return {"items": items, "ok": True, "removed": removed}


def _action_shift(items: list[dict]) -> dict:
    removed = items.pop(0) if items else None
    return {"items": items, "ok": True, "shifted": removed}


def _action_clear(items: list[dict]) -> dict:
    return {"items": [], "ok": True}


def apply_action(items: list[dict[str, Any]], action: str, body: dict) -> dict:
    if action == "add":
        data = body.get("items") or body.get("item")
        return _action_add(items, data)
    if action == "remove":
        return _action_remove(items, body.get("index"))
    if action == "shift":
        return _action_shift(items)
    if action == "clear":
        return _action_clear(items)
    raise HTTPException(status_code=400, detail=f"Unknown action: {action}")


def mutate(action: str, body: dict) -> dict:
    with _lock:
        items = load_queue()
        result = apply_action(items, action, body)
        write_queue(result["items"])
        result["items"] = list(result["items"])
        return result


def subscribe() -> asyncio.Queue:
    q = asyncio.Queue(maxsize=1)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def event_message(items: list[dict[str, Any]]) -> str:
    payload = json.dumps({"type": "queue", "queue": items}, ensure_ascii=False)
    return f"data: {payload}\n\n"


async def publish(items: list[dict[str, Any]]) -> None:
    message = event_message(items)
    for q in list(_subscribers):
        try:
            q.put_nowait(message)
        except asyncio.QueueFull:
            pass