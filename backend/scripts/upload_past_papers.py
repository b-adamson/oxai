#!/usr/bin/env python3
"""Upload all past paper questions to Supabase.

Run once (or re-run safely — upserts are idempotent):

  cd /home/beada/dev/Projects/oxbridgeai/backend
  python -m scripts.upload_past_papers

Reads:  data/processed/nsaa/questions_YYYY.json  (all years)
        data/processed/nsaa/images_YYYY/          (diagram images)
Writes: Supabase questions table (origin='past_paper')
        Supabase Storage bucket  question-images/
"""
from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Add backend root to path so src.* imports work
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from src.utils.supabase_writer import is_enabled, upsert_question  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s: %(message)s',
)
LOGGER = logging.getLogger('upload_past_papers')

PROCESSED_DIR = BACKEND_DIR / 'data' / 'processed' / 'nsaa'


def load_year(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding='utf-8'))
    if isinstance(data, list):
        return data
    # Most files are {"source":..., "questions":[...]}
    if isinstance(data, dict) and 'questions' in data:
        return data['questions']
    return []


def main() -> None:
    if not is_enabled():
        LOGGER.error(
            'Supabase not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env'
        )
        sys.exit(1)

    question_files = sorted(PROCESSED_DIR.glob('questions_*.json'))
    if not question_files:
        LOGGER.error('No questions_YYYY.json files found in %s', PROCESSED_DIR)
        sys.exit(1)

    total = 0
    skipped = 0

    for qfile in question_files:
        year = qfile.stem.replace('questions_', '')
        LOGGER.info('Processing %s...', qfile.name)
        questions = load_year(qfile)
        LOGGER.info('  %d questions found', len(questions))

        for q in questions:
            qid = q.get('question_id')
            if not qid:
                skipped += 1
                continue

            # Synchronous upsert (script context — no background tasks)
            # Force DB_WRITE_ENABLED for this script regardless of env
            import os
            os.environ['DB_WRITE_ENABLED'] = '1'

            upsert_question(
                question=q,
                processed_dir=PROCESSED_DIR,
                diagram_dir=None,           # past papers have no generated diagrams
                origin='past_paper',
            )
            total += 1

            # Brief pause to avoid hammering the REST API
            time.sleep(0.05)

        LOGGER.info('  Done with %s', year)

    LOGGER.info('Upload complete: %d questions upserted, %d skipped (no ID)', total, skipped)


if __name__ == '__main__':
    main()
