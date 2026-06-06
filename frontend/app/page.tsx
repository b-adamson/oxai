"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { TutorChat } from "@/components/TutorChat";
import { useStore, normaliseQuestion } from "@/lib/store";
import { migrateLegacySessions } from "@/lib/migrateLegacy";
import type {
  HintRecord,
  QuestionRecord,
  SolutionRecord,
  TutorChatMessage,
} from "@/lib/types";

type Mode = "training" | "generated";

type PaperMeta = {
  id: string;
  exam: string;
  year: number;
  paper: string;
  count: number;
  file: string;
};


type Question = {
  question_id?: string;
  source?: { section?: string; question_number?: number; page?: number };
  content?: {
    subject?: string;
    topic?: string;
    subtopic?: string;
    archetype?: string;
    difficulty?: number;
    requires_diagram?: boolean;
  };
  prompt?: {
    stem?: string;
    options?: { label: string; text: string }[];
    figures?: { figure_id?: string; type?: string; src?: string; kind?: string; caption?: string }[];
  };
  validation?: {
    answer_label?: string;
    answer_text?: string;
  };
  metadata?: {
    diagram_url?: string | null;
    diagram_required?: boolean;
    tags?: string[];
    estimated_time_seconds?: number | null;
  };
};

type PaperResponse = {
  paper: {
    source?: string;
    questions: Question[];
  };
  meta?: PaperMeta;
};

type QuestionSet = {
  questions: Question[];
  sourceLabel: string;
};

// ── Store adapters ───────────────────────────────────────────────────────────
// This page renders the raw backend question shape (nested prompt/content/…),
// while the Zustand store persists the flattened QuestionRecord used by the
// quick/paper pages. These helpers convert between the two.

function recordToQuestion(rec: QuestionRecord): Question {
  return {
    question_id: rec.question_id,
    source: rec.paper_source
      ? {
          section: rec.paper_source.section,
          question_number: rec.paper_source.question_number,
        }
      : undefined,
    content: {
      subject: rec.subject,
      topic: rec.topic ?? undefined,
      subtopic: rec.subtopic ?? undefined,
      archetype: rec.archetype ?? undefined,
      difficulty: rec.difficulty,
    },
    prompt: {
      stem: rec.stem,
      options: rec.options,
      figures: rec.figures as unknown as NonNullable<Question["prompt"]>["figures"],
    },
    validation: {
      answer_label: rec.answer_label ?? undefined,
      answer_text: rec.answer_text ?? undefined,
    },
    metadata: { diagram_url: rec.diagram_url },
  };
}

/** Add a raw question to the store if it isn't there yet. Returns its id, or null if it has none. */
function ensureQuestionStored(q: Question | undefined): string | null {
  const qid = q?.question_id;
  if (!q || !qid) return null;
  const store = useStore.getState();
  if (!store.getQuestion(qid)) {
    const sourceType = q.source && "year" in q.source ? "bank" : "fresh_ai";
    const rec = normaliseQuestion(q as Record<string, unknown>, null, sourceType);
    rec.question_id = qid;
    store.addQuestion(rec);
  }
  return qid;
}

function listRecentGenerated(limit = 10): Question[] {
  return Object.values(useStore.getState().questions)
    .filter((q) => q.source_type === "fresh_ai")
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map(recordToQuestion);
}

function normalizeSubject(subject?: string) {
  const s = String(subject || "").toLowerCase();
  if (s.startsWith("math")) return "math";
  if (s.startsWith("phys")) return "physics";
  if (s.startsWith("chem")) return "chemistry";
  if (s.startsWith("bio")) return "biology";
  return s || "math";
}

function sectionOf(q: Question) {
  return q.source?.section || "A";
}

function questionNumber(q: Question, fallback: number) {
  return q.source?.question_number ?? fallback + 1;
}

function stemToHtml(stem?: string) {
  if (!stem) return "<p><em>No stem available.</em></p>";

  return stem
    .split("\n\n")
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("|")) {
        return mdTableToHtml(trimmed);
      }
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

function mdTableToHtml(block: string) {
  const rows = block.trim().split("\n").filter(Boolean);
  if (rows.length < 2) return `<p>${block}</p>`;

  const header = rows[0]
    .split("|")
    .map((c) => c.trim())
    .filter(Boolean);

  const body = rows.slice(2).map((r) =>
    r
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean)
  );

  const ths = header.map((h) => `<th>${h}</th>`).join("");
  const trs = body
    .map(
      (row) =>
        "<tr>" + row.map((c) => `<td>${c}</td>`).join("") + "</tr>"
    )
    .join("");

  return `<table class="md-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function solutionToHtml(text: string): string {
  return text
    .split("\n\n")
    .map((block) => {
      const t = block.trim();
      if (!t) return "";
      if (t.startsWith("$$")) return `<div class="math-block">${t}</div>`;
      if (t.startsWith("|")) return mdTableToHtml(t);
      // bold **text**
      const inline = t
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
      return `<p>${inline}</p>`;
    })
    .join("");
}

function SolutionBody({
  text,
  diagramUrl,
  mathJaxReady,
}: {
  text: string;
  diagramUrl: string | null;
  mathJaxReady: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = solutionToHtml(text);
    if (!mathJaxReady) return;
    const mj = (window as any).MathJax;
    if (mj?.typesetPromise) {
      mj.typesetPromise([ref.current]).catch((err: unknown) =>
        console.error("MathJax typeset failed:", err)
      );
    }
  }, [text, mathJaxReady]);

  return (
    <div>
      <div
        ref={ref}
        className="prose prose-slate max-w-none text-sm leading-relaxed"
      />
      {diagramUrl && (
        <img
          src={diagramUrl}
          alt="Solution diagram"
          className="mt-4 max-w-full rounded-lg border border-slate-200"
        />
      )}
    </div>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("generated");
  const [papers, setPapers] = useState<PaperMeta[]>([]);
  const [paperId, setPaperId] = useState("");
  const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);
  const [selectedSection, setSelectedSection] = useState("A");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [papersLoading, setPapersLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadLabel, setUploadLabel] = useState("");
  const [genSubject, setGenSubject] = useState("physics");
  const [genTopic, setGenTopic] = useState("");
  const [genDifficulty, setGenDifficulty] = useState(2);
  const [genForceDiagram, setGenForceDiagram] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [hints, setHints] = useState<HintRecord[]>([]);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintError, setHintError] = useState("");
  const [solution, setSolution] = useState<SolutionRecord | null>(null);
  const [solutionLoading, setSolutionLoading] = useState(false);
  const [solutionError, setSolutionError] = useState("");
  const [sessionChat, setSessionChat] = useState<TutorChatMessage[]>([]);
  const [recentSessions, setRecentSessions] = useState<Question[]>([]);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [genArchetype, setGenArchetype] = useState("");

  const contentRef = useRef<HTMLDivElement | null>(null);
  const [mathJaxReady, setMathJaxReady] = useState(false);

  const questions = questionSet?.questions || [];

  const sectionQuestions = useMemo(() => {
    if (questions.length === 1 && questions[0]?.question_id) return questions;
    return questions.filter((q) => sectionOf(q) === selectedSection);
  }, [questions, selectedSection]);

  const currentQuestion = sectionQuestions[selectedIndex];

  useEffect(() => {
    async function loadPapers() {
      try {
        setPapersLoading(true);
        const res = await fetch("/api/papers", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to load paper list.");

        const data = await res.json();
        const list: PaperMeta[] = data.papers || [];
        setPapers(list);

        const first = list[0];
        if (first) setPaperId(first.id);
      } catch {
        setError("Could not load paper list.");
      } finally {
        setPapersLoading(false);
      }
    }

    loadPapers();
  }, []);

  // Migrate any legacy localStorage sessions, then restore recents from the store
  useEffect(() => {
    migrateLegacySessions();
    const recents = listRecentGenerated();
    setRecentSessions(recents);
    if (recents.length > 0 && mode === "generated") {
      const latest = recents[0];
      setQuestionSet({ questions: [latest], sourceLabel: "Generated" });
      setSelectedSection(latest.source?.section || "A");
      setSelectedIndex(0);
      setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadTrainingPaper() {
      if (!paperId || mode !== "training") return;

      try {
        setContentLoading(true);
        setError("");

        const res = await fetch(`/api/papers/${paperId}`, {
          cache: "no-store",
        });

        if (!res.ok) throw new Error("Failed to load paper");

        const data: PaperResponse = await res.json();
        const questions = data.paper?.questions || [];

        setQuestionSet({
          questions,
          sourceLabel:
            data.paper?.source ||
            data.meta
              ? `${data.meta?.exam ?? "Paper"} ${data.meta?.year ?? ""} ${
                  data.meta?.paper ? `— Paper ${data.meta.paper}` : ""
                }`.trim()
              : `Paper ${paperId}`,
        });

        setSelectedSection(questions[0]?.source?.section || "A");
        setSelectedIndex(0);
      } catch {
        setError("Could not load the selected paper.");
      } finally {
        setContentLoading(false);
      }
    }

    loadTrainingPaper();
  }, [paperId, mode]);

  useEffect(() => {
    if (mode === "generated") {
      setQuestionSet(null);
      setError("");
      setUploadLabel("");
      setContentLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    if (selectedIndex >= sectionQuestions.length && sectionQuestions.length > 0) {
      setSelectedIndex(0);
    }
  }, [sectionQuestions, selectedIndex]);

  useEffect(() => {
    const q = sectionQuestions[selectedIndex];
    if (!q) return;

    const content = document.getElementById("question-content");
    if (content) content.scrollTop = 0;
  }, [selectedIndex, selectedSection, sectionQuestions]);

  const currentQuestionKey =
    currentQuestion?.question_id ?? `${selectedSection}-${selectedIndex}`;

  // Flattened view of the current question for the shared TutorChat component
  const tutorQuestion = useMemo(
    () =>
      currentQuestion
        ? normaliseQuestion(currentQuestion as Record<string, unknown>, null, "fresh_ai")
        : null,
    [currentQuestion]
  );

  useEffect(() => {
    const qid = currentQuestion?.question_id;
    if (qid) {
      const store = useStore.getState();
      setHints(store.getHints(qid));
      setSolution(store.getSolution(qid) ?? null);
      setSessionChat(store.getTutorThread(qid));
    } else {
      setHints([]);
      setSolution(null);
      setSessionChat([]);
    }
    setHintError("");
    setSolutionError("");
    setTutorOpen(false);
  }, [currentQuestionKey]);

  useEffect(() => {
    if (!contentRef.current || !currentQuestion) return;

    // Set innerHTML manually so React never touches this div during re-renders
    contentRef.current.innerHTML = renderQuestion(currentQuestion, selectedIndex);

    if (!mathJaxReady) return;

    const mj = (window as any).MathJax;
    if (mj?.typesetPromise) {
      mj.typesetPromise([contentRef.current]).catch((err: unknown) => {
        console.error("MathJax typeset failed:", err);
      });
    }
  }, [currentQuestionKey, mathJaxReady]);

  function renderQuestion(q: Question, idx: number) {
    const subject = normalizeSubject(q.content?.subject);
    const stars = "★".repeat(q.content?.difficulty || 0).padEnd(5, "☆");

    const optionsHtml =
      q.prompt?.options
        ?.map(
          (opt) => `
            <div style="display:flex;align-items:flex-start;gap:0.85rem;margin-bottom:0.75rem;">
              <div style="width:2rem;height:2rem;flex:0 0 2rem;border-radius:999px;display:flex;align-items:center;justify-content:center;font-weight:800;background:#dbeafe;color:#1e3a8a;margin-top:0.7rem;">${opt.label}</div>
              <div style="flex:1;line-height:1.7;border:1px solid #e2e8f0;border-radius:1rem;background:#fff;padding:0.9rem 1rem;">${opt.text}</div>
            </div>
          `
        )
        .join("") || "";

    const diagramUrl = q.metadata?.diagram_url
      ? q.metadata.diagram_url.replace(/^\/diagrams\//, "/api/diagrams/")
      : null;

    const figuresHtml = diagramUrl
      ? `<div class="figure-box"><img src="${diagramUrl}" alt="Question diagram" style="max-width:100%;border-radius:0.5rem;" /></div>`
      : q.prompt?.figures
          ?.map((fig) => {
            if (fig.src) {
              return `
                <div class="figure-box">
                  <div class="figure-label">${fig.type || fig.kind || "Figure"} — ${fig.figure_id || fig.caption || ""}</div>
                  <img src="${fig.src}" alt="${fig.figure_id || "figure"}" />
                </div>
              `;
            }
            if (fig.caption || fig.kind) {
              return `
                <div class="figure-box">
                  <div class="figure-label">${fig.type || fig.kind || "Figure"}${fig.caption ? ` — ${fig.caption}` : ""}</div>
                  <div class="figure-placeholder-text">Image not available</div>
                </div>
              `;
            }
            return "";
          })
          .join("") || "";

    const validationText = q.validation?.answer_label
      ? `${q.validation.answer_label}${
          q.validation.answer_text ? ` ${q.validation.answer_text}` : ""
        }`
      : "Unverified";

    return `
      <div class="q-header">
        <div class="q-id-badge">${q.question_id || `Question ${idx + 1}`}</div>
        <div class="q-subject-pill subject-${subject}">${subject}</div>
        <div class="q-difficulty">Difficulty: <span>${stars}</span></div>
      </div>

      <div class="stem">${stemToHtml(q.prompt?.stem)}</div>
      ${figuresHtml}

      <div class="options-label">Answer options</div>
      <div class="options-grid">${optionsHtml}</div>

      <div class="q-footer">
        <div class="meta-item"><strong>Subject:</strong> ${
          q.content?.subject || ""
        }</div>
        <div class="meta-item"><strong>Topic:</strong> ${
          q.content?.topic || ""
        }</div>
        <div class="meta-item"><strong>Subtopic:</strong> ${
          q.content?.subtopic || ""
        }</div>
        <div class="meta-item"><strong>Archetype:</strong> ${
          q.content?.archetype || ""
        }</div>
        <div class="meta-item"><strong>Solution:</strong> ${validationText}</div>
      </div>
    `;
  }

  async function handleGenerate() {
    try {
      setGenerating(true);
      setGenerateError("");
      setError("");

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: genSubject,
          topic: genTopic || null,
          archetype: genArchetype || null,
          difficulty: genDifficulty,
          want_diagram: genForceDiagram,
          force_diagram: genForceDiagram,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Generation failed (${res.status})`);
      }

      const question = await res.json();

      if (question.question_id) {
        useStore.getState().addQuestion(normaliseQuestion(question, null, "fresh_ai"));
        setRecentSessions(listRecentGenerated());
      }

      setQuestionSet({
        questions: [question],
        sourceLabel: "Generated",
      });
      setSelectedSection(question.source?.section || "A");
      setSelectedIndex(0);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleHint() {
    if (!currentQuestion) return;
    const nextLevel = hints.length + 1;
    if (nextLevel > 3) return;

    try {
      setHintLoading(true);
      setHintError("");

      const res = await fetch("/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stem: currentQuestion.prompt?.stem ?? "",
          options: currentQuestion.prompt?.options ?? [],
          subject: currentQuestion.content?.subject ?? "math",
          topic: currentQuestion.content?.topic ?? null,
          level: nextLevel,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Hint failed (${res.status})`);
      }

      const data = await res.json();
      const qid = ensureQuestionStored(currentQuestion);
      const hint: HintRecord = {
        question_id: qid ?? currentQuestionKey,
        level: data.level,
        hint: data.hint,
        generated_at: Date.now(),
      };
      setHints([...hints, hint]);
      if (qid) useStore.getState().addHint(hint);
    } catch (err) {
      setHintError(err instanceof Error ? err.message : "Failed to get hint.");
    } finally {
      setHintLoading(false);
    }
  }

  async function handleSolution() {
    if (!currentQuestion || solution) return;
    const v = currentQuestion.validation;
    if (!v?.answer_label) return;

    try {
      setSolutionLoading(true);
      setSolutionError("");

      const res = await fetch("/api/solution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: currentQuestion.question_id ?? null,
          stem: currentQuestion.prompt?.stem ?? "",
          options: currentQuestion.prompt?.options ?? [],
          subject: currentQuestion.content?.subject ?? "math",
          topic: currentQuestion.content?.topic ?? null,
          subtopic: currentQuestion.content?.subtopic ?? null,
          verified_answer_label: v.answer_label,
          verified_answer_text: v.answer_text ?? null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Solution failed (${res.status})`);
      }

      const data = await res.json();
      const qid = ensureQuestionStored(currentQuestion);
      const sol: SolutionRecord = {
        question_id: qid ?? currentQuestionKey,
        status: data.status,
        worked_solution: data.worked_solution,
        final_answer_label: data.final_answer_label,
        requires_diagram: data.requires_diagram ?? false,
        diagram_url: data.diagram_url ?? null,
        generated_at: Date.now(),
      };
      setSolution(sol);
      if (qid) useStore.getState().addSolution(sol);
    } catch (err) {
      setSolutionError(err instanceof Error ? err.message : "Failed to get solution.");
    } finally {
      setSolutionLoading(false);
    }
  }

  function handleTutorMessage(msg: TutorChatMessage) {
    setSessionChat((prev) => [...prev, msg]);
    const qid = ensureQuestionStored(currentQuestion);
    if (qid) useStore.getState().addTutorMessage(qid, msg);
  }

  function handleClearChat() {
    setSessionChat([]);
    const qid = currentQuestion?.question_id;
    if (qid) useStore.getState().clearTutorThread(qid);
  }

  function navigate(dir: number) {
    const next = selectedIndex + dir;
    if (next >= 0 && next < sectionQuestions.length) {
      setSelectedIndex(next);
    }
  }

  async function handleGeneratedUpload(file: File | null) {
    if (!file) return;

    try {
      setContentLoading(true);
      setError("");

      const text = await file.text();
      const data = JSON.parse(text);

      let questions: Question[] = [];
      if (Array.isArray(data.questions)) {
        questions = data.questions;
      } else if (data.question_id) {
        questions = [data];
      } else {
        throw new Error(
          "Uploaded JSON must contain either questions[] or a single question object."
        );
      }

      setQuestionSet({
        questions,
        sourceLabel: file.name,
      });

      setUploadLabel(file.name);
      setSelectedSection(questions[0]?.source?.section || "A");
      setSelectedIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read uploaded file.");
      setQuestionSet(null);
    } finally {
      setContentLoading(false);
    }
  }

  return (
    <>
      <Script
        id="mathjax-config"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            window.MathJax = {
              tex: {
                inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
                displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']]
              },
              options: {
                skipHtmlTags: ['script', 'noscript', 'style', 'textarea']
              }
            };
          `,
        }}
      />
      <Script
        src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"
        strategy="afterInteractive"
        onLoad={() => setMathJaxReady(true)}
      />

      <main className="min-h-screen bg-[#f5f5f0] text-slate-900">
        <div className="flex h-screen overflow-hidden">
          <aside className="w-[320px] shrink-0 overflow-hidden bg-slate-900 text-slate-200">
            <div className="border-b border-slate-700 p-4">
              <h1 className="text-lg font-bold">oxAI</h1>
              <p className="mt-1 text-xs text-slate-400">
                Training data and question generation
              </p>

              <div className="mt-4 grid gap-3">
                <label className="text-[10px] uppercase tracking-widest text-slate-400">
                  Mode
                </label>
                <select
                  className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as Mode)}
                >
                  <option value="training">Training data</option>
                  <option value="generated">Generated question</option>
                </select>

                {mode === "training" ? (
                  <>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400">
                      Paper
                    </label>
                    <select
                      className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                      value={paperId}
                      onChange={(e) => setPaperId(e.target.value)}
                    >
                      {papers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.exam} {p.year} — Paper {p.paper} ({p.count})
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400">
                      Subject
                    </label>
                    <select
                      className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                      value={genSubject}
                      onChange={(e) => setGenSubject(e.target.value)}
                    >
                      <option value="math">Mathematics</option>
                      <option value="physics">Physics</option>
                      <option value="chemistry">Chemistry</option>
                      <option value="biology">Biology</option>
                    </select>

                    <label className="text-[10px] uppercase tracking-widest text-slate-400">
                      Topic <span className="normal-case">(optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. mechanics, optics…"
                      className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-600"
                      value={genTopic}
                      onChange={(e) => setGenTopic(e.target.value)}
                    />

                    <label className="text-[10px] uppercase tracking-widest text-slate-400">
                      Difficulty — {genDifficulty}/5
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={genDifficulty}
                      onChange={(e) => setGenDifficulty(Number(e.target.value))}
                      className="w-full accent-blue-500"
                    />

                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={genForceDiagram}
                        onChange={(e) => setGenForceDiagram(e.target.checked)}
                        className="accent-blue-500"
                      />
                      <span className="text-xs text-slate-300">Force diagram</span>
                    </label>

                    <button
                      className="mt-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={generating}
                      onClick={handleGenerate}
                    >
                      {generating ? "Generating…" : "Generate question"}
                    </button>

                    {generateError && (
                      <p className="text-xs text-red-400">{generateError}</p>
                    )}

                    {recentSessions.length > 0 && (
                      <div className="mt-2 border-t border-slate-700 pt-3">
                        <label className="text-[10px] uppercase tracking-widest text-slate-400">
                          Recent
                        </label>
                        <div className="mt-2 flex flex-col gap-1">
                          {recentSessions.slice(0, 5).map((q, i) => (
                            <button
                              key={q.question_id || i}
                              className="rounded-md bg-slate-800 px-3 py-2 text-left text-xs text-slate-300 hover:bg-slate-700 truncate"
                              onClick={() => {
                                setQuestionSet({ questions: [q], sourceLabel: "Generated" });
                                setSelectedSection(q.source?.section || "A");
                                setSelectedIndex(0);
                              }}
                            >
                              {q.content?.subject} · {q.content?.topic || "No topic"} · ★{q.content?.difficulty ?? "?"}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-2 border-t border-slate-700 pt-3">
                      <label className="text-[10px] uppercase tracking-widest text-slate-400">
                        Load saved JSON
                      </label>
                      <input
                        type="file"
                        accept=".json"
                        className="mt-2 text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-slate-100"
                        onChange={(e) => handleGeneratedUpload(e.target.files?.[0] || null)}
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="mt-3 text-xs text-slate-400">
                {papersLoading
                  ? "Loading papers…"
                  : questionSet
                  ? `${questionSet.sourceLabel} · ${questions.length} question(s)${
                      uploadLabel ? ` · uploaded: ${uploadLabel}` : ""
                    }`
                  : "No questions loaded"}
              </div>
            </div>

            <div className="flex border-b border-slate-700">
              {[...new Set(questions.map(sectionOf))].map((s) => (
                <button
                  key={s}
                  className={`flex-1 px-3 py-2 text-sm font-semibold ${
                    s === selectedSection
                      ? "bg-blue-700 text-white"
                      : "bg-slate-800 text-slate-400"
                  }`}
                  onClick={() => {
                    setSelectedSection(s);
                    setSelectedIndex(0);
                  }}
                >
                  Part {s}
                </button>
              ))}
            </div>

            <div className="h-[calc(100vh-180px)] overflow-y-auto p-2">
              {sectionQuestions.map((q, i) => {
                const subject = normalizeSubject(q.content?.subject);
                return (
                  <button
                    key={q.question_id || i}
                    onClick={() => setSelectedIndex(i)}
                    className={`mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${
                      i === selectedIndex ? "bg-blue-700" : "bg-slate-800"
                    }`}
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-xs font-bold">
                      {questionNumber(q, i)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        Q{questionNumber(q, i)}
                      </div>
                      <div className="truncate text-[11px] text-slate-400">
                        {q.content?.topic || ""}
                      </div>
                    </div>
                    <div className="text-[10px] uppercase text-slate-300">
                      {subject.slice(0, 4)}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex-1 overflow-y-auto p-8">
            <div className="max-w-4xl">
              {contentLoading ? (
                <div className="text-slate-500">Loading…</div>
              ) : error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                  {error}
                </div>
              ) : currentQuestion ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div
                    id="question-content"
                    ref={contentRef}
                  />

                  <div className="mt-6 flex gap-3">
                    <button
                      className="rounded-md border px-4 py-2 disabled:opacity-40"
                      disabled={selectedIndex === 0}
                      onClick={() => navigate(-1)}
                    >
                      Previous
                    </button>
                    <button
                      className="rounded-md border px-4 py-2 disabled:opacity-40"
                      disabled={selectedIndex === sectionQuestions.length - 1}
                      onClick={() => navigate(1)}
                    >
                      Next
                    </button>
                  </div>

                  {solution && (
                    <div className="mt-6 border-t border-slate-100 pt-5">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-emerald-600">
                        Worked Solution
                        {solution.status === "needs_revision" && (
                          <span className="ml-2 text-amber-500">(unverified)</span>
                        )}
                      </div>
                      <SolutionBody
                        text={solution.worked_solution}
                        diagramUrl={
                          solution.diagram_url
                            ? solution.diagram_url.replace(/^\/diagrams\//, "/api/diagrams/")
                            : null
                        }
                        mathJaxReady={mathJaxReady}
                      />
                    </div>
                  )}

                  <div className="mt-6 border-t border-slate-100 pt-5">
                    {hints.map((h) => (
                      <div
                        key={h.level}
                        className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
                      >
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-amber-600">
                          Hint {h.level} / 3
                        </div>
                        <div className="text-sm leading-relaxed text-slate-700">
                          {h.hint}
                        </div>
                      </div>
                    ))}

                    {hintError && (
                      <p className="mb-3 text-xs text-red-500">{hintError}</p>
                    )}

                    {hints.length < 3 && (
                      <button
                        className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40"
                        disabled={hintLoading}
                        onClick={handleHint}
                      >
                        {hintLoading
                          ? "Getting hint…"
                          : hints.length === 0
                          ? "Get a hint"
                          : `Next hint (${hints.length + 1} / 3)`}
                      </button>
                    )}

                    {!solution && currentQuestion?.validation?.answer_label && (
                      <div className="mt-4">
                        {solutionError && (
                          <p className="mb-2 text-xs text-red-500">{solutionError}</p>
                        )}
                        <button
                          className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                          disabled={solutionLoading}
                          onClick={handleSolution}
                        >
                          {solutionLoading ? "Generating solution…" : "Show worked solution"}
                        </button>
                      </div>
                    )}
                  </div>

                  {tutorQuestion && (
                    <div className="mt-6 border-t border-slate-100 pt-5">
                      <button
                        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                        onClick={() => setTutorOpen((o) => !o)}
                      >
                        <span>Ask Tutor</span>
                        <span className="text-slate-400">{tutorOpen ? "▲" : "▼"}</span>
                      </button>

                      {tutorOpen && (
                        <div className="mt-3">
                          <TutorChat
                            key={currentQuestionKey}
                            question={tutorQuestion}
                            messages={sessionChat}
                            hints={hints}
                            solution={solution ?? undefined}
                            onMessage={handleTutorMessage}
                          />
                          {sessionChat.length > 0 && (
                            <button
                              className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
                              onClick={handleClearChat}
                            >
                              Clear conversation
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-slate-500">No paper selected.</div>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}