'use client';
import { useEffect, useState } from 'react';
import { MathText } from './MathText';
import type { SolutionRecord, QuestionRecord } from '@/lib/types';
import { api } from '@/lib/api';

interface SolutionPanelProps {
  question: QuestionRecord;
  solution: SolutionRecord | undefined;
  revealed: boolean;
  onReveal: () => void;
  onSolutionGenerated: (sol: SolutionRecord) => void;
}

export function SolutionPanel({ question, solution, revealed, onReveal, onSolutionGenerated }: SolutionPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fetch when revealed externally (e.g. via action bar) before fetchSolution is called
  useEffect(() => {
    if (revealed && !solution && !loading) {
      fetchSolution();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  async function handleReveal() {
    onReveal();
    if (!solution && !loading) {
      await fetchSolution();
    }
  }

  async function fetchSolution() {
    if (!question.answer_label) return;
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

  if (!revealed) {
    return (
      <button
        onClick={handleReveal}
        className="flex items-center gap-2 text-sm text-indigo-700 hover:text-indigo-900 border border-indigo-300 hover:border-indigo-400 px-3 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 transition-colors"
      >
        📋 Reveal worked solution
      </button>
    );
  }

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
      <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">
        Worked Solution
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="animate-spin inline-block">⟳</span> Generating solution…
        </div>
      )}

      {error && (
        <div className="space-y-2">
          <p className="text-sm text-red-500">{error}</p>
          <button onClick={fetchSolution} className="text-sm text-indigo-600 underline">
            Try again
          </button>
        </div>
      )}

      {solution && !loading && (
        <div className="space-y-3">
          <div className="text-sm text-emerald-700 font-semibold">
            Answer: {solution.final_answer_label}
          </div>
          <MathText
            text={solution.worked_solution}
            block
            className="text-sm text-gray-800 leading-relaxed prose prose-sm max-w-none"
          />
          {solution.diagram_url && (
            <img
              src={solution.diagram_url}
              alt="Solution diagram"
              className="max-w-full max-h-64 rounded border border-indigo-200 mt-2"
            />
          )}
        </div>
      )}
    </div>
  );
}
