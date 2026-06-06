"""
Generation session state.

Each API call is stateless (no previous_response_id).  The identical
system-prompt prefix enables OpenAI's automatic prompt caching so the fixed
portion is billed at a discount on repeated calls.

Sessions exist only to track coverage diversity across multiple questions.

Two modes
---------
live  — 1 question per call; session refreshed after MAX_CALLS_LIVE turns.
batch — N questions sequentially; session refreshed after MAX_CALLS_BATCH turns.

Coverage tracking
-----------------
CoverageTracker records every (subject, topic, difficulty, archetype) output in
a bounded deque.  It drives diversity by:
  - reporting recently-overused topics so the caller can ask the model to avoid them
  - biasing difficulty selection toward underrepresented levels

Session refresh
---------------
When call_count >= max_calls the SessionManager starts a fresh session and
carries forward a compact one-line coverage summary so the new session knows
what was recently generated.
"""

from __future__ import annotations

import logging
import random
import threading
import time
import uuid
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

LOGGER = logging.getLogger('oxai.generation_session')

# Session call limits before auto-refresh
MAX_CALLS_LIVE  = 8
MAX_CALLS_BATCH = 20

# Rolling window of recent outputs tracked for diversity
COVERAGE_WINDOW = 60


# ---------------------------------------------------------------------------
# Coverage tracker
# ---------------------------------------------------------------------------

class CoverageTracker:
    """Rolling window of recent (subject, topic, difficulty, archetype) outputs."""

    def __init__(self, window: int = COVERAGE_WINDOW) -> None:
        self._history: deque = deque(maxlen=window)

    def record(
        self,
        subject: str,
        topic: Optional[str],
        difficulty: int,
        archetype: Optional[str],
    ) -> None:
        self._history.append((
            subject.lower(),
            (topic or '').lower(),
            difficulty,
            (archetype or '').lower(),
        ))

    def recent_topics(self, subject: str, n: int = 5) -> List[str]:
        """Most-recently-used *distinct* topics for a subject (newest first)."""
        subj = subject.lower()
        seen: List[str] = []
        for s, t, _d, _a in reversed(self._history):
            if s == subj and t and t not in seen:
                seen.append(t)
                if len(seen) >= n:
                    break
        return seen

    def difficulty_counts(self, subject: str) -> Counter:
        subj = subject.lower()
        return Counter(d for s, _t, d, _a in self._history if s == subj)

    def suggest_difficulty(
        self,
        subject: str,
        target: Optional[Dict[int, float]] = None,
    ) -> int:
        """Return a difficulty biased toward levels underrepresented so far."""
        if target is None:
            # NSAA/ESAT realistic distribution
            target = {1: 0.08, 2: 0.25, 3: 0.35, 4: 0.22, 5: 0.10}
        recent = self.difficulty_counts(subject)
        total = sum(recent.values()) or 1
        weights = {
            d: max(0.02, frac - recent.get(d, 0) / total + 0.05)
            for d, frac in target.items()
        }
        diffs = list(weights)
        w = [weights[d] for d in diffs]
        return random.choices(diffs, weights=w, k=1)[0]

    def compact_summary(self, max_entries: int = 14) -> str:
        """One-line summary of recent coverage for seeding a fresh session."""
        if not self._history:
            return ''
        counts: Dict[Tuple, int] = {}
        for s, t, d, _a in self._history:
            key = (s, t or 'general', d)
            counts[key] = counts.get(key, 0) + 1
        items = sorted(counts.items(), key=lambda x: -x[1])[:max_entries]
        parts = [f'{s}/{t}/d{d}×{n}' for (s, t, d), n in items]
        return 'Prior coverage: ' + ', '.join(parts)


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

@dataclass
class GenerationSession:
    """State for one generation session (live or batch)."""

    session_id: str         = field(default_factory=lambda: uuid.uuid4().hex[:12])
    mode: str               = 'live'   # 'live' | 'batch'
    last_response_id: Optional[str] = None
    call_count: int         = 0
    created_at: float       = field(default_factory=time.monotonic)
    coverage: CoverageTracker = field(default_factory=CoverageTracker)

    @property
    def max_calls(self) -> int:
        return MAX_CALLS_BATCH if self.mode == 'batch' else MAX_CALLS_LIVE

    @property
    def is_fresh(self) -> bool:
        return self.call_count == 0

    @property
    def needs_refresh(self) -> bool:
        return self.call_count >= self.max_calls

    def record_call(
        self,
        response_id: Optional[str],
        subject: str,
        topic: Optional[str],
        difficulty: int,
        archetype: Optional[str],
    ) -> None:
        if response_id:
            self.last_response_id = response_id
        self.call_count += 1
        self.coverage.record(subject, topic, difficulty, archetype)

    def compact_summary(self) -> str:
        return self.coverage.compact_summary()


# ---------------------------------------------------------------------------
# Session manager
# ---------------------------------------------------------------------------

class SessionManager:
    """Thread-safe manager for per-(subject, mode) generation sessions."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: Dict[str, GenerationSession] = {}

    @staticmethod
    def _key(subject: str, mode: str) -> str:
        return f'{subject.lower()}:{mode}'

    def get_or_create(
        self,
        subject: str,
        mode: str = 'live',
    ) -> Tuple[GenerationSession, str]:
        """Return (session, prior_coverage_summary).

        If the current session for (subject, mode) is exhausted, compact it
        and start fresh.  The coverage summary from the old session is passed
        back so the caller can inject it into the new session's system prompt.
        """
        key = self._key(subject, mode)
        with self._lock:
            existing = self._sessions.get(key)
            if existing is not None and not existing.needs_refresh:
                return existing, ''
            summary = existing.compact_summary() if existing else ''
            new_session = GenerationSession(mode=mode)
            self._sessions[key] = new_session
            LOGGER.info(
                'Session %s started  mode=%s  subject=%s  prior=%s',
                new_session.session_id, mode, subject, bool(existing),
            )
            return new_session, summary

    def invalidate(self, subject: str, mode: str) -> None:
        """Force the next call to start a new session."""
        key = self._key(subject, mode)
        with self._lock:
            self._sessions.pop(key, None)
