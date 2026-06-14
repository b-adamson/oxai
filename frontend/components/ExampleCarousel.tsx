'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MathText } from './MathText';
import { FigureRenderer } from './FigureRenderer';
import { StreamingText } from './SolutionPanel';
import type { FigureSpec } from '@/lib/types';

interface ExampleOption { label: string; text: string; }
interface RawFigure {
  figure_type: string;
  caption: string;
  url?: string | null;
  diagram_prompt: string | null;
  table_headers: string[] | null;
  table_rows: string[][] | null;
  table_row_labels: string[] | null;
  graph_type: string | null;
  graph_title: string | null;
  graph_x_label: string | null;
  graph_y_label: string | null;
  graph_x_labels: string[] | null;
  graph_series: { name: string; x_values: number[]; y_values: number[] }[] | null;
  graph_x_min: number | null;
  graph_x_max: number | null;
  graph_y_min: number | null;
  graph_y_max: number | null;
}

export interface ExampleQuestion {
  question_id: string;
  content: { subject: string; topic: string; subtopic: string; difficulty: number; };
  prompt: { stem: string; options: ExampleOption[]; figures: RawFigure[]; };
  validation: { answer_label: string; answer_text: string; worked_solution?: string; };
}

const SUBJECT_COLORS: Record<string, string> = {
  physics:   'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  math:      'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  maths:     'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  chemistry: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  biology:   'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
};

function displaySubject(s: string) {
  const lower = s.toLowerCase();
  if (lower === 'math' || lower === 'maths') return 'Maths';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function subjectColor(s: string) {
  return SUBJECT_COLORS[s.toLowerCase()] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
}

function Stars({ n }: { n: number }) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M6 1l1.3 2.6 2.9.4-2.1 2 .5 2.9L6 7.5 3.4 8.9l.5-2.9-2.1-2 2.9-.4L6 1z"
            fill={i < n ? '#f59e0b' : 'none'}
            stroke={i < n ? '#f59e0b' : '#9ca3af'}
            strokeWidth="0.8"
          />
        </svg>
      ))}
    </span>
  );
}

// ── Solution panel for the carousel ──────────────────────────────────────
function CarouselSolutionPanel({ solution }: { solution: string }) {
  return (
    <div className="rounded-xl border border-accent/20 bg-accent/5 dark:bg-accent/10 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-accent/10 bg-accent/5">
        <span className="text-xs font-bold uppercase tracking-wide text-accent">Worked Solution</span>
      </div>
      <div className="px-4 py-4 max-h-72 overflow-y-auto">
        <StreamingText
          text={solution}
          className="text-sm leading-relaxed text-gray-700 dark:text-gray-300"
        />
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────
function ExampleCard({ q }: { q: ExampleQuestion }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [solutionOpen, setSolutionOpen] = useState(false);

  function goToPricing() { router.push('/#pricing'); }

  const correctLabel = q.validation.answer_label;
  const isAnswered = selected !== null;
  const isCorrect = selected === correctLabel;

  function handleSelect(label: string) {
    if (isAnswered) return;
    setSelected(label);
    setSolutionOpen(true);
  }

  const figures = (q.prompt.figures ?? []) as unknown as FigureSpec[];
  const renderable = figures.filter(
    f => f.figure_type === 'simple_graph' || f.figure_type === 'table' || f.figure_type === 'complex_diagram'
  );

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 rounded-t-2xl">
        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${subjectColor(q.content.subject)}`}>
          {displaySubject(q.content.subject)}
        </span>
        <span className="text-sm text-gray-500 dark:text-gray-400 truncate">{q.content.topic}</span>
        <span className="ml-auto shrink-0">
          <Stars n={q.content.difficulty} />
        </span>
      </div>

      {/* Body */}
      <div className="px-5 pt-5 pb-5 space-y-4 flex-1">
        <div className="text-base leading-relaxed text-gray-800 dark:text-gray-200 font-serif">
          <MathText text={q.prompt.stem} block />
        </div>

        {renderable.map((fig, i) => (
          <FigureRenderer key={i} spec={fig} />
        ))}

        <div className="space-y-2">
          {q.prompt.options.map((opt) => {
            const isSelected = selected === opt.label;
            const isRight = opt.label === correctLabel;
            let cls = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-accent/50 cursor-pointer';
            if (isAnswered) {
              if (isRight) cls = 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-600';
              else if (isSelected) cls = 'border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-600';
              else cls = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 opacity-40 cursor-default';
            }
            return (
              <div
                key={opt.label}
                onClick={() => handleSelect(opt.label)}
                className={`flex items-center gap-3 text-sm px-4 py-2.5 rounded-xl border transition-all select-none ${cls}`}
              >
                <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  isAnswered && isRight ? 'bg-emerald-500 text-white'
                  : isAnswered && isSelected ? 'bg-red-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                }`}>
                  {opt.label}
                </span>
                <span className="text-gray-700 dark:text-gray-300 leading-snug">
                  <MathText text={opt.text} />
                </span>
                {isAnswered && isRight && <span className="ml-auto text-emerald-500 font-bold shrink-0">✓</span>}
                {isAnswered && isSelected && !isRight && <span className="ml-auto text-red-500 font-bold shrink-0">✗</span>}
              </div>
            );
          })}
        </div>

        {isAnswered && (
          <div className={`text-sm font-semibold px-4 py-2.5 rounded-xl text-center ${
            isCorrect
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
              : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
          }`}>
            {isCorrect ? '✓ Correct!' : `✗ Incorrect — correct answer is ${correctLabel}`}
          </div>
        )}

        <button
          onClick={() => setSolutionOpen(v => !v)}
          className="w-full text-sm font-medium py-2 rounded-xl border border-accent/30 text-accent hover:bg-accent/5 dark:hover:bg-gray-800 transition-colors"
        >
          {solutionOpen ? 'Hide solution' : 'Show worked solution'}
        </button>

        {solutionOpen && q.validation.worked_solution && (
          <CarouselSolutionPanel solution={q.validation.worked_solution} />
        )}

        {/* Locked hint button */}
        <button
          onClick={goToPricing}
          className="w-full text-sm font-medium py-2 rounded-xl border border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors flex items-center justify-center gap-2"
        >
          <span>🔒</span> Get a hint
        </button>

        {/* Locked Ask Tutor */}
        <button
          onClick={goToPricing}
          className="w-full text-sm font-medium py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
        >
          <span>🔒</span> Ask Tutor
        </button>
      </div>
    </div>
  );
}

// ── Carousel ──────────────────────────────────────────────────────────────

interface SlideState {
  outgoing: ExampleQuestion[];
  incoming: ExampleQuestion[];
  newOffset: number;
  dir: 'next' | 'prev';
  phase: 'prepare' | 'animate';
}

function getSlice(questions: ExampleQuestion[], offset: number, count: number) {
  return Array.from({ length: count }, (_, i) => questions[(offset + i) % questions.length]);
}

export function ExampleCarousel({ questions }: { questions: ExampleQuestion[] }) {
  const total = questions.length;
  const visible = 2;
  const [offset, setOffset] = useState(0);
  const [slide, setSlide] = useState<SlideState | null>(null);
  const animatingRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [minHeight, setMinHeight] = useState(0);

  // Ratchet: min-height only ever grows, never shrinks — prevents layout jumps
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      setMinHeight(prev => (h > prev ? h : prev));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const currentSlice = getSlice(questions, offset, visible);
  const activeIndices = slide
    ? Array.from({ length: visible }, (_, i) => (slide.newOffset + i) % total)
    : Array.from({ length: visible }, (_, i) => (offset + i) % total);

  function navigate(newOffset: number, dir: 'next' | 'prev') {
    if (animatingRef.current) return;
    animatingRef.current = true;
    const incoming = getSlice(questions, newOffset, visible);
    setSlide({ outgoing: currentSlice, incoming, newOffset, dir, phase: 'prepare' });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setSlide(s => s ? { ...s, phase: 'animate' } : null);
      // Commit after the 500ms CSS transition — no dependency on onTransitionEnd
      setTimeout(() => {
        setOffset(newOffset);
        setSlide(null);
        animatingRef.current = false;
      }, 520);
    }));
  }

  function next() { navigate((offset + 1) % total, 'next'); }
  function prev() { navigate((offset - 1 + total) % total, 'prev'); }
  function goTo(i: number) { navigate(i, i > offset ? 'next' : 'prev'); }

  // Outgoing stays in NORMAL FLOW to hold container height during transition.
  // Incoming slides in as absolute on top.
  const outX = slide?.phase === 'animate'
    ? (slide.dir === 'next' ? '-translate-x-full' : 'translate-x-full')
    : 'translate-x-0';

  const inX = slide?.phase === 'animate'
    ? 'translate-x-0'
    : (slide?.dir === 'next' ? 'translate-x-full' : '-translate-x-full');

  const gridCls = 'grid grid-cols-1 md:grid-cols-2 items-start gap-6';

  return (
    <div>
      {/* Weekly refresh note */}
      <p className="text-center text-xs text-gray-400 dark:text-gray-600 mb-4 italic">
        Example questions refresh every week
      </p>

      {/* Nav */}
      <div className="flex items-center justify-center gap-4 mb-7">
        <button
          onClick={prev}
          disabled={!!slide}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-accent border border-gray-200 dark:border-gray-700 hover:border-accent/40 px-5 py-2 rounded-full transition-colors bg-white dark:bg-gray-900 shadow-sm disabled:opacity-40"
        >
          &#8592; Prev
        </button>

        <div className="flex gap-2">
          {questions.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                activeIndices.includes(i)
                  ? 'bg-accent'
                  : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
              aria-label={`Go to question ${i + 1}`}
            />
          ))}
        </div>

        <button
          onClick={next}
          disabled={!!slide}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-accent border border-gray-200 dark:border-gray-700 hover:border-accent/40 px-5 py-2 rounded-full transition-colors bg-white dark:bg-gray-900 shadow-sm disabled:opacity-40"
        >
          Next &#8594;
        </button>
      </div>

      {/* Slide stage — outgoing stays in flow, incoming absolute on top */}
      <div ref={stageRef} className="relative overflow-hidden" style={{ minHeight: minHeight || undefined }}>
        {/* Outgoing: stays in normal flow (holds container height).
            Transition class only applied while sliding — removing it on cleanup
            prevents the div snapping back from -translate-x-full with an animation. */}
        <div className={`${gridCls} ${slide ? 'transition-transform duration-500 ease-in-out' : ''} ${outX}`}>
          {(slide?.outgoing ?? currentSlice).map(q => (
            <ExampleCard key={q.question_id} q={q} />
          ))}
        </div>

        {/* Incoming: absolute, slides in on top */}
        {slide && (
          <div className={`absolute inset-0 ${gridCls} transition-transform duration-500 ease-in-out ${inX}`}>
            {slide.incoming.map(q => (
              <ExampleCard key={q.question_id} q={q} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
