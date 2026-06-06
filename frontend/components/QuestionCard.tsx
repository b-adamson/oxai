'use client';
import { useState } from 'react';
import { MathText } from './MathText';
import { FigureRenderer } from './FigureRenderer';
import { HintPanel } from './HintPanel';
import { SolutionPanel } from './SolutionPanel';
import { TutorChat } from './TutorChat';
import type { QuestionRecord, HintRecord, SolutionRecord, TutorChatMessage } from '@/lib/types';
import { difficultyLabel, subjectColor } from '@/lib/questionUtils';

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

  const answered = submittedAnswer !== null;
  const correct = question.answer_label;

  function handleOptionClick(label: string) {
    // In paper mode (hideFeedback=true), options stay interactive so the user
    // can change or deselect their answer before final submission.
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

  function getOptionStyle(label: string): string {
    const base = 'flex items-start gap-3 p-3 rounded-lg border-2 transition-all text-left w-full text-gray-900';
    if (!answered) {
      return `${base} ${
        hoveredOption === label
          ? 'border-accent bg-blue-50 cursor-pointer'
          : 'border-gray-200 bg-white hover:border-blue-300 cursor-pointer'
      }`;
    }
    if (hideFeedback) {
      // Paper mode — options stay interactive; selected is highlighted, others remain clickable
      if (label === submittedAnswer) {
        return `${base} border-accent bg-blue-50 cursor-pointer`;
      }
      return `${base} ${
        hoveredOption === label
          ? 'border-accent bg-blue-50 cursor-pointer'
          : 'border-gray-200 bg-white hover:border-blue-300 cursor-pointer'
      }`;
    }
    if (label === correct) return `${base} border-emerald-500 bg-emerald-50`;
    if (label === submittedAnswer && label !== correct) return `${base} border-red-400 bg-red-50`;
    return `${base} border-gray-200 bg-white opacity-60`;
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gray-50">
        {questionNumber != null && (
          <span className="text-xs font-bold text-white bg-accent px-2.5 py-1 rounded-md">
            {questionNumber}{totalQuestions ? ` / ${totalQuestions}` : ''}
          </span>
        )}
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${subjectColor(question.subject)}`}>
          {question.subject}
        </span>
        {question.topic && (
          <span className="text-xs text-gray-500">{question.topic}</span>
        )}
        <span className="ml-auto text-xs text-gray-400">
          {difficultyLabel(question.difficulty)}
        </span>
        {question.source_type === 'bank' && question.paper_source ? (
          <span className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded font-medium whitespace-nowrap">
            {[
              question.paper_source.exam,
              question.paper_source.year,
              question.paper_source.question_number != null ? `Q${question.paper_source.question_number}` : null,
            ].filter(Boolean).join(' · ')}
          </span>
        ) : question.source_type === 'bank' ? (
          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Past paper</span>
        ) : null}
      </div>

      {/* Stem */}
      <div className="px-5 py-5">
        <MathText
          text={question.stem}
          block
          className="text-base leading-relaxed text-gray-900 font-serif"
        />

        {/* Structured figures (AI-generated questions) */}
        {question.figures.length > 0 && question.figures.map((fig, i) => (
          <FigureRenderer key={i} spec={fig} />
        ))}

        {/* Fallback image URL for bank questions without structured figures */}
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
              <div className={`
                flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                ${!hideFeedback && answered && opt.label === correct ? 'bg-emerald-500 text-white' : ''}
                ${!hideFeedback && answered && opt.label === submittedAnswer && opt.label !== correct ? 'bg-red-400 text-white' : ''}
                ${(hideFeedback || !answered || (opt.label !== correct && opt.label !== submittedAnswer)) ? 'bg-gray-100 text-gray-600' : ''}
              `}>
                {opt.label}
              </div>
              <MathText text={opt.text} className="text-sm leading-relaxed pt-0.5 text-gray-900" />
              {answered && !hideFeedback && opt.label === correct && (
                <span className="ml-auto text-emerald-600 font-bold text-lg leading-none">✓</span>
              )}
              {answered && !hideFeedback && opt.label === submittedAnswer && opt.label !== correct && (
                <span className="ml-auto text-red-500 font-bold text-lg leading-none">✗</span>
              )}
            </button>
          ))}
        </div>

        {/* Answer result — hidden when feedback is suppressed */}
        {answered && !hideFeedback && (
          <div className={`mt-4 p-3 rounded-lg text-sm font-medium ${
            submittedAnswer === correct
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}>
            {submittedAnswer === correct
              ? '✓ Correct!'
              : `✗ Incorrect. The answer is ${correct}.`}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
        {!hideHints && (
          <ActionButton
            active={panel === 'hints'}
            onClick={() => togglePanel('hints')}
            icon="💡"
            label={hints.length > 0 ? `Hints (${hints.length})` : 'Hints'}
          />
        )}
        {!hideSolution && (
          <ActionButton
            active={panel === 'solution' && solutionRevealed}
            onClick={handleRevealSolution}
            icon="📋"
            label="Solution"
          />
        )}
        {!hideTutor && (
          <ActionButton
            active={panel === 'tutor'}
            onClick={() => togglePanel('tutor')}
            icon="🎓"
            label={tutorMessages.length > 0 ? `Tutor (${Math.ceil(tutorMessages.length / 2)})` : 'Ask Tutor'}
          />
        )}
        {onSimilarQuestion && answered && (
          <ActionButton
            active={false}
            onClick={onSimilarQuestion}
            icon="🔄"
            label="Similar question"
          />
        )}
      </div>

      {/* Expandable panels */}
      {panel !== 'none' && (
        <div className="px-5 py-4 border-t border-gray-100">
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
            />
          )}
        </div>
      )}
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
          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
