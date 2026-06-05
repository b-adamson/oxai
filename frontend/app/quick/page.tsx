'use client';
import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '@/lib/store';
import { computeMastery } from '@/lib/analytics';
import { planQuickSlots, startBackgroundGeneration, slotCounts } from '@/lib/queue';
import { QuestionCard } from '@/components/QuestionCard';
import { QueueStatus } from '@/components/QueueStatus';
import type {
  PaperSlot,
  QuickModeConfig,
  DifficultyPreset,
  TopicMode,
  HintRecord,
  SolutionRecord,
  TutorChatMessage,
  AttemptRecord,
} from '@/lib/types';

const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology'];
const PRELOAD = 4;
const BUFFER = 2;
const CONCURRENCY = 2;

function makeConfig(
  subject: string,
  topicMode: TopicMode,
  difficultyPreset: DifficultyPreset
): QuickModeConfig {
  return {
    topic_mode: topicMode,
    custom_topics: [],
    diagram_policy: 'sometimes',
    difficulty_preset: difficultyPreset,
    custom_difficulty: 3,
    min_preload_count: PRELOAD,
    solution_hidden: false,
    timer_enabled: false,
    target_subject: subject,
  };
}

export default function QuickModePage() {
  const [phase, setPhase] = useState<'config' | 'active'>('config');
  const [subject, setSubject] = useState('Mathematics');
  const [topicMode, setTopicMode] = useState<TopicMode>('all_topics');
  const [difficultyPreset, setDifficultyPreset] = useState<DifficultyPreset>('realistic');

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
  const [configRef, setConfigRef] = useState<QuickModeConfig | null>(null);

  const stopGenRef = useRef<(() => void) | null>(null);

  // Store selectors
  const questions = useStore((s) => s.questions);
  const hints = useStore((s) => s.hints);
  const solutions = useStore((s) => s.solutions);
  const tutorThreads = useStore((s) => s.tutorThreads);
  const attempts = useStore((s) => s.attempts);
  const inventory = useStore((s) => s.inventory);
  const addQuestion = useStore((s) => s.addQuestion);
  const recordAttempt = useStore((s) => s.recordAttempt);
  const addHint = useStore((s) => s.addHint);
  const addSolution = useStore((s) => s.addSolution);
  const addTutorMessage = useStore((s) => s.addTutorMessage);

  useEffect(() => {
    return () => { stopGenRef.current?.(); };
  }, []);

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
    const config = makeConfig(subject, topicMode, difficultyPreset);
    const mastery = computeMastery(attempts);
    const initial = planQuickSlots(config, mastery, inventory, PRELOAD, 0);
    setConfigRef(config);
    setSlots(initial);
    setCurrentPos(0);
    setSubmittedAnswer(null);
    setSolutionRevealed(false);
    setTotalAnswered(0);
    setTotalCorrect(0);
    setStreak(0);
    setBestStreak(0);
    setStartTime(Date.now());
    launchGeneration(initial);
    setPhase('active');
  }

  function handleEnd() {
    stopGenRef.current?.();
    setPhase('config');
    setSlots([]);
    setConfigRef(null);
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

    if (remaining.length < BUFFER && configRef) {
      const mastery = computeMastery(attempts);
      const more = planQuickSlots(configRef, mastery, inventory, PRELOAD, slots.length);
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
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Quick Mode</h1>
          <p className="text-sm text-gray-500 mb-6">
            Endless adaptive questions. No time pressure.
          </p>

          <div className="space-y-5">
            <PickerGroup label="Subject" options={SUBJECTS} value={subject} onChange={setSubject} />

            <PickerGroup
              label="Topic focus"
              options={['All topics', 'Focus on weak']}
              value={topicMode === 'all_topics' ? 'All topics' : 'Focus on weak'}
              onChange={(v) => setTopicMode(v === 'All topics' ? 'all_topics' : 'weak_topics')}
            />

            <PickerGroup
              label="Difficulty"
              options={['Easy', 'Realistic', 'Hard', 'Olympiad']}
              value={({ easy: 'Easy', realistic: 'Realistic', hard: 'Hard', olympiad: 'Olympiad', custom: 'Realistic' } as Record<string, string>)[difficultyPreset] ?? 'Realistic'}
              onChange={(v) =>
                setDifficultyPreset(
                  { Easy: 'easy', Realistic: 'realistic', Hard: 'hard', Olympiad: 'olympiad' }[v] as DifficultyPreset ?? 'realistic'
                )
              }
            />

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

  // ── Active screen ──────────────────────────────────────────────
  const isWaiting = !currentSlot ||
    currentSlot.status === 'planned' ||
    currentSlot.status === 'generating';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3">
        <span className="font-semibold text-gray-800 text-sm">Quick Mode</span>
        <span className="text-gray-300">·</span>
        <span className="text-sm text-gray-500">{subject}</span>
        <div className="ml-auto flex items-center gap-4">
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

      {/* Content */}
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
              hideSolution={false}
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
