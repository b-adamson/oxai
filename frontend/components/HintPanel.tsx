'use client';
import { useState } from 'react';
import { MathText } from './MathText';
import type { HintRecord, QuestionRecord } from '@/lib/types';
import { api } from '@/lib/api';

interface HintPanelProps {
  question: QuestionRecord;
  hints: HintRecord[];
  onHintAdded: (hint: HintRecord) => void;
}

export function HintPanel({ question, hints, onHintAdded }: HintPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextLevel = (hints.length + 1) as 1 | 2 | 3;
  const canRequestMore = hints.length < 3;

  async function requestHint() {
    if (!canRequestMore || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.getHint({
        stem: question.stem,
        options: question.options,
        subject: question.subject,
        topic: question.topic,
        level: nextLevel,
      });
      const hintRecord: HintRecord = {
        question_id: question.question_id,
        level: result.level as 1 | 2 | 3,
        hint: result.hint,
        generated_at: Date.now(),
      };
      onHintAdded(hintRecord);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get hint');
    } finally {
      setLoading(false);
    }
  }

  const levelLabels = ['', 'Concept nudge', 'Method hint', 'First step'];

  return (
    <div className="space-y-3">
      {hints.map((h) => (
        <div key={h.level} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">
            Hint {h.level} — {levelLabels[h.level]}
          </div>
          <MathText text={h.hint} className="text-sm text-gray-800 leading-relaxed" />
        </div>
      ))}

      {canRequestMore && (
        <button
          onClick={requestHint}
          disabled={loading}
          className="flex items-center gap-2 text-sm text-amber-700 hover:text-amber-900 border border-amber-300 hover:border-amber-400 px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <>
              <span className="animate-spin">⟳</span> Getting hint…
            </>
          ) : (
            <>
              💡 {hints.length === 0 ? 'Get a hint' : `Hint ${nextLevel} of 3`}
            </>
          )}
        </button>
      )}

      {hints.length === 3 && (
        <p className="text-xs text-gray-400 italic">All 3 hints revealed. Try the solution or ask the tutor.</p>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
