import hashlib
import hmac
import re
import struct
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException

from . import config, locks, mappers
from .config import cred_key, log, now
from .mappers import sanitize_track_id

TOKEN_REFRESH_MARGIN = 30
CLIENT_TOKEN_REFRESH_MARGIN = 60

PLAYER_BUNDLE_JS_RE = re.compile(r'["\'](https://[^"\'\s]+/web-player\.[0-9a-f]+\.js)["\']')
SECRETS_RE = re.compile(
    r'\{\s*secret\s*:\s*(["\'])(.*?)\1\s*,\s*version\s*:\s*(\d+)\s*\}'
)
PERSISTED_HASH_RE = re.compile(
    r'\.l\("([A-Za-z0-9_]+)","(?:query|mutation)","([a-f0-9]{64})"'
)


def _totp_key(secret: str) -> bytes:
    values = [ord(ch) ^ ((i % 33) + 9) for i, ch in enumerate(secret)]
    return "".join(str(v) for v in values).encode("utf-8")


def _totp_code(key: bytes, timestamp_seconds: int) -> str:
    counter = timestamp_seconds // 30
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = ((digest[offset] & 0x7F) << 24
            | digest[offset + 1] << 16
            | digest[offset + 2] << 8
            | digest[offset + 3]) % 1_000_000
    return f"{code:06d}"


def _extract_secrets(bundle: str) -> list[tuple[int, str]]:
    found = [(int(m.group(3)), m.group(2)) for m in SECRETS_RE.finditer(bundle)]
    return sorted(found, key=lambda item: item[0], reverse=True)


def _extract_hashes(bundle: str) -> dict[str, str]:
    return {m.group(1): m.group(2) for m in PERSISTED_HASH_RE.finditer(bundle)}


async def _get_player_bundle(app: FastAPI) -> str:
    resp = await app.state.http.get(config.SPOTIFY_WEB_PLAYER_URL)
    if resp.status_code != 200:
        raise HTTPException(status_code=502,
                            detail=f"Spotify web player fetch {resp.status_code}")
    match = PLAYER_BUNDLE_JS_RE.search(resp.text)
    if not match:
        raise HTTPException(status_code=502,
                            detail="Web player bundle URL not found")
    bundle = await app.state.http.get(match.group(1))
    if bundle.status_code != 200:
        raise HTTPException(status_code=502,
                            detail=f"Web player bundle fetch {bundle.status_code}")
    return bundle.text


async def _issue_access_token(app: FastAPI, sp_dc: str,
                              secrets: list[tuple[int, str]]) -> tuple[str, float]:
    try:
        st = await app.state.http.get(config.SPOTIFY_SERVER_TIME_URL)
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout,
            httpx.WriteTimeout, httpx.PoolTimeout) as exc:
        raise HTTPException(status_code=504,
                            detail=f"Spotify server-time timeout: {type(exc).__name__}")
    if st.status_code != 200:
        raise HTTPException(status_code=502,
                            detail=f"Spotify server-time {st.status_code}")
    try:
        server_time = int(st.json()["serverTime"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=502, detail="Spotify server-time invalid payload")

    last_status = None
    for version, secret in secrets:
        key = _totp_key(secret)
        code = _totp_code(key, server_time)
        params = {
            "reason": "init",
            "productType": config.SPOTIFY_PRODUCT_TYPE,
            "totp": code,
            "totpVer": str(version),
            "totpServer": code,
        }
        try:
            resp = await app.state.http.get(
                config.SPOTIFY_TOKEN_URL, params=params,
                cookies={"sp_dc": sp_dc} if sp_dc else None)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout,
                httpx.WriteTimeout, httpx.PoolTimeout) as exc:
            raise HTTPException(status_code=504,
                                detail=f"Spotify token timeout: {type(exc).__name__}")
        if resp.status_code == 200:
            try:
                data = resp.json()
            except Exception:
                data = {}
            access_token = data.get("accessToken")
            if access_token:
                expire_ms = int(data.get("accessTokenExpirationTimestampMs") or 0)
                expires_at = (expire_ms / 1000) if expire_ms > 0 else now() + 3600
                return access_token, expires_at
        last_status = resp.status_code

    raise HTTPException(
        status_code=502,
        detail=f"Spotify access token unavailable (status {last_status})")


async def _get_access_token_uncached(app: FastAPI, sp_dc: str):
    secrets = app.state.totp_secrets
    try:
        return await _issue_access_token(app, sp_dc, secrets)
    except HTTPException as exc:
        if exc.status_code != 502 or "unavailable" not in str(exc.detail):
            raise
        log("[TOKEN] rotation suspected, re-extracting secrets")
        bundle = await _get_player_bundle(app)
        app.state.totp_secrets = _extract_secrets(bundle)
        return await _issue_access_token(app, sp_dc, app.state.totp_secrets)


async def get_access_token(app: FastAPI, sp_dc: str) -> str:
    credential_key = cred_key(sp_dc)
    cached = app.state.token_cache.get(credential_key)
    if cached and now() < cached[1] - TOKEN_REFRESH_MARGIN:
        return cached[0]
    lock = await locks.get_token_lock(credential_key)
    async with lock:
        cached = app.state.token_cache.get(credential_key)
        if cached and now() < cached[1] - TOKEN_REFRESH_MARGIN:
            return cached[0]
        token, expires_at = await _get_access_token_uncached(app, sp_dc)
        app.state.token_cache[credential_key] = (token, expires_at)
        log(f"[TOKEN] refreshed room={credential_key}")
        return token


async def _issue_client_token(app: FastAPI, sp_dc: str) -> tuple[str, float]:
    payload = {
        "client_data": {
            "client_version": config.SPOTIFY_CLIENT_VERSION,
            "client_id": config.SPOTIFY_CLIENT_ID,
            "js_sdk_data": {},
        }
    }
    try:
        resp = await app.state.http.post(
            config.SPOTIFY_CLIENT_TOKEN_URL, json=payload,
            cookies={"sp_dc": sp_dc} if sp_dc else None)
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout,
            httpx.WriteTimeout, httpx.PoolTimeout) as exc:
        raise HTTPException(status_code=504,
                            detail=f"Spotify client token timeout: {type(exc).__name__}")
    if resp.status_code != 200:
        raise HTTPException(status_code=502,
                            detail=f"Spotify client token {resp.status_code}")
    try:
        data = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Spotify client token invalid payload")
    granted = data.get("granted_token") or {}
    token = granted.get("token")
    if not token:
        raise HTTPException(status_code=502, detail="Spotify client token unavailable")
    return token, now() + int(granted.get("expires_after_seconds", 3600))


async def _get_client_token_uncached(app: FastAPI, sp_dc: str):
    return await _issue_client_token(app, sp_dc)


async def get_client_token(app: FastAPI, sp_dc: str) -> str:
    credential_key = cred_key(sp_dc)
    cached = app.state.client_token_cache.get(credential_key)
    if cached and now() < cached[1] - CLIENT_TOKEN_REFRESH_MARGIN:
        return cached[0]
    lock = await locks.get_client_token_lock(credential_key)
    async with lock:
        cached = app.state.client_token_cache.get(credential_key)
        if cached and now() < cached[1] - CLIENT_TOKEN_REFRESH_MARGIN:
            return cached[0]
        token, expires_at = await _get_client_token_uncached(app, sp_dc)
        app.state.client_token_cache[credential_key] = (token, expires_at)
        return token


async def discover_persisted_hash(app: FastAPI, operation_name: str,
                                  sp_dc: Optional[str] = None):
    existing = app.state.persisted_hashes.get(operation_name)
    if existing:
        return existing
    bundle = await _get_player_bundle(app)
    found = _extract_hashes(bundle)
    app.state.persisted_hashes.update(found)
    discovered = found.get(operation_name)
    if not discovered:
        raise HTTPException(status_code=502,
                            detail=f"Hash for {operation_name} not found")
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


async def spotify_web_api_get(app: FastAPI, path: str, sp_dc: str, params: dict = None):
    token = await get_access_token(app, sp_dc)
    url = f"https://api.spotify.com{path}"
    headers = {
        "authorization": f"Bearer {token}",
        "accept": "application/json",
        "user-agent": config.UA,
    }
    try:
        resp = await app.state.http.get(url, params=params, headers=headers, timeout=10.0)
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout,
            httpx.WriteTimeout, httpx.PoolTimeout) as exc:
        raise HTTPException(status_code=504,
                            detail=f"Spotify Web API timeout: {type(exc).__name__}")
    if resp.status_code == 401:
        app.state.token_cache.pop(cred_key(sp_dc), None)
        token = await get_access_token(app, sp_dc)
        headers["authorization"] = f"Bearer {token}"
        resp = await app.state.http.get(url, params=params, headers=headers, timeout=10.0)
    if resp.status_code != 200:
        raise HTTPException(status_code=502,
                            detail=f"Spotify Web API {resp.status_code}: {resp.text[:200]}")
    return resp.json()


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