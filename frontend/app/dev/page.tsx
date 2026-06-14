"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { TutorChat } from "@/components/TutorChat";
import { AccountChip } from "@/components/AccountChip";
import { FigureRenderer } from "@/components/FigureRenderer";
import type { FigureSpec } from "@/lib/types";
import { useStore, normaliseQuestion } from "@/lib/store";
import { migrateLegacySessions } from "@/lib/migrateLegacy";
import type { HintRecord, QuestionRecord, SolutionRecord, TutorChatMessage } from "@/lib/types";

type Mode = "training" | "generated" | "reports";
type QuestionReport = { id: string; created_at: string; question_id: string; user_id: string | null; error_title: string; error_body: string | null; question_stem: string | null; worked_solution: string | null; status: string; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = { question_id: string; subject: string; topic: string | null; difficulty: number | null; archetype: string | null; origin: string | null; created_at: string; payload: Record<string, any> | null; };
type PaperMeta = { id: string; label?: string; exam: string; year: number | null; paper: string; count: number; file: string; };
type Question = {
  question_id?: string;
  source?: { section?: string; question_number?: number; page?: number };
  content?: { subject?: string; topic?: string; subtopic?: string; archetype?: string; difficulty?: number; requires_diagram?: boolean; };
  prompt?: { stem?: string; options?: { label: string; text: string }[]; figures?: { figure_id?: string; type?: string; src?: string; kind?: string; caption?: string }[]; };
  validation?: { answer_label?: string; answer_text?: string; worked_solution?: string | null; };
  metadata?: { diagram_url?: string | null; diagram_required?: boolean; tags?: string[]; estimated_time_seconds?: number | null; };
};
type PaperResponse = { paper: { source?: string; questions: Question[] }; meta?: PaperMeta; };
type QuestionSet = { questions: Question[]; sourceLabel: string; };

function recordToQuestion(rec: QuestionRecord): Question {
  return {
    question_id: rec.question_id,
    source: rec.paper_source ? { section: rec.paper_source.section, question_number: rec.paper_source.question_number } : undefined,
    content: { subject: rec.subject, topic: rec.topic ?? undefined, subtopic: rec.subtopic ?? undefined, archetype: rec.archetype ?? undefined, difficulty: rec.difficulty },
    prompt: { stem: rec.stem, options: rec.options, figures: rec.figures as unknown as NonNullable<Question["prompt"]>["figures"] },
    validation: { answer_label: rec.answer_label ?? undefined, answer_text: rec.answer_text ?? undefined },
    metadata: { diagram_url: rec.diagram_url },
  };
}

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

function sectionOf(q: Question) { return q.source?.section || "A"; }
function questionNumber(q: Question, fallback: number) { return q.source?.question_number ?? fallback + 1; }

function stemToHtml(stem?: string) {
  if (!stem) return "<p><em>No stem available.</em></p>";
  return stem.split("\n\n").map((p) => {
    const trimmed = p.trim();
    if (!trimmed) return "";
    return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
  }).join("");
}

function solutionToHtml(text: string): string {
  return text.split("\n\n").map((block) => {
    const t = block.trim();
    if (!t) return "";
    const inline = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
    return `<p>${inline}</p>`;
  }).join("");
}

function SolutionBody({ text, diagramUrl, mathJaxReady }: { text: string; diagramUrl: string | null; mathJaxReady: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = solutionToHtml(text);
    if (!mathJaxReady) return;
    const mj = (window as any).MathJax;
    if (mj?.typesetPromise) mj.typesetPromise([ref.current]).catch(console.error);
  }, [text, mathJaxReady]);
  return (
    <div>
      <div ref={ref} className="prose prose-slate max-w-none text-sm leading-relaxed" />
      {diagramUrl && <img src={diagramUrl} alt="Solution diagram" className="mt-4 max-w-full rounded-lg border border-slate-200" />}
    </div>
  );
}

export default function DevPage() {
  const [mode, setMode] = useState<Mode>("generated");
  const [papers, setPapers] = useState<PaperMeta[]>([]);
  const [paperId, setPaperId] = useState("");
  const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);
  const [selectedSection, setSelectedSection] = useState("A");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [papersLoading, setPapersLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(true);
  const [error, setError] = useState("");
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
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [mathJaxReady, setMathJaxReady] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [currentFigures, setCurrentFigures] = useState<any[]>([]);
  const [reports, setReports] = useState<QuestionReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbRefreshKey, setDbRefreshKey] = useState(0);

  const questions = questionSet?.questions || [];
  const sectionQuestions = useMemo(() => {
    if (questions.length === 1 && questions[0]?.question_id) return questions;
    return questions.filter((q) => sectionOf(q) === selectedSection);
  }, [questions, selectedSection]);
  const currentQuestion = sectionQuestions[selectedIndex];

  useEffect(() => {
    fetch("/api/papers", { cache: "no-store" }).then(r => r.json()).then(d => {
      const list: PaperMeta[] = d.papers || [];
      setPapers(list);
      if (list[0]) setPaperId(list[0].id);
    }).catch(() => setError("Could not load paper list.")).finally(() => setPapersLoading(false));
  }, []);

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
    if (!paperId || mode !== "training") return;
    setContentLoading(true);
    setError("");
    fetch(`/api/papers/${paperId}`, { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error("Failed to load paper");
      return r.json();
    }).then((data: PaperResponse) => {
      const qs = data.paper?.questions || [];
      setQuestionSet({ questions: qs, sourceLabel: data.paper?.source || `Paper ${paperId}` });
      setSelectedSection(qs[0]?.source?.section || "A");
      setSelectedIndex(0);
    }).catch(() => setError("Could not load the selected paper.")).finally(() => setContentLoading(false));
  }, [paperId, mode]);

  useEffect(() => {
    if (mode === "reports") {
      setReportsLoading(true);
      fetch("/api/question-reports")
        .then(r => r.json())
        .then(d => setReports(d.reports ?? []))
        .catch(() => setReports([]))
        .finally(() => setReportsLoading(false));
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "generated") return;
    setDbLoading(true);
    setError("");
    fetch(`/api/generated-questions?subject=${genSubject}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        const qs: Question[] = (d.questions ?? []).map((row: DbRow) => {
          const p = row.payload ?? {};
          return {
            question_id: row.question_id,
            content: p.content ?? { subject: row.subject, topic: row.topic, difficulty: row.difficulty, archetype: row.archetype },
            prompt: p.prompt,
            validation: p.validation,
            metadata: p.metadata,
            source: p.source,
          };
        });
        if (qs.length > 0) {
          setQuestionSet({ questions: qs, sourceLabel: `Generated · ${genSubject}` });
          setSelectedSection("A");
          setSelectedIndex(0);
        } else {
          setQuestionSet({ questions: [], sourceLabel: `Generated · ${genSubject}` });
        }
      })
      .catch(() => setError("Could not load generated questions."))
      .finally(() => setDbLoading(false));
  }, [mode, genSubject, dbRefreshKey]);

  useEffect(() => {
    if (selectedIndex >= sectionQuestions.length && sectionQuestions.length > 0) setSelectedIndex(0);
  }, [sectionQuestions, selectedIndex]);

  const currentQuestionKey = currentQuestion?.question_id ?? `${selectedSection}-${selectedIndex}`;
  const tutorQuestion = useMemo(
    () => currentQuestion ? normaliseQuestion(currentQuestion as Record<string, unknown>, null, "fresh_ai") : null,
    [currentQuestion]
  );

  useEffect(() => {
    const qid = currentQuestion?.question_id;
    if (qid) {
      const store = useStore.getState();
      setHints(store.getHints(qid));
      setSolution(store.getSolution(qid) ?? null);
      setSessionChat(store.getTutorThread(qid));
    } else { setHints([]); setSolution(null); setSessionChat([]); }
    setHintError(""); setSolutionError(""); setTutorOpen(false);
  }, [currentQuestionKey]);

  useEffect(() => {
    setCurrentFigures(currentQuestion?.prompt?.figures ?? []);
  }, [currentQuestionKey]);

  useEffect(() => {
    if (!contentRef.current || !currentQuestion) return;
    const subject = normalizeSubject(currentQuestion.content?.subject);
    const stars = "★".repeat(currentQuestion.content?.difficulty || 0).padEnd(5, "☆");
    const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const optionsHtml = currentQuestion.prompt?.options?.map(opt =>
      `<div style="display:flex;align-items:flex-start;gap:.85rem;margin-bottom:.75rem;"><div style="width:2rem;height:2rem;flex:0 0 2rem;border-radius:999px;display:flex;align-items:center;justify-content:center;font-weight:800;background:#dbeafe;color:#1e3a8a;margin-top:.7rem;">${opt.label}</div><div style="flex:1;line-height:1.7;border:1px solid #e2e8f0;border-radius:1rem;background:#fff;padding:.9rem 1rem;">${escHtml(opt.text)}</div></div>`
    ).join("") || "";
    contentRef.current.innerHTML = `<div style="font-size:.75rem;font-weight:700;color:#64748b;margin-bottom:1rem;">${currentQuestion.question_id || ""} &nbsp;·&nbsp; ${subject} &nbsp;·&nbsp; ${stars}</div><div style="font-size:.95rem;line-height:1.7;">${stemToHtml(currentQuestion.prompt?.stem)}</div><div style="margin-top:1rem;">${optionsHtml}</div>`;
    if (!mathJaxReady) return;
    const mj = (window as any).MathJax;
    if (mj?.typesetPromise) mj.typesetPromise([contentRef.current]).catch(console.error);
  }, [currentQuestionKey, mathJaxReady]);

  async function handleGenerate() {
    try {
      setGenerating(true); setGenerateError(""); setError("");
      const res = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: genSubject, topic: genTopic || null, difficulty: genDifficulty, want_diagram: genForceDiagram, force_diagram: genForceDiagram }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Generation failed (${res.status})`); }
      const question = await res.json();
      if (question.question_id) { useStore.getState().addQuestion(normaliseQuestion(question, null, "fresh_ai")); }
      setDbRefreshKey(k => k + 1);
    } catch (err) { setGenerateError(err instanceof Error ? err.message : "Generation failed."); }
    finally { setGenerating(false); }
  }

  async function handleHint() {
    if (!currentQuestion) return;
    const nextLevel = hints.length + 1;
    if (nextLevel > 3) return;
    try {
      setHintLoading(true); setHintError("");
      const res = await fetch("/api/hint", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stem: currentQuestion.prompt?.stem ?? "", options: currentQuestion.prompt?.options ?? [], subject: currentQuestion.content?.subject ?? "math", topic: currentQuestion.content?.topic ?? null, level: nextLevel }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Hint failed (${res.status})`); }
      const data = await res.json();
      const qid = ensureQuestionStored(currentQuestion);
      const hint: HintRecord = { question_id: qid ?? currentQuestionKey, level: data.level, hint: data.hint, generated_at: Date.now() };
      setHints([...hints, hint]);
      if (qid) useStore.getState().addHint(hint);
    } catch (err) { setHintError(err instanceof Error ? err.message : "Failed to get hint."); }
    finally { setHintLoading(false); }
  }

  async function handleSolution() {
    if (!currentQuestion || solution) return;
    const v = currentQuestion.validation;
    if (!v?.answer_label) return;
    if (v.worked_solution) {
      const qid = ensureQuestionStored(currentQuestion);
      const sol: SolutionRecord = { question_id: qid ?? currentQuestionKey, status: "ok", worked_solution: v.worked_solution, final_answer_label: v.answer_label, requires_diagram: false, diagram_url: null, generated_at: Date.now() };
      setSolution(sol);
      if (qid) useStore.getState().addSolution(sol);
      return;
    }
    try {
      setSolutionLoading(true); setSolutionError("");
      const res = await fetch("/api/solution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question_id: currentQuestion.question_id ?? null, stem: currentQuestion.prompt?.stem ?? "", options: currentQuestion.prompt?.options ?? [], subject: currentQuestion.content?.subject ?? "math", topic: currentQuestion.content?.topic ?? null, subtopic: currentQuestion.content?.subtopic ?? null, verified_answer_label: v.answer_label, verified_answer_text: v.answer_text ?? null }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `Solution failed (${res.status})`); }
      const data = await res.json();
      const qid = ensureQuestionStored(currentQuestion);
      const sol: SolutionRecord = { question_id: qid ?? currentQuestionKey, status: data.status, worked_solution: data.worked_solution, final_answer_label: data.final_answer_label, requires_diagram: data.requires_diagram ?? false, diagram_url: data.diagram_url ?? null, generated_at: Date.now() };
      setSolution(sol);
      if (qid) useStore.getState().addSolution(sol);
    } catch (err) { setSolutionError(err instanceof Error ? err.message : "Failed to get solution."); }
    finally { setSolutionLoading(false); }
  }

  function handleTutorMessage(msg: TutorChatMessage) {
    setSessionChat((prev) => [...prev, msg]);
    const qid = ensureQuestionStored(currentQuestion);
    if (qid) useStore.getState().addTutorMessage(qid, msg);
  }

  function navigate(dir: number) {
    const next = selectedIndex + dir;
    if (next >= 0 && next < sectionQuestions.length) setSelectedIndex(next);
  }

  return (
    <>
      <Script id="mathjax-config" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `window.MathJax={tex:{inlineMath:[['$','$'],['\\\\(','\\\\)']],displayMath:[['$$','$$'],['\\\\[','\\\\]']]},options:{skipHtmlTags:['script','noscript','style','textarea']}};` }} />
      <Script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js" strategy="afterInteractive" onLoad={() => setMathJaxReady(true)} />

      <main className="min-h-screen bg-[#f5f5f0] text-slate-900">
        <div className="flex h-screen overflow-hidden">
          <aside className="w-[300px] shrink-0 overflow-hidden bg-slate-900 text-slate-200">
            <div className="border-b border-slate-700 p-4">
              <h1 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Dev Tools</h1>
              <AccountChip />
              <div className="mt-4 grid gap-3">
                <label className="text-[10px] uppercase tracking-widest text-slate-400">Mode</label>
                <select className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                  <option value="training">Training data</option>
                  <option value="generated">Generated question</option>
                  <option value="reports">Error reports</option>
                </select>
                {mode === "training" ? (
                  <>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400">Paper</label>
                    <select className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm" value={paperId} onChange={(e) => setPaperId(e.target.value)}>
                      {papers.map((p) => <option key={p.id} value={p.id}>{p.label || `${p.exam} ${p.year ?? ''} Paper ${p.paper}`} ({p.count})</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400">Subject</label>
                    <select className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm" value={genSubject} onChange={(e) => setGenSubject(e.target.value)}>
                      <option value="math">Mathematics</option>
                      <option value="physics">Physics</option>
                      <option value="chemistry">Chemistry</option>
                      <option value="biology">Biology</option>
                    </select>
                    <label className="text-[10px] uppercase tracking-widest text-slate-400">Topic (optional)</label>
                    <input type="text" placeholder="e.g. mechanics…" className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500" value={genTopic} onChange={(e) => setGenTopic(e.target.value)} />
                    <label className="text-[10px] uppercase tracking-widest text-slate-400">Difficulty — {genDifficulty}/5</label>
                    <input type="range" min={1} max={5} step={1} value={genDifficulty} onChange={(e) => setGenDifficulty(Number(e.target.value))} className="w-full accent-blue-500" />
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={genForceDiagram} onChange={(e) => setGenForceDiagram(e.target.checked)} className="accent-blue-500" />
                      <span className="text-xs text-slate-300">Force diagram</span>
                    </label>
                    <button className="mt-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={generating || dbLoading} onClick={handleGenerate}>
                      {generating ? "Generating…" : "Generate question"}
                    </button>
                    {generateError && <p className="text-xs text-red-400">{generateError}</p>}
                  </>
                )}
              </div>
              <div className="mt-3 text-xs text-slate-400">{dbLoading ? "Loading from DB…" : papersLoading ? "Loading papers…" : questionSet ? `${questionSet.sourceLabel} · ${questions.length} question(s)` : "No questions loaded"}</div>
            </div>
            <div className="flex border-b border-slate-700">
              {[...new Set(questions.map(sectionOf))].map((s) => (
                <button key={s} className={`flex-1 px-3 py-2 text-sm font-semibold ${s === selectedSection ? "bg-blue-700 text-white" : "bg-slate-800 text-slate-400"}`} onClick={() => { setSelectedSection(s); setSelectedIndex(0); }}>
                  Part {s}
                </button>
              ))}
            </div>
            <div className="h-[calc(100vh-180px)] overflow-y-auto p-2">
              {dbLoading && mode === "generated" && <p className="text-xs text-slate-400 px-2 py-4">Loading…</p>}
              {sectionQuestions.map((q, i) => (
                <button key={q.question_id || i} onClick={() => setSelectedIndex(i)} className={`mb-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${i === selectedIndex ? "bg-blue-700" : "bg-slate-800"}`}>
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-bold">{mode === "generated" ? i + 1 : questionNumber(q, i)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{q.content?.topic || q.content?.archetype || "No topic"}</div>
                    <div className="truncate text-[11px] text-slate-400">{"★".repeat(q.content?.difficulty || 0)} {q.question_id}</div>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex-1 overflow-y-auto p-8">
            <div className="max-w-4xl">
              {mode === "reports" ? (
                <div>
                  <h2 className="text-lg font-bold text-slate-800 mb-4">Error Reports {reports.length > 0 && <span className="text-sm font-normal text-slate-500">({reports.length})</span>}</h2>
                  {reportsLoading ? <p className="text-slate-500">Loading…</p> : reports.length === 0 ? <p className="text-slate-400 text-sm">No reports yet.</p> : (
                    <div className="flex flex-col gap-3">
                      {reports.map(r => (
                        <div key={r.id} className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                          <button className="w-full text-left px-5 py-4 flex items-start justify-between gap-4 hover:bg-slate-50" onClick={() => setExpandedReport(expandedReport === r.id ? null : r.id)}>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${r.status === 'open' ? 'bg-red-100 text-red-700' : r.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
                                <span className="text-xs font-semibold text-slate-700">{r.error_title}</span>
                              </div>
                              <p className="text-xs text-slate-400 font-mono truncate">{r.question_id}</p>
                            </div>
                            <span className="text-xs text-slate-400 shrink-0">{new Date(r.created_at).toLocaleDateString()}</span>
                          </button>
                          {expandedReport === r.id && (
                            <div className="border-t border-slate-100 px-5 py-4 text-sm space-y-3">
                              {r.error_body && <div><p className="text-[10px] uppercase font-semibold text-slate-400 mb-1">Details</p><p className="text-slate-700">{r.error_body}</p></div>}
                              {r.question_stem && <div><p className="text-[10px] uppercase font-semibold text-slate-400 mb-1">Question stem</p><p className="text-slate-600 text-xs leading-relaxed bg-slate-50 rounded-lg p-3 font-mono">{r.question_stem}</p></div>}
                              {r.worked_solution && <div><p className="text-[10px] uppercase font-semibold text-slate-400 mb-1">Worked solution</p><p className="text-slate-600 text-xs leading-relaxed bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">{r.worked_solution}</p></div>}
                              <p className="text-[10px] text-slate-400">User: {r.user_id ?? 'guest'} · {new Date(r.created_at).toLocaleString()}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : contentLoading ? <div className="text-slate-500">Loading…</div> : error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div> : currentQuestion ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div id="question-content" ref={contentRef} />
                  {currentFigures.length > 0 && (
                    <div className="my-4 flex flex-col items-center gap-4">
                      {currentFigures.map((fig, i) => {
                        if (fig.figure_type === 'table' || fig.figure_type === 'complex_diagram') {
                          return <FigureRenderer key={i} spec={fig as FigureSpec} />;
                        }
                        if (fig.src) {
                          return <img key={i} src={fig.src} alt={fig.figure_id || 'figure'} className="max-w-full rounded border border-slate-200" />;
                        }
                        return null;
                      })}
                    </div>
                  )}
                  <div className="mt-6 flex gap-3">
                    <button className="rounded-md border px-4 py-2 disabled:opacity-40" disabled={selectedIndex === 0} onClick={() => navigate(-1)}>Previous</button>
                    <button className="rounded-md border px-4 py-2 disabled:opacity-40" disabled={selectedIndex === sectionQuestions.length - 1} onClick={() => navigate(1)}>Next</button>
                  </div>
                  {solution && (
                    <div className="mt-6 border-t border-slate-100 pt-5">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-emerald-600">Worked Solution</div>
                      <SolutionBody text={solution.worked_solution} diagramUrl={solution.diagram_url ? solution.diagram_url.replace(/^\/diagrams\//, "/api/diagrams/") : null} mathJaxReady={mathJaxReady} />
                    </div>
                  )}
                  <div className="mt-6 border-t border-slate-100 pt-5">
                    {hints.map((h) => (
                      <div key={h.level} className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-amber-600">Hint {h.level} / 3</div>
                        <div className="text-sm leading-relaxed text-slate-700">{h.hint}</div>
                      </div>
                    ))}
                    {hintError && <p className="mb-3 text-xs text-red-500">{hintError}</p>}
                    {hints.length < 3 && <button className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-40" disabled={hintLoading} onClick={handleHint}>{hintLoading ? "Getting hint…" : hints.length === 0 ? "Get a hint" : `Next hint (${hints.length + 1} / 3)`}</button>}
                    {!solution && currentQuestion?.validation?.answer_label && (
                      <div className="mt-4">
                        {solutionError && <p className="mb-2 text-xs text-red-500">{solutionError}</p>}
                        <button className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40" disabled={solutionLoading} onClick={handleSolution}>{solutionLoading ? "Generating solution…" : "Show worked solution"}</button>
                      </div>
                    )}
                  </div>
                  {tutorQuestion && (
                    <div className="mt-6 border-t border-slate-100 pt-5">
                      <button className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100" onClick={() => setTutorOpen((o) => !o)}>
                        <span>Ask Tutor</span>
                        <span className="text-slate-400">{tutorOpen ? "▲" : "▼"}</span>
                      </button>
                      {tutorOpen && (
                        <div className="mt-3">
                          <TutorChat key={currentQuestionKey} question={tutorQuestion} messages={sessionChat} hints={hints} solution={solution ?? undefined} onMessage={handleTutorMessage} />
                          {sessionChat.length > 0 && <button className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100" onClick={() => { setSessionChat([]); const qid = currentQuestion?.question_id; if (qid) useStore.getState().clearTutorThread(qid); }}>Clear conversation</button>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : <div className="text-slate-500">No paper selected.</div>}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
