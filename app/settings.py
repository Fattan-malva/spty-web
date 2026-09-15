import json
import os
from typing import Any

from fastapi import HTTPException

from .config import BASE_DIR

SETTINGS_FILE = os.path.join(BASE_DIR, "settings.json")
DEFAULTS: dict[str, Any] = {"sp_dc": ""}


def load_settings() -> dict[str, Any]:
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return dict(DEFAULTS)
    if not isinstance(data, dict):
        return dict(DEFAULTS)
    return {**DEFAULTS, **data}


def save_settings(data: dict[str, Any]) -> dict[str, Any]:
    current = load_settings()
    sp_dc = str(data.get("sp_dc") or "").strip()
    current["sp_dc"] = sp_dc
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2, ensure_ascii=False)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not write settings: {exc}")
    return current