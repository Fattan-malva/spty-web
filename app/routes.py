import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse

from . import config, queue, services, settings, spdc
from .config import MAX_LIMIT
from .mappers import sanitize_track_id

router = APIRouter()


def _require(request: Request, sp_dc_q: Optional[str]) -> str | HTMLResponse:
    room_sp_dc = spdc.require_sp_dc(request, sp_dc_q)
    if isinstance(room_sp_dc, HTMLResponse):
        return room_sp_dc
    return room_sp_dc


def _queue_response(items):
    return {"items": items, "count": len(items)}


@router.get("/health")
async def health(request: Request):
    app = request.app
    return {
        "status": "ok",
        "browser": getattr(app.state, "browser", None) is not None,
        "playwrightConcurrency": config.PLAYWRIGHT_CONCURRENCY,
        "spotifyHttpConcurrency": config.SPOTIFY_HTTP_CONCURRENCY,
        "embedConcurrency": config.EMBED_CONCURRENCY,
        "time": int(config.now()),
    }


@router.get("/")
async def root():
    return FileResponse(os.path.join(config.BASE_DIR, "search.html"), media_type="text/html")


@router.get("/settings")
async def get_settings():
    return settings.load_settings()


@router.put("/settings")
async def put_settings(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    return settings.save_settings(body or {})


@router.get("/queue")
async def get_queue():
    return _queue_response(queue.read())


@router.post("/queue")
async def add_queue(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    items, added = queue.add(body or {})
    return {**_queue_response(items), "added": added}


@router.post("/queue/next")
async def take_queue_next():
    item, items = queue.take_next()
    return {**_queue_response(items), "item": item}


@router.put("/queue/{track_id}")
async def update_queue(track_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    return _queue_response(queue.update(track_id, body or {}))


@router.delete("/queue")
async def clear_queue():
    return _queue_response(queue.clear())


@router.delete("/queue/{track_id}")
async def delete_queue(track_id: str):
    return _queue_response(queue.remove(track_id))


@router.get("/search")
async def search(request: Request, q: str = Query(...), page: int = Query(1, ge=1),
                 limit: int = Query(20, ge=1, le=MAX_LIMIT),
                 offset: Optional[int] = Query(None, ge=0)):
    if offset is not None:
        page = (offset // limit) + 1
    return await services.fetch_search_page(request.app, q, page, limit)


@router.get("/track")
async def track_ep(request: Request, trackId: str = Query(...),
                   sp_dc: Optional[str] = Query(None)):
    tid = sanitize_track_id(trackId)
    if not tid:
        raise HTTPException(status_code=400, detail="Invalid trackId")
    room_sp_dc = _require(request, sp_dc)
    if isinstance(room_sp_dc, HTMLResponse):
        return room_sp_dc
    metadata = await services.get_track_metadata(request.app, tid, room_sp_dc)
    if not metadata:
        raise HTTPException(status_code=404, detail="Track not found")
    return metadata


@router.get("/lyrics")
async def lyrics_ep(request: Request, trackId: str = Query(...),
                    sp_dc: Optional[str] = Query(None)):
    tid = sanitize_track_id(trackId)
    if not tid:
        raise HTTPException(status_code=400, detail="Invalid trackId")
    room_sp_dc = _require(request, sp_dc)
    if isinstance(room_sp_dc, HTMLResponse):
        return room_sp_dc
    return await services.get_lyrics(request.app, tid, room_sp_dc)


@router.get("/embed-proxy")
async def embed_proxy(request: Request, trackId: str = Query(...),
                      sp_dc: Optional[str] = Query(None)):
    room_sp_dc = _require(request, sp_dc)
    if isinstance(room_sp_dc, HTMLResponse):
        return room_sp_dc
    tid = sanitize_track_id(trackId)
    if not tid:
        raise HTTPException(status_code=400, detail="Invalid trackId")
    return await services.get_embed_html(request.app, tid, room_sp_dc)


@router.get("/player", response_class=FileResponse)
async def player():
    player_path = os.path.join(config.BASE_DIR, "player.html")
    return FileResponse(player_path, media_type="text/html")


@router.delete("/cache")
async def clear_cache():
    config.SEARCH_CACHE.clear()
    config.TRACK_META_CACHE.clear()
    config.EMBED_CACHE.clear()
    config.LYRICS_CACHE.clear()
    return {"success": True, "message": "All caches cleared"}


@router.delete("/cache/{query}")
async def clear_query_cache(query: str):
    existed = query in config.SEARCH_CACHE
    config.SEARCH_CACHE.pop(query, None)
    return {"success": True, "query": query, "removed": existed}
