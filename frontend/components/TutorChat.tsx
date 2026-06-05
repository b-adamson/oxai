'use client';
import { useState, useRef, useEffect } from 'react';
import { MathText } from './MathText';
import type { TutorChatMessage, QuestionRecord, HintRecord, SolutionRecord } from '@/lib/types';
import { api } from '@/lib/api';

interface TutorChatProps {
  question: QuestionRecord;
  messages: TutorChatMessage[];
  hints: HintRecord[];
  solution: SolutionRecord | undefined;
  onMessage: (msg: TutorChatMessage) => void;
}

export function TutorChat({ question, messages, hints, solution, onMessage }: TutorChatProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg: TutorChatMessage = { role: 'user', text, timestamp: Date.now() };
    onMessage(userMsg);
    setLoading(true);
    setError(null);

    try {
      const result = await api.askTutor({
        stem: question.stem,
        options: question.options,
        subject: question.subject,
        topic: question.topic,
        subtopic: question.subtopic,
        difficulty: question.difficulty,
        chat_history: [...messages, userMsg].map((m) => ({ role: m.role, text: m.text })),
        solution_available: Boolean(solution),
        worked_solution: solution?.worked_solution ?? null,
        hints_shown: hints.length,
      });
      const tutorMsg: TutorChatMessage = {
        role: 'tutor',
        text: result.response,
        response_type: result.response_type as TutorChatMessage['response_type'],
        timestamp: Date.now(),
      };
      onMessage(tutorMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tutor unavailable');
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const typeIcon: Record<string, string> = {
    hint: '💡',
    explanation: '📖',
    walkthrough: '🔍',
    redirect: '↩',
  };

  return (
    <div className="flex flex-col bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-slate-100 border-b border-slate-200">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Ask the Tutor
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 max-h-80 min-h-24">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 italic text-center mt-4">
            Ask any question about this problem. The tutor won't reveal the answer directly.
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-accent text-white'
                  : 'bg-white border border-slate-200 text-gray-800'
              }`}
            >
              {msg.role === 'tutor' && msg.response_type && (
                <div className="text-xs text-slate-400 mb-1">
                  {typeIcon[msg.response_type] ?? '🤖'} {msg.response_type}
                </div>
              )}
              <MathText text={msg.text} className="leading-relaxed" />
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-400">
              <span className="animate-pulse">Thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="px-3 py-1 text-xs text-red-500 bg-red-50 border-t border-red-100">{error}</div>}

      <div className="flex gap-2 p-2 border-t border-slate-200 bg-white">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask about this question… (Enter to send)"
          rows={2}
          className="flex-1 text-sm border border-slate-300 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          className="self-end px-3 py-1.5 bg-accent text-white text-sm rounded hover:bg-accent-light disabled:opacity-40 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
