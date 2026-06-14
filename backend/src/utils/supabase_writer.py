"""Supabase integration: write questions, upload images, query the bank.

All public functions are best-effort and silently no-op when credentials are
not set. Env vars (read lazily so load_dotenv() order doesn't matter):
  SUPABASE_URL        — project URL, e.g. https://xxxx.supabase.co
  SUPABASE_SECRET_KEY — service-role (secret) key
  DB_WRITE_ENABLED=1  — must be explicitly enabled to write
"""
from __future__ import annotations

import copy
import logging
import mimetypes
import os
import random
from pathlib import Path
from typing import Any

import httpx

LOGGER = logging.getLogger('oxai.supabase')

STORAGE_BUCKET = 'question-images'
_FETCH_MULTIPLIER = 4   # fetch 4x the requested limit for randomisation
_MAX_GENERATE_FALLBACK = 3  # generate at most this many questions if bank is empty


# ── Env helpers (lazy so load_dotenv() in app.py doesn't matter) ──────────────

def _url() -> str | None:
    return os.getenv('SUPABASE_URL', '').strip() or None

def _key() -> str | None:
    return os.getenv('SUPABASE_SECRET_KEY', '').strip() or None

def _write_enabled() -> bool:
    return os.getenv('DB_WRITE_ENABLED', '0').lower() not in ('0', 'false', '')

def is_enabled() -> bool:
    """True when URL and key are configured (read/query is possible)."""
    return bool(_url()) and bool(_key())


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def _json_headers() -> dict[str, str]:
    k = _key() or ''
    return {
        'apikey': k,
        'Authorization': f'Bearer {k}',
        'Content-Type': 'application/json',
    }

def _storage_headers(content_type: str) -> dict[str, str]:
    k = _key() or ''
    return {
        'apikey': k,
        'Authorization': f'Bearer {k}',
        'Content-Type': content_type,
        'x-upsert': 'true',
    }

def _rest(path: str) -> str:
    return f"{(_url() or '').rstrip('/')}/rest/v1/{path.lstrip('/')}"

def _storage_object(key: str) -> str:
    return f"{(_url() or '').rstrip('/')}/storage/v1/object/{STORAGE_BUCKET}/{key}"

def _storage_public(key: str) -> str:
    return f"{(_url() or '').rstrip('/')}/storage/v1/object/public/{STORAGE_BUCKET}/{key}"


# ── Image upload ──────────────────────────────────────────────────────────────

def _upload_image(local_path: Path, storage_key: str) -> str | None:
    """Upload an image file to Supabase Storage. Returns public URL or None."""
    if not is_enabled() or not local_path.exists():
        return None
    mime = mimetypes.guess_type(str(local_path))[0] or 'image/png'
    try:
        resp = httpx.put(
            _storage_object(storage_key),
            content=local_path.read_bytes(),
            headers=_storage_headers(mime),
            timeout=30.0,
        )
        if resp.status_code in (200, 201):
            pub = _storage_public(storage_key)
            LOGGER.debug('Uploaded image %s → %s', local_path.name, pub)
            return pub
        LOGGER.warning('Image upload failed %d: %s', resp.status_code, resp.text[:120])
        return None
    except Exception as exc:
        LOGGER.warning('Image upload error for %s: %s', storage_key, exc)
        return None


def _resolve_and_upload_images(
    payload: dict[str, Any],
    processed_dir: Path | None,
    diagram_dir: Path | None,
) -> dict[str, Any]:
    """Return a copy of payload with all image URLs replaced by Storage public URLs.

    Handles:
      metadata.diagram_url  →  /images/...  or  /diagrams/...
      prompt.figures[].url  →  /diagrams/...
    """
    if not is_enabled():
        return payload

    payload = copy.deepcopy(payload)

    def _resolve(raw_url: str) -> Path | None:
        if raw_url.startswith('/images/') and processed_dir:
            rel = raw_url[len('/images/'):]
            return processed_dir / rel
        if raw_url.startswith('/diagrams/') and diagram_dir:
            rel = raw_url[len('/diagrams/'):]
            return diagram_dir / rel
        return None

    def _storage_key(question_id: str, url: str) -> str:
        filename = url.split('/')[-1]
        return f"{question_id}/{filename}"

    qid = str(payload.get('question_id', 'unknown'))

    # metadata.diagram_url
    meta = payload.get('metadata') or {}
    if isinstance(meta, dict) and meta.get('diagram_url'):
        raw = meta['diagram_url']
        local = _resolve(raw)
        if local:
            pub = _upload_image(local, _storage_key(qid, raw))
            if pub:
                meta['diagram_url'] = pub
                payload['metadata'] = meta

    # prompt.figures[].url (complex_diagram figures)
    prompt = payload.get('prompt') or {}
    figures = prompt.get('figures') or []
    changed = False
    for fig in figures:
        if isinstance(fig, dict) and fig.get('url'):
            raw = fig['url']
            local = _resolve(raw)
            if local:
                pub = _upload_image(local, _storage_key(qid, raw))
                if pub:
                    fig['url'] = pub
                    changed = True
    if changed:
        prompt['figures'] = figures
        payload['prompt'] = prompt

    return payload


# ── Question upsert ───────────────────────────────────────────────────────────

def upsert_question(
    question: dict[str, Any],
    processed_dir: Path | None = None,
    diagram_dir: Path | None = None,
    origin: str = 'generated',
) -> None:
    """Save a question to Supabase. No-op if DB_WRITE_ENABLED is not set.

    Uploads any referenced images to Storage and rewrites their URLs in the
    payload before saving, so questions are fully self-contained in the DB.
    """
    if not _write_enabled() or not is_enabled():
        return

    question_id = question.get('question_id')
    if not question_id:
        LOGGER.warning('supabase: skipping upsert — no question_id')
        return

    payload = _resolve_and_upload_images(question, processed_dir, diagram_dir)

    content = question.get('content') or {}
    difficulty = content.get('difficulty')
    try:
        difficulty = int(difficulty) if difficulty is not None else None
        if difficulty is not None and not (1 <= difficulty <= 5):
            difficulty = None
    except (TypeError, ValueError):
        difficulty = None

    row = {
        'question_id': str(question_id),
        'payload': payload,
        'origin': origin,
        'subject': str(content.get('subject') or 'unknown').lower(),
        'topic': (content.get('topic') or '').lower() or None,
        'difficulty': difficulty,
    }

    try:
        resp = httpx.post(
            _rest('questions'),
            json=[row],
            headers={**_json_headers(), 'Prefer': 'resolution=merge-duplicates'},
            params={'on_conflict': 'question_id'},
            timeout=15.0,
        )
        if resp.status_code in (200, 201, 204):
            LOGGER.debug('supabase: upserted %s (origin=%s)', question_id, origin)
        else:
            LOGGER.warning('supabase: upsert failed %d: %s', resp.status_code, resp.text[:200])
    except Exception as exc:
        LOGGER.warning('supabase: upsert error for %s: %s', question_id, exc)


# ── Query ─────────────────────────────────────────────────────────────────────

def query_questions(
    subject: str | None = None,
    topic: str | None = None,
    difficulty: int | None = None,
    exclude_ids: list[str] | None = None,
    limit: int = 20,
    origin: str | None = None,
) -> list[dict[str, Any]]:
    """Fetch questions from Supabase matching the given filters.

    Returns a shuffled list of raw question payload dicts.
    Returns [] if Supabase is not configured or on any error.
    """
    if not is_enabled():
        return []

    params: dict[str, str] = {
        'select': 'question_id,payload,origin',
        'limit': str(limit * _FETCH_MULTIPLIER),
        'order': 'created_at.asc',
    }

    if subject:
        params['subject'] = f'eq.{subject.lower()}'

    if topic:
        # ilike for case-insensitive partial match
        params['topic'] = f'ilike.*{topic.lower()}*'

    if difficulty is not None:
        # Allow ±1 difficulty band
        lo = max(1, difficulty - 1)
        hi = min(5, difficulty + 1)
        params['difficulty'] = f'gte.{lo}'
        # Supabase REST supports a second filter via a repeated key only through
        # the PostgREST `and` syntax. Use a rangeGTE/rangeLTE workaround by
        # sending both via the `and` param.
        params['and'] = f'(difficulty.lte.{hi})'

    if origin:
        params['origin'] = f'eq.{origin}'

    try:
        resp = httpx.get(
            _rest('questions'),
            params=params,
            headers=_json_headers(),
            timeout=10.0,
        )
        if resp.status_code != 200:
            LOGGER.warning('supabase: query failed %d: %s', resp.status_code, resp.text[:200])
            return []

        rows = resp.json()
        if not isinstance(rows, list):
            return []

        # Filter out excluded IDs (some may not be expressible cleanly in REST params)
        excluded = set(exclude_ids or [])
        rows = [r for r in rows if r.get('question_id') not in excluded]

        # Shuffle for variety then cap to requested limit
        random.shuffle(rows)
        rows = rows[:limit]

        return [r['payload'] for r in rows if isinstance(r.get('payload'), dict)]

    except Exception as exc:
        LOGGER.warning('supabase: query error: %s', exc)
        return []


def get_all_question_metadata() -> list[dict[str, Any]]:
    """Fetch subject/topic/difficulty/origin for every question (for inventory).

    Returns [] on error or when not configured.
    """
    if not is_enabled():
        return []

    try:
        resp = httpx.get(
            _rest('questions'),
            params={
                'select': 'question_id,subject,topic,difficulty,origin',
                'limit': '50000',
            },
            headers=_json_headers(),
            timeout=20.0,
        )
        if resp.status_code != 200:
            return []
        rows = resp.json()
        return rows if isinstance(rows, list) else []
    except Exception as exc:
        LOGGER.warning('supabase: inventory query error: %s', exc)
        return []
