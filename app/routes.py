import asyncio
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse

from . import config, queue_store, services, settings, spdc
from .config import MAX_LIMIT
from .mappers import sanitize_track_id

router = APIRouter()


def _require(request: Request, sp_dc_q: Optional[str]) -> str | HTMLResponse:
    room_sp_dc = spdc.require_sp_dc(request, sp_dc_q)
    if isinstance(room_sp_dc, HTMLResponse):
        return room_sp_dc
    return room_sp_dc


@router.get("/health")
async def health(request: Request):
    app = request.app
    return {
        "status": "ok",
        "spotifyHttpConcurrency": config.SPOTIFY_HTTP_CONCURRENCY,
        "embedConcurrency": config.EMBED_CONCURRENCY,
        "time": int(config.now()),
    }


@router.get("/")
async def root():
    return FileResponse(os.path.join(config.BASE_DIR, "home.html"), media_type="text/html")


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


def _queue_message(items) -> dict:
    return {"queue": items, "count": len(items)}


@router.get("/queue")
async def get_queue():
    return _queue_message(queue_store.load_queue())


@router.post("/queue")
async def post_queue(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    action = str(body.get("action") or "").strip()
    result = await asyncio.to_thread(queue_store.mutate, action, body or {})
    await queue_store.publish(result["items"])
    response = _queue_message(result["items"])
    if action == "shift" and result.get("shifted") is not None:
        response["shifted"] = result["shifted"]
    return response


@router.get("/queue/stream")
async def queue_stream(request: Request):
    async def event_generator():
        q = queue_store.subscribe()
        try:
            yield queue_store.event_message(queue_store.load_queue())
            while True:
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(q.get(), timeout=15)
                    yield message
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            queue_store.unsubscribe(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/search")
async def search(request: Request, q: str = Query(...), page: int = Query(1, ge=1),
                 limit: int = Query(20, ge=1, le=MAX_LIMIT),
                 offset: Optional[int] = Query(None, ge=0)):
    if offset is not None:
        page = (offset // limit) + 1
    return await services.fetch_search_page(request.app, q, page, limit)


@router.get("/playlists")
async def playlists_ep(request: Request, sp_dc: Optional[str] = Query(None)):
    room_sp_dc = _require(request, sp_dc)
    if isinstance(room_sp_dc, HTMLResponse):
        return room_sp_dc
    return await services.get_user_playlists(request.app, room_sp_dc)


@router.get("/liked")
async def liked_ep(request: Request, sp_dc: Optional[str] = Query(None)):
    room_sp_dc = _require(request, sp_dc)
    if isinstance(room_sp_dc, HTMLResponse):
        return room_sp_dc
    return await services.get_user_liked_tracks(request.app, room_sp_dc)


@router.get("/playlist/{playlist_id}/tracks")
async def playlist_tracks_ep(request: Request, playlist_id: str,
                             sp_dc: Optional[str] = Query(None)):
    room_sp_dc = _require(request, sp_dc)
    if isinstance(room_sp_dc, HTMLResponse):
        return room_sp_dc
    return await services.get_playlist_tracks(request.app, playlist_id, room_sp_dc)


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