'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '@/lib/store';
import { planEsatPaperSlots, startBackgroundGeneration, slotCounts } from '@/lib/queue';
import { QuestionCard } from '@/components/QuestionCard';
import { PaperExport } from '@/components/PaperExport';
import { QueueStatus } from '@/components/QueueStatus';
import type {
  PaperSlot,
  PaperSession,
  PaperBlueprint,
  DifficultyPreset,
  HintRecord,
  SolutionRecord,
  TutorChatMessage,
  AttemptRecord,
} from '@/lib/types';

// ── Constants ──────────────────────────────────────────────────

const OPTIONAL_MODULES = ['Physics', 'Chemistry', 'Biology', 'Advanced Mathematics'] as const;
const QUESTIONS_PER_MODULE = 20;
const PRELOAD_COUNT = 10;
const CONCURRENCY = 1;
const MAX_ACTIVE_JOBS = 2;

const SOURCE_OPTIONS = [
  { label: '100% Past Papers', bankFraction: 1.0 },
  { label: '75% Past / 25% AI', bankFraction: 0.75 },
  { label: '50 / 50', bankFraction: 0.5 },
  { label: '25% Past / 75% AI', bankFraction: 0.25 },
  { label: '100% AI', bankFraction: 0.0 },
] as const;

const DIFFICULTY_OPTIONS: { label: string; value: DifficultyPreset }[] = [
  { label: 'Easy', value: 'easy' },
  { label: 'Realistic', value: 'realistic' },
  { label: 'Hard', value: 'hard' },
  { label: 'Olympiad', value: 'olympiad' },
];

const PAST_PAPER_YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

const MODULE_COLORS: Record<string, { bg: string; text: string; ring: string; dot: string; bar: string }> = {
  Mathematics:           { bg: 'bg-blue-50 dark:bg-blue-950/30',    text: 'text-blue-700 dark:text-blue-300',   ring: 'ring-blue-300 dark:ring-blue-700',   dot: 'bg-blue-400',   bar: 'bg-blue-400' },
  Physics:               { bg: 'bg-green-50 dark:bg-green-950/30',   text: 'text-green-700 dark:text-green-300',  ring: 'ring-green-300 dark:ring-green-700',  dot: 'bg-green-400',  bar: 'bg-green-400' },
  Chemistry:             { bg: 'bg-amber-50 dark:bg-amber-950/30',   text: 'text-amber-700 dark:text-amber-300',  ring: 'ring-amber-300 dark:ring-amber-700',  dot: 'bg-amber-400',  bar: 'bg-amber-400' },
  Biology:               { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300',ring: 'ring-emerald-300 dark:ring-emerald-700',dot: 'bg-emerald-400',bar: 'bg-emerald-400' },
  'Advanced Mathematics':{ bg: 'bg-purple-50 dark:bg-purple-950/30',  text: 'text-purple-700 dark:text-purple-300', ring: 'ring-purple-300 dark:ring-purple-700', dot: 'bg-purple-400', bar: 'bg-purple-400' },
};

// ── Timer helpers ──────────────────────────────────────────────

function useCountdown(targetMs: number | null): number {
  const [remaining, setRemaining] = useState(() =>
    targetMs ? Math.max(0, targetMs - Date.now()) : Infinity
  );
  useEffect(() => {
    if (!targetMs) { setRemaining(Infinity); return; }
    const tick = () => setRemaining(Math.max(0, targetMs - Date.now()));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [targetMs]);
  return remaining;
}

function formatTime(ms: number): string {
  if (ms === Infinity || ms < 0) return '--:--';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function timerColor(ms: number): string {
  if (ms === Infinity) return 'text-gray-700 dark:text-gray-300';
  if (ms < 5 * 60 * 1000) return 'text-red-600 font-bold animate-pulse';
  if (ms < 30 * 60 * 1000) return 'text-amber-600 font-semibold';
  return 'text-gray-700 dark:text-gray-300';
}

function stubBlueprint(modules: string[], bankFraction: number, difficulty: DifficultyPreset): PaperBlueprint {
  return {
    blueprint_id: uuidv4(),
    name: 'ESAT',
    paper_length: modules.length * QUESTIONS_PER_MODULE,
    difficulty_preset: difficulty,
    target_subject: 'math',
    topic_mode: 'all_topics',
    topic_weights: {},
    bank_fraction: bankFraction,
    diagram_fraction: 0,
    diagram_policy: 'never',
    source_policy: 'balanced',
    ordering_policy: 'fixed',
    preload_count: PRELOAD_COUNT,
    background_concurrency_limit: CONCURRENCY,
    must_include_topics: [],
    excluded_topics: [],
    difficulty_range: [1, 5],
  };
}

// ── Page ───────────────────────────────────────────────────────

type Phase = 'config' | 'loading' | 'paper' | 'review';

export default function PaperModePage() {
  // Config
  const [selectedOptional, setSelectedOptional] = useState<string[]>([]);
  const [bankFraction, setBankFraction] = useState(0.5);
  const [difficulty, setDifficulty] = useState<DifficultyPreset>('realistic');
  const [excludedYears, setExcludedYears] = useState<number[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [examMode, setExamMode] = useState(true);
  const [customTimerEnabled, setCustomTimerEnabled] = useState(true);
  const [customTimerMinutes, setCustomTimerMinutes] = useState(120);
  const [customLiveSolution, setCustomLiveSolution] = useState(false);
  const [customEnableSolution, setCustomEnableSolution] = useState(false);
  const [customEnableHints, setCustomEnableHints] = useState(false);
  const [customEnableTutor, setCustomEnableTutor] = useState(false);

  // Paper session state (mirrors store)
  const [phase, setPhase] = useState<Phase>('config');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [slots, setSlots] = useState<PaperSlot[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, string>>({});
  const [revealedSolutions, setRevealedSolutions] = useState<string[]>([]);
  const [paperStartTime, setPaperStartTime] = useState<number | null>(null);
  const [paperTimerSeconds, setPaperTimerSeconds] = useState<number | null>(null);
  const [paperLiveSolution, setPaperLiveSolution] = useState(false);
  const [paperEnableSolution, setPaperEnableSolution] = useState(false);
  const [paperEnableHints, setPaperEnableHints] = useState(false);
  const [paperEnableTutor, setPaperEnableTutor] = useState(false);
  const [reviewQuestionIdx, setReviewQuestionIdx] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [showSubmitWarning, setShowSubmitWarning] = useState(false);

  const stopGenRef = useRef<(() => void) | null>(null);
  const didAutoSubmitRef = useRef(false);
  // Tracks latest slots synchronously so generation callbacks don't use stale state
  const slotsRef = useRef<PaperSlot[]>([]);

  // Store
  const questions = useStore((s) => s.questions);
  const hints = useStore((s) => s.hints);
  const solutions = useStore((s) => s.solutions);
  const tutorThreads = useStore((s) => s.tutorThreads);
  const paperSessions = useStore((s) => s.paperSessions);
  const addQuestion = useStore((s) => s.addQuestion);
  const recordAttempt = useStore((s) => s.recordAttempt);
  const addHint = useStore((s) => s.addHint);
  const addSolution = useStore((s) => s.addSolution);
  const addTutorMessage = useStore((s) => s.addTutorMessage);
  const addPaperSession = useStore((s) => s.addPaperSession);
  const updatePaperSession = useStore((s) => s.updatePaperSession);

  const savedPapers = paperSessions.filter(
    (s) => s.status !== 'complete' && s.status !== 'abandoned'
  );
  const activePapers = savedPapers.filter(
    (s) => s.status === 'in_progress' || s.status === 'loading' || s.status === 'ready'
  );

  useEffect(() => { return () => { stopGenRef.current?.(); }; }, []);

  // Timer
  const timerTargetMs =
    paperStartTime && paperTimerSeconds
      ? paperStartTime + paperTimerSeconds * 1000
      : null;
  const timerRemaining = useCountdown(timerTargetMs);

  // Auto-submit when timer expires
  useEffect(() => {
    if (
      phase === 'paper' &&
      timerTargetMs !== null &&
      timerRemaining === 0 &&
      !didAutoSubmitRef.current
    ) {
      didAutoSubmitRef.current = true;
      setTimedOut(true);
      handleSubmit(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRemaining, phase, timerTargetMs]);

  // Record start time when we enter paper phase
  useEffect(() => {
    if (phase === 'paper' && paperStartTime === null && activeSessionId) {
      const now = Date.now();
      setPaperStartTime(now);
      updatePaperSession(activeSessionId, { start_time: now, status: 'in_progress' });
    }
  }, [phase, paperStartTime, activeSessionId, updatePaperSession]);

  const syncSession = useCallback(
    (changes: Partial<PaperSession>, sid: string) => {
      updatePaperSession(sid, changes);
    },
    [updatePaperSession]
  );

  const pageRetriesRef = useRef<Map<string, number>>(new Map());

  function launchGeneration(newSlots: PaperSlot[], sessionId: string) {
    slotsRef.current = newSlots;

    const onSlotGenerating = (s: PaperSlot) => {
      const next = slotsRef.current.map((x) => (x.slot_id === s.slot_id ? s : x));
      slotsRef.current = next;
      setSlots(next);
    };

    const onSlotReady = (s: PaperSlot, q: import('@/lib/types').QuestionRecord) => {
      addQuestion(q);
      const next = slotsRef.current.map((x) => (x.slot_id === s.slot_id ? s : x));
      slotsRef.current = next;
      setSlots(next);
      syncSession({ slots: next }, sessionId);
    };

    const onSlotFailed = (s: PaperSlot, _error: string) => {
      const retries = pageRetriesRef.current.get(s.slot_id) ?? 0;
      if (retries < 1) {
        pageRetriesRef.current.set(s.slot_id, retries + 1);
        const resetSlot: PaperSlot = { ...s, status: 'planned', error: null, retry_count: 0 };
        const next = slotsRef.current.map((x) => (x.slot_id === s.slot_id ? resetSlot : x));
        slotsRef.current = next;
        setSlots(next);
        startBackgroundGeneration([resetSlot], 1, { onSlotGenerating, onSlotReady, onSlotFailed });
      } else {
        const next = slotsRef.current.map((x) => (x.slot_id === s.slot_id ? s : x));
        slotsRef.current = next;
        setSlots(next);
      }
    };

    const stop = startBackgroundGeneration(newSlots, CONCURRENCY, { onSlotGenerating, onSlotReady, onSlotFailed });
    stopGenRef.current?.();
    stopGenRef.current = stop;
  }

  function handleStart() {
    if (activePapers.length >= MAX_ACTIVE_JOBS) return;
    const mods = ['Mathematics', ...selectedOptional];
    const allSlots = planEsatPaperSlots(mods, bankFraction, difficulty, excludedYears);
    const sessionId = uuidv4();
    const now = Date.now();
    const timerSec = examMode
      ? 120 * 60
      : customTimerEnabled
      ? customTimerMinutes * 60
      : null;
    const liveSOL = examMode ? false : customLiveSolution;
    const enableSolution = examMode ? false : customEnableSolution;
    const enableHints = examMode ? false : customEnableHints;
    const enableTutor = examMode ? false : customEnableTutor;

    const session: PaperSession = {
      session_id: sessionId,
      blueprint: stubBlueprint(mods, bankFraction, difficulty),
      modules: mods,
      slots: allSlots,
      status: 'loading',
      current_slot_index: 0,
      start_time: null,
      end_time: null,
      total_answered: 0,
      total_correct: 0,
      submitted_answers: {},
      revealed_solutions: [],
      timer_duration_seconds: timerSec,
      live_solution: liveSOL,
      enable_solution: enableSolution,
      enable_hints: enableHints,
      enable_tutor: enableTutor,
      submitted: false,
      created_at: now,
      updated_at: now,
    };

    addPaperSession(session);
    setActiveSessionId(sessionId);
    setModules(mods);
    slotsRef.current = allSlots;
    setSlots(allSlots);
    setCurrentIdx(0);
    setSubmittedAnswers({});
    setRevealedSolutions([]);
    setPaperStartTime(null);
    setPaperTimerSeconds(timerSec);
    setPaperLiveSolution(liveSOL);
    setPaperEnableSolution(enableSolution);
    setPaperEnableHints(enableHints);
    setPaperEnableTutor(enableTutor);
    setTimedOut(false);
    didAutoSubmitRef.current = false;
    launchGeneration(allSlots, sessionId);
    setPhase('loading');
  }

  function handleResume(session: PaperSession) {
    stopGenRef.current?.();
    const sessionId = session.session_id;
    const mods = session.modules ?? ['Mathematics'];
    const fixedSlots = (session.slots ?? []).map((s) =>
      s.status === 'generating' ? { ...s, status: 'planned' as const } : s
    );

    setActiveSessionId(sessionId);
    setModules(mods);
    slotsRef.current = fixedSlots;
    setSlots(fixedSlots);
    setCurrentIdx(session.current_slot_index ?? 0);
    setSubmittedAnswers(session.submitted_answers ?? {});
    setRevealedSolutions(session.revealed_solutions ?? []);
    setPaperTimerSeconds(session.timer_duration_seconds ?? null);
    setPaperLiveSolution(session.live_solution ?? false);
    setPaperEnableSolution(session.enable_solution ?? false);
    setPaperEnableHints(session.enable_hints ?? false);
    setPaperEnableTutor(session.enable_tutor ?? false);
    setPaperStartTime(session.start_time);
    setTimedOut(false);
    didAutoSubmitRef.current = false;

    if (session.submitted) {
      setReviewQuestionIdx(null);
      setPhase('review');
      return;
    }

    // Update fixed slots in store
    syncSession({ slots: fixedSlots }, sessionId);

    // Check if enough questions are already loaded
    const readyCount = fixedSlots.filter(
      (s) => s.status === 'ready' || s.status === 'answered' || s.status === 'shown'
    ).length;

    launchGeneration(fixedSlots, sessionId);

    if (readyCount >= PRELOAD_COUNT || session.status === 'in_progress') {
      setPhase('paper');
    } else {
      setPhase('loading');
      syncSession({ status: 'loading' }, sessionId);
    }
  }

  function handleAbandon(sessionId: string) {
    updatePaperSession(sessionId, { status: 'abandoned' });
  }

  function handleExit() {
    stopGenRef.current?.();
    if (activeSessionId) {
      syncSession(
        {
          slots,
          submitted_answers: submittedAnswers,
          revealed_solutions: revealedSolutions,
          current_slot_index: currentIdx,
        },
        activeSessionId
      );
    }
    setPhase('config');
    setActiveSessionId(null);
    setSlots([]);
    setModules([]);
  }

  function handleSubmitRequest() {
    const readySlotIds = new Set(
      slots.filter((s) => s.question_id).map((s) => s.slot_id)
    );
    const unanswered = [...readySlotIds].filter((id) => !submittedAnswers[id]);
    if (unanswered.length > 0) {
      setShowSubmitWarning(true);
      return;
    }
    handleSubmit();
  }

  function handleSubmit(autoFromTimer = false) {
    setShowSubmitWarning(false);
    if (phase !== 'paper' && !autoFromTimer) return;
    stopGenRef.current?.();
    const endTime = Date.now();
    const correct = slots.filter((s) => {
      const a = submittedAnswers[s.slot_id];
      const q = s.question_id ? questions[s.question_id] : null;
      return a && q && a === q.answer_label;
    }).length;

    if (activeSessionId) {
      syncSession(
        {
          status: 'complete',
          submitted: true,
          end_time: endTime,
          total_answered: Object.keys(submittedAnswers).length,
          total_correct: correct,
          submitted_answers: submittedAnswers,
          revealed_solutions: revealedSolutions,
          current_slot_index: currentIdx,
          slots,
        },
        activeSessionId
      );
    }
    setReviewQuestionIdx(null);
    setPhase('review');
  }

  function handleAnswer(label: string, timeTaken: number) {
    const slot = slots[currentIdx];
    if (!slot?.question_id) return;
    const q = questions[slot.question_id];
    if (!q) return;

    const currentAnswer = submittedAnswers[slot.slot_id];

    // Clicking the already-selected option deselects it
    if (label === currentAnswer) {
      const newAnswers = { ...submittedAnswers };
      delete newAnswers[slot.slot_id];
      const newSlots = slots.map((s, i) =>
        i === currentIdx ? { ...s, status: 'shown' as const } : s
      );
      setSubmittedAnswers(newAnswers);
      setSlots(newSlots);
      slotsRef.current = newSlots;
      if (activeSessionId) syncSession({ submitted_answers: newAnswers, slots: newSlots }, activeSessionId);
      return;
    }

    const newAnswers = { ...submittedAnswers, [slot.slot_id]: label };
    const newSlots = slots.map((s, i) =>
      i === currentIdx ? { ...s, status: 'answered' as const } : s
    );
    setSubmittedAnswers(newAnswers);
    setSlots(newSlots);
    slotsRef.current = newSlots;

    if (activeSessionId) {
      syncSession({ submitted_answers: newAnswers, slots: newSlots }, activeSessionId);
    }

    recordAttempt({
      attempt_id: uuidv4(),
      question_id: q.question_id,
      session_id: activeSessionId ?? '',
      mode: 'paper',
      chosen_answer: label,
      correct_answer: q.answer_label,
      is_correct: label === q.answer_label,
      time_taken_seconds: timeTaken,
      hint_count: hints[q.question_id]?.length ?? 0,
      tutor_used: (tutorThreads[q.question_id]?.messages.length ?? 0) > 0,
      solution_revealed: revealedSolutions.includes(slot.slot_id),
      topic: q.topic,
      subtopic: q.subtopic,
      difficulty: q.difficulty,
      source_type: q.source_type,
      attempted_at: Date.now(),
    } as AttemptRecord);
  }

  function handleNavigate(idx: number) {
    setCurrentIdx(idx);
    if (activeSessionId) syncSession({ current_slot_index: idx }, activeSessionId);
  }

  // ── Derived ────────────────────────────────────────────────────

  const canStart = selectedOptional.length === 2;
  const allModules = ['Mathematics', ...selectedOptional];
  const totalQuestions = allModules.length * QUESTIONS_PER_MODULE;
  const totalAnswered = Object.keys(submittedAnswers).length;
  const totalCorrect = slots.filter((s) => {
    const a = submittedAnswers[s.slot_id];
    const q = s.question_id ? questions[s.question_id] : null;
    return a && q && a === q.answer_label;
  }).length;

  const readyCount = slots.filter(
    (s) => s.status === 'ready' || s.status === 'answered' || s.status === 'shown'
  ).length;
  const firstTranchReady =
    readyCount >= PRELOAD_COUNT ||
    (slots.length > 0 &&
      slots.filter((s) => s.status === 'planned' || s.status === 'generating').length === 0);

  useEffect(() => {
    if (phase === 'loading' && firstTranchReady) setPhase('paper');
  }, [phase, firstTranchReady]);

  const currentSlot = slots[currentIdx] ?? null;
  const currentQuestion = currentSlot?.question_id ? questions[currentSlot.question_id] : null;
  const currentHints: HintRecord[] = currentSlot?.question_id
    ? (hints[currentSlot.question_id] ?? [])
    : [];
  const currentSolution: SolutionRecord | undefined = currentSlot?.question_id
    ? solutions[currentSlot.question_id]
    : undefined;
  const currentTutorMessages: TutorChatMessage[] = currentSlot?.question_id
    ? (tutorThreads[currentSlot.question_id]?.messages ?? [])
    : [];
  const currentAnswer = currentSlot ? (submittedAnswers[currentSlot.slot_id] ?? null) : null;
  const currentRevealed = currentSlot ? revealedSolutions.includes(currentSlot.slot_id) : false;
  const isWaiting =
    !currentSlot ||
    currentSlot.status === 'planned' ||
    currentSlot.status === 'generating';
  const isLastQuestion = currentIdx === slots.length - 1;

  // ── CONFIG ─────────────────────────────────────────────────────
  if (phase === 'config') {
    const bankPct = Math.round(bankFraction * 100);
    const aiPct = 100 - bankPct;
    const tooManyJobs = activePapers.length >= MAX_ACTIVE_JOBS;

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 pb-12">
        <div className="max-w-xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-6 mb-1">ESAT Paper Mode</h1>
          <p className="text-sm text-gray-500 mb-6">
            60 questions across 3 modules · Mathematics is mandatory
          </p>

          {/* Saved papers */}
          {savedPapers.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Your saved papers</h2>
              <div className="space-y-2">
                {savedPapers.map((sess) => {
                  const mods = sess.modules ?? [];
                  const answered = Object.keys(sess.submitted_answers ?? {}).length;
                  const total = (sess.slots ?? []).length;
                  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
                  const isActive =
                    sess.status === 'in_progress' ||
                    sess.status === 'loading' ||
                    sess.status === 'ready';
                  return (
                    <div
                      key={sess.session_id}
                      className="flex items-center gap-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {mods.map((m) => {
                            const c = MODULE_COLORS[m] ?? MODULE_COLORS['Mathematics'];
                            return (
                              <span
                                key={m}
                                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}
                              >
                                {m}
                              </span>
                            );
                          })}
                          {isActive && (
                            <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                              active
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-accent h-1.5 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            {answered}/{total}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleResume(sess)}
                        className="px-3 py-1.5 bg-accent hover:bg-accent-light text-white text-xs font-semibold rounded-lg transition-colors flex-shrink-0"
                      >
                        Resume
                      </button>
                      <button
                        onClick={() => handleAbandon(sess.session_id)}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                        title="Abandon this paper"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Max jobs warning */}
          {tooManyJobs && (
            <div className="mb-5 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl text-sm text-amber-700 dark:text-amber-400">
              You have {MAX_ACTIVE_JOBS} active papers. Resume or abandon one before starting a new paper.
            </div>
          )}

          {/* Module selection */}
          <section className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Select modules</h2>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  canStart
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-600'
                }`}
              >
                {canStart ? '3 modules selected ✓' : `Select ${2 - selectedOptional.length} more`}
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-950/20 border-2 border-blue-200 dark:border-blue-800 rounded-xl">
                <div className="w-5 h-5 rounded bg-blue-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">Mathematics</span>
                <span className="ml-auto text-xs text-blue-500 dark:text-blue-400 font-medium">20 questions · mandatory</span>
              </div>
              {OPTIONAL_MODULES.map((mod) => {
                const selected = selectedOptional.includes(mod);
                const disabled = !selected && selectedOptional.length >= 2;
                const colors = MODULE_COLORS[mod];
                return (
                  <button
                    key={mod}
                    onClick={() =>
                      setSelectedOptional((prev) => {
                        if (prev.includes(mod)) return prev.filter((m) => m !== mod);
                        if (prev.length >= 2) return prev;
                        return [...prev, mod];
                      })
                    }
                    disabled={disabled}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-colors text-left ${
                      selected
                        ? `${colors.bg} border-current ${colors.text}`
                        : disabled
                        ? 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        selected ? 'bg-current border-current' : 'border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {selected && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm font-medium">{mod}</span>
                    <span className="ml-auto text-xs opacity-60 font-medium">20 questions</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Source split */}
          <section className="mb-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Question source</h2>
            <div className="grid grid-cols-5 gap-1.5">
              {SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setBankFraction(opt.bankFraction)}
                  className={`py-2 px-1 rounded-lg border text-xs font-medium text-center transition-colors leading-tight ${
                    bankFraction === opt.bankFraction
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Difficulty */}
          <section className="mb-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Difficulty</h2>
            <div className="grid grid-cols-4 gap-2">
              {DIFFICULTY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setDifficulty(opt.value)}
                  className={`py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                    difficulty === opt.value
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Exam settings */}
          <section className="mb-5">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Exam settings</h2>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              {/* Exam mode toggle */}
              <button
                onClick={() => setExamMode((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="text-left">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">Exam mode</div>
                  <div className="text-xs text-gray-400 mt-0.5">2-hour timer · no live feedback</div>
                </div>
                <div
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    examMode ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      examMode ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </div>
              </button>

              {/* Custom settings when exam mode is off */}
              {!examMode && (
                <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 space-y-3">
                  {/* Timer */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-700 dark:text-gray-300">Countdown timer</div>
                      {customTimerEnabled && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <input
                            type="number"
                            min={5}
                            max={300}
                            value={customTimerMinutes}
                            onChange={(e) =>
                              setCustomTimerMinutes(Math.max(5, Math.min(300, Number(e.target.value))))
                            }
                            className="w-16 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-center text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800"
                          />
                          <span className="text-xs text-gray-400">minutes</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setCustomTimerEnabled((v) => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        customTimerEnabled ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          customTimerEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Live solution */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-700 dark:text-gray-300">Live feedback</div>
                      <div className="text-xs text-gray-400">Show correct/wrong after each answer</div>
                    </div>
                    <button
                      onClick={() => setCustomLiveSolution((v) => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        customLiveSolution ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          customLiveSolution ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Enable solutions */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-700 dark:text-gray-300">Solutions</div>
                      <div className="text-xs text-gray-400">Allow generating worked solutions</div>
                    </div>
                    <button
                      onClick={() => setCustomEnableSolution((v) => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        customEnableSolution ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          customEnableSolution ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Enable hints */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-700 dark:text-gray-300">Hints</div>
                      <div className="text-xs text-gray-400">Allow requesting hints during the paper</div>
                    </div>
                    <button
                      onClick={() => setCustomEnableHints((v) => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        customEnableHints ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          customEnableHints ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Enable tutor */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-gray-700 dark:text-gray-300">AI Tutor</div>
                      <div className="text-xs text-gray-400">Allow asking the tutor for guidance</div>
                    </div>
                    <button
                      onClick={() => setCustomEnableTutor((v) => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        customEnableTutor ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          customEnableTutor ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Advanced */}
          <section className="mb-6">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              <span className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
              Advanced options
            </button>
            {showAdvanced && (
              <div className="mt-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wide">
                  Exclude past paper years
                </p>
                <div className="flex flex-wrap gap-2">
                  {PAST_PAPER_YEARS.map((year) => (
                    <button
                      key={year}
                      onClick={() =>
                        setExcludedYears((prev) =>
                          prev.includes(year)
                            ? prev.filter((y) => y !== year)
                            : [...prev, year]
                        )
                      }
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                        excludedYears.includes(year)
                          ? 'bg-red-100 dark:bg-red-950/30 border-red-300 dark:border-red-700 text-red-700 dark:text-red-400'
                          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500'
                      }`}
                    >
                      {year}
                      {excludedYears.includes(year) && <span className="ml-1">✕</span>}
                    </button>
                  ))}
                </div>
                {excludedYears.length > 0 && (
                  <button
                    onClick={() => setExcludedYears([])}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline"
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Summary badge */}
          {canStart && (
            <div className="mb-4 p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-600 dark:text-gray-400">
              <div className="flex flex-wrap gap-2 mb-2">
                {allModules.map((m) => {
                  const c = MODULE_COLORS[m];
                  return (
                    <span
                      key={m}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                      {m}
                    </span>
                  );
                })}
              </div>
              <div className="text-xs text-gray-400">
                60 questions ·{' '}
                {bankPct > 0 && aiPct > 0
                  ? `${bankPct}% past papers + ${aiPct}% AI`
                  : bankPct === 100
                  ? '100% past papers'
                  : '100% AI generated'}
                {' '}· {DIFFICULTY_OPTIONS.find((d) => d.value === difficulty)?.label}
                {' '}· {examMode ? '2h exam mode' : customTimerEnabled ? `${customTimerMinutes}m timer` : 'no timer'}
                {excludedYears.length > 0 && ` · excl. ${excludedYears.join(', ')}`}
              </div>
            </div>
          )}

          <button
            onClick={handleStart}
            disabled={!canStart || tooManyJobs}
            className="w-full bg-accent hover:bg-accent-light disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {!canStart
              ? `Select ${2 - selectedOptional.length} more module${2 - selectedOptional.length !== 1 ? 's' : ''} to continue`
              : tooManyJobs
              ? 'Too many active papers (max 2)'
              : 'Start Paper'}
          </button>
        </div>
      </div>
    );
  }

  // ── LOADING ────────────────────────────────────────────────────
  if (phase === 'loading') {
    const counts = slotCounts(slots);
    const pct = Math.round((readyCount / PRELOAD_COUNT) * 100);
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 w-full max-w-sm text-center">
          <div className="text-3xl mb-4 animate-pulse">📄</div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-1">Assembling paper…</h2>
          <p className="text-sm text-gray-500 mb-1">{modules.join(' · ')}</p>
          <p className="text-xs text-gray-400 mb-5">
            Loading first {PRELOAD_COUNT} questions before you start
          </p>
          <div className="bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden mb-2">
            <div
              className="bg-accent h-2 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <div className="text-xs text-gray-400">
            {readyCount} / {PRELOAD_COUNT} ready
            {counts.generating > 0 && ` · ${counts.generating} generating`}
          </div>
          <button
            onClick={() => {
              stopGenRef.current?.();
              if (activeSessionId) updatePaperSession(activeSessionId, { status: 'abandoned' });
              setPhase('config');
              setActiveSessionId(null);
              setSlots([]);
            }}
            className="mt-5 text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── REVIEW ─────────────────────────────────────────────────────
  if (phase === 'review') {
    const pct =
      totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

    // Individual question review
    if (reviewQuestionIdx !== null) {
      const slot = slots[reviewQuestionIdx];
      const q = slot?.question_id ? questions[slot.question_id] : null;
      const reviewHints: HintRecord[] = slot?.question_id
        ? (hints[slot.question_id] ?? [])
        : [];
      const reviewSolution: SolutionRecord | undefined = slot?.question_id
        ? solutions[slot.question_id]
        : undefined;
      const reviewTutorMsgs: TutorChatMessage[] = slot?.question_id
        ? (tutorThreads[slot.question_id]?.messages ?? [])
        : [];
      const reviewAnswer = slot ? (submittedAnswers[slot.slot_id] ?? null) : null;

      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
          <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2.5">
            <div className="max-w-3xl mx-auto flex items-center gap-3">
              <button
                onClick={() => setReviewQuestionIdx(null)}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 flex items-center gap-1"
              >
                ← Back to summary
              </button>
              <span className="ml-auto text-sm text-gray-500">
                Q{reviewQuestionIdx + 1} / {slots.length}
              </span>
            </div>
          </div>
          <div className="max-w-2xl mx-auto p-4 space-y-4 pb-8">
            {q ? (
              <QuestionCard
                question={q}
                hints={reviewHints}
                solution={reviewSolution}
                tutorMessages={reviewTutorMsgs}
                submittedAnswer={reviewAnswer}
                solutionRevealed={revealedSolutions.includes(slot?.slot_id ?? '')}
                hideSolution={false}
                hideFeedback={false}
                hideHints={!paperEnableHints}
                hideTutor={!paperEnableTutor}
                onAnswer={() => {}}
                onHintAdded={(h) => addHint(h)}
                onSolutionRevealed={() => {
                  if (slot) {
                    const next = [...revealedSolutions, slot.slot_id];
                    setRevealedSolutions(next);
                  }
                }}
                onSolutionGenerated={(s) => addSolution(s)}
                onTutorMessage={(m) => addTutorMessage(q.question_id, m)}
                questionNumber={reviewQuestionIdx + 1}
                totalQuestions={slots.length}
              />
            ) : (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-400 text-sm">
                Question not available
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setReviewQuestionIdx((i) => Math.max(0, (i ?? 0) - 1))}
                disabled={reviewQuestionIdx === 0}
                className="flex-1 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
              >
                ← Previous
              </button>
              <button
                onClick={() =>
                  setReviewQuestionIdx((i) => Math.min(slots.length - 1, (i ?? 0) + 1))
                }
                disabled={reviewQuestionIdx === slots.length - 1}
                className="flex-1 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Summary + review grid
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 pb-12">
        <div className="max-w-2xl mx-auto">
          {/* Score card */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center mb-5">
            {timedOut && (
              <div className="mb-3 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                Time&apos;s up — paper auto-submitted
              </div>
            )}
            <div className="text-4xl mb-3">{pct >= 70 ? '🎉' : pct >= 50 ? '📝' : '📚'}</div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Paper submitted</h2>
            <p
              className={`text-4xl font-bold mt-2 ${
                pct >= 70
                  ? 'text-emerald-600'
                  : pct >= 50
                  ? 'text-amber-600'
                  : 'text-red-500'
              }`}
            >
              {pct}%
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {totalCorrect} / {totalAnswered} correct
            </p>
          </div>

          {/* Module breakdown */}
          <div className="space-y-2 mb-5">
            {modules.map((mod, modIdx) => {
              const modSlots = slots.slice(
                modIdx * QUESTIONS_PER_MODULE,
                (modIdx + 1) * QUESTIONS_PER_MODULE
              );
              const modCorrect = modSlots.filter((s) => {
                const a = submittedAnswers[s.slot_id];
                const q = s.question_id ? questions[s.question_id] : null;
                return a && q && a === q.answer_label;
              }).length;
              const modAnswered = modSlots.filter((s) => submittedAnswers[s.slot_id]).length;
              const modPct = modAnswered > 0 ? Math.round((modCorrect / modAnswered) * 100) : 0;
              const c = MODULE_COLORS[mod];
              return (
                <div
                  key={mod}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl ${c.bg}`}
                >
                  <span className={`text-sm font-semibold ${c.text} w-40`}>{mod}</span>
                  <div className="flex-1 bg-white dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full ${c.bar}`}
                      style={{ width: `${modPct}%` }}
                    />
                  </div>
                  <span className={`text-sm font-bold ${c.text} w-10 text-right`}>{modPct}%</span>
                  <span className="text-xs text-gray-400 w-12 text-right">
                    {modCorrect}/{modAnswered}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Question review grid */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 mb-5">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Review questions — click to see solution
            </h3>
            <div className="space-y-3">
              {modules.map((mod, modIdx) => {
                const modSlots = slots.slice(
                  modIdx * QUESTIONS_PER_MODULE,
                  (modIdx + 1) * QUESTIONS_PER_MODULE
                );
                const c = MODULE_COLORS[mod];
                return (
                  <div key={mod}>
                    <div className={`text-xs font-semibold ${c.text} mb-1.5`}>{mod}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {modSlots.map((slot, i) => {
                        const globalIdx = modIdx * QUESTIONS_PER_MODULE + i;
                        const chosen = submittedAnswers[slot.slot_id];
                        const q = slot.question_id ? questions[slot.question_id] : null;
                        const correct = chosen && q ? chosen === q.answer_label : null;
                        const unanswered = !chosen;
                        return (
                          <button
                            key={slot.slot_id}
                            onClick={() => setReviewQuestionIdx(globalIdx)}
                            title={
                              unanswered
                                ? `Q${globalIdx + 1} — unanswered`
                                : correct
                                ? `Q${globalIdx + 1} — correct`
                                : `Q${globalIdx + 1} — incorrect`
                            }
                            className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors hover:opacity-80 ${
                              unanswered
                                ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
                                : correct
                                ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                                : 'bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400'
                            }`}
                          >
                            {i + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <PaperExport
            slots={slots}
            modules={modules}
            questions={questions}
            durationSeconds={paperTimerSeconds}
          />

          <button
            onClick={() => {
              setPhase('config');
              setActiveSessionId(null);
              setSlots([]);
              setModules([]);
            }}
            className="w-full mt-3 bg-accent hover:bg-accent-light text-white font-semibold py-3 rounded-xl transition-colors"
          >
            New Paper
          </button>
        </div>
      </div>
    );
  }

  // ── PAPER ──────────────────────────────────────────────────────
  const currentModule = currentSlot?.subject ?? '';
  const currentModuleColors = MODULE_COLORS[currentModule] ?? MODULE_COLORS['Mathematics'];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2.5">
        <div className="max-w-3xl mx-auto flex items-center gap-3 flex-wrap">
          <div className="flex gap-1.5 flex-wrap">
            {modules.map((m) => {
              const c = MODULE_COLORS[m];
              return (
                <span key={m} className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
                  {m}
                </span>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-3 flex-wrap">
            {/* Timer */}
            {paperTimerSeconds !== null && (
              <span
                className={`font-mono text-sm tabular-nums ${timerColor(timerRemaining)}`}
                title="Time remaining"
              >
                ⏱ {formatTime(timerRemaining)}
              </span>
            )}

            {/* Live score (only if live solution enabled) */}
            {paperLiveSolution && totalAnswered > 0 && (
              <span className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{totalCorrect}</span>
                /{totalAnswered}
              </span>
            )}

            {!paperLiveSolution && totalAnswered > 0 && (
              <span className="text-sm text-gray-500 dark:text-gray-400">{totalAnswered} answered</span>
            )}

            <QueueStatus slots={slots} compact />

            <button
              onClick={handleSubmitRequest}
              className="px-3 py-1.5 bg-accent hover:bg-accent-light text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Submit Paper
            </button>

            <button
              onClick={handleExit}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-300 dark:border-gray-700 rounded px-2 py-1"
            >
              Exit
            </button>
          </div>
        </div>
      </div>

      {/* Module-grouped question nav */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-4 py-2 overflow-x-auto">
        <div className="max-w-3xl mx-auto space-y-1.5">
          {modules.map((mod, modIdx) => {
            const modSlots = slots.slice(
              modIdx * QUESTIONS_PER_MODULE,
              (modIdx + 1) * QUESTIONS_PER_MODULE
            );
            const c = MODULE_COLORS[mod];
            return (
              <div key={mod} className="flex items-center gap-1.5 min-w-0">
                <span className={`text-xs font-semibold w-24 flex-shrink-0 ${c.text}`}>{mod}</span>
                <div className="flex gap-1 flex-wrap">
                  {modSlots.map((slot, i) => {
                    const globalIdx = modIdx * QUESTIONS_PER_MODULE + i;
                    const answered = submittedAnswers[slot.slot_id];
                    const q = slot.question_id ? questions[slot.question_id] : null;
                    // Show correctness in nav only if live solution is on
                    const isCorrect =
                      paperLiveSolution && answered && q
                        ? answered === q.answer_label
                        : null;
                    return (
                      <button
                        key={slot.slot_id}
                        onClick={() => handleNavigate(globalIdx)}
                        disabled={slot.status === 'planned' || slot.status === 'generating'}
                        title={`Q${globalIdx + 1} · ${slot.source_type === 'bank' ? 'Past paper' : 'AI'}`}
                        className={`flex-shrink-0 w-7 h-7 rounded text-xs font-semibold transition-colors ${
                          globalIdx === currentIdx ? `ring-2 ring-offset-1 ${c.ring}` : ''
                        } ${
                          isCorrect === true
                            ? 'bg-emerald-100 text-emerald-700'
                            : isCorrect === false
                            ? 'bg-red-100 text-red-600'
                            : answered
                            ? `${c.bg} ${c.text}`
                            : slot.status === 'ready'
                            ? 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                            : slot.status === 'generating'
                            ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-400 animate-pulse'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-300 dark:text-gray-600'
                        }`}
                      >
                        {i + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main */}
      <div className="max-w-2xl mx-auto p-4 space-y-4 pb-8">
        {/* Module indicator strip */}
        {currentSlot && (
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold ${currentModuleColors.bg} ${currentModuleColors.text}`}
          >
            <span className={`w-2 h-2 rounded-full ${currentModuleColors.dot}`} />
            {currentModule} · Q{currentIdx + 1} of {totalQuestions}
            <span className="ml-auto opacity-60">
              {currentSlot.source_type === 'bank' ? '📄 Past paper' : '✨ AI generated'}
            </span>
          </div>
        )}

        {isWaiting ? (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-12 text-center">
            <div className="text-3xl mb-3 animate-pulse">⚡</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Generating question {currentIdx + 1}…</div>
          </div>
        ) : currentSlot?.status === 'failed' ? (
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-xl p-6 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">Failed to generate this question.</p>
          </div>
        ) : currentQuestion ? (
          <QuestionCard
            question={currentQuestion}
            hints={currentHints}
            solution={currentSolution}
            tutorMessages={currentTutorMessages}
            submittedAnswer={currentAnswer}
            solutionRevealed={currentRevealed}
            hideSolution={!paperEnableSolution}
            hideFeedback={!paperLiveSolution}
            hideHints={!paperEnableHints}
            hideTutor={!paperEnableTutor}
            onAnswer={handleAnswer}
            onHintAdded={(h) => addHint(h)}
            onSolutionRevealed={() => {
              if (currentSlot) {
                const next = [...revealedSolutions, currentSlot.slot_id];
                setRevealedSolutions(next);
                if (activeSessionId) syncSession({ revealed_solutions: next }, activeSessionId);
              }
            }}
            onSolutionGenerated={(s) => addSolution(s)}
            onTutorMessage={(m) => addTutorMessage(currentQuestion.question_id, m)}
            questionNumber={currentIdx + 1}
            totalQuestions={totalQuestions}
            startTime={null}
          />
        ) : null}

        {/* Navigation */}
        {!isWaiting && currentSlot?.status !== 'failed' && (
          <div className="flex gap-3">
            <button
              onClick={() => handleNavigate(Math.max(0, currentIdx - 1))}
              disabled={currentIdx === 0}
              className="flex-1 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 transition-colors"
            >
              ← Previous
            </button>
            {isLastQuestion ? (
              <button
                onClick={handleSubmitRequest}
                className="flex-1 py-2.5 bg-accent hover:bg-accent-light text-white rounded-xl text-sm font-semibold transition-colors"
              >
                Submit
              </button>
            ) : (
              <button
                onClick={() => handleNavigate(Math.min(slots.length - 1, currentIdx + 1))}
                className="flex-1 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Next →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Unanswered questions warning modal */}
      {showSubmitWarning && (() => {
        const unansweredSlots = slots
          .map((s, i) => ({ slot: s, idx: i }))
          .filter(({ slot }) => slot.question_id && !submittedAnswers[slot.slot_id]);
        const firstUnanswered = unansweredSlots[0]?.idx ?? null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-sm w-full p-6">
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">
                {unansweredSlots.length} question{unansweredSlots.length !== 1 ? 's' : ''} unanswered
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                You haven&apos;t answered questions:{' '}
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {unansweredSlots.map(({ idx }) => idx + 1).join(', ')}
                </span>
              </p>
              <div className="flex flex-col gap-2">
                {firstUnanswered !== null && (
                  <button
                    onClick={() => {
                      setShowSubmitWarning(false);
                      handleNavigate(firstUnanswered);
                    }}
                    className="w-full py-2.5 border-2 border-accent text-accent rounded-xl text-sm font-semibold hover:bg-blue-50 transition-colors"
                  >
                    Go to Q{firstUnanswered + 1} (first unanswered)
                  </button>
                )}
                <button
                  onClick={() => handleSubmit()}
                  className="w-full py-2.5 bg-accent hover:bg-accent-light text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  Submit anyway
                </button>
                <button
                  onClick={() => setShowSubmitWarning(false)}
                  className="w-full py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  Go back
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
