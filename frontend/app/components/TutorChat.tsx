"use client";

import { useEffect, useRef, useState } from "react";
import {
  appendChat,
  clearChat,
  ChatMessage,
  HintRecord,
  QuestionRecord,
  SolutionRecord,
} from "../lib/session";

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  questionId: string;
  question: QuestionRecord;
  hints: HintRecord[];
  solution: SolutionRecord | null;
  initialChat: ChatMessage[];
  mathJaxReady: boolean;
};

const RESPONSE_TYPE_LABEL: Record<string, string> = {
  hint: "Hint",
  explanation: "Explanation",
  walkthrough: "Walkthrough",
  redirect: "Off topic",
};

const RESPONSE_TYPE_COLOR: Record<string, string> = {
  hint: "bg-amber-100 text-amber-700",
  explanation: "bg-blue-100 text-blue-700",
  walkthrough: "bg-purple-100 text-purple-700",
  redirect: "bg-slate-100 text-slate-600",
};

// ── Minimal markdown+LaTeX → HTML ─────────────────────────────────────────────

function renderText(text: string): string {
  return text
    .split("\n\n")
    .map((block) => {
      const t = block.trim();
      if (!t) return "";
      if (t.startsWith("$$")) return `<div style="overflow-x:auto;margin:0.5rem 0;">${t}</div>`;
      const inline = t
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
      return `<p style="margin:0.35rem 0;">${inline}</p>`;
    })
    .join("");
}

// ── TutorMessage — renders one message, runs MathJax when ready ───────────────

function TutorMessage({
  msg,
  mathJaxReady,
}: {
  msg: ChatMessage;
  mathJaxReady: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isUser = msg.role === "user";

  useEffect(() => {
    if (isUser || !ref.current) return;
    ref.current.innerHTML = renderText(msg.text);
    if (!mathJaxReady) return;
    const mj = (window as any).MathJax;
    if (mj?.typesetPromise) {
      mj.typesetPromise([ref.current]).catch((e: unknown) =>
        console.error("MathJax error in tutor chat:", e)
      );
    }
  }, [msg.text, mathJaxReady, isUser]);

  if (isUser) {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2.5 text-sm text-white leading-relaxed">
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%]">
        {msg.response_type && (
          <span
            className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              RESPONSE_TYPE_COLOR[msg.response_type] ?? "bg-slate-100 text-slate-600"
            }`}
          >
            {RESPONSE_TYPE_LABEL[msg.response_type] ?? msg.response_type}
          </span>
        )}
        <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 leading-relaxed">
          <div ref={ref}>{msg.text}</div>
        </div>
      </div>
    </div>
  );
}

// ── TutorChat ─────────────────────────────────────────────────────────────────

export function TutorChat({
  questionId,
  question,
  hints,
  solution,
  initialChat,
  mathJaxReady,
}: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(initialChat);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sync initialChat when question changes
  useEffect(() => {
    setMessages(initialChat);
    setInput("");
    setError("");
  }, [questionId]);

  // Scroll to bottom on new message
  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      timestamp: Date.now(),
    };

    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    setError("");
    appendChat(questionId, userMsg);

    try {
      const res = await fetch("/api/ask-tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stem: question.prompt?.stem ?? "",
          options: question.prompt?.options ?? [],
          subject: question.content?.subject ?? "math",
          topic: question.content?.topic ?? null,
          subtopic: question.content?.subtopic ?? null,
          difficulty: question.content?.difficulty ?? null,
          chat_history: next.map((m) => ({ role: m.role, text: m.text })),
          solution_available: !!solution,
          worked_solution: solution?.worked_solution ?? null,
          hints_shown: hints.length,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Tutor error (${res.status})`);
      }

      const data = await res.json();
      const tutorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "tutor",
        text: data.response,
        response_type: data.response_type,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, tutorMsg]);
      appendChat(questionId, tutorMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function handleClear() {
    setMessages([]);
    clearChat(questionId);
  }

  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <button
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Ask Tutor</span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
          {/* Message list */}
          <div className="h-80 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <p className="text-center text-xs text-slate-400 mt-8">
                Ask anything about this question. The tutor won't reveal the answer.
              </p>
            )}
            {messages.map((msg) => (
              <TutorMessage key={msg.id} msg={msg} mathJaxReady={mathJaxReady} />
            ))}
            {loading && (
              <div className="flex justify-start mb-3">
                <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-400">
                  Thinking…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Error */}
          {error && (
            <p className="px-4 pb-2 text-xs text-red-500">{error}</p>
          )}

          {/* Input */}
          <div className="border-t border-slate-200 bg-white px-3 py-2 flex gap-2 items-end">
            <textarea
              ref={inputRef}
              rows={2}
              className="flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <div className="flex flex-col gap-1">
              <button
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:bg-blue-700"
                onClick={send}
                disabled={loading || !input.trim()}
              >
                Send
              </button>
              {messages.length > 0 && (
                <button
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
                  onClick={handleClear}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
