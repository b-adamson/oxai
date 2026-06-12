"""Best-effort Supabase writer for generated questions.

Only active when DB_WRITE_ENABLED=1, SUPABASE_URL, and SUPABASE_SECRET_KEY are
all set in the environment. Failures are logged and never block the response.

Uses the Supabase REST API directly via httpx (no extra dependency).
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import httpx

LOGGER = logging.getLogger('oxai.supabase_writer')

_SUPABASE_URL: Optional[str] = os.getenv('SUPABASE_URL')
_SUPABASE_SECRET_KEY: Optional[str] = os.getenv('SUPABASE_SECRET_KEY')
_DB_WRITE_ENABLED: bool = os.getenv('DB_WRITE_ENABLED', '0').lower() not in ('0', 'false', '')


def is_enabled() -> bool:
    return _DB_WRITE_ENABLED and bool(_SUPABASE_URL) and bool(_SUPABASE_SECRET_KEY)


def upsert_question(question: Dict[str, Any]) -> None:
    """Upsert a generated question into the Supabase `questions` table.

    No-op if DB_WRITE_ENABLED is not set or credentials are missing.
    Best-effort: exceptions are caught and logged.
    """
    if not is_enabled():
        return

    question_id = question.get('question_id')
    if not question_id:
        LOGGER.warning('supabase_writer: skipping upsert — question has no question_id')
        return

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
        'payload': question,
        'origin': 'generated',
        'subject': str(content.get('subject') or 'unknown'),
        'topic': content.get('topic') or None,
        'difficulty': difficulty,
    }

    url = f"{_SUPABASE_URL.rstrip('/')}/rest/v1/questions"
    headers = {
        'apikey': _SUPABASE_SECRET_KEY,
        'Authorization': f'Bearer {_SUPABASE_SECRET_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
    }

    try:
        resp = httpx.post(
            url,
            json=[row],
            headers=headers,
            params={'on_conflict': 'question_id'},
            timeout=10.0,
        )
        if resp.status_code not in (200, 201, 204):
            LOGGER.warning(
                'supabase_writer: upsert failed  status=%d  body=%s',
                resp.status_code, resp.text[:200],
            )
        else:
            LOGGER.debug('supabase_writer: upserted question_id=%s', question_id)
    except Exception as exc:
        LOGGER.warning('supabase_writer: upsert exception for question_id=%s: %s', question_id, exc)
