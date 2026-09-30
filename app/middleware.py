import time
import uuid

from .config import log


def add_request_logging(app):
    @app.middleware("http")
    async def request_logger(request, call_next):
        request_id = uuid.uuid4().hex[:8]
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception as exc:
            elapsed = time.perf_counter() - started
            log(f"[REQ {request_id}] {request.method} {request.url.path} "
                f"ERROR {elapsed:.3f}s {type(exc).__name__}")
            raise
        elapsed = time.perf_counter() - started
        response.headers["X-Request-ID"] = request_id

        # Asset frontend (JS/CSS) sering di-cache lama oleh Safari/iOS dan
        # Cloudflare, sehingga perbaikan baru tidak pernah sampai ke perangkat
        # pengguna. Paksa supaya TIDAK pernah di-cache, di browser maupun di
        # edge Cloudflare.
        #
        # "no-store" yang penting: dengan begitu edge tidak boleh menyimpan
        # salinan sama sekali, jadi Cache Rule Cloudflare tidak bisa
        #menyajikan versi lama. Header tambahan di bawah hanya
        # pengaman untuk proxy yang menghormati header terpisah.
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["CDN-Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Cloudflare-CDN-Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"

        log(f"[REQ {request_id}] {request.method} {request.url.path} "
            f"{response.status_code} {elapsed:.3f}s")
        return response

    return app