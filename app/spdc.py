import os
from typing import Optional

from fastapi import Request
from fastapi.responses import HTMLResponse

from .config import BASE_DIR

_SPDC_HTML: str | None = None


def extract_sp_dc(request: Request, sp_dc_q: Optional[str]) -> str:
    sp_dc = (sp_dc_q or "").strip()
    if not sp_dc:
        sp_dc = (
            request.headers.get("x-sp-dc")
            or request.headers.get("x-sp_dc")
            or request.headers.get("sp_dc")
            or request.headers.get("SP_DC")
            or request.cookies.get("sp_dc")
            or ""
        ).strip()
    if not sp_dc:
        for key, value in request.query_params.items():
            if key.lower() in ("sp_dc", "spdc", "sp-dc"):
                sp_dc = value.strip()
                break
    return sp_dc


def load_spdc_html() -> str:
    global _SPDC_HTML
    if _SPDC_HTML is None:
        html_path = os.path.join(BASE_DIR, "required-spdc.html")
        with open(html_path, "r", encoding="utf-8") as f:
            _SPDC_HTML = f.read()
    return _SPDC_HTML


def require_sp_dc(request: Request, sp_dc_q: Optional[str]) -> str | HTMLResponse:
    sp_dc = extract_sp_dc(request, sp_dc_q)
    if not sp_dc or len(sp_dc) < 20:
        return HTMLResponse(content=load_spdc_html(), status_code=401)
    return sp_dc