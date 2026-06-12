'use client';
import { useState, useRef, useEffect } from 'react';
import { MathText } from './MathText';
import { StreamingText } from './SolutionPanel';
import type { TutorAnnotation, TutorChatMessage, QuestionRecord, HintRecord, SolutionRecord } from '@/lib/types';
import { api } from '@/lib/api';

interface TutorChatProps {
  question: QuestionRecord;
  messages: TutorChatMessage[];
  hints: HintRecord[];
  solution: SolutionRecord | undefined;
  onMessage: (msg: TutorChatMessage) => void;
  whiteboardEnabled?: boolean;
  getWhiteboardSnapshot?: () => string | null;
  whiteboardStrokeCount?: number;
  onAnnotations?: (annotations: TutorAnnotation[]) => void;
}

export function TutorChat({
  question,
  messages,
  hints,
  solution,
  onMessage,
  whiteboardEnabled = false,
  getWhiteboardSnapshot,
  whiteboardStrokeCount = 0,
  onAnnotations,
}: TutorChatProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boardContextOn, setBoardContextOn] = useState(true);
  const [streamingIdx, setStreamingIdx] = useState<number | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(messages.length);

  useEffect(() => {
    if (messages.length > prevLengthRef.current && messagesContainerRef.current) {
      const el = messagesContainerRef.current;
      el.scrollTop = el.scrollHeight;
      // find the newly arrived tutor message (search from the end)
      for (let i = messages.length - 1; i >= prevLengthRef.current; i--) {
        if (messages[i].role === 'tutor') { setStreamingIdx(i); break; }
      }
    }
    prevLengthRef.current = messages.length;
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg: TutorChatMessage = { role: 'user', text, timestamp: Date.now() };
    onMessage(userMsg);
    setLoading(true);
    setError(null);

    // Only share board context when the checkbox is on AND there's actual drawing
    const sendBoard = boardContextOn && whiteboardEnabled && whiteboardStrokeCount > 0;
    const snapshot = sendBoard && getWhiteboardSnapshot ? getWhiteboardSnapshot() : null;

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
        ...(sendBoard && {
          whiteboard_enabled: true,
          whiteboard_snapshot: snapshot,
          whiteboard_stroke_count: whiteboardStrokeCount,
        }),
      });

      const tutorMsg: TutorChatMessage = {
        role: 'tutor',
        text: result.response,
        response_type: result.response_type as TutorChatMessage['response_type'],
        timestamp: Date.now(),
      };
      onMessage(tutorMsg);

      if (result.annotations && result.annotations.length > 0 && onAnnotations) {
        onAnnotations(result.annotations);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tutor unavailable');
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const typeIcon: Record<string, string> = {
    hint: '&#128161;',
    explanation: '&#128214;',
    walkthrough: '&#128221;',
    redirect: '&#8617;',
  };

  const sendBoardContext = boardContextOn && whiteboardEnabled && whiteboardStrokeCount > 0;

  return (
    <div className="flex flex-col bg-slate-50 dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-slate-100 dark:bg-gray-800 border-b border-slate-200 dark:border-gray-700 flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-600 dark:text-gray-400 uppercase tracking-wide">
          Ask the Tutor
        </span>
        {whiteboardEnabled && (
          <label className="flex items-center gap-1.5 ml-auto cursor-pointer select-none">
            <input
              type="checkbox"
              checked={boardContextOn}
              onChange={(e) => setBoardContextOn(e.target.checked)}
              className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
            />
            <span className={`text-xs font-medium ${boardContextOn ? 'text-amber-700 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
              Board context {boardContextOn ? 'on' : 'off'}
            </span>
          </label>
        )}
      </div>

      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-3 space-y-3 max-h-80 min-h-24">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 italic text-center mt-4">
            {whiteboardEnabled
              ? sendBoardContext
                ? 'Your whiteboard will be shared with each message.'
                : 'Ask any question — enable board context to share your working.'
              : "Ask any question about this problem. The tutor won't reveal the answer directly."}
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-accent text-white'
                  : 'bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 text-gray-800 dark:text-gray-100'
              }`}
            >
              {msg.role === 'tutor' && msg.response_type && (
                <div
                  className="text-xs text-slate-400 dark:text-gray-500 mb-1"
                  dangerouslySetInnerHTML={{ __html: `${typeIcon[msg.response_type] ?? '&#129302;'} ${msg.response_type}` }}
                />
              )}
              {msg.role === 'tutor' && i === streamingIdx ? (
                <StreamingText text={msg.text} className="leading-relaxed" />
              ) : (
                <MathText text={msg.text} className="leading-relaxed" />
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
              <span className="animate-pulse">
                {sendBoardContext ? 'Reading whiteboard…' : 'Thinking…'}
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="px-3 py-1 text-xs text-red-500 bg-red-50 dark:bg-red-950/20 border-t border-red-100 dark:border-red-900">
          {error}
        </div>
      )}

      <div className="flex gap-2 p-2 border-t border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={
            whiteboardEnabled && sendBoardContext
              ? 'Ask about this problem or your working… (Enter to send)'
              : 'Ask about this question… (Enter to send)'
          }
          rows={2}
          className="flex-1 text-sm border border-slate-300 dark:border-gray-600 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-accent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 bg-white dark:bg-gray-800"
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
