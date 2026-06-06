"""Sandboxed execution of model-emitted verification code.

The draft model emits a short Python snippet that computes a question's answer
from the problem data and assigns it to a variable named RESULT. This module
runs that snippet in an isolated subprocess and returns the canonical printed
value.

Threat model: the code comes from our own model, not from users — the main
risks are accidents (infinite loops, runaway memory), so the defenses are
cheap and layered rather than bulletproof:

1. pre-flight size gate
2. AST static check (import allowlist, forbidden names, no dunder access)
3. subprocess with -I, empty env, its own process group, and rlimits
   (CPU, address space, file size, process count), SIGKILLed on timeout
"""
from __future__ import annotations

import ast
import logging
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Optional, Set

LOGGER = logging.getLogger('oxai.code_sandbox')

ALLOWED_IMPORT_ROOTS: Set[str] = {
    'math',
    'sympy',
    'fractions',
    'decimal',
    'itertools',
    'statistics',
    'cmath',
    'numbers',
}

FORBIDDEN_NAMES: Set[str] = {
    'open',
    'exec',
    'eval',
    'compile',
    '__import__',
    'input',
    'breakpoint',
    'globals',
    'locals',
    'vars',
    'getattr',
    'setattr',
    'delattr',
    'memoryview',
}

_MAX_OUTPUT_BYTES = 64 * 1024

# Runner executed via `python -I -c`. Reads the user code from stdin, execs it
# in a fresh namespace, then prints a canonical form of RESULT between
# sentinels so stray prints from the user code cannot be mistaken for it.
_RUNNER = r"""
import sys
code = sys.stdin.read()
ns = {}
exec(compile(code, '<verification>', 'exec'), ns)
if 'RESULT' not in ns:
    print('OXAI_NO_RESULT', file=sys.stderr)
    sys.exit(3)
value = ns['RESULT']
if isinstance(value, float) and value.is_integer():
    canonical = repr(int(value))
else:
    canonical = str(value)
print('OXAI_RESULT_BEGIN')
print(canonical)
print('OXAI_RESULT_END')
"""


@dataclass
class SandboxResult:
    ok: bool
    value: Optional[str]
    error: Optional[str]
    duration_s: float


def static_check(code: str) -> Optional[str]:
    """Return a rejection reason, or None if the code passes the AST gate."""
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return f'syntax error: {exc.msg} (line {exc.lineno})'

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split('.')[0]
                if root not in ALLOWED_IMPORT_ROOTS:
                    return f'forbidden import: {alias.name}'
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or '').split('.')[0]
            if root not in ALLOWED_IMPORT_ROOTS:
                return f'forbidden import: from {node.module}'
        elif isinstance(node, ast.Name):
            if node.id in FORBIDDEN_NAMES:
                return f'forbidden name: {node.id}'
            if node.id.startswith('__') and node.id.endswith('__'):
                return f'forbidden dunder name: {node.id}'
        elif isinstance(node, ast.Attribute):
            if node.attr in FORBIDDEN_NAMES:
                return f'forbidden attribute: {node.attr}'
            if node.attr.startswith('__') and node.attr.endswith('__'):
                return f'forbidden dunder attribute: {node.attr}'

    return None


def _make_preexec(cpu_s: int, max_mem_mb: int):
    """Build the child-process setup function. Kept minimal: only syscalls,
    since the parent may be multithreaded (FastAPI threadpool)."""
    import resource

    def preexec() -> None:
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s))
        mem = max_mem_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
        try:
            resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
        except (ValueError, OSError):
            pass  # may be below current usage on busy systems

    return preexec


def execute_verification_code(
    code: Optional[str],
    *,
    timeout_s: float = 5.0,
    max_mem_mb: int = 512,
    max_code_len: int = 4000,
) -> SandboxResult:
    start = time.monotonic()

    def fail(reason: str) -> SandboxResult:
        return SandboxResult(ok=False, value=None, error=reason, duration_s=time.monotonic() - start)

    if not code or not code.strip():
        return fail('no code provided')
    if len(code) > max_code_len:
        return fail(f'code too long ({len(code)} > {max_code_len} chars)')

    rejection = static_check(code)
    if rejection:
        return fail(f'static check: {rejection}')

    proc = subprocess.Popen(
        [sys.executable, '-I', '-c', _RUNNER],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={'PATH': '/usr/bin:/bin', 'PYTHONHASHSEED': '0'},
        preexec_fn=_make_preexec(int(timeout_s) + 1, max_mem_mb),
        text=True,
    )
    try:
        stdout, stderr = proc.communicate(input=code, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        proc.wait()
        return fail(f'timeout after {timeout_s}s')

    stdout = stdout[:_MAX_OUTPUT_BYTES]
    stderr = stderr[:_MAX_OUTPUT_BYTES]

    if proc.returncode != 0:
        if 'OXAI_NO_RESULT' in stderr:
            return fail('code did not assign RESULT')
        detail = stderr.strip().splitlines()[-1] if stderr.strip() else f'exit code {proc.returncode}'
        return fail(f'execution failed: {detail}')

    # Extract the canonical value between sentinels (stray prints ignored).
    lines = stdout.splitlines()
    try:
        begin = lines.index('OXAI_RESULT_BEGIN')
        end = lines.index('OXAI_RESULT_END')
    except ValueError:
        return fail('result sentinels missing from output')
    value = '\n'.join(lines[begin + 1 : end]).strip()
    if not value:
        return fail('empty RESULT')

    return SandboxResult(ok=True, value=value, error=None, duration_s=time.monotonic() - start)
