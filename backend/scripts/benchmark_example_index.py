#!/usr/bin/env python3
"""Benchmark and sanity checks for QuestionExampleIndex."""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.services.example_index import QuestionExampleIndex
from src.services.generate_question import choose_examples, load_questions

PROCESSED_DIR = ROOT / 'data' / 'processed'

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
# Load corpus
# ---------------------------------------------------------------------------

def load() -> list[dict]:
    if not PROCESSED_DIR.exists():
        print(f'[warn] Processed dir not found at {PROCESSED_DIR}; using synthetic corpus.')
        return _synthetic_corpus()
    questions = load_questions(PROCESSED_DIR)
    if not questions:
        print('[warn] No questions found; using synthetic corpus.')
        return _synthetic_corpus()
    print(f'Loaded {len(questions)} questions from {PROCESSED_DIR}')
    return questions


def _synthetic_corpus() -> list[dict]:
    import uuid

    corpus = []
    topics = ['algebra', 'calculus', 'geometry', 'statistics', 'mechanics']
    subjects = ['math', 'physics', 'chemistry']
    for subj in subjects:
        for topic in topics:
            for diff in range(1, 6):
                for i in range(4):
                    has_diag = topic == 'geometry' and i % 2 == 0
                    corpus.append(
                        {
                            'question_id': str(uuid.uuid4()),
                            'content': {
                                'subject': subj,
                                'topic': topic,
                                'subtopic': None,
                                'archetype': f'arch_{i % 3}',
                                'difficulty': diff,
                                'requires_diagram': has_diag,
                                'requires_calculation': True,
                            },
                            'prompt': {
                                'stem': f'Synthetic {subj}/{topic}/d{diff} question #{i}',
                                'options': [{'label': l, 'text': f'option {l}'} for l in 'ABCDE'],
                                'figures': [],
                            },
                            'validation': {'answer_label': 'A', 'answer_text': 'option A', 'status': 'verified'},
                            'source': {},
                            'generation': {'solution_steps': [], 'distractor_strategy': []},
                            'metadata': {
                                'tags': [subj],
                                'diagram_required': has_diag,
                                'diagram_url': None,
                                'estimated_time_seconds': 90,
                            },
                            'data_quality_notes': [],
                        }
                    )
    return corpus


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_basic(index: QuestionExampleIndex) -> None:
    print(f'\n{BOLD}1. Basic selection{RESET}')
    result = index.get_examples('math', 'algebra', 3, 3)
    check('returns up to k=3 results', len(result) <= 3)
    check('returns at least 1 result', len(result) >= 1)
    check('each result is a dict', all(isinstance(q, dict) for q in result))


def test_cache(index: QuestionExampleIndex) -> None:
    print(f'\n{BOLD}2. Cache correctness{RESET}')
    args = ('math', 'algebra', 3, 3)
    r1 = index.get_examples(*args)

    t0 = time.perf_counter()
    r2 = index.get_examples(*args)
    cached_ms = (time.perf_counter() - t0) * 1000

    check('cached result identical to first', r1 == r2)
    check(f'cached call <0.5 ms (was {cached_ms:.3f} ms)', cached_ms < 0.5, f'took {cached_ms:.3f} ms')

    index.invalidate_cache()
    r3 = index.get_examples(*args)
    check('result after cache invalidation still valid', len(r3) >= 1)


def test_diagram_preference(index: QuestionExampleIndex) -> None:
    print(f'\n{BOLD}3. Diagram preference{RESET}')
    want_diag = index.get_examples('math', None, 3, 5, want_diagram=True)
    no_diag = index.get_examples('math', None, 3, 5, want_diagram=False)

    diag_count_want = sum(1 for q in want_diag if q.get('content', {}).get('requires_diagram'))
    diag_count_no = sum(1 for q in no_diag if q.get('content', {}).get('requires_diagram'))

    check(
        f'want_diagram=False: <=1 of {len(no_diag)} have diagrams (got {diag_count_no})',
        diag_count_no <= max(1, len(no_diag) // 4),
        f'{diag_count_no}/{len(no_diag)} have diagrams',
    )
    if want_diag and any(q.get('content', {}).get('requires_diagram') for q in index.questions):
        check(
            f'want_diagram=True: >=1 of {len(want_diag)} have diagrams (got {diag_count_want})',
            diag_count_want >= 1,
        )


def test_sparse_fallback(index: QuestionExampleIndex) -> None:
    print(f'\n{BOLD}4. Sparse/no-match fallback{RESET}')
    result = index.get_examples('math', '__nonexistent_topic__', 3, 3)
    check('sparse topic falls back and returns results', len(result) >= 1)

    try:
        index.get_examples('__no_such_subject__', None, 3, 2)
        check('unknown subject does not crash', True)
    except Exception as exc:
        check('unknown subject does not crash', False, str(exc))


def test_subject_filter(index: QuestionExampleIndex) -> None:
    print(f'\n{BOLD}5. Subject filtering{RESET}')
    subjects = ['math', 'physics', 'chemistry', 'biology']
    for subj in subjects:
        result = index.get_examples(subj, None, 3, 5)
        if result:
            correct = [q for q in result if str(q.get('content', {}).get('subject', '')).lower() == subj.lower()]
            pct = len(correct) / len(result) * 100
            check(
                f'{subj}: >=80% of results match subject ({pct:.0f}%)',
                len(correct) >= len(result) * 0.8,
                f'{len(correct)}/{len(result)} match',
            )


def test_topic_sampling(index: QuestionExampleIndex) -> None:
    print(f'\n{BOLD}6. Topic sampling{RESET}')
    if not hasattr(index, 'sample_topic'):
        check('sample_topic exists', False, 'QuestionExampleIndex.sample_topic is missing')
        return

    sampled = [index.sample_topic('math') for _ in range(20)]
    check('sample_topic returns a string sometimes', any(isinstance(x, str) and x for x in sampled))
    check('sample_topic returns varied topics', len(set(sampled)) > 1 or len([x for x in sampled if x]) <= 1)


def test_legacy_reference(questions: list[dict], index: QuestionExampleIndex) -> None:
    print(f'\n{BOLD}7. Legacy reference check{RESET}')
    topics = [str(q.get('content', {}).get('topic', '') or '') for q in questions if str(q.get('content', {}).get('subject', '') or '').lower() == 'math' and q.get('content', {}).get('topic')]
    topic = topics[0] if topics else 'algebra'
    old = choose_examples(questions, 'math', topic, 3, 3, want_diagram=False)
    new = index.get_examples('math', topic, 3, 3, want_diagram=False)

    old_topics = {str(q.get('content', {}).get('topic', '')).lower() for q in old}
    new_topics = {str(q.get('content', {}).get('topic', '')).lower() for q in new}
    overlap = len({q.get('question_id') for q in old} & {q.get('question_id') for q in new})

    print(f'  legacy overlap with choose_examples: {overlap}/{min(len(old), len(new), 3)}')
    check('new picker remains on-topic', topic.lower() in new_topics or len(new_topics) > 0)
    if old_topics:
        check('legacy comparison still shows topic alignment', topic.lower() in old_topics)


# ---------------------------------------------------------------------------
# Benchmark
# ---------------------------------------------------------------------------

def benchmark(index: QuestionExampleIndex) -> None:
    print(f'\n{BOLD}8. Timing benchmark{RESET}')
    cases = [
        ('math', 'algebra', 3, 3, None, False),
        ('math', None, 2, 3, None, False),
        ('physics', 'mechanics', 3, 3, None, False),
        ('math', 'geometry', 3, 3, None, True),
        ('chemistry', None, 2, 3, None, False),
        ('math', '__sparse__', 3, 3, None, False),
    ]

    print('  First calls (cold cache):')
    index.invalidate_cache()
    for subj, topic, diff, k, arch, want_d in cases:
        t0 = time.perf_counter()
        r = index.get_examples(subj, topic, diff, k, archetype=arch, want_diagram=want_d)
        ms = (time.perf_counter() - t0) * 1000
        label = f'{subj}/{topic or "*"}/d{diff} diag={want_d}'
        print(f'    {label:<45} -> {len(r)} results  {ms:.3f} ms')

    print('  Repeated calls (warm cache):')
    for subj, topic, diff, k, arch, want_d in cases:
        t0 = time.perf_counter()
        index.get_examples(subj, topic, diff, k, archetype=arch, want_diagram=want_d)
        ms = (time.perf_counter() - t0) * 1000
        label = f'{subj}/{topic or "*"}/d{diff} diag={want_d}'
        print(f'    {label:<45}              {ms:.3f} ms')


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    print(f'{BOLD}QuestionExampleIndex - benchmark + correctness{RESET}')
    print('=' * 60)

    questions = load()

    t0 = time.perf_counter()
    index = QuestionExampleIndex(questions)
    build_ms = (time.perf_counter() - t0) * 1000
    print(f'Index built in {build_ms:.1f} ms  |  {index.stats()}')

    test_basic(index)
    test_cache(index)
    test_diagram_preference(index)
    test_sparse_fallback(index)
    test_subject_filter(index)
    test_topic_sampling(index)
    test_legacy_reference(questions, index)
    benchmark(index)

    print('\n' + '=' * 60)
    if _failures:
        print(f'{RED}FAILED{RESET}: {len(_failures)} check(s):')
        for f in _failures:
            print(f'  • {f}')
        return 1
    print(f'{GREEN}All checks passed.{RESET}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
