'use client';
import { useRef, useState, useEffect, useCallback } from 'react';
import { MathText } from './MathText';
import { FigureRenderer } from './FigureRenderer';
import { HintPanel } from './HintPanel';
import { SolutionPanel } from './SolutionPanel';
import { TutorChat } from './TutorChat';
import { WhiteboardCanvas, type WhiteboardHandle } from './WhiteboardCanvas';
import type { QuestionRecord, HintRecord, SolutionRecord, TutorChatMessage, TutorAnnotation, WhiteboardState } from '@/lib/types';
import { difficultyLabel, subjectColor, displaySubject } from '@/lib/questionUtils';
import { useStore } from '@/lib/store';

type Layout = 'single' | 'two-column';

const EMPTY_WHITEBOARD: WhiteboardState = { strokes: [], annotations: [] };

interface QuestionCardProps {
  question: QuestionRecord;
  hints: HintRecord[];
  solution: SolutionRecord | undefined;
  tutorMessages: TutorChatMessage[];
  submittedAnswer: string | null;
  solutionRevealed: boolean;
  hideSolution?: boolean;
  hideHints?: boolean;
  hideTutor?: boolean;

  onAnswer: (label: string, timeTaken: number) => void;
  onHintAdded: (h: HintRecord) => void;
  onSolutionRevealed: () => void;
  onSolutionGenerated: (sol: SolutionRecord) => void;
  onTutorMessage: (msg: TutorChatMessage) => void;
  onClearTutorMessages?: () => void;
  onSimilarQuestion?: () => void;

  questionNumber?: number;
  totalQuestions?: number;
  startTime?: number | null;
  hideFeedback?: boolean;
  layout?: Layout;
}

type Panel = 'none' | 'hints' | 'solution' | 'tutor';

export function QuestionCard({
  question,
  hints,
  solution,
  tutorMessages,
  submittedAnswer,
  solutionRevealed,
  hideSolution = true,
  hideHints = false,
  hideTutor = false,
  onAnswer,
  onHintAdded,
  onSolutionRevealed,
  onSolutionGenerated,
  onTutorMessage,
  onClearTutorMessages,
  onSimilarQuestion,
  questionNumber,
  totalQuestions,
  startTime,
  hideFeedback = false,
  layout = 'single',
}: QuestionCardProps) {
  const [panel, setPanel] = useState<Panel>('none');
  const [hoveredOption, setHoveredOption] = useState<string | null>(null);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);

  const whiteboardState = useStore((s) => s.whiteboards[question.question_id] ?? EMPTY_WHITEBOARD);
  const setWhiteboardStrokes = useStore((s) => s.setWhiteboardStrokes);
  const addWhiteboardAnnotations = useStore((s) => s.addWhiteboardAnnotations);

  const whiteboardRef = useRef<WhiteboardHandle>(null);

  const answered = submittedAnswer !== null;
  const correct = question.answer_label;

  function handleOptionClick(label: string) {
    if (answered && !hideFeedback) return;
    const timeTaken = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    onAnswer(label, timeTaken);
  }

  function togglePanel(p: Panel) {
    setPanel((prev) => (prev === p ? 'none' : p));
  }

  function handleRevealSolution() {
    if (!solutionRevealed) onSolutionRevealed();
    setPanel('solution');
  }

  function handleToggleWhiteboard() {
    setWhiteboardOpen((o) => !o);
  }

  function handleAnnotations(annotations: TutorAnnotation[]) {
    addWhiteboardAnnotations(question.question_id, annotations);
    if (!whiteboardOpen) setWhiteboardOpen(true);
  }

  function getOptionStyle(label: string): string {
    const base = 'flex items-start gap-3 p-3 rounded-lg border-2 transition-all text-left w-full text-gray-900 dark:text-gray-100';
    if (!answered) {
      return `${base} ${
        hoveredOption === label
          ? 'border-accent bg-blue-50 dark:bg-blue-950/30 cursor-pointer'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-600 cursor-pointer'
      }`;
    }
    if (hideFeedback) {
      if (label === submittedAnswer) return `${base} border-accent bg-blue-50 dark:bg-blue-950/30 cursor-pointer`;
      return `${base} ${
        hoveredOption === label
          ? 'border-accent bg-blue-50 dark:bg-blue-950/30 cursor-pointer'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-600 cursor-pointer'
      }`;
    }
    if (label === correct) return `${base} border-emerald-500 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30`;
    if (label === submittedAnswer && label !== correct) return `${base} border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-950/30`;
    return `${base} border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 opacity-60`;
  }

  // Question stem + options (no whiteboard — whiteboard is rendered separately)
  const questionContent = (
    <div className="px-5 py-5">
      <MathText
        text={question.stem}
        block
        className="text-base leading-relaxed text-gray-900 dark:text-gray-100 font-serif"
      />

      {question.figures.length > 0 &&
        question.figures.map((fig, i) => <FigureRenderer key={i} spec={fig} />)}

      {question.figures.length === 0 && question.diagram_url && (
        <div className="mt-4">
          <img
            src={question.diagram_url}
            alt="Figure"
            className="max-w-full max-h-72 mx-auto rounded border border-gray-200"
          />
        </div>
      )}

      <div className="mt-6 space-y-2">
        {question.options.map((opt) => (
          <button
            key={opt.label}
            onClick={() => handleOptionClick(opt.label)}
            onMouseEnter={() => (!answered || hideFeedback) && setHoveredOption(opt.label)}
            onMouseLeave={() => setHoveredOption(null)}
            className={getOptionStyle(opt.label)}
            disabled={answered && !hideFeedback}
          >
            <div
              className={`
              flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
              ${!hideFeedback && answered && opt.label === correct ? 'bg-emerald-500 text-white' : ''}
              ${!hideFeedback && answered && opt.label === submittedAnswer && opt.label !== correct ? 'bg-red-400 text-white' : ''}
              ${hideFeedback || !answered || (opt.label !== correct && opt.label !== submittedAnswer) ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' : ''}
            `}
            >
              {opt.label}
            </div>
            <MathText text={opt.text} className="text-sm leading-relaxed pt-0.5 text-gray-900 dark:text-gray-100" />
            {answered && !hideFeedback && opt.label === correct && (
              <span className="ml-auto text-emerald-600 font-bold text-lg leading-none">&#10003;</span>
            )}
            {answered && !hideFeedback && opt.label === submittedAnswer && opt.label !== correct && (
              <span className="ml-auto text-red-500 font-bold text-lg leading-none">&#10007;</span>
            )}
          </button>
        ))}
      </div>

      {answered && !hideFeedback && (
        <div
          className={`mt-4 p-3 rounded-lg text-sm font-medium ${
            submittedAnswer === correct
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              : 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}
        >
          {submittedAnswer === correct ? '✓ Correct!' : `✗ Incorrect. The answer is ${correct}.`}
        </div>
      )}
    </div>
  );

  // Whiteboard node — reused in both single and two-column layouts
  const whiteboardNode = (
    <WhiteboardCanvas
      key={question.question_id}
      ref={whiteboardRef}
      strokes={whiteboardState.strokes}
      annotations={whiteboardState.annotations}
      onStrokesChange={(strokes) => setWhiteboardStrokes(question.question_id, strokes)}
      fullscreenSidebar={
        <WhiteboardSidebar
          question={question}
          submittedAnswer={submittedAnswer}
          hideFeedback={hideFeedback}
          tutorMessages={tutorMessages}
          hints={hints}
          solution={solution}
          solutionRevealed={solutionRevealed}
          hideHints={hideHints}
          hideSolution={hideSolution}
          onTutorMessage={onTutorMessage}
          onHintAdded={onHintAdded}
          onSolutionRevealed={onSolutionRevealed}
          onSolutionGenerated={onSolutionGenerated}
          onClearTutorMessages={onClearTutorMessages}
          getWhiteboardSnapshot={() => whiteboardRef.current?.getSnapshot() ?? null}
          whiteboardStrokeCount={whiteboardState.strokes.length}
          onAnnotations={handleAnnotations}
        />
      }
    />
  );

  const actionBar = (
    <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
      <ActionButton
        active={whiteboardOpen}
        onClick={handleToggleWhiteboard}
        icon="&#9999;&#65039;"
        label={whiteboardOpen ? 'Board' : 'Whiteboard'}
      />
      {!hideHints && (
        <ActionButton
          active={panel === 'hints'}
          onClick={() => togglePanel('hints')}
          icon="&#128161;"
          label={hints.length > 0 ? `Hints (${hints.length})` : 'Hints'}
        />
      )}
      {!hideSolution && (
        <ActionButton
          active={panel === 'solution' && solutionRevealed}
          onClick={handleRevealSolution}
          icon="&#128203;"
          label="Solution"
        />
      )}
      {!hideTutor && (
        <ActionButton
          active={panel === 'tutor'}
          onClick={() => togglePanel('tutor')}
          icon="&#127891;"
          label={tutorMessages.length > 0 ? `Tutor (${Math.ceil(tutorMessages.length / 2)})` : 'Ask Tutor'}
        />
      )}
      {onSimilarQuestion && answered && (
        <ActionButton active={false} onClick={onSimilarQuestion} icon="&#128260;" label="Similar question" />
      )}
    </div>
  );

  const header = (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
      {questionNumber != null && (
        <span className="text-xs font-bold text-white bg-accent px-2.5 py-1 rounded-md">
          {questionNumber}{totalQuestions ? ` / ${totalQuestions}` : ''}
        </span>
      )}
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${subjectColor(question.subject)}`}>
        {displaySubject(question.subject)}
      </span>
      {question.topic && (
        <span className="text-xs text-gray-500 dark:text-gray-400">{question.topic}</span>
      )}
      <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
        {difficultyLabel(question.difficulty)}
      </span>
      {question.source_type === 'bank' && question.paper_source ? (
        <span className="text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded font-medium whitespace-nowrap">
          {[
            question.paper_source.exam,
            question.paper_source.year,
            question.paper_source.paper,
            question.paper_source.question_number != null
              ? `Q${question.paper_source.question_number}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      ) : question.source_type === 'bank' ? (
        <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">Past paper</span>
      ) : null}
    </div>
  );

  if (layout === 'two-column') {
    return (
      <TwoColumnLayout
        header={header}
        questionContent={questionContent}
        whiteboardNode={whiteboardNode}
        question={question}
        hints={hints}
        solution={solution}
        tutorMessages={tutorMessages}
        submittedAnswer={submittedAnswer}
        solutionRevealed={solutionRevealed}
        hideSolution={hideSolution}
        hideHints={hideHints}
        hideTutor={hideTutor}
        whiteboardOpen={whiteboardOpen}
        whiteboardState={whiteboardState}
        whiteboardRef={whiteboardRef}
        onHintAdded={onHintAdded}
        onSolutionRevealed={onSolutionRevealed}
        onSolutionGenerated={onSolutionGenerated}
        onTutorMessage={onTutorMessage}
        onClearTutorMessages={onClearTutorMessages}
        onAnnotations={handleAnnotations}
        onToggleWhiteboard={handleToggleWhiteboard}
        onSimilarQuestion={onSimilarQuestion}
        answered={answered}
      />
    );
  }

  // Single-column layout
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      {header}
      {questionContent}
      {whiteboardOpen && (
        <div className="px-5 pb-4 border-t border-gray-100 dark:border-gray-800">
          <div className="mt-3">{whiteboardNode}</div>
        </div>
      )}
      {actionBar}
      {panel !== 'none' && (
        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800">
          {panel === 'hints' && (
            <HintPanel question={question} hints={hints} onHintAdded={onHintAdded} />
          )}
          {panel === 'solution' && (
            <SolutionPanel
              question={question}
              solution={solution}
              revealed={solutionRevealed}
              onReveal={onSolutionRevealed}
              onSolutionGenerated={onSolutionGenerated}
            />
          )}
          {panel === 'tutor' && (
            <TutorChat
              question={question}
              messages={tutorMessages}
              hints={hints}
              solution={solutionRevealed ? solution : undefined}
              onMessage={onTutorMessage}
              whiteboardEnabled={whiteboardOpen}
              getWhiteboardSnapshot={() => whiteboardRef.current?.getSnapshot() ?? null}
              whiteboardStrokeCount={whiteboardState.strokes.length}
              onAnnotations={handleAnnotations}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Resize handle ──────────────────────────────────────────────

function ResizeHandle({ onDrag }: { onDrag: (dx: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    onDrag(e.clientX - lastX.current);
    lastX.current = e.clientX;
  }, [onDrag]);

  const onMouseUp = useCallback(() => { dragging.current = false; }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  return (
    <div
      onMouseDown={(e) => { dragging.current = true; lastX.current = e.clientX; e.preventDefault(); }}
      className="w-1.5 shrink-0 bg-gray-200 dark:bg-gray-700 hover:bg-accent active:bg-accent cursor-col-resize transition-colors"
    />
  );
}

// ── Two-column layout ───────────────────────────────────────────

interface TwoColumnProps {
  header: React.ReactNode;
  questionContent: React.ReactNode;
  whiteboardNode: React.ReactNode;
  question: QuestionRecord;
  hints: HintRecord[];
  solution: SolutionRecord | undefined;
  tutorMessages: TutorChatMessage[];
  submittedAnswer: string | null;
  solutionRevealed: boolean;
  hideSolution?: boolean;
  hideHints?: boolean;
  hideTutor?: boolean;
  whiteboardOpen: boolean;
  whiteboardState: WhiteboardState;
  whiteboardRef: React.RefObject<WhiteboardHandle | null>;
  onHintAdded: (h: HintRecord) => void;
  onSolutionRevealed: () => void;
  onSolutionGenerated: (sol: SolutionRecord) => void;
  onTutorMessage: (msg: TutorChatMessage) => void;
  onClearTutorMessages?: () => void;
  onAnnotations: (annotations: TutorAnnotation[]) => void;
  onToggleWhiteboard: () => void;
  onSimilarQuestion?: () => void;
  answered: boolean;
}

function TwoColumnLayout({
  header, questionContent, whiteboardNode,
  question, hints, solution, tutorMessages,
  solutionRevealed, hideSolution, hideHints, hideTutor,
  whiteboardOpen, whiteboardState, whiteboardRef,
  onHintAdded, onSolutionRevealed, onSolutionGenerated, onTutorMessage, onClearTutorMessages, onAnnotations,
  onToggleWhiteboard, onSimilarQuestion, answered,
}: TwoColumnProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const solutionScrollRef = useRef<HTMLDivElement>(null);

  const [qPct, setQPct] = useState(36);
  const [tPct, setTPct] = useState(32);

  // Show/hide panels — toggled from footer buttons
  const [showTutor, setShowTutor] = useState(true);
  const [showSolution, setShowSolution] = useState(true);

  // Auto-scroll solution panel during streaming
  useEffect(() => {
    if (solutionScrollRef.current) {
      solutionScrollRef.current.scrollTop = solutionScrollRef.current.scrollHeight;
    }
  }, [solution?.worked_solution]);

  function handleExportPng() {
    const snap = whiteboardRef.current?.getSnapshot();
    if (!snap) return;
    const a = document.createElement('a');
    a.href = snap;
    a.download = `whiteboard-${question.question_id}.png`;
    a.click();
  }

  const tutorVisible = !hideTutor && showTutor;
  const solutionVisible = !hideSolution && showSolution;

  return (
    <div className="flex flex-col bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">

      {/* ── Three-panel row — fixed viewport height so panels scroll internally ── */}
      <div ref={containerRef} className="flex overflow-hidden" style={{ height: 'calc(100dvh - 200px)' }}>

        {/* Question panel */}
        <div
          className="flex flex-col border-r border-gray-200 dark:border-gray-700 overflow-hidden shrink-0"
          style={{ width: `${qPct}%` }}
        >
          <div className="shrink-0">{header}</div>
          <div className="flex-1 min-h-0 overflow-y-auto">{questionContent}</div>
          {onSimilarQuestion && answered && (
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
              <ActionButton active={false} onClick={onSimilarQuestion} icon="&#128260;" label="Similar question" />
            </div>
          )}
          {!hideHints && (
            <details className="shrink-0 group border-t border-gray-100 dark:border-gray-800">
              <summary className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300 list-none bg-gray-50 dark:bg-gray-800/40">
                <span className="text-[10px] group-open:rotate-90 transition-transform inline-block">&#9654;</span>
                &#128161; {hints.length > 0 ? `Hints (${hints.length})` : 'Get a hint'}
              </summary>
              <div className="px-4 pb-3 max-h-48 overflow-y-auto">
                <HintPanel question={question} hints={hints} onHintAdded={onHintAdded} />
              </div>
            </details>
          )}
        </div>

        <ResizeHandle onDrag={(dx) => {
          if (!containerRef.current) return;
          const w = containerRef.current.offsetWidth;
          setQPct(p => Math.max(20, Math.min(55, p + dx / w * 100)));
        }} />

        {/* Solution panel (centre) */}
        {solutionVisible && (
          <>
            <div className="flex flex-col overflow-hidden flex-1 min-w-0">
              <div className="shrink-0 px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
                <span className="text-xs font-bold uppercase tracking-wide text-accent">Worked Solution</span>
              </div>
              <div ref={solutionScrollRef} className="flex-1 min-h-0 overflow-y-auto p-4">
                {!solutionRevealed ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
                    <span className="text-3xl">&#128203;</span>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Submit an answer to reveal the worked solution.</p>
                    <button onClick={onSolutionRevealed} className="text-xs text-accent underline hover:text-accent-light">
                      Reveal anyway
                    </button>
                  </div>
                ) : (
                  <SolutionPanel
                    question={question}
                    solution={solution}
                    revealed={solutionRevealed}
                    onReveal={onSolutionRevealed}
                    onSolutionGenerated={onSolutionGenerated}
                  />
                )}
              </div>
            </div>

            {tutorVisible && (
              <ResizeHandle onDrag={(dx) => {
                if (!containerRef.current) return;
                const w = containerRef.current.offsetWidth;
                setTPct(p => Math.max(15, Math.min(50, p + dx / w * 100)));
              }} />
            )}
          </>
        )}

        {/* Tutor panel (right) */}
        {tutorVisible && (
          <div
            className="flex flex-col border-l border-gray-200 dark:border-gray-700 overflow-hidden shrink-0"
            style={{ width: `${tPct}%` }}
          >
            <div className="shrink-0 flex items-center px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide flex-1">Ask Tutor</span>
              {onClearTutorMessages && tutorMessages.length > 0 && (
                <button
                  onClick={onClearTutorMessages}
                  title="Clear chat"
                  className="px-1 py-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
            <TutorChat
              question={question}
              messages={tutorMessages}
              hints={hints}
              solution={solutionRevealed ? solution : undefined}
              onMessage={onTutorMessage}
              whiteboardEnabled={whiteboardOpen}
              getWhiteboardSnapshot={() => whiteboardRef.current?.getSnapshot() ?? null}
              whiteboardStrokeCount={whiteboardState.strokes.length}
              onAnnotations={onAnnotations}
              fillHeight
              hideHeader
            />
          </div>
        )}
      </div>

      {/* ── Whiteboard — full width, flows below panels ── */}
      {whiteboardOpen && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {whiteboardNode}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
        <button
          onClick={onToggleWhiteboard}
          className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border transition-colors ${
            whiteboardOpen
              ? 'bg-accent text-white border-accent'
              : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          &#9999;&#65039; {whiteboardOpen ? 'Hide Whiteboard' : 'Whiteboard'}
        </button>
        {!hideTutor && (
          <button
            onClick={() => setShowTutor(v => !v)}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border transition-colors ${
              showTutor
                ? 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600'
            }`}
          >
            &#127891; {showTutor ? 'Hide Tutor' : 'Show Tutor'}
          </button>
        )}
        {!hideSolution && (
          <button
            onClick={() => setShowSolution(v => !v)}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border transition-colors ${
              showSolution
                ? 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600'
            }`}
          >
            &#128203; {showSolution ? 'Hide Solution' : 'Show Solution'}
          </button>
        )}
        {whiteboardOpen && (
          <button
            onClick={handleExportPng}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            &#11015;&#65039; Download PNG
          </button>
        )}
      </div>
    </div>
  );
}

// ── Fullscreen whiteboard sidebar ──────────────────────────────

function WhiteboardSidebar({
  question,
  submittedAnswer,
  hideFeedback,
  tutorMessages,
  hints,
  solution,
  solutionRevealed,
  hideHints,
  hideSolution,
  onTutorMessage,
  onHintAdded,
  onSolutionRevealed,
  onSolutionGenerated,
  onClearTutorMessages,
  getWhiteboardSnapshot,
  whiteboardStrokeCount,
  onAnnotations,
}: {
  question: QuestionRecord;
  submittedAnswer: string | null;
  hideFeedback: boolean;
  tutorMessages: TutorChatMessage[];
  hints: HintRecord[];
  solution: SolutionRecord | undefined;
  solutionRevealed: boolean;
  hideHints?: boolean;
  hideSolution?: boolean;
  onTutorMessage: (msg: TutorChatMessage) => void;
  onHintAdded: (h: HintRecord) => void;
  onSolutionRevealed: () => void;
  onSolutionGenerated: (sol: SolutionRecord) => void;
  onClearTutorMessages?: () => void;
  getWhiteboardSnapshot: () => string | null;
  whiteboardStrokeCount: number;
  onAnnotations: (annotations: TutorAnnotation[]) => void;
}) {
  const [questionOpen, setQuestionOpen] = useState(true);
  const [solutionOpen, setSolutionOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const correct = question.answer_label;

  function handleRevealSolution() {
    if (!solutionRevealed) onSolutionRevealed();
    setSolutionOpen(true);
  }

  // Collapsed column width
  const SLIVER = 28;

  function ColHeader({
    open,
    onToggle,
    label,
    badge,
  }: {
    open: boolean;
    onToggle: () => void;
    label: string;
    badge?: string;
  }) {
    if (!open) {
      return (
        <button
          onClick={onToggle}
          title={label}
          className="flex-1 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <span
            className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 whitespace-nowrap select-none"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            {label}
          </span>
        </button>
      );
    }
    return (
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <span className="flex-1 text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">{label}</span>
        {badge && <span className="text-xs text-gray-400 dark:text-gray-500">{badge}</span>}
        <button
          onClick={onToggle}
          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-[10px] shrink-0"
          title="Collapse"
        >
          ‹
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-row h-full overflow-hidden text-sm">

      {/* Tutor column */}
      <div
        className="flex flex-col border-r border-gray-200 dark:border-gray-700 overflow-hidden"
        style={{ width: tutorOpen ? undefined : SLIVER, flex: tutorOpen ? '1 1 0' : '0 0 auto' }}
      >
        {tutorOpen ? (
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <span className="flex-1 text-xs font-semibold text-gray-700 dark:text-gray-300">Ask Tutor</span>
            {onClearTutorMessages && tutorMessages.length > 0 && (
              <button
                onClick={onClearTutorMessages}
                title="Clear chat"
                className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors text-xs shrink-0"
              >
                🗑
              </button>
            )}
            <button
              onClick={() => setTutorOpen(false)}
              className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-[10px] shrink-0"
              title="Collapse"
            >
              ‹
            </button>
          </div>
        ) : (
          <ColHeader open={false} onToggle={() => setTutorOpen(true)} label="🎓 Tutor" />
        )}
        {tutorOpen && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <TutorChat
              question={question}
              messages={tutorMessages}
              hints={hints}
              solution={solutionRevealed ? solution : undefined}
              onMessage={onTutorMessage}
              whiteboardEnabled
              getWhiteboardSnapshot={getWhiteboardSnapshot}
              whiteboardStrokeCount={whiteboardStrokeCount}
              onAnnotations={onAnnotations}
              fillHeight
              hideHeader
            />
          </div>
        )}
      </div>

      {/* Solution column */}
      {!hideSolution && (
        <div
          className="flex flex-col border-r border-gray-200 dark:border-gray-700 overflow-hidden"
          style={{ width: solutionOpen ? undefined : SLIVER, flex: solutionOpen ? '1 1 0' : '0 0 auto' }}
        >
          <ColHeader
            open={solutionOpen}
            onToggle={() => solutionRevealed ? setSolutionOpen((o) => !o) : handleRevealSolution()}
            label={solutionOpen ? 'Worked Solution' : '📋 Solution'}
            badge={!solutionRevealed ? '(tap to reveal)' : undefined}
          />
          {solutionOpen && (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <SolutionPanel
                question={question}
                solution={solution}
                revealed={solutionRevealed}
                onReveal={onSolutionRevealed}
                onSolutionGenerated={onSolutionGenerated}
              />
            </div>
          )}
        </div>
      )}

      {/* Question column */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ width: questionOpen ? undefined : SLIVER, flex: questionOpen ? '1 1 0' : '0 0 auto' }}
      >
        <ColHeader
          open={questionOpen}
          onToggle={() => setQuestionOpen((o) => !o)}
          label="Question"
        />
        {questionOpen && (
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
            <MathText
              text={question.stem}
              block
              className="text-gray-900 dark:text-gray-100 leading-relaxed font-serif text-sm"
            />
            <div className="space-y-1.5">
              {question.options.map((opt) => {
                const isCorrect = !hideFeedback && submittedAnswer !== null && opt.label === correct;
                const isWrong = !hideFeedback && opt.label === submittedAnswer && opt.label !== correct;
                const isSelected = hideFeedback && opt.label === submittedAnswer;
                return (
                  <div
                    key={opt.label}
                    className={`flex items-start gap-2 px-2 py-1.5 rounded-lg border text-xs ${
                      isCorrect
                        ? 'border-emerald-500 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30'
                        : isWrong
                        ? 'border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-950/30'
                        : isSelected
                        ? 'border-accent bg-blue-50 dark:bg-blue-950/30'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                    }`}
                  >
                    <span
                      className={`font-bold flex-shrink-0 ${
                        isCorrect
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : isWrong
                          ? 'text-red-500 dark:text-red-400'
                          : 'text-gray-500 dark:text-gray-400'
                      }`}
                    >
                      {opt.label}
                    </span>
                    <MathText text={opt.text} className="text-gray-900 dark:text-gray-100 leading-relaxed" />
                    {isCorrect && <span className="ml-auto text-emerald-500 font-bold text-sm">✓</span>}
                    {isWrong && <span className="ml-auto text-red-500 font-bold text-sm">✗</span>}
                  </div>
                );
              })}
            </div>
            {!hideHints && (
              <HintPanel question={question} hints={hints} onHintAdded={onHintAdded} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border transition-colors ${
        active
          ? 'bg-accent text-white border-accent'
          : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}