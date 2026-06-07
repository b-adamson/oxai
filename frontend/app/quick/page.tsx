'use client';
import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '@/lib/store';
import { planMultiSubjectQuickSlots, startBackgroundGeneration } from '@/lib/queue';
import { QuestionCard } from '@/components/QuestionCard';
import { QueueStatus } from '@/components/QueueStatus';
import type {
  PaperSlot,
  DifficultyPreset,
  HintRecord,
  SolutionRecord,
  TutorChatMessage,
  AttemptRecord,
  SubjectTopicConfig,
} from '@/lib/types';

const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology'];
const PRELOAD = 4;
const BUFFER = 2;
const CONCURRENCY = 1;

// Topics per subject — each name is unique within its subject context
const SUBJECT_TOPICS: Record<string, string[]> = {
  Mathematics: [
    'Algebra', 'Calculus', 'Geometry', 'Trigonometry',
    'Statistics & Probability', 'Mechanics', 'Complex Numbers', 'Number Theory',
  ],
  Physics: [
    'Mechanics', 'Electricity & Magnetism', 'Waves & Optics',
    'Thermodynamics', 'Quantum Physics', 'Fields & Gravity', 'Modern Physics',
  ],
  Chemistry: [
    'Atomic Structure & Bonding', 'Energetics', 'Kinetics',
    'Equilibria', 'Organic Chemistry', 'Electrochemistry', 'Acids & Bases',
  ],
  Biology: [
    'Cell Biology', 'Genetics & Evolution', 'Biochemistry',
    'Ecology', 'Physiology', 'Microbiology',
  ],
};

const DIFFICULTY_LABELS: Record<DifficultyPreset, string> = {
  easy: 'Easy', realistic: 'Realistic', hard: 'Hard', olympiad: 'Olympiad', custom: 'Custom',
};

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
  if (ms === Infinity) return 'text-gray-700';
  if (ms < 5 * 60 * 1000) return 'text-red-600 font-bold animate-pulse';
  if (ms < 30 * 60 * 1000) return 'text-amber-600 font-semibold';
  return 'text-gray-700';
}

type Phase = 'config' | 'active' | 'report';

export default function QuickModePage() {
  // Config options
  const [subjectConfigs, setSubjectConfigs] = useState<SubjectTopicConfig[]>([
    { subject: 'Mathematics', difficulty: 'realistic', topics: null },
  ]);
  const [bankFraction, setBankFraction] = useState(0.5);
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [timerMinutes, setTimerMinutes] = useState(120);
  const [enableSolution, setEnableSolution] = useState(true);
  const [enableHints, setEnableHints] = useState(true);
  const [enableTutor, setEnableTutor] = useState(true);

  // Phase
  const [phase, setPhase] = useState<Phase>('config');

  // Active session state
  const [slots, setSlots] = useState<PaperSlot[]>([]);
  const [currentPos, setCurrentPos] = useState(0);
  const [submittedAnswer, setSubmittedAnswer] = useState<string | null>(null);
  const [solutionRevealed, setSolutionRevealed] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [sessionId] = useState(() => uuidv4());
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);

  // Session options captured at handleStart
  const [sessionTimerEnabled, setSessionTimerEnabled] = useState(false);
  const [sessionTimerTargetMs, setSessionTimerTargetMs] = useState<number | null>(null);
  const [sessionEnableSolution, setSessionEnableSolution] = useState(true);
  const [sessionEnableHints, setSessionEnableHints] = useState(true);
  const [sessionEnableTutor, setSessionEnableTutor] = useState(true);
  const [sessionSubject, setSessionSubject] = useState('Mathematics');
  const [sessionStartMs, setSessionStartMs] = useState<number | null>(null);

  // Refs — used in callbacks to avoid stale closures
  const stopGenRef = useRef<(() => void) | null>(null);
  const didAutoEndRef = useRef(false);
  const sessionSubjectConfigsRef = useRef<SubjectTopicConfig[]>([]);
  const sessionBankFractionRef = useRef(0.5);

  // Store selectors
  const questions = useStore((s) => s.questions);
  const hints = useStore((s) => s.hints);
  const solutions = useStore((s) => s.solutions);
  const tutorThreads = useStore((s) => s.tutorThreads);
  const addQuestion = useStore((s) => s.addQuestion);
  const recordAttempt = useStore((s) => s.recordAttempt);
  const addHint = useStore((s) => s.addHint);
  const addSolution = useStore((s) => s.addSolution);
  const addTutorMessage = useStore((s) => s.addTutorMessage);

  useEffect(() => {
    return () => { stopGenRef.current?.(); };
  }, []);

  const timerRemaining = useCountdown(sessionTimerTargetMs);

  useEffect(() => {
    if (
      phase === 'active' &&
      sessionTimerEnabled &&
      sessionTimerTargetMs !== null &&
      timerRemaining === 0 &&
      !didAutoEndRef.current
    ) {
      didAutoEndRef.current = true;
      stopGenRef.current?.();
      setPhase('report');
    }
  }, [timerRemaining, phase, sessionTimerEnabled, sessionTimerTargetMs]);

  function launchGeneration(newSlots: PaperSlot[]) {
    const stop = startBackgroundGeneration(newSlots, CONCURRENCY, {
      onSlotGenerating: (s) =>
        setSlots((prev) => prev.map((x) => x.slot_id === s.slot_id ? s : x)),
      onSlotReady: (s, q) => {
        addQuestion(q);
        setSlots((prev) => prev.map((x) => x.slot_id === s.slot_id ? s : x));
      },
      onSlotFailed: (s) =>
        setSlots((prev) => prev.map((x) => x.slot_id === s.slot_id ? s : x)),
    });
    stopGenRef.current?.();
    stopGenRef.current = stop;
  }

  function handleStart() {
    sessionSubjectConfigsRef.current = [...subjectConfigs];
    sessionBankFractionRef.current = bankFraction;

    const initial = planMultiSubjectQuickSlots(subjectConfigs, bankFraction, PRELOAD, 0);
    const now = Date.now();

    setSlots(initial);
    setCurrentPos(0);
    setSubmittedAnswer(null);
    setSolutionRevealed(false);
    setTotalAnswered(0);
    setTotalCorrect(0);
    setStreak(0);
    setBestStreak(0);
    setStartTime(now);
    setSessionStartMs(now);

    setSessionSubject(subjectConfigs.map((c) => c.subject).join(' · '));
    setSessionTimerEnabled(timerEnabled);
    setSessionTimerTargetMs(timerEnabled ? now + timerMinutes * 60 * 1000 : null);
    setSessionEnableSolution(enableSolution);
    setSessionEnableHints(enableHints);
    setSessionEnableTutor(enableTutor);
    didAutoEndRef.current = false;

    launchGeneration(initial);
    setPhase('active');
  }

  function handleEnd() {
    stopGenRef.current?.();
    setPhase('report');
  }

  function handleRestart() {
    setPhase('config');
    setSlots([]);
    setSessionTimerTargetMs(null);
  }

  function handleAnswer(label: string, timeTaken: number) {
    const slot = slots[currentPos];
    if (!slot?.question_id) return;
    const q = questions[slot.question_id];
    if (!q) return;
    const isCorrect = label === q.answer_label;

    setSubmittedAnswer(label);
    setTotalAnswered((a) => a + 1);

    if (isCorrect) {
      setTotalCorrect((c) => c + 1);
      setStreak((s) => {
        const next = s + 1;
        setBestStreak((b) => Math.max(b, next));
        return next;
      });
    } else {
      setStreak(0);
    }

    setSlots((prev) => prev.map((s, i) => i === currentPos ? { ...s, status: 'answered' as const } : s));

    const attempt: AttemptRecord = {
      attempt_id: uuidv4(),
      question_id: q.question_id,
      session_id: sessionId,
      mode: 'quick',
      chosen_answer: label,
      correct_answer: q.answer_label,
      is_correct: isCorrect,
      time_taken_seconds: timeTaken,
      hint_count: hints[q.question_id]?.length ?? 0,
      tutor_used: (tutorThreads[q.question_id]?.messages.length ?? 0) > 0,
      solution_revealed: solutionRevealed,
      topic: q.topic,
      subtopic: q.subtopic,
      difficulty: q.difficulty,
      source_type: q.source_type,
      attempted_at: Date.now(),
    };
    recordAttempt(attempt);
  }

  function handleNext() {
    const nextPos = currentPos + 1;
    const remaining = slots
      .slice(nextPos)
      .filter((s) => s.status !== 'answered' && s.status !== 'failed');

    if (remaining.length < BUFFER && sessionSubjectConfigsRef.current.length > 0) {
      const more = planMultiSubjectQuickSlots(
        sessionSubjectConfigsRef.current,
        sessionBankFractionRef.current,
        PRELOAD,
        slots.length,
      );
      setSlots((prev) => [...prev, ...more]);
      launchGeneration(more);
    }

    setCurrentPos(nextPos);
    setSubmittedAnswer(null);
    setSolutionRevealed(false);
    setStartTime(Date.now());
  }

  function handleSimilarQuestion() {
    const slot = slots[currentPos];
    if (!slot?.question_id) return;
    const similarSlot: PaperSlot = {
      slot_id: uuidv4(),
      position: currentPos + 0.5,
      subject: slot.subject,
      topic: slot.topic,
      subtopic: slot.subtopic,
      difficulty: slot.difficulty,
      diagram_requirement: 'never',
      source_type: 'fresh_ai',
      status: 'planned',
      question_id: null,
      retry_count: 0,
      error: null,
    };
    setSlots((prev) => [
      ...prev.slice(0, currentPos + 1),
      similarSlot,
      ...prev.slice(currentPos + 1),
    ]);
    launchGeneration([similarSlot]);
    handleNext();
  }

  // Current slot data
  const currentSlot = slots[currentPos] ?? null;
  const currentQuestion = currentSlot?.question_id ? questions[currentSlot.question_id] : null;
  const currentHints: HintRecord[] = currentSlot?.question_id ? (hints[currentSlot.question_id] ?? []) : [];
  const currentSolution: SolutionRecord | undefined = currentSlot?.question_id ? solutions[currentSlot.question_id] : undefined;
  const currentTutorMessages: TutorChatMessage[] = currentSlot?.question_id
    ? (tutorThreads[currentSlot.question_id]?.messages ?? [])
    : [];

  // ── Config screen ──────────────────────────────────────────────
  if (phase === 'config') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-lg">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Quick Mode</h1>
          <p className="text-sm text-gray-500 mb-6">Endless adaptive questions.</p>

          <div className="space-y-5">
            <SubjectTopicSelector configs={subjectConfigs} onChange={setSubjectConfigs} />

            <PickerGroup
              label="Question source"
              options={['All AI', 'Mostly AI', 'Mostly Past Papers', 'All Past Papers']}
              value={
                bankFraction === 0 ? 'All AI'
                  : bankFraction <= 0.3 ? 'Mostly AI'
                    : bankFraction <= 0.7 ? 'Mostly Past Papers'
                      : 'All Past Papers'
              }
              onChange={(v) =>
                setBankFraction(
                  ({ 'All AI': 0, 'Mostly AI': 0.25, 'Mostly Past Papers': 0.75, 'All Past Papers': 1 } as Record<string, number>)[v] ?? 0.5
                )
              }
            />

            {/* Options */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Options</span>
              </div>
              <div className="divide-y divide-gray-100">
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-gray-800">Timer</div>
                    {timerEnabled && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <input
                          type="number"
                          min={5}
                          max={300}
                          value={timerMinutes}
                          onChange={(e) =>
                            setTimerMinutes(Math.max(5, Math.min(300, Number(e.target.value))))
                          }
                          className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-center text-gray-800"
                        />
                        <span className="text-xs text-gray-500">minutes</span>
                      </div>
                    )}
                  </div>
                  <Toggle value={timerEnabled} onChange={setTimerEnabled} />
                </div>
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-gray-800">Solutions</div>
                    <div className="text-xs text-gray-400">Worked solution button</div>
                  </div>
                  <Toggle value={enableSolution} onChange={setEnableSolution} />
                </div>
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-gray-800">Hints</div>
                    <div className="text-xs text-gray-400">Step-by-step hints</div>
                  </div>
                  <Toggle value={enableHints} onChange={setEnableHints} />
                </div>
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-gray-800">AI Tutor</div>
                    <div className="text-xs text-gray-400">Ask the tutor for guidance</div>
                  </div>
                  <Toggle value={enableTutor} onChange={setEnableTutor} />
                </div>
              </div>
            </div>

            <button
              onClick={handleStart}
              className="w-full bg-accent hover:bg-accent-light text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Start Practising
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Report screen ──────────────────────────────────────────────
  if (phase === 'report') {
    const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
    const elapsedSec = sessionStartMs ? Math.floor((Date.now() - sessionStartMs) / 1000) : 0;
    const elapsedMin = Math.floor(elapsedSec / 60);
    const elapsedS = elapsedSec % 60;
    const timeStr = elapsedMin > 0 ? `${elapsedMin}m ${elapsedS}s` : `${elapsedSec}s`;

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">
              {accuracy >= 80 ? '🎉' : accuracy >= 60 ? '👍' : '📚'}
            </div>
            <h2 className="text-xl font-bold text-gray-900">Session complete</h2>
            <p className="text-sm text-gray-500 mt-1">{sessionSubject}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <StatBox label="Answered" value={String(totalAnswered)} />
            <StatBox label="Correct" value={String(totalCorrect)} />
            <StatBox
              label="Accuracy"
              value={`${accuracy}%`}
              valueClass={accuracy >= 80 ? 'text-emerald-600' : accuracy >= 60 ? 'text-amber-600' : 'text-red-500'}
            />
            <StatBox label="Best streak" value={String(bestStreak)} />
          </div>
          <div className="text-center text-xs text-gray-400 mb-6">Time: {timeStr}</div>
          <div className="flex flex-col gap-3">
            <button
              onClick={handleRestart}
              className="w-full bg-accent hover:bg-accent-light text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Practice Again
            </button>
            <button
              onClick={handleRestart}
              className="w-full text-sm text-gray-500 hover:text-gray-700 transition-colors py-2"
            >
              Back to config
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Active screen ──────────────────────────────────────────────
  const isWaiting = !currentSlot ||
    currentSlot.status === 'planned' ||
    currentSlot.status === 'generating';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3">
        <span className="font-semibold text-gray-800 text-sm">Quick Mode</span>
        <span className="text-gray-300">·</span>
        <span className="text-sm text-gray-500 truncate max-w-[180px]">{sessionSubject}</span>
        <div className="ml-auto flex items-center gap-4">
          {sessionTimerEnabled && sessionTimerTargetMs !== null && (
            <span className={`text-sm font-mono ${timerColor(timerRemaining)}`}>
              {formatTime(timerRemaining)}
            </span>
          )}
          <div className="text-sm text-gray-600">
            <span className="font-semibold text-emerald-600">{totalCorrect}</span>
            <span className="text-gray-400">/{totalAnswered}</span>
            {streak >= 3 && (
              <span className="ml-2 text-amber-500 font-semibold">🔥 {streak}</span>
            )}
          </div>
          <QueueStatus slots={slots} compact />
          <button
            onClick={handleEnd}
            className="text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded px-2 py-1 transition-colors"
          >
            End
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4 pb-8">
        {isWaiting ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="text-3xl mb-3 animate-pulse">⚡</div>
            <div className="text-sm text-gray-500">Generating question…</div>
            <QueueStatus slots={slots} label="Queue" />
          </div>
        ) : currentSlot?.status === 'failed' ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <p className="text-sm text-red-600 mb-3">Failed to generate question.</p>
            <button onClick={handleNext} className="text-sm text-red-600 underline">
              Skip →
            </button>
          </div>
        ) : currentQuestion ? (
          <>
            <QuestionCard
              question={currentQuestion}
              hints={currentHints}
              solution={currentSolution}
              tutorMessages={currentTutorMessages}
              submittedAnswer={submittedAnswer}
              solutionRevealed={solutionRevealed}
              hideSolution={!sessionEnableSolution}
              hideHints={!sessionEnableHints}
              hideTutor={!sessionEnableTutor}
              onAnswer={handleAnswer}
              onHintAdded={(h) => addHint(h)}
              onSolutionRevealed={() => setSolutionRevealed(true)}
              onSolutionGenerated={(s) => addSolution(s)}
              onTutorMessage={(m) => addTutorMessage(currentQuestion.question_id, m)}
              onSimilarQuestion={submittedAnswer !== null ? handleSimilarQuestion : undefined}
              questionNumber={totalAnswered + (submittedAnswer ? 0 : 1)}
              startTime={startTime}
            />
            {submittedAnswer !== null && (
              <button
                onClick={handleNext}
                className="w-full bg-accent hover:bg-accent-light text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Next Question →
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── SubjectTopicSelector ───────────────────────────────────────

function SubjectTopicSelector({
  configs,
  onChange,
}: {
  configs: SubjectTopicConfig[];
  onChange: (configs: SubjectTopicConfig[]) => void;
}) {
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());
  const active = new Set(configs.map((c) => c.subject));

  function toggleSubject(subject: string) {
    if (active.has(subject)) {
      if (configs.length === 1) return; // keep at least one
      onChange(configs.filter((c) => c.subject !== subject));
    } else {
      onChange([...configs, { subject, difficulty: 'realistic', topics: null }]);
    }
  }

  function updateConfig(subject: string, patch: Partial<SubjectTopicConfig>) {
    onChange(configs.map((c) => c.subject === subject ? { ...c, ...patch } : c));
  }

  function toggleTopicExpand(subject: string) {
    setExpandedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(subject)) next.delete(subject); else next.add(subject);
      return next;
    });
  }

  function toggleTopic(subject: string, topic: string) {
    const config = configs.find((c) => c.subject === subject);
    if (!config) return;
    const allTopics = SUBJECT_TOPICS[subject] ?? [];
    const current = config.topics ?? allTopics;
    const next = current.includes(topic)
      ? current.filter((t) => t !== topic)
      : [...current, topic];
    if (next.length === 0) return; // keep at least one topic
    updateConfig(subject, { topics: next.length === allTopics.length ? null : next });
  }

  return (
    <div className="space-y-3">
      {/* Subject chips */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Subjects</label>
        <div className="grid grid-cols-2 gap-2">
          {SUBJECTS.map((subject) => (
            <button
              key={subject}
              onClick={() => toggleSubject(subject)}
              className={`py-2 px-3 rounded-lg border text-sm font-medium transition-colors text-left flex items-center gap-2 ${
                active.has(subject)
                  ? 'bg-accent text-white border-accent'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
              }`}
            >
              {active.has(subject) && <span className="text-xs opacity-80">✓</span>}
              {subject}
            </button>
          ))}
        </div>
      </div>

      {/* Per-subject config cards */}
      {configs.map((config) => {
        const allTopics = SUBJECT_TOPICS[config.subject] ?? [];
        const selectedTopics = config.topics ?? allTopics;
        const isExpanded = expandedTopics.has(config.subject);
        const allSelected = config.topics === null;

        return (
          <div key={config.subject} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {config.subject}
              </span>
            </div>

            <div className="px-4 py-3 space-y-3">
              {/* Difficulty row */}
              <div>
                <div className="text-xs text-gray-500 mb-1.5">Difficulty</div>
                <div className="flex gap-1.5 flex-wrap">
                  {(['easy', 'realistic', 'hard', 'olympiad'] as DifficultyPreset[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => updateConfig(config.subject, { difficulty: d })}
                      className={`flex-1 min-w-0 py-1 rounded text-xs font-medium border transition-colors ${
                        config.difficulty === d
                          ? 'bg-accent text-white border-accent'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      {DIFFICULTY_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Topics */}
              <div>
                <button
                  onClick={() => toggleTopicExpand(config.subject)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors"
                >
                  <span
                    className="inline-block transition-transform duration-150"
                    style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  >
                    ›
                  </span>
                  <span>
                    Topics:{' '}
                    <span className={allSelected ? 'text-gray-400' : 'text-accent font-medium'}>
                      {allSelected
                        ? 'All'
                        : `${selectedTopics.length} of ${allTopics.length} selected`}
                    </span>
                  </span>
                </button>

                {isExpanded && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => updateConfig(config.subject, { topics: null })}
                        className="text-xs text-accent hover:underline"
                      >
                        Select all
                      </button>
                      <span className="text-gray-300 text-xs">·</span>
                      <button
                        onClick={() =>
                          updateConfig(config.subject, { topics: [allTopics[0]] })
                        }
                        className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {allTopics.map((topic) => {
                        const selected = selectedTopics.includes(topic);
                        return (
                          <button
                            key={topic}
                            onClick={() => toggleTopic(config.subject, topic)}
                            className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                              selected
                                ? 'bg-blue-50 border-accent/40 text-accent font-medium'
                                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                            }`}
                          >
                            {topic}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Shared UI primitives ───────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        value ? 'bg-accent' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          value ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function PickerGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
              value === opt
                ? 'bg-accent text-white border-accent'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  valueClass = 'text-gray-900',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 text-center">
      <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}
