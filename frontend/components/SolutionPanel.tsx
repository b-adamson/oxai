'use client';
import { useEffect, useState } from 'react';
import { MathText } from './MathText';
import type { SolutionRecord, QuestionRecord } from '@/lib/types';
import { api } from '@/lib/api';

// ── Shared streaming display used by both this panel and the landing carousel ─
interface StreamingTextProps {
  text: string;
  className?: string;
}

type Seg = { type: 'text'; content: string } | { type: 'math'; content: string; display: boolean };

// Split visible text into plain-text and complete math segments.
// Incomplete $...$ (no closing delimiter yet) stays as plain text.
function parseSegments(text: string): Seg[] {
  const segs: Seg[] = [];
  let i = 0;
  let start = 0;

  while (i < text.length) {
    if (text[i] === '$') {
      const display = text[i + 1] === '$';
      const delim = display ? '$$' : '$';
      const from = i + delim.length;
      const close = text.indexOf(delim, from);
      if (close !== -1) {
        if (i > start) segs.push({ type: 'text', content: text.slice(start, i) });
        segs.push({ type: 'math', content: text.slice(from, close), display });
        i = close + delim.length;
        start = i;
        continue;
      }
    }
    i++;
  }

  if (start < text.length) segs.push({ type: 'text', content: text.slice(start) });
  return segs;
}

const CHARS_PER_TICK = 3;
const TICK_MS = 16;
const CHAR_FADE_MS = 4000;   // how long each char takes to fully fade in
const CHAR_STAGGER_MS = 400; // delay between consecutive char starts
const FADE_WINDOW = 20;     // how many trailing chars are in the fading zone

function inlineMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/gs, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

// Tracks texts that have already been fully streamed, so remounting skips animation
const _completedTexts = new Set<string>();

export function StreamingText({ text, className }: StreamingTextProps) {
  const key = text.slice(0, 120);
  const [count, setCount] = useState(() => _completedTexts.has(key) ? text.length : 0);

  useEffect(() => {
    if (_completedTexts.has(key)) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let cur = 0;
    const id = setInterval(() => {
      cur = Math.min(cur + CHARS_PER_TICK, text.length);
      setCount(cur);
      if (cur >= text.length) {
        _completedTexts.add(key);
        clearInterval(id);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [text, key]);

  const done = count >= text.length;
  // Stable = chars that have already passed through the fade window
  const fadeStart = done ? count : Math.max(0, count - FADE_WINDOW);
  const stableText = text.slice(0, fadeStart);
  const fadingChars = done ? [] : text.slice(fadeStart, count).split('');
  const stableSegs = parseSegments(stableText);
  const windowLen = fadingChars.length;

  return (
    <div className={className} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {stableSegs.map((seg, idx) => {
        if (seg.type === 'math') {
          const raw = seg.display ? `$$${seg.content}$$` : `$${seg.content}$`;
          return seg.display
            ? <MathText key={idx} text={raw} block />
            : <MathText key={idx} text={raw} />;
        }
        return <span key={idx} dangerouslySetInnerHTML={{ __html: inlineMarkdown(seg.content) }} />;
      })}
      {fadingChars.map((ch, i) => {
        // i=0 is oldest char in window, i=windowLen-1 is newest.
        // Use negative delay so older chars appear further into their fade.
        const elapsed = (windowLen - 1 - i) * CHAR_STAGGER_MS;
        return (
          <span
            key={fadeStart + i}
            style={{ animation: `fadeCharIn ${CHAR_FADE_MS}ms ease-out -${elapsed}ms both` }}
          >
            {ch}
          </span>
        );
      })}
      {!done && (
        <span style={{
          display: 'inline-block', width: '2px', height: '1em',
          background: 'currentColor', opacity: 0.6, marginLeft: '1px',
          verticalAlign: 'middle', animation: 'blink 1s step-start infinite',
        }} />
      )}
    </div>
  );
}

// ── Full solution panel (used in quick-fire / paper mode) ─────────────────

interface SolutionPanelProps {
  question: QuestionRecord;
  solution: SolutionRecord | undefined;
  revealed: boolean;
  onReveal: () => void;
  onSolutionGenerated: (sol: SolutionRecord) => void;
}

export function SolutionPanel({ question, solution, revealed, onSolutionGenerated }: SolutionPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (revealed && !solution && !loading) {
      fetchSolution();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  async function fetchSolution() {
    if (!question.answer_label) return;

    if (question.worked_solution) {
      const record: SolutionRecord = {
        question_id: question.question_id,
        worked_solution: question.worked_solution,
        final_answer_label: question.answer_label,
        requires_diagram: false,
        diagram_url: null,
        generated_at: Date.now(),
      };
      onSolutionGenerated(record);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await api.getSolution({
        question_id: question.question_id,
        stem: question.stem,
        options: question.options,
        subject: question.subject,
        topic: question.topic,
        subtopic: question.subtopic,
        verified_answer_label: question.answer_label,
        verified_answer_text: question.answer_text,
      });
      const record: SolutionRecord = {
        question_id: question.question_id,
        worked_solution: result.worked_solution,
        final_answer_label: result.final_answer_label,
        requires_diagram: result.requires_diagram,
        diagram_url: result.diagram_url,
        generated_at: Date.now(),
      };
      onSolutionGenerated(record);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate solution');
    } finally {
      setLoading(false);
    }
  }

  if (!revealed) return null;

  return (
    <div className="rounded-xl border border-accent/20 bg-accent/5 dark:bg-accent/10 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-accent/10 bg-accent/5 flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-accent">Worked Solution</span>
        {loading && <span className="w-1.5 h-3.5 bg-accent rounded-sm animate-pulse inline-block" />}
      </div>

      <div className="px-4 py-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="animate-spin inline-block text-accent">⟳</span>
            <span>Generating solution…</span>
          </div>
        )}

        {error && (
          <div className="space-y-2">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={fetchSolution} className="text-sm text-accent underline">
              Try again
            </button>
          </div>
        )}

        {solution && !loading && (
          <div className="space-y-3">
            <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              Answer: {solution.final_answer_label}
            </div>
            <StreamingText
              text={solution.worked_solution}
              className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed"
            />
            {solution.diagram_url && (
              <img
                src={solution.diagram_url}
                alt="Solution diagram"
                className="max-w-full max-h-64 rounded border border-accent/20 mt-2"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
