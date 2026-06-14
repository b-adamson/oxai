#!/usr/bin/env python3
"""Structural and heuristic integrity checks for the extracted question bank.

Catches the extraction-corruption classes found in issue #8: options leaked
onto stem ends, options replaced by neighbouring-question text, dropped
options (label gaps), and answer keys pointing at missing options.

Usage:
    ./check_bank_integrity.py                 # strict: nonzero exit on findings
    ./check_bank_integrity.py --report        # list findings, always exit 0
    ./check_bank_integrity.py --year 2022     # restrict to one paper
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent
PROCESSED_DIR = ROOT / 'data' / 'processed' / 'nsaa'

BOLD = '\033[1m'
GREEN = '\033[32m'
RED = '\033[31m'
YELLOW = '\033[33m'
RESET = '\033[0m'

LABELS = 'ABCDEFGH'

# A short value (number, optionally unit-ish) glued after the final question mark
VALUE_AFTER_QUESTION = re.compile(
    r'\?[\s\n]*[-+]?[\d.]+\s*(?:[a-zA-Z]{1,4}(?:\s?[a-zA-Z/^\-0-9]{0,6})?)?\s*$'
)
# A LaTeX value (e.g. \dfrac{1}{12}) glued after the final question mark/paren
GLUED_LATEX_VALUE = re.compile(r'[?)][\s\n]*\\(?:dfrac|frac|sqrt)\b[^a-zA-Z]*$')


def question_findings(
    q: Dict[str, Any], next_stem: str | None, all_stem_starts: List[str] | None = None
) -> tuple[List[str], List[str]]:
    """Return (hard, soft) findings. Hard = structural, zero false positives
    (fails CI). Soft = fuzzy heuristics that may flag legitimate content."""
    hard: List[str] = []
    soft: List[str] = []
    stem = (q.get('prompt', {}).get('stem') or '').strip()
    options = q.get('prompt', {}).get('options', [])
    answer = q.get('validation', {}).get('answer_label')

    if not stem:
        hard.append('empty stem')

    if not options:
        hard.append('no options')
    else:
        labels = [str(o.get('label', '')) for o in options]
        expected = list(LABELS[: len(options)])
        if labels != expected:
            hard.append(f'option labels not consecutive from A: {labels}')

        texts = [str(o.get('text', '')).strip() for o in options]
        if any(not t for t in texts):
            hard.append('empty option text')
        if len(set(texts)) != len(texts):
            hard.append('duplicate option texts')

        own_start = stem[:30]
        for label, text in zip(labels, texts):
            # Option that is the opening of ANY question's stem (not just the
            # immediate next) — high-precision signal of question-text leakage.
            if all_stem_starts and len(text) > 25:
                head = text[:25]
                if any(s.startswith(head) for s in all_stem_starts if not own_start.startswith(head)):
                    hard.append(f'option {label} matches the start of a question stem (leak)')
                    continue
            if next_stem and len(text) > 25 and next_stem.startswith(text[:25]):
                hard.append(f'option {label} matches start of next question stem')

        # Trailing bare-integer option (a leaked page number) among options that
        # otherwise carry units, decimals, or fractions — e.g. F="22".
        last = texts[-1]
        if re.fullmatch(r'\d{1,3}', last):
            others = texts[:-1]
            others_structured = sum(
                bool(re.search(r'[a-zA-Z%/.]', o) or '\\' in o) for o in others
            )
            if others_structured >= max(2, len(others) - 1):
                hard.append(f'trailing bare-integer option {labels[-1]}={last!r} (likely page-number leak)')

        # A leak often shows as one anomalously long option among short ones;
        # but legitimately long-option questions exist, so this is advisory.
        lengths = sorted(len(t) for t in texts)
        median_len = lengths[len(lengths) // 2]
        for label, text in zip(labels, texts):
            if len(text) > 60 and len(text) > 3 * max(median_len, 1):
                soft.append(f'outlier-length option {label}: {text[:60]!r}…')

    if answer is not None and options:
        labels = [str(o.get('label', '')) for o in options]
        if answer not in labels:
            hard.append(f'answer_label {answer!r} not among option labels {labels}')

    if VALUE_AFTER_QUESTION.search(stem) or GLUED_LATEX_VALUE.search(stem):
        hard.append(f'value glued after question mark: …{stem[-40:]!r}')

    return hard, soft


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', action='store_true', help='list findings, always exit 0')
    parser.add_argument('--year', type=int, default=None, help='restrict to one paper year')
    args = parser.parse_args()

    files = sorted(PROCESSED_DIR.glob('questions_*.json'))
    if args.year:
        files = [f for f in files if str(args.year) in f.name]
    if not files:
        print(f'{RED}No question files found{RESET}')
        sys.exit(2)

    total_questions = 0
    total_hard = 0
    total_soft = 0

    for path in files:
        data = json.loads(path.read_text(encoding='utf-8'))
        questions = data.get('questions', data) if isinstance(data, dict) else data
        total_questions += len(questions)
        file_hard = 0
        file_soft = 0

        stem_starts = [
            (q.get('prompt', {}).get('stem') or '').strip()[:40]
            for q in questions
            if (q.get('prompt', {}).get('stem') or '').strip()
        ]
        print(f'{BOLD}{path.name}{RESET} ({len(questions)} questions)')
        for i, q in enumerate(questions):
            next_stem = None
            if i + 1 < len(questions):
                next_stem = (questions[i + 1].get('prompt', {}).get('stem') or '').strip()
            hard, soft = question_findings(q, next_stem, stem_starts)
            for f in hard:
                print(f'  {RED}✗{RESET} {q.get("question_id")}: {f}')
            file_hard += len(hard)
            if args.report:
                for f in soft:
                    print(f'  {YELLOW}~{RESET} {q.get("question_id")}: {f}')
            file_soft += len(soft)

        if file_hard == 0:
            print(f'  {GREEN}✓ no structural errors{RESET}'
                  + (f' ({file_soft} advisory)' if file_soft and not args.report else ''))
        total_hard += file_hard
        total_soft += file_soft

    print(f'\n{BOLD}{total_hard} structural error(s), {total_soft} advisory finding(s) '
          f'across {total_questions} questions{RESET}')
    if args.report and total_soft:
        print(f'{YELLOW}(advisory findings shown above — review, but they do not fail CI){RESET}')
    if total_hard and not args.report:
        sys.exit(1)


if __name__ == '__main__':
    main()
