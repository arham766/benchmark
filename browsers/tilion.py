"""Tilion -- https://tilion.dev

Stealth session over CDP. Requires: TILION_API_KEY env var.
TILION_BASE_URL overrides the endpoint (defaults to production).
"""

import os

import httpx

from browsers import retry_on_429

_session_ids: list[str] = []

BASE_URL = os.environ.get("TILION_BASE_URL", "https://api.tilion.dev").rstrip("/")


async def connect() -> str:
    async def _create():
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{BASE_URL}/v1/session",
                headers={"Authorization": f"Bearer {os.environ['TILION_API_KEY']}"},
                json={},
                # A cold create can wait on a microVM boot when the warm pool is drained, and
                # these tasks each hold a session for minutes, so a short timeout here would
                # fail runs that would otherwise have succeeded.
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()

    data = await retry_on_429(_create)
    sid = data.get("session_id")
    if sid:
        # A list, not a single global: the harness can hold several sessions at once, and a
        # scalar would leak every session but the last.
        _session_ids.append(sid)
    return data["connect_url"]


async def disconnect() -> None:
    if not _session_ids:
        return
    session_id = _session_ids.pop()
    try:
        async with httpx.AsyncClient() as client:
            await client.delete(
                f"{BASE_URL}/v1/session/{session_id}",
                headers={"Authorization": f"Bearer {os.environ['TILION_API_KEY']}"},
                timeout=30,
            )
    except Exception:
        pass  # best effort: the session's own TTL reaps it anyway
