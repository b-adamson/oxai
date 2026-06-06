"""
QuestionExampleIndex — one-time-built index for fast example selection.

Architecture
------------
On construction the full question corpus is partitioned into three tiers of
in-memory buckets keyed by (subject, topic, difficulty):

  Tier 1 — narrow:  (subject, topic,  difficulty)   exact match + ±1 radius
  Tier 2 — medium:  (subject, None,   difficulty)   topic-agnostic
  Tier 3 — broad:   (subject, None,   None)         all questions for subject
  Tier 4 — global:  (None,    None,   None)         full corpus fallback

get_examples() walks the tiers in order, collecting candidates until
k * CANDIDATE_MULTIPLIER are available, then scores only those candidates
(instead of the full corpus as the old choose_examples() did), and returns
the top-k result.

Results are cached in a bounded LRU dict keyed by
  (subject, topic, difficulty, archetype, want_diagram, k)
so repeated identical requests are O(1).

Speedup
-------
Old path: score every question in the corpus (potentially thousands) on
every generation request, then sort the entire list.

New path: score 20–200 pre-filtered candidates; return cached result for
repeated keys.  Building the index takes ~1 ms for a corpus of 2 000
questions; individual selections take <0.1 ms after the first call.
"""

from __future__ import annotations

import hashlib
import logging
import random
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

LOGGER = logging.getLogger('oxai.example_index')

# How many candidates to collect before scoring. Larger = better quality, slower.
_CANDIDATE_MULTIPLIER = 6
# Max entries in the LRU selection cache.
_CACHE_MAX = 512


# ---------------------------------------------------------------------------
# Corpus fingerprint
# ---------------------------------------------------------------------------

def corpus_fingerprint(questions: List[Dict[str, Any]]) -> str:
    """Stable short hash of a loaded corpus; used to detect if a reload happened."""
    ids = [str(q.get('question_id', '')) for q in questions[:30]]
    ids += [str(q.get('question_id', '')) for q in questions[-30:]]
    payload = f'{len(questions)}|' + '|'.join(ids)
    return hashlib.sha256(payload.encode()).hexdigest()[:20]


# ---------------------------------------------------------------------------
# LRU cache
# ---------------------------------------------------------------------------

class _LRUCache:
    """Simple bounded dict-based LRU cache. CPython dict ops are GIL-protected."""

    def __init__(self, maxsize: int) -> None:
        self._maxsize = maxsize
        self._data: Dict[Tuple, List[Dict[str, Any]]] = {}
        self._order: List[Tuple] = []

    def get(self, key: Tuple) -> Optional[List[Dict[str, Any]]]:
        if key not in self._data:
            return None
        # Move to most-recently-used end
        self._order.remove(key)
        self._order.append(key)
        return self._data[key]

    def put(self, key: Tuple, value: List[Dict[str, Any]]) -> None:
        if key in self._data:
            self._order.remove(key)
            self._order.append(key)
            self._data[key] = value
            return
        if len(self._order) >= self._maxsize:
            evict = self._order.pop(0)
            del self._data[evict]
        self._data[key] = value
        self._order.append(key)

    def clear(self) -> None:
        self._data.clear()
        self._order.clear()

    def __len__(self) -> int:
        return len(self._data)


# ---------------------------------------------------------------------------
# Index
# ---------------------------------------------------------------------------

class QuestionExampleIndex:
    """
    Pre-built index over a question corpus for fast, consistent example selection.

    Parameters
    ----------
    questions : list of question dicts (same shape as load_questions() output)
    """

    def __init__(self, questions: List[Dict[str, Any]]) -> None:
        self.questions = questions
        self.fingerprint = corpus_fingerprint(questions)
        # buckets[(subj, topic_or_None, diff_or_None)] → sorted list of question indices
        self._buckets: Dict[Tuple, List[int]] = defaultdict(list)
        self._cache = _LRUCache(_CACHE_MAX)
        self._build()

    # ------------------------------------------------------------------
    # Build
    # ------------------------------------------------------------------

    def _build(self) -> None:
        # topic_counts[subject][topic] = count — used for weighted topic sampling
        self._topic_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for idx, q in enumerate(self.questions):
            c = q.get('content', {}) if isinstance(q.get('content', {}), dict) else {}
            subj = str(c.get('subject', '') or '').lower().strip()
            raw_topic = str(c.get('topic', '') or '').lower().strip()
            topic: Optional[str] = raw_topic or None
            try:
                diff = int(c.get('difficulty') or 0)
                if not (1 <= diff <= 5):
                    diff = 0
            except Exception:
                diff = 0

            if subj and topic:
                self._topic_counts[subj][topic] += 1

            # Tier 1 — narrow (subject + topic + difficulty ± radius)
            if subj and topic and diff:
                self._buckets[(subj, topic, diff)].append(idx)
                for d in (diff - 1, diff + 1):
                    if 1 <= d <= 5:
                        self._buckets[(subj, topic, d)].append(idx)

            # Tier 2 — medium (subject + difficulty ± radius, no topic)
            if subj and diff:
                self._buckets[(subj, None, diff)].append(idx)
                for d in (diff - 1, diff + 1):
                    if 1 <= d <= 5:
                        self._buckets[(subj, None, d)].append(idx)

            # Tier 3 — broad (subject only)
            if subj:
                self._buckets[(subj, None, None)].append(idx)

            # Tier 4 — global fallback
            self._buckets[(None, None, None)].append(idx)

        LOGGER.info(
            'QuestionExampleIndex built: %d questions, %d buckets, topic distribution: %s',
            len(self.questions),
            len(self._buckets),
            {s: dict(t) for s, t in self._topic_counts.items()},
        )

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    @staticmethod
    def _score(
        q: Dict[str, Any],
        subject: str,
        topic: Optional[str],
        difficulty: int,
        archetype: Optional[str],
        want_diagram: bool,
    ) -> int:
        c = q.get('content', {}) if isinstance(q.get('content', {}), dict) else {}
        score = 0

        if str(c.get('subject', '') or '').lower() == subject.lower():
            score += 3
        if topic and str(c.get('topic', '') or '').lower() == topic.lower():
            score += 3
        if archetype and str(c.get('archetype', '') or '').lower() == archetype.lower():
            score += 2

        has_diagram = bool(c.get('requires_diagram'))
        if want_diagram and has_diagram:
            score += 2
        elif not want_diagram and not has_diagram:
            # Strongly prefer non-diagram examples to avoid geometry bias
            score += 4
        elif not want_diagram and has_diagram:
            score -= 2

        try:
            q_diff = int(c.get('difficulty') or 0)
            score += max(0, 3 - abs(q_diff - difficulty))
        except Exception:
            pass

        return score

    # ------------------------------------------------------------------
    # Candidate collection
    # ------------------------------------------------------------------

    def _collect_candidates(
        self,
        subject: str,
        topic: Optional[str],
        difficulty: int,
        want: int,
    ) -> List[int]:
        """Walk tiers until we have `want` unique candidate indices."""
        seen: set = set()
        candidates: List[int] = []

        def _add(bucket_key: Tuple) -> None:
            for idx in self._buckets.get(bucket_key, []):
                if idx not in seen:
                    seen.add(idx)
                    candidates.append(idx)

        subj_key = subject.lower().strip()
        topic_key = (topic or '').lower().strip() or None

        # Tier 1 — narrow
        if topic_key:
            _add((subj_key, topic_key, difficulty))

        # Tier 2 — medium
        if len(candidates) < want:
            _add((subj_key, None, difficulty))

        # Tier 3 — broad
        if len(candidates) < want:
            _add((subj_key, None, None))

        # Tier 4 — global
        if len(candidates) < want:
            _add((None, None, None))

        return candidates

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_examples(
        self,
        subject: str,
        topic: Optional[str],
        difficulty: int,
        k: int,
        archetype: Optional[str] = None,
        want_diagram: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Return up to k full question dicts for use as style examples.

        When topic is specified, results are cached (same topic → same style pool
        is fine). When topic is None (broad/random generation), caching is skipped
        so each request gets a different random draw from the top-scoring candidates,
        preventing the model from being repeatedly fed the same topic examples.
        """
        if topic:
            cache_key = (
                subject.lower(),
                topic.lower(),
                difficulty,
                (archetype or '').lower(),
                want_diagram,
                k,
            )
            cached = self._cache.get(cache_key)
            if cached is not None:
                return cached
            result = self._select(subject, topic, difficulty, k, archetype, want_diagram)
            self._cache.put(cache_key, result)
            return result

        # No topic — skip cache so each request gets a fresh random draw
        return self._select(subject, topic, difficulty, k, archetype, want_diagram)

    def _select(
        self,
        subject: str,
        topic: Optional[str],
        difficulty: int,
        k: int,
        archetype: Optional[str],
        want_diagram: bool,
    ) -> List[Dict[str, Any]]:
        want = max(k * _CANDIDATE_MULTIPLIER, 30)
        candidate_indices = self._collect_candidates(subject, topic, difficulty, want)

        if not candidate_indices:
            return []

        # Score only the candidate subset (not the full corpus)
        scored = [
            (
                self._score(self.questions[idx], subject, topic, difficulty, archetype, want_diagram),
                idx,
            )
            for idx in candidate_indices
        ]
        scored.sort(key=lambda x: x[0], reverse=True)

        # When topic=None, shuffle within the top score tier so repeated calls
        # don't always return the same examples and bias the model toward one topic.
        # When a specific topic is given, keep deterministic order (no monoculture risk).
        score_map = {idx: sc for sc, idx in scored}
        if topic is None and scored:
            top_score = scored[0][0]
            top_tier  = [idx for sc, idx in scored if sc >= top_score - 1]
            remainder = [idx for sc, idx in scored if sc <  top_score - 1]
            random.shuffle(top_tier)
            ordered = top_tier + remainder
        else:
            ordered = [idx for _, idx in scored]

        # Prefer positively-scored candidates; fall back to top-k regardless
        positive = [idx for idx in ordered if score_map.get(idx, 0) > 0]
        chosen = positive[:k] if positive else ordered[:k]

        return [self.questions[idx] for idx in chosen]

    def sample_topic(self, subject: str) -> Optional[str]:
        """
        Weighted-randomly sample a topic for the given subject, proportional to
        how many questions of that topic exist in the corpus.

        Returns None only if the subject has no topic data at all.
        """
        counts = self._topic_counts.get(subject.lower().strip(), {})
        if not counts:
            return None
        topics = list(counts.keys())
        weights = [counts[t] for t in topics]
        return random.choices(topics, weights=weights, k=1)[0]

    def invalidate_cache(self) -> None:
        """Discard cached selections (call after reloading the corpus)."""
        self._cache.clear()
        LOGGER.info('QuestionExampleIndex selection cache cleared')

    def stats(self) -> Dict[str, Any]:
        """Diagnostic summary."""
        return {
            'corpus_size': len(self.questions),
            'bucket_count': len(self._buckets),
            'cache_entries': len(self._cache),
            'fingerprint': self.fingerprint,
        }
