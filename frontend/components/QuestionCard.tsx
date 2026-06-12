'use client';
import { useRef, useState } from 'react';
import { MathText } from './MathText';
import { FigureRenderer } from './FigureRenderer';
import { HintPanel } from './HintPanel';
import { SolutionPanel } from './SolutionPanel';
import { TutorChat } from './TutorChat';
import { WhiteboardCanvas, type WhiteboardHandle } from './WhiteboardCanvas';
import type { QuestionRecord, HintRecord, SolutionRecord, TutorChatMessage, TutorAnnotation, WhiteboardState } from '@/lib/types';
import { difficultyLabel, subjectColor, displaySubject } from '@/lib/questionUtils';
import { useStore } from '@/lib/store';

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
  onSimilarQuestion?: () => void;

  questionNumber?: number;
  totalQuestions?: number;
  startTime?: number | null;
  hideFeedback?: boolean;
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
  onSimilarQuestion,
  questionNumber,
  totalQuestions,
  startTime,
  hideFeedback = false,
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

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
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

      {/* Stem */}
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

        {/* Answer options */}
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

      {/* Whiteboard */}
      {whiteboardOpen && (
        <div className="px-5 pb-4 border-t border-gray-100 dark:border-gray-800">
          <div className="mt-3">
            <WhiteboardCanvas
              key={question.question_id}
              ref={whiteboardRef}
              strokes={whiteboardState.strokes}
              annotations={whiteboardState.annotations}
              onStrokesChange={(strokes) =>
                setWhiteboardStrokes(question.question_id, strokes)
              }
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
                  getWhiteboardSnapshot={() => whiteboardRef.current?.getSnapshot() ?? null}
                  whiteboardStrokeCount={whiteboardState.strokes.length}
                  onAnnotations={handleAnnotations}
                />
              }
            />
          </div>
        </div>
      )}

      {/* Action bar */}
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
            label={
              tutorMessages.length > 0
                ? `Tutor (${Math.ceil(tutorMessages.length / 2)})`
                : 'Ask Tutor'
            }
          />
        )}
        {onSimilarQuestion && answered && (
          <ActionButton
            active={false}
            onClick={onSimilarQuestion}
            icon="&#128260;"
            label="Similar question"
          />
        )}
      </div>

      {/* Expandable panels */}
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
  getWhiteboardSnapshot: () => string | null;
  whiteboardStrokeCount: number;
  onAnnotations: (annotations: TutorAnnotation[]) => void;
}) {
  const [tutorOpen, setTutorOpen] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [solutionOpen, setSolutionOpen] = useState(false);
  const correct = question.answer_label;

  function handleRevealSolution() {
    if (!solutionRevealed) onSolutionRevealed();
    setSolutionOpen(true);
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* Stem */}
      <div>
        <div className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">
          Question
        </div>
        <MathText
          text={question.stem}
          block
          className="text-gray-900 dark:text-gray-100 leading-relaxed font-serif text-sm"
        />
      </div>

      {/* Options — display only, no click handler */}
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

      {/* Hints section */}
      {!hideHints && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
          <button
            onClick={() => setHintsOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 w-full mb-2 transition-colors"
          >
            <span className="text-[10px]">{hintsOpen ? '▼' : '▶'}</span>
            💡 Hints
            {hints.length > 0 && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">({hints.length})</span>
            )}
          </button>
          {hintsOpen && (
            <HintPanel question={question} hints={hints} onHintAdded={onHintAdded} />
          )}
        </div>
      )}

      {/* Solution section */}
      {!hideSolution && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
          <button
            onClick={() => solutionRevealed ? setSolutionOpen((o) => !o) : handleRevealSolution()}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 w-full mb-2 transition-colors"
          >
            <span className="text-[10px]">{solutionOpen ? '▼' : '▶'}</span>
            📋 Worked Solution
            {!solutionRevealed && (
              <span className="ml-1 text-gray-400 dark:text-gray-500 font-normal">(reveal)</span>
            )}
          </button>
          {solutionOpen && (
            <SolutionPanel
              question={question}
              solution={solution}
              revealed={solutionRevealed}
              onReveal={onSolutionRevealed}
              onSolutionGenerated={onSolutionGenerated}
            />
          )}
        </div>
      )}

      {/* Tutor section */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
        <button
          onClick={() => setTutorOpen((o) => !o)}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 w-full mb-2 transition-colors"
        >
          <span className="text-[10px]">{tutorOpen ? '▼' : '▶'}</span>
          🎓 Ask Tutor
          {tutorMessages.length > 0 && (
            <span className="ml-1 text-accent">({Math.ceil(tutorMessages.length / 2)})</span>
          )}
        </button>
        {tutorOpen && (
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
          />
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