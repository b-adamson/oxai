#!/usr/bin/env python3
"""Calibrate the code-execution verifier against bank ground truth.

For a sample of past-paper calculation questions (which carry OFFICIAL answer
keys), the model writes solution_code from the stem — it never sees the
official key — then the production sandbox + matcher pipeline runs and the
matched option is compared against the official answer.

This measures the true end-to-end accuracy of "model writes code, machine
executes, matcher picks the option" against known-correct data, and surfaces
the interesting tail: disagreements are either model conceptual errors or
extraction/key errors in the bank.

Usage:
    ./calibrate_bank_verification.py --n 50 [--seed 7] [--subject physics]
                                     [--no-llm-fallback] [--rel-tol 1e-3]

Requires OPENAI_API_KEY (backend/.env). Writes a full per-question report to
backend/generated/bank_calibration.jsonl.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

from src.utils.answer_match import match_value_to_options
from src.utils.code_sandbox import execute_verification_code
from src.services.generate_question import load_questions

BOLD = '\033[1m'
GREEN = '\033[32m'
RED = '\033[31m'
YELLOW = '\033[33m'
RESET = '\033[0m'

REPORT_PATH = ROOT / 'generated' / 'bank_calibration.jsonl'

CODE_INSTRUCTIONS = (
    'You are given a past-paper multiple-choice question. Write a self-contained '
    'Python 3 snippet that computes the answer purely from the data given in the stem. '
    'The code must NOT reference the answer options, their letters, or any answer you suspect — '
    'it computes the result independently from first principles. '
    'Allowed imports ONLY: math, sympy, fractions, decimal, statistics, itertools, cmath, numbers. '
    'No file, network, OS access, eval/exec, or dunder attributes. '
    'End the code by assigning the computed answer to a variable named RESULT. '
    'For numeric answers assign a plain number without units, expressed in the same unit the options use. '
    'For exact symbolic answers (surds, fractions, pi) assign a sympy expression. '
    'If the question cannot be answered by computation from the stem alone '
    '(e.g. it needs a diagram or is purely conceptual), set solution_code to null.'
)


def _code_schema() -> Dict[str, Any]:
    return {
        'name': 'bank_solution_code',
        'schema': {
            'type': 'object',
            'additionalProperties': False,
            'required': ['solution_code'],
            'properties': {'solution_code': {'type': ['string', 'null']}},
        },
    }


def _match_schema(labels: List[str]) -> Dict[str, Any]:
    return {
        'name': 'option_match',
        'schema': {
            'type': 'object',
            'additionalProperties': False,
            'required': ['label'],
            'properties': {'label': {'type': 'string', 'enum': labels + ['NONE']}},
        },
    }


class Calibrator:
    def __init__(self, model: str, rel_tol: float, use_llm_fallback: bool):
        from openai import OpenAI

        self.client = OpenAI()
        self.model = model
        self.rel_tol = rel_tol
        self.use_llm_fallback = use_llm_fallback

    def _call(self, instructions: str, payload: Dict[str, Any], schema: Dict[str, Any], max_tokens: int) -> Dict[str, Any]:
        response = self.client.responses.create(
            model=self.model,
            input=[
                {'role': 'developer', 'content': instructions},
                {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)},
            ],
            text={'format': {'type': 'json_schema', 'name': schema['name'], 'schema': schema['schema'], 'strict': True}},
            max_output_tokens=max_tokens,
        )
        text = getattr(response, 'output_text', None)
        if not text:
            raise ValueError('empty model response')
        return json.loads(text)

    def write_code(self, question: Dict[str, Any]) -> Optional[str]:
        prompt = question.get('prompt', {})
        payload = {
            'stem': prompt.get('stem'),
            # Options shown (mirrors production knowledge) so units/format are
            # known — the instructions still forbid referencing them.
            'options': prompt.get('options', []),
        }
        result = self._call(CODE_INSTRUCTIONS, payload, _code_schema(), max_tokens=2400)
        return result.get('solution_code')

    def llm_fallback(self, computed: str, options: List[Dict[str, str]]) -> Optional[str]:
        labels = [str(o.get('label', '')) for o in options if o.get('label')]
        result = self._call(
            'You compare a computed answer value against multiple-choice options. '
            'Reply with the letter of the single option mathematically equal to the value '
            '(allowing formatting, units, and reasonable rounding differences), or NONE. '
            'If two or more options are equal to the value, reply NONE. Do not guess.',
            {'computed_value': computed, 'options': options},
            _match_schema(labels),
            max_tokens=200,
        )
        label = result.get('label')
        return label if label in labels else None

    def calibrate_one(self, question: Dict[str, Any]) -> Dict[str, Any]:
        qid = question.get('question_id')
        official = question.get('validation', {}).get('answer_label')
        options = question.get('prompt', {}).get('options', [])
        record: Dict[str, Any] = {
            'question_id': qid,
            'subject': question.get('content', {}).get('subject'),
            'topic': question.get('content', {}).get('topic'),
            'official_label': official,
            'stem': question.get('prompt', {}).get('stem'),
            'options': options,
        }

        try:
            code = self.write_code(question)
        except Exception as exc:
            record.update(outcome='model_error', detail=str(exc))
            return record
        record['solution_code'] = code

        if not code:
            record.update(outcome='declined', detail='model returned null solution_code')
            return record

        result = execute_verification_code(code)
        record['computed_value'] = result.value
        if not result.ok:
            record.update(outcome='exec_fail', detail=result.error)
            return record

        fallback = self.llm_fallback if self.use_llm_fallback else None
        match = match_value_to_options(result.value, options, rel_tol=self.rel_tol, llm_fallback=fallback)
        record['matched_label'] = match.matched_label
        record['match_tier'] = match.tier

        if match.matched_label is None:
            record.update(outcome='no_match' if match.tier == 'none' else 'ambiguous', detail=match.details)
        elif match.matched_label == official:
            record.update(outcome='agree', detail='')
        else:
            record.update(outcome='disagree', detail=f'matched {match.matched_label}, official {official}')
        return record


def eligible_questions(subject: Optional[str], year: Optional[int] = None) -> List[Dict[str, Any]]:
    questions = load_questions(ROOT / 'data' / 'processed')
    out = []
    for q in questions:
        c = q.get('content', {})
        if not c.get('requires_calculation'):
            continue
        if c.get('requires_diagram') or q.get('prompt', {}).get('figures'):
            continue  # code can't see figures
        if not q.get('validation', {}).get('answer_label'):
            continue
        if subject and str(c.get('subject', '')).lower() != subject.lower():
            continue
        if year and q.get('source', {}).get('year') != year:
            continue
        out.append(q)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--n', type=int, default=50)
    parser.add_argument('--seed', type=int, default=7)
    parser.add_argument('--subject', default=None)
    parser.add_argument('--year', type=int, default=None)
    parser.add_argument('--rel-tol', type=float, default=1e-3)
    parser.add_argument('--no-llm-fallback', action='store_true')
    args = parser.parse_args()

    load_dotenv(ROOT / '.env')
    if not os.getenv('OPENAI_API_KEY'):
        print(f'{RED}OPENAI_API_KEY required (backend/.env){RESET}')
        sys.exit(2)

    pool = eligible_questions(args.subject, args.year)
    if not pool:
        print(f'{RED}No eligible bank questions found{RESET}')
        sys.exit(2)
    sample = random.Random(args.seed).sample(pool, min(args.n, len(pool)))
    print(f'{BOLD}Calibrating against {len(sample)} bank questions '
          f'(of {len(pool)} eligible: calculation, no diagram, official key){RESET}\n')

    calibrator = Calibrator(
        model=os.getenv('OPENAI_MODEL_DRAFT', 'gpt-5.5'),
        rel_tol=args.rel_tol,
        use_llm_fallback=not args.no_llm_fallback,
    )

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    counts: Dict[str, int] = {}
    tiers: Dict[str, int] = {}
    disagreements: List[Dict[str, Any]] = []

    with REPORT_PATH.open('w', encoding='utf-8') as report:
        for i, q in enumerate(sample, 1):
            record = calibrator.calibrate_one(q)
            record['calibrated_at'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
            report.write(json.dumps(record, ensure_ascii=False) + '\n')
            report.flush()

            outcome = record['outcome']
            counts[outcome] = counts.get(outcome, 0) + 1
            if record.get('match_tier'):
                tiers[record['match_tier']] = tiers.get(record['match_tier'], 0) + 1
            if outcome == 'disagree':
                disagreements.append(record)

            colour = GREEN if outcome == 'agree' else (RED if outcome == 'disagree' else YELLOW)
            print(f"  [{i:>3}/{len(sample)}] {colour}{outcome:<11}{RESET} {record['question_id']} "
                  f"({record['subject']}) {record.get('detail', '')}")

    total = len(sample)
    agree = counts.get('agree', 0)
    disagree = counts.get('disagree', 0)
    resolved = agree + disagree  # cases where the pipeline produced a definite label

    print(f'\n{BOLD}Summary{RESET}')
    for outcome in sorted(counts, key=counts.get, reverse=True):
        print(f'  {outcome:<12} {counts[outcome]:>3}  ({counts[outcome] / total:.0%})')
    if resolved:
        print(f'\n  {BOLD}Key-agreement rate (when a label was produced): '
              f'{agree}/{resolved} = {agree / resolved:.1%}{RESET}')
    print(f'  Match tiers: {tiers}')
    print(f'  Full report: {REPORT_PATH}')

    if disagreements:
        print(f'\n{BOLD}{RED}Disagreements — model conceptual errors OR bank key/extraction errors; review by hand:{RESET}')
        for r in disagreements:
            print(f"\n  {r['question_id']} ({r['subject']}): computed={r.get('computed_value')!r} "
                  f"matched={r.get('matched_label')} official={r['official_label']}")
            stem = (r.get('stem') or '')[:200].replace('\n', ' ')
            print(f'    stem: {stem}…')


if __name__ == '__main__':
    main()
