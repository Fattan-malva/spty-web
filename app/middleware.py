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
        log(f"[REQ {request_id}] {request.method} {request.url.path} "
            f"{response.status_code} {elapsed:.3f}s")
        return response

    return app