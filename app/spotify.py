import asyncio
import json
from typing import Optional
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import FastAPI, HTTPException
from playwright.async_api import async_playwright

from . import config, locks, mappers
from .config import cred_key, log, now
from .mappers import sanitize_track_id

TOKEN_POLL_SECONDS = 60
TOKEN_POLL_INTERVAL = 0.25


async def new_page_with_cookies(browser, sp_dc: Optional[str] = None):
    ctx = await browser.new_context(user_agent=config.UA, locale="en-US")
    if sp_dc and len(sp_dc) > 20:
        try:
            await ctx.add_cookies([
                {"name": "sp_dc", "value": sp_dc, "domain": ".spotify.com",
                 "path": "/", "httpOnly": False, "secure": True, "sameSite": "Lax"},
                {"name": "sp_dc", "value": sp_dc, "domain": "open.spotify.com",
                 "path": "/", "httpOnly": False, "secure": True, "sameSite": "Lax"},
            ])
        except Exception as exc:
            log(f"[COOKIE] failed: {exc}")
    page = await ctx.new_page()
    return page, ctx


async def _get_access_token_uncached(app: FastAPI, sp_dc: str):
    browser = app.state.browser
    if not browser:
        raise HTTPException(status_code=503, detail="Browser not ready")
    credential_key = cred_key(sp_dc)
    token = None
    expire = 0

    def capture_request(req):
        if "api-partner.spotify.com/pathfinder" not in req.url:
            return
        try:
            parsed = parse_qs(urlparse(req.url).query)
            operation_name = (parsed.get("operationName") or [None])[0]
            ext_value = (parsed.get("extensions") or [None])[0]
            if not operation_name or not ext_value:
                body = json.loads(req.post_data or "")
                if not isinstance(body, dict):
                    return
                operation_name = body.get("operationName")
                extensions = body.get("extensions") or {}
            else:
                extensions = json.loads(ext_value)
            if not operation_name:
                return
            sha = (extensions.get("persistedQuery") or {}).get("sha256Hash")
            if sha:
                app.state.persisted_hashes[operation_name] = sha
        except Exception:
            return

    async def on_response(resp):
        nonlocal token, expire
        capture_request(resp.request)
        if "open.spotify.com/api/token" not in resp.url:
            return
        try:
            data = await resp.json()
        except Exception:
            return
        access_token = data.get("accessToken")
        if access_token:
            token = access_token
            expire = int(data.get("accessTokenExpirationTimestampMs", 0)) / 1000

    async with config.PLAYWRIGHT_SEMAPHORE:
        page = None
        ctx = None
        try:
            page, ctx = await new_page_with_cookies(browser, sp_dc)
            page.on("response", on_response)
            page.on("request", capture_request)
            await page.goto("https://open.spotify.com/search/hello",
                            wait_until="domcontentloaded", timeout=30000)
            for _ in range(TOKEN_POLL_SECONDS):
                if token:
                    break
                await asyncio.sleep(TOKEN_POLL_INTERVAL)
        except Exception as exc:
            log(f"[TOKEN] goto error [{credential_key}]: {exc}")
        finally:
            if page:
                try: await page.close()
                except Exception: pass
            if ctx:
                try: await ctx.close()
                except Exception: pass

    if not token:
        raise HTTPException(status_code=502,
                            detail=f"Spotify access token unavailable for room {credential_key}")
    return token, expire or (now() + 3600)


async def get_access_token(app: FastAPI, sp_dc: str) -> str:
    credential_key = cred_key(sp_dc)
    cached = app.state.token_cache.get(credential_key)
    if cached and now() < cached[1] - 30:
        return cached[0]
    lock = await locks.get_token_lock(credential_key)
    async with lock:
        cached = app.state.token_cache.get(credential_key)
        if cached and now() < cached[1] - 30:
            return cached[0]
        token, expires_at = await _get_access_token_uncached(app, sp_dc)
        app.state.token_cache[credential_key] = (token, expires_at)
        log(f"[TOKEN] refreshed room={credential_key}")
        return token


async def _get_client_token_uncached(app: FastAPI, sp_dc: str):
    browser = app.state.browser
    if not browser:
        raise HTTPException(status_code=503, detail="Browser not ready")
    credential_key = cred_key(sp_dc)
    client_token = None
    expires_at = 0

    async def on_response(resp):
        nonlocal client_token, expires_at
        if "clienttoken.spotify.com/v1/clienttoken" not in resp.url:
            return
        try:
            data = await resp.json()
            granted = data.get("granted_token") or {}
            token = granted.get("token")
            if token:
                client_token = token
                expires_at = now() + int(granted.get("expires_after_seconds", 3600))
        except Exception:
            pass

    async with config.PLAYWRIGHT_SEMAPHORE:
        page = None
        ctx = None
        try:
            page, ctx = await new_page_with_cookies(browser, sp_dc)
            page.on("response", on_response)
            await page.goto("https://open.spotify.com/search/hello",
                            wait_until="domcontentloaded", timeout=30000)
            for _ in range(TOKEN_POLL_SECONDS):
                if client_token:
                    break
                await asyncio.sleep(TOKEN_POLL_INTERVAL)
        except Exception as exc:
            log(f"[CLIENT-TOKEN] error [{credential_key}]: {exc}")
        finally:
            if page:
                try: await page.close()
                except Exception: pass
            if ctx:
                try: await ctx.close()
                except Exception: pass

    if not client_token:
        raise HTTPException(status_code=502,
                            detail=f"Spotify client token unavailable for room {credential_key}")
    return client_token, expires_at or (now() + 3600)


async def get_client_token(app: FastAPI, sp_dc: str) -> str:
    credential_key = cred_key(sp_dc)
    cached = app.state.client_token_cache.get(credential_key)
    if cached and now() < cached[1] - 60:
        return cached[0]
    lock = await locks.get_client_token_lock(credential_key)
    async with lock:
        cached = app.state.client_token_cache.get(credential_key)
        if cached and now() < cached[1] - 60:
            return cached[0]
        token, expires_at = await _get_client_token_uncached(app, sp_dc)
        app.state.client_token_cache[credential_key] = (token, expires_at)
        return token


async def discover_persisted_hash(app: FastAPI, operation_name: str, sp_dc: Optional[str] = None):
    existing = app.state.persisted_hashes.get(operation_name)
    if existing:
        return existing
    browser = app.state.browser
    if not browser:
        raise HTTPException(status_code=503, detail="Browser not ready")
    discovered = None

    def capture_request(req):
        nonlocal discovered
        if discovered or "api-partner.spotify.com/pathfinder" not in req.url:
            return
        try:
            body = json.loads(req.post_data or "")
        except Exception:
            return
        if body.get("operationName") != operation_name:
            return
        discovered = ((body.get("extensions") or {}).get("persistedQuery") or {}).get("sha256Hash")

    async with config.PLAYWRIGHT_SEMAPHORE:
        page = None
        ctx = None
        try:
            page, ctx = await new_page_with_cookies(browser, sp_dc)
            page.on("request", capture_request)
            await page.goto("https://open.spotify.com/search/hello",
                            wait_until="domcontentloaded", timeout=30000)
            for _ in range(TOKEN_POLL_SECONDS):
                if discovered:
                    break
                await asyncio.sleep(TOKEN_POLL_INTERVAL)
        except Exception:
            pass
        finally:
            if page:
                try: await page.close()
                except Exception: pass
            if ctx:
                try: await ctx.close()
                except Exception: pass

    if not discovered:
        raise HTTPException(status_code=502, detail=f"Hash for {operation_name} not found")
    app.state.persisted_hashes[operation_name] = discovered
    return discovered


async def spotify_post(app: FastAPI, payload: dict, headers: dict):
    async with config.SPOTIFY_HTTP_SEMAPHORE:
        try:
            return await app.state.http.post(config.SPOTIFY_PATHFINDER_URL,
                                             json=payload, headers=headers)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout,
                httpx.WriteTimeout, httpx.PoolTimeout) as exc:
            raise HTTPException(status_code=504,
                                detail=f"Spotify upstream timeout: {type(exc).__name__}")


async def spotify_query(app: FastAPI, operation_name: str, variables: dict,
                        sp_dc: Optional[str] = None, sha256_hash: Optional[str] = None):
    token = await get_access_token(app, sp_dc or "")
    sha256_hash = sha256_hash or app.state.persisted_hashes.get(operation_name)
    if not sha256_hash:
        sha256_hash = await discover_persisted_hash(app, operation_name, sp_dc)

    payload = {
        "operationName": operation_name,
        "variables": variables,
        "extensions": {"persistedQuery": {"version": 1, "sha256Hash": sha256_hash}},
    }
    headers = {
        "authorization": f"Bearer {token}",
        "accept": "application/json",
        "app-platform": "WebPlayer",
        "origin": "https://open.spotify.com",
        "referer": "https://open.spotify.com/",
        "user-agent": config.UA,
    }

    client_token = await get_client_token(app, sp_dc or "")
    if client_token:
        headers["client-token"] = client_token

    response = await spotify_post(app, payload, headers)
    credential_key = cred_key(sp_dc or "")

    if response.status_code == 401:
        app.state.token_cache.pop(credential_key, None)
        token = await get_access_token(app, sp_dc or "")
        headers["authorization"] = f"Bearer {token}"
        response = await spotify_post(app, payload, headers)

    if response.status_code in (400, 404):
        app.state.token_cache.pop(credential_key, None)
        app.state.persisted_hashes.pop(operation_name, None)
        token = await get_access_token(app, sp_dc or "")
        new_hash = await discover_persisted_hash(app, operation_name, sp_dc)
        payload["extensions"] = {"persistedQuery": {"version": 1, "sha256Hash": new_hash}}
        headers["authorization"] = f"Bearer {token}"
        response = await spotify_post(app, payload, headers)

    if response.status_code != 200:
        raise HTTPException(status_code=502,
                            detail=f"Pathfinder error {response.status_code}: {response.text[:300]}")
    return response.json()


async def fetch_spotify_lyrics(app: FastAPI, track_id: str, sp_dc: str) -> dict | None:
    """Fetch synced lyrics via spclient color-lyrics API. Returns None if unavailable."""
    tid = sanitize_track_id(track_id)
    if not tid:
        return None
    token = await get_access_token(app, sp_dc)
    try:
        client_token: Optional[str] = await get_client_token(app, sp_dc)
    except Exception:
        client_token = None

    url = config.SPCLIENT_LYRICS_URL.format(track_id=tid)
    headers = {
        "authorization": f"Bearer {token}",
        "app-platform": "WebPlayer",
        "origin": "https://open.spotify.com",
        "referer": "https://open.spotify.com/",
        "user-agent": config.UA,
        "accept": "application/json",
    }
    if client_token:
        headers["client-token"] = client_token

    async def _do_get(hdrs: dict):
        async with config.SPOTIFY_HTTP_SEMAPHORE:
            return await app.state.http.get(url, headers=hdrs, timeout=10.0)

    try:
        resp = await _do_get(headers)
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout,
            httpx.WriteTimeout, httpx.PoolTimeout) as exc:
        raise HTTPException(status_code=504,
                            detail=f"Lyrics upstream timeout: {type(exc).__name__}")

    if resp.status_code == 401:
        # Token expired — refresh once and retry.
        app.state.token_cache.pop(cred_key(sp_dc), None)
        token = await get_access_token(app, sp_dc)
        headers["authorization"] = f"Bearer {token}"
        try:
            resp = await _do_get(headers)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout,
                httpx.WriteTimeout, httpx.PoolTimeout) as exc:
            raise HTTPException(status_code=504,
                                detail=f"Lyrics upstream timeout: {type(exc).__name__}")

    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise HTTPException(status_code=502,
                            detail=f"Lyrics error {resp.status_code}: {resp.text[:300]}")
    try:
        data = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Lyrics invalid JSON")
    if not data or not (data.get("lyrics") or {}).get("lines"):
        return None
    return mappers.normalize_lyrics_payload(tid, data)