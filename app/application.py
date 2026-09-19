import asyncio
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config
from .middleware import add_request_logging
from .routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.SPOTIFY_HTTP_SEMAPHORE = asyncio.Semaphore(config.SPOTIFY_HTTP_CONCURRENCY)
    config.EMBED_SEMAPHORE = asyncio.Semaphore(config.EMBED_CONCURRENCY)

    timeout = httpx.Timeout(connect=config.HTTP_CONNECT_TIMEOUT,
                            read=config.HTTP_READ_TIMEOUT,
                            write=config.HTTP_WRITE_TIMEOUT,
                            pool=config.HTTP_POOL_TIMEOUT)
    limits = httpx.Limits(max_connections=200, max_keepalive_connections=50,
                          keepalive_expiry=60)
    app.state.http = httpx.AsyncClient(timeout=timeout, limits=limits,
                                       follow_redirects=True, http2=True,
                                       headers=config.SPOTIFY_HEADERS)
    app.state.token_cache = {}
    app.state.client_token_cache = {}
    app.state.persisted_hashes = dict(config.PERSISTED_HASHES)
    app.state.totp_secrets = list(config.TOTP_SECRETS)

    config.log("Spotify API starting")
    config.log(f"SPOTIFY_HTTP_CONCURRENCY={config.SPOTIFY_HTTP_CONCURRENCY}")
    config.log(f"EMBED_CONCURRENCY={config.EMBED_CONCURRENCY}")
    config.log("strict per-room sp_dc mode")

    yield
    try:
        await app.state.http.aclose()
    except Exception:
        pass


app = FastAPI(
    title="Spotify Multi-Room API",
    description="Spotify API with isolated per-room sp_dc credentials and bounded concurrency",
    lifespan=lifespan,
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

add_request_logging(app)

app.mount("/static", StaticFiles(directory=os.path.join(config.BASE_DIR, "static")), name="static")

app.include_router(router)