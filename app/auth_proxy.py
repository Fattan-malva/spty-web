"""Transparent same-origin proxy for the official Spotify login.

The real Spotify login page (accounts.spotify.com) is served from our own
origin so the browser stores the resulting ``sp_dc`` cookie on this site
instead of on a blocked third-party domain. Everything the login SPA fetches
with relative paths (``/login/...``, ``/v1/...`` ...) is forwarded upstream and
the cookies Spotify sets along the way are relayed back to the browser.
"""

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import Response
from urllib.parse import urlparse

from .config import UA
from .spdc import SPDC_COOKIE_NAME

router = APIRouter()

ACCOUNTS_ORIGIN = "https://accounts.spotify.com"
LOGIN_PATH = "en/login"

# Relative prefixes the login SPA calls with ``fetch``/navigation.
_PROXY_PREFIXES = ("login", "v1", "en", "accountrecovery")
_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]

_SKIP_RESPONSE_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "content-encoding",
    "set-cookie",
    "x-frame-options",
}

_HTTP_RENAMED_COOKIES = {
    "sp_csrf_sid": "__Host-sp_csrf_sid",
    "device_id": "__Host-device_id",
}


def _is_secure(request: Request) -> bool:
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    return proto == "https" or request.url.scheme == "https"


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        follow_redirects=False,
        timeout=httpx.Timeout(connect=8.0, read=25.0, write=25.0, pool=5.0),
        http2=True,
    )


def _upstream_cookie_header(request: Request) -> str:
    raw = request.headers.get("cookie")
    if not raw:
        return ""
    if _is_secure(request):
        return raw
    parts = []
    for chunk in raw.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "=" in chunk:
            name, value = chunk.split("=", 1)
        else:
            name, value = chunk, ""
        name = name.strip()
        name = _HTTP_RENAMED_COOKIES.get(name, name)
        parts.append(f"{name}={value}")
    return "; ".join(parts)


def _upstream_headers(request: Request, upstream_path: str) -> dict:
    headers = {
        "user-agent": request.headers.get("user-agent") or UA,
        "accept": request.headers.get("accept") or "*/*",
        "accept-language": request.headers.get("accept-language") or "en-US,en;q=0.9",
        "origin": ACCOUNTS_ORIGIN,
        "referer": f"{ACCOUNTS_ORIGIN}/{upstream_path}",
    }
    for name in ("content-type", "x-csrf-token", "client-token", "x-client-token", "authorization"):
        value = request.headers.get(name)
        if value:
            headers[name] = value
    cookie = _upstream_cookie_header(request)
    if cookie:
        headers["cookie"] = cookie
    return headers


def _transform_set_cookie(cookie: str, secure: bool) -> str:
    segments = cookie.split(";")
    name_value = segments[0].strip()
    if "=" in name_value:
        name, value = name_value.split("=", 1)
    else:
        name, value = name_value, ""
    name = name.strip()
    if not secure and name.lower().startswith("__host-"):
        name = name[len("__Host-"):]
        name_value = f"{name}={value}"

    out = [name_value]
    for segment in segments[1:]:
        segment = segment.strip()
        if not segment:
            continue
        low = segment.lower()
        if low.startswith("domain="):
            continue
        if low == "secure":
            if secure:
                out.append("Secure")
            continue
        if low.startswith("samesite="):
            same_site = segment.split("=", 1)[1].strip().lower()
            if same_site == "none" and not secure:
                out.append("SameSite=Lax")
            else:
                out.append(segment)
            continue
        if low.startswith("path="):
            out.append("Path=/")
            continue
        if low == "httponly":
            # The frontend reads sp_dc from document.cookie.
            if name == SPDC_COOKIE_NAME:
                continue
            out.append("HttpOnly")
            continue
        out.append(segment)
    return "; ".join(out)


def _relay(upstream: httpx.Response, request: Request) -> Response:
    secure = _is_secure(request)
    response = Response(content=upstream.content, status_code=upstream.status_code)
    for key, value in upstream.headers.items():
        if key.lower() in _SKIP_RESPONSE_HEADERS:
            continue
        response.headers[key] = value
    # Keep the browser on our own origin: absolute redirects to any Spotify
    # host are rewritten to the same-origin proxy path, otherwise the user's
    # browser (or network) may block/directly refuse accounts.spotify.com.
    location = upstream.headers.get("location")
    if location:
        parsed = urlparse(location)
        if parsed.netloc.lower() in (
            "accounts.spotify.com",
            "open.spotify.com",
            "accounts.scdn.co",
            "www.spotify.com",
        ):
            new_path = parsed.path
            if parsed.query:
                new_path = f"{new_path}?{parsed.query}"
            response.headers["location"] = f"/auth{new_path}"
    for cookie in upstream.headers.get_list("set-cookie"):
        response.headers.append("set-cookie", _transform_set_cookie(cookie, secure))
    return response


async def _forward(request: Request, upstream_path: str) -> Response:
    url = f"{ACCOUNTS_ORIGIN}/{upstream_path.lstrip('/')}"
    if request.url.query:
        url = f"{url}?{request.url.query}"
    try:
        body = await request.body()
    except Exception:
        body = b""
    headers = _upstream_headers(request, upstream_path)
    try:
        async with _client() as client:
            upstream = await client.request(request.method, url, headers=headers, content=body)
    except httpx.HTTPError:
        return Response(content="Gagal menghubungi Spotify. Coba lagi.", status_code=502)
    return _relay(upstream, request)


@router.get("/auth/login")
async def login_page(request: Request) -> Response:
    return await _forward(request, LOGIN_PATH)


# Catch-all for rewritten same-origin redirects (see _relay): the leading
# "auth" segment is our own prefix, so forward only the upstream path.
async def auth_proxy_root(request: Request) -> Response:
    return await _forward(request, "")


async def auth_proxy_rest(request: Request, rest: str) -> Response:
    return await _forward(request, rest)


@router.api_route("/auth", methods=_METHODS, include_in_schema=False)
async def auth_root(request: Request) -> Response:
    return await auth_proxy_root(request)


@router.api_route("/auth/{rest:path}", methods=_METHODS, include_in_schema=False)
async def auth_rest(request: Request, rest: str) -> Response:
    return await auth_proxy_rest(request, rest)


def _register_prefix(prefix: str) -> None:
    async def endpoint(request: Request, rest: str = "") -> Response:
        path = prefix + (f"/{rest}" if rest else "")
        return await _forward(request, path)

    router.add_api_route(f"/{prefix}", endpoint, methods=_METHODS)
    router.add_api_route(f"/{prefix}/{{rest:path}}", endpoint, methods=_METHODS)


for _prefix in _PROXY_PREFIXES:
    _register_prefix(_prefix)
