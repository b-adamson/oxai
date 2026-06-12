"""Match a computed verification value against multiple-choice option texts.

Tiered strategy (cheapest first), run against all five options. Exactly one
option must match — zero matches may fall through to an injectable LLM
fallback; multiple matches always fail hard (a question with two equal
options is broken, and guessing could bless a wrong answer).

T0  normalized exact string compare
T1  numeric parse with relative tolerance (units stripped, sci notation,
    simple fractions)
T2  sympy symbolic equivalence (surds, pi, exact forms)
T3  optional LLM fallback (zero T0-T2 matches only)
"""
from __future__ import annotations

import logging
import math
import re
import unicodedata
from dataclasses import dataclass
from fractions import Fraction
from typing import Callable, Dict, List, Optional

LOGGER = logging.getLogger('oxai.answer_match')

_MAX_SYMPY_INPUT_LEN = 200

# value + five option texts -> option label ('A'..'E') or None
LlmFallback = Callable[[str, List[Dict[str, str]]], Optional[str]]


@dataclass
class MatchResult:
    matched_label: Optional[str]
    tier: str  # 'exact' | 'numeric' | 'symbolic' | 'llm' | 'none' | 'ambiguous'
    details: str


def _normalize(text: str) -> str:
    text = unicodedata.normalize('NFKC', text)
    # LaTeX cleanup — option texts are often "$27$", "\(27\)", "\frac{3}{4}",
    # "27 \text{ cm}" etc. Reduce to plain math before comparing.
    text = re.sub(r'\\text\s*\{([^}]*)\}', r' \1 ', text)
    text = re.sub(r'\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}', r'((\1)/(\2))', text)
    text = re.sub(r'\\sqrt\s*\{([^}]*)\}', r'sqrt(\1)', text)
    text = (
        text.replace('\\pi', 'pi')
        .replace('\\times', '*')
        .replace('\\cdot', '*')
        .replace('\\,', ' ')
        .replace('\\;', ' ')
    )
    text = re.sub(r'\\\(|\\\)|\\\[|\\\]|\$', '', text)
    text = (
        text.replace('−', '-')  # unicode minus
        .replace('×', '*')  # ×
        .replace('·', '*')  # ·
        .replace('√', 'sqrt')  # √
        .replace('π', 'pi')  # π
    )
    return ' '.join(text.lower().split())


_SCI_RE = re.compile(r'(?P<m>[-+]?\d+(?:\.\d+)?)\s*\*?\s*10\s*(?:\^|\*\*)\s*(?P<e>[-+]?\d+)')
# trailing unit-ish run: letters, slashes, exponents — e.g. " J", " m/s^2",
# " kJ mol^-1". Negative lookahead keeps an exponent like "2.5e3" intact.
_TRAILING_UNITS_RE = re.compile(r'\s*(?![eE]\d)[a-zA-Z][a-zA-Z0-9/^*\-\s]*$')


def _parse_number(text: str) -> Optional[float]:
    """Best-effort numeric parse of an option/computed text. None if non-numeric."""
    s = _normalize(text)
    s = s.replace(',', '')  # thousands separators
    # symbolic expressions are not numbers-with-units — leave them to sympy
    if 'sqrt' in s or re.search(r'\bpi\b', s):
        return None
    # scientific notation written as m * 10^e
    s = _SCI_RE.sub(lambda m: f"{m.group('m')}e{m.group('e')}", s)
    stripped = _TRAILING_UNITS_RE.sub('', s).strip()
    if stripped:
        s = stripped
    try:
        return float(s)
    except ValueError:
        pass
    # simple fraction a/b
    m = re.fullmatch(r'([-+]?\d+)\s*/\s*(\d+)', s)
    if m:
        try:
            return float(Fraction(int(m.group(1)), int(m.group(2))))
        except (ValueError, ZeroDivisionError):
            return None
    return None


def _sympy_parse(text: str):
    """Parse text into a sympy expression, or None."""
    if len(text) > _MAX_SYMPY_INPUT_LEN:
        return None
    try:
        import sympy
        from sympy.core.sympify import SympifyError

        s = _normalize(text)
        s = s.replace('^', '**')
        # "√3" normalized to "sqrt3" — parenthesize the argument
        s = re.sub(r'sqrt\s*(\d+(?:\.\d+)?)', r'sqrt(\1)', s)
        # implicit multiplication for the common surd form "2sqrt(3)"
        s = re.sub(r'(\d)\s*(sqrt|pi)\b', r'\1*\2', s)
        expr = sympy.sympify(s, evaluate=True)
        if expr.free_symbols:
            return None  # an unresolved variable means it wasn't a value
        return expr
    except (SympifyError, SyntaxError, TypeError, ValueError, AttributeError):
        return None


def _symbolically_equal(a, b) -> bool:
    try:
        result = a.equals(b)
        if result is True:
            return True
        diff = (a - b).simplify()
        return diff == 0
    except Exception:
        return False


def match_value_to_options(
    computed: str,
    options: List[Dict[str, str]],
    *,
    rel_tol: float = 1e-3,
    llm_fallback: Optional[LlmFallback] = None,
) -> MatchResult:
    computed_norm = _normalize(computed)
    computed_num = _parse_number(computed)
    computed_sym = None  # parsed lazily

    matches: List[tuple] = []  # (label, tier)

    for opt in options:
        label = str(opt.get('label', ''))
        text = str(opt.get('text', ''))

        if _normalize(text) == computed_norm:
            matches.append((label, 'exact'))
            continue

        opt_num = _parse_number(text)
        if computed_num is not None and opt_num is not None:
            if math.isclose(computed_num, opt_num, rel_tol=rel_tol, abs_tol=1e-9):
                matches.append((label, 'numeric'))
            continue  # both numeric but unequal — no point trying sympy

        if computed_sym is None:
            computed_sym = _sympy_parse(computed)
        if computed_sym is not None:
            opt_sym = _sympy_parse(text)
            if opt_sym is not None and _symbolically_equal(computed_sym, opt_sym):
                matches.append((label, 'symbolic'))

    if len(matches) == 1:
        label, tier = matches[0]
        return MatchResult(matched_label=label, tier=tier, details=f'computed={computed!r}')

    if len(matches) > 1:
        labels = ', '.join(l for l, _ in matches)
        return MatchResult(
            matched_label=None,
            tier='ambiguous',
            details=f'computed={computed!r} matched multiple options: {labels}',
        )

    # Zero matches — optional LLM fallback (never used for ambiguity).
    if llm_fallback is not None:
        try:
            label = llm_fallback(computed, options)
        except Exception as exc:
            LOGGER.warning('LLM match fallback failed: %s', exc)
            label = None
        if label:
            return MatchResult(matched_label=label, tier='llm', details=f'computed={computed!r}')

    return MatchResult(matched_label=None, tier='none', details=f'computed={computed!r} matched no option')
