#!/usr/bin/env python3
"""Sanity checks for code-execution answer verification.

Offline checks (no OpenAI key needed): sandbox containment, result contract,
and the tiered answer matcher.

Optional live mode:  ./check_code_verification.py --live 5
Generates N real calculation questions end-to-end (requires OPENAI_API_KEY)
and reports verification pass rate and match-tier distribution.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.utils.answer_match import match_value_to_options
from src.utils.code_sandbox import execute_verification_code

BOLD = '\033[1m'
GREEN = '\033[32m'
RED = '\033[31m'
RESET = '\033[0m'

_failures: list[str] = []


def check(name: str, condition: bool, detail: str = '') -> None:
    if condition:
        print(f'  {GREEN}✓{RESET} {name}')
    else:
        msg = f'{name}' + (f': {detail}' if detail else '')
        print(f'  {RED}✗{RESET} {msg}')
        _failures.append(msg)


# ---------------------------------------------------------------------------
# 1. Sandbox containment
# ---------------------------------------------------------------------------

def check_sandbox() -> None:
    print(f'\n{BOLD}1. Sandbox containment{RESET}')

    r = execute_verification_code('import os\nRESULT = 1')
    check('forbidden import rejected', not r.ok and 'forbidden import' in (r.error or ''), str(r.error))

    r = execute_verification_code('RESULT = ().__class__.__bases__')
    check('dunder escape rejected', not r.ok and 'dunder' in (r.error or ''), str(r.error))

    r = execute_verification_code("RESULT = eval('1+1')")
    check('eval rejected', not r.ok and 'forbidden name' in (r.error or ''), str(r.error))

    r = execute_verification_code("f = open('/tmp/x', 'w')")
    check('open rejected', not r.ok and 'forbidden name' in (r.error or ''), str(r.error))

    start = time.monotonic()
    r = execute_verification_code('while True: pass', timeout_s=2)
    elapsed = time.monotonic() - start
    check('infinite loop killed by timeout', not r.ok and 'timeout' in (r.error or ''), str(r.error))
    check('timeout returned promptly', elapsed < 5, f'{elapsed:.1f}s')

    r = execute_verification_code('x = bytearray(2 * 1024 ** 3)\nRESULT = 1', max_mem_mb=256)
    check('memory bomb killed', not r.ok, 'allocation unexpectedly succeeded')

    r = execute_verification_code('RESULT = 21 * 2')
    check('happy path int', r.ok and r.value == '42', f'{r.ok} {r.value!r} {r.error}')

    r = execute_verification_code('import math\nRESULT = math.sqrt(16)')
    check('float canonicalised (4.0 -> 4)', r.ok and r.value == '4', f'{r.value!r}')

    r = execute_verification_code('print("noise")\nRESULT = 7')
    check('stray prints ignored', r.ok and r.value == '7', f'{r.value!r}')

    r = execute_verification_code('x = 5')
    check('missing RESULT reported', not r.ok and 'RESULT' in (r.error or ''), str(r.error))

    # The highest-impact tuning risk: sympy must import under the default
    # RLIMIT_AS, or every calc question becomes a verification failure.
    r = execute_verification_code('import sympy\nRESULT = 2 * sympy.sqrt(3)')
    check('sympy works under default memory limit', r.ok and r.value == '2*sqrt(3)', f'{r.ok} {r.value!r} {r.error}')


# ---------------------------------------------------------------------------
# 2. Matcher
# ---------------------------------------------------------------------------

def check_matcher() -> None:
    print(f'\n{BOLD}2. Answer matcher{RESET}')

    opts = [
        {'label': 'A', 'text': '0.75'},
        {'label': 'B', 'text': '2√3'},
        {'label': 'C', 'text': '2.5 × 10^3 J'},
        {'label': 'D', 'text': '12'},
        {'label': 'E', 'text': '1/3'},
    ]

    m = match_value_to_options('0.75', opts)
    check('exact decimal', m.matched_label == 'A' and m.tier == 'exact', f'{m.matched_label} {m.tier}')

    m = match_value_to_options('3/4', opts)
    check('fraction vs decimal', m.matched_label == 'A', f'{m.matched_label} {m.tier}')

    m = match_value_to_options('2500', opts)
    check('sci notation + units', m.matched_label == 'C', f'{m.matched_label} {m.tier}')

    m = match_value_to_options('2*sqrt(3)', opts)
    check('surd (symbolic)', m.matched_label == 'B' and m.tier == 'symbolic', f'{m.matched_label} {m.tier}')

    m = match_value_to_options('9.8', [{'label': 'A', 'text': '9.8 m/s^2'}, {'label': 'B', 'text': '12 m/s^2'}])
    check('trailing units stripped', m.matched_label == 'A', f'{m.matched_label} {m.tier}')

    m = match_value_to_options('12.004', [{'label': 'A', 'text': '12'}, {'label': 'B', 'text': '13'}])
    check('within rel tolerance', m.matched_label == 'A', f'{m.matched_label} {m.tier}')

    m = match_value_to_options('12.5', [{'label': 'A', 'text': '12'}, {'label': 'B', 'text': '13'}])
    check('outside tolerance fails', m.matched_label is None, f'{m.matched_label}')

    m = match_value_to_options('0.75', [{'label': 'A', 'text': '0.75'}, {'label': 'B', 'text': '3/4'}])
    check('ambiguous double-match fails hard', m.matched_label is None and m.tier == 'ambiguous', f'{m.matched_label} {m.tier}')

    calls: list[str] = []

    def fake_fallback(value, options):
        calls.append(value)
        return None

    m = match_value_to_options('0.75', [{'label': 'A', 'text': '0.75'}, {'label': 'B', 'text': '3/4'}], llm_fallback=fake_fallback)
    check('ambiguity never invokes LLM fallback', m.tier == 'ambiguous' and not calls, f'calls={calls}')

    m = match_value_to_options('99', opts, llm_fallback=fake_fallback)
    check('zero-match invokes fallback', m.tier == 'none' and calls == ['99'], f'calls={calls}')

    m = match_value_to_options('pi/2', [{'label': 'A', 'text': 'π/2'}, {'label': 'B', 'text': 'π'}])
    check('pi symbolic', m.matched_label == 'A', f'{m.matched_label} {m.tier}')

    latex_opts = [
        {'label': 'A', 'text': '$27$'},
        {'label': 'B', 'text': '\\(54\\)'},
        {'label': 'C', 'text': '27 \\text{ cm}'},
    ]
    m = match_value_to_options('27', latex_opts)
    check('latex delimiters fail hard when duplicated', m.matched_label is None and m.tier == 'ambiguous', f'{m.matched_label} {m.tier}')

    m = match_value_to_options('27', [{'label': 'A', 'text': '$27$'}, {'label': 'B', 'text': '\\(54\\)'}])
    check('latex dollar-wrapped number', m.matched_label == 'A', f'{m.matched_label} {m.tier}')

    m = match_value_to_options('0.75', [{'label': 'A', 'text': '$\\frac{3}{4}$'}, {'label': 'B', 'text': '$\\frac{4}{3}$'}])
    check('latex frac', m.matched_label == 'A', f'{m.matched_label} {m.tier}')

    m = match_value_to_options('2*sqrt(3)', [{'label': 'A', 'text': '$2\\sqrt{3}$'}, {'label': 'B', 'text': '$3\\sqrt{2}$'}])
    check('latex surd', m.matched_label == 'A', f'{m.matched_label} {m.tier}')


# ---------------------------------------------------------------------------
# 3. Optional live mode
# ---------------------------------------------------------------------------

def run_live(n: int) -> None:
    import os

    from dotenv import load_dotenv

    load_dotenv(ROOT / '.env')
    if not os.getenv('OPENAI_API_KEY'):
        print(f'{RED}--live requires OPENAI_API_KEY (backend/.env){RESET}')
        sys.exit(2)

    import logging

    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s: %(message)s')

    from src.services.generate_question import GenerationSettings, QuestionGenerationService

    settings = GenerationSettings(
        processed_dir=ROOT / 'data' / 'processed' / 'nsaa',
        generated_dir=ROOT / 'generated',
        diagram_dir=ROOT / 'generated' / 'diagrams',
        enable_image_generation=False,
    )
    service = QuestionGenerationService(settings=settings)

    print(f'\n{BOLD}3. Live generation ({n} calculation questions){RESET}')
    passed, failed = 0, 0
    tiers: dict[str, int] = {}
    subjects = ['math', 'physics', 'chemistry']
    for i in range(n):
        subject = subjects[i % len(subjects)]
        try:
            q = service.generate_question(subject=subject, topic=None, difficulty=3, examples=3)
        except Exception as exc:
            failed += 1
            print(f'  {RED}✗{RESET} {subject}: generation failed after retries: {exc}')
            continue
        v = q.get('validation', {})
        ver = q.get('generation', {}).get('verification') or {}
        calc = q.get('content', {}).get('requires_calculation')
        if calc and v.get('verified_by') == 'code_execution':
            passed += 1
            tier = ver.get('match_tier', '?')
            tiers[tier] = tiers.get(tier, 0) + 1
            print(f"  {GREEN}✓{RESET} {subject}: {v.get('answer_label')} verified by code "
                  f"(tier={tier}, computed={ver.get('computed_value')!r}, id_is_uuid={len(str(q.get('question_id'))) == 36})")
        elif not calc:
            print(f'  - {subject}: non-calculation question (not code-verified, expected)')
        else:
            failed += 1
            print(f'  {RED}✗{RESET} {subject}: calc question returned without code verification')

    print(f'\n  verified: {passed}, failed: {failed}, tier distribution: {tiers}')


# ---------------------------------------------------------------------------

def main() -> None:
    check_sandbox()
    check_matcher()

    if '--live' in sys.argv:
        idx = sys.argv.index('--live')
        n = int(sys.argv[idx + 1]) if len(sys.argv) > idx + 1 else 3
        run_live(n)

    print()
    if _failures:
        print(f'{RED}{BOLD}{len(_failures)} check(s) failed{RESET}')
        sys.exit(1)
    print(f'{GREEN}{BOLD}All checks passed{RESET}')


if __name__ == '__main__':
    main()
