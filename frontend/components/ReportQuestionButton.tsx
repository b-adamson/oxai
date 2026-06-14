'use client';
import { useState } from 'react';

const ERROR_TITLES = [
  'Wrong answer key',
  'Bad LaTeX / formatting',
  'Wrong worked solution',
  'Incorrect question text',
  'Missing diagram / image',
  'Other',
];

interface Props {
  questionId: string;
  questionStem?: string;
  workedSolution?: string;
}

export function ReportQuestionButton({ questionId, questionStem, workedSolution }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(ERROR_TITLES[0]);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  async function submit() {
    setStatus('sending');
    try {
      const res = await fetch('/api/question-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: questionId,
          error_title: title,
          error_body: body || null,
          question_stem: questionStem ?? null,
          worked_solution: workedSolution ?? null,
        }),
      });
      setStatus(res.ok ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  }

  function reset() {
    setOpen(false);
    setTitle(ERROR_TITLES[0]);
    setBody('');
    setStatus('idle');
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1"
      >
        <span>⚑</span> Report error
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={reset}>
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6"
            onClick={e => e.stopPropagation()}
          >
            {status === 'done' ? (
              <div className="text-center py-4">
                <div className="text-3xl mb-3">✓</div>
                <p className="font-semibold text-gray-800 dark:text-white mb-1">Report submitted</p>
                <p className="text-sm text-gray-500 mb-6">Thanks — we'll look into it.</p>
                <button onClick={reset} className="text-sm text-accent font-semibold">Close</button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-bold text-gray-900 dark:text-white">Report an error</h2>
                  <button onClick={reset} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
                </div>
                <p className="text-xs text-gray-400 mb-4 font-mono truncate">
                  {questionId}
                </p>

                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1">
                  What's wrong?
                </label>
                <select
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {ERROR_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1">
                  Details (optional)
                </label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={3}
                  placeholder="Describe the issue..."
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 mb-5 resize-none focus:outline-none focus:ring-2 focus:ring-accent"
                />

                {status === 'error' && (
                  <p className="text-xs text-red-500 mb-3">Something went wrong — please try again.</p>
                )}

                <button
                  onClick={submit}
                  disabled={status === 'sending'}
                  className="w-full bg-accent hover:bg-accent-light disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
                >
                  {status === 'sending' ? 'Sending…' : 'Submit report'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
