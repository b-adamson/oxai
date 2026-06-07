// Core data types for the OxAI exam practice app
export type Subject = string;
export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type SourceType = 'bank' | 'fresh_ai' | 'either';
export type Mode = 'quick' | 'paper';
export type DiagramPolicy = 'never' | 'sometimes' | 'often';
export type TopicMode = 'all_topics' | 'weak_topics' | 'custom_topic' | 'custom_mix';
export type DifficultyPreset = 'easy' | 'realistic' | 'hard' | 'olympiad' | 'custom';
export type SlotStatus = 'planned' | 'generating' | 'ready' | 'shown' | 'answered' | 'failed';
export type PaperStatus = 'planning' | 'loading' | 'ready' | 'in_progress' | 'complete' | 'abandoned';

export interface AnswerOption { label: string; text: string; }

export interface GraphSeries {
  name: string;
  x_values: number[];
  y_values: number[];
}

export interface FigureSpec {
  figure_type: 'table' | 'simple_graph' | 'complex_diagram';
  caption: string;
  diagram_prompt: string | null;
  // table fields
  table_headers: string[] | null;
  table_rows: string[][] | null;
  table_row_labels: string[] | null;
  // graph fields
  graph_type: 'line' | 'bar' | 'scatter' | null;
  graph_title: string | null;
  graph_x_label: string | null;
  graph_y_label: string | null;
  graph_x_labels: string[] | null;
  graph_series: GraphSeries[] | null;
  graph_x_min: number | null;
  graph_x_max: number | null;
  graph_y_min: number | null;
  graph_y_max: number | null;
  // set by backend for complex_diagram after image generation
  url?: string | null;
}

export interface PaperSource {
  exam?: string;
  year?: number;
  paper?: string;
  section?: string;
  question_number?: number;
}

export interface QuestionRecord {
  question_id: string;
  source_type: SourceType;
  paper_source?: PaperSource;
  subject: Subject;
  topic: string | null;
  subtopic: string | null;
  archetype?: string | null;
  difficulty: Difficulty;
  stem: string;
  options: AnswerOption[];
  figures: FigureSpec[];
  answer_label: string | null;
  answer_text: string | null;
  has_diagram: boolean;
  diagram_url: string | null;
  tags: string[];
  estimated_time_seconds: number | null;
  shown_in_mode: Mode | null;
  created_at: number;
}

export interface HintRecord { question_id: string; level: 1 | 2 | 3; hint: string; generated_at: number; }

export interface SolutionRecord {
  question_id: string;
  status?: string;
  worked_solution: string;
  final_answer_label: string;
  requires_diagram: boolean;
  diagram_url: string | null;
  generated_at: number;
}

export type TutorResponseType = 'hint' | 'explanation' | 'walkthrough' | 'redirect';
export interface TutorChatMessage { role: 'user' | 'tutor'; text: string; response_type?: TutorResponseType; timestamp: number; }
export interface TutorChatThread { question_id: string; messages: TutorChatMessage[]; }

export interface AttemptRecord {
  attempt_id: string;
  question_id: string;
  session_id: string;
  mode: Mode;
  chosen_answer: string | null;
  correct_answer: string | null;
  is_correct: boolean | null;
  time_taken_seconds: number;
  hint_count: number;
  tutor_used: boolean;
  solution_revealed: boolean;
  topic: string | null;
  subtopic: string | null;
  difficulty: Difficulty;
  source_type: SourceType;
  attempted_at: number;
}

export interface QuestionSession {
  question_id: string;
  session_id: string;
  slot_id: string;
  submitted_answer: string | null;
  is_correct: boolean | null;
  solution_revealed: boolean;
  hints_shown: HintRecord[];
  tutor_active: boolean;
  start_time: number | null;
  end_time: number | null;
}

export interface PaperSlot {
  slot_id: string;
  position: number;
  subject: Subject;
  topic: string | null;
  subtopic: string | null;
  difficulty: Difficulty;
  diagram_requirement: 'never' | 'allowed' | 'required';
  source_type: SourceType;
  status: SlotStatus;
  question_id: string | null;
  retry_count: number;
  error: string | null;
  excluded_years?: number[];
}

export interface PaperBlueprint {
  blueprint_id: string;
  name: string;
  paper_length: number;
  difficulty_preset: DifficultyPreset;
  target_subject: Subject;
  topic_mode: TopicMode;
  topic_weights: Record<string, number>;
  bank_fraction: number;
  diagram_fraction: number;
  diagram_policy: DiagramPolicy;
  source_policy: 'prefer_bank' | 'prefer_fresh' | 'balanced';
  ordering_policy: 'fixed' | 'random';
  preload_count: number;
  background_concurrency_limit: number;
  must_include_topics: string[];
  excluded_topics: string[];
  difficulty_range: [number, number];
}

export interface PaperSession {
  session_id: string;
  blueprint: PaperBlueprint;
  modules: string[];
  slots: PaperSlot[];
  status: PaperStatus;
  current_slot_index: number;
  start_time: number | null;
  end_time: number | null;
  total_answered: number;
  total_correct: number;
  submitted_answers: Record<string, string>;
  revealed_solutions: string[];
  timer_duration_seconds: number | null;
  live_solution: boolean;
  enable_solution: boolean;
  enable_hints: boolean;
  enable_tutor: boolean;
  submitted: boolean;
  created_at: number;
  updated_at: number;
}

export interface SubjectTopicConfig {
  subject: string;
  difficulty: DifficultyPreset;
  /** null = all topics; array = specific topics */
  topics: string[] | null;
}

export interface QuickModeConfig {
  topic_mode: TopicMode;
  custom_topics: string[];
  diagram_policy: DiagramPolicy;
  difficulty_preset: DifficultyPreset;
  custom_difficulty: number;
  min_preload_count: number;
  solution_hidden: boolean;
  timer_enabled: boolean;
  target_subject: Subject;
  /** 0 = all AI, 1 = all past papers */
  bank_fraction: number;
}

export interface QuickModeStats {
  questions_answered: number;
  correct_answers: number;
  streak: number;
  best_streak: number;
  hints_used: number;
  solutions_revealed: number;
  total_time_seconds: number;
}

export interface QuickModeSession {
  session_id: string;
  config: QuickModeConfig;
  slots: PaperSlot[];
  stats: QuickModeStats;
  status: 'active' | 'paused' | 'ended';
  created_at: number;
}

export interface TopicMastery {
  topic: string;
  subject: Subject;
  attempts: number;
  correct: number;
  accuracy: number;
  avg_time_seconds: number;
  hint_dependence: number;
  solution_dependence: number;
  recent_trend: 'improving' | 'declining' | 'stable' | 'unknown';
  last_attempt_at: number;
}

export interface MasteryStats {
  overall_accuracy: number;
  overall_attempts: number;
  avg_time_seconds: number;
  current_streak: number;
  best_streak: number;
  topics: Record<string, TopicMastery>;
  weak_topics: string[];
  strong_topics: string[];
  last_updated: number;
}

export interface TopicInventory {
  topic: string;
  subtopics: Record<string, number>;
  count: number;
  difficulty_counts: Record<string, number>;
  has_diagrams: boolean;
  archetypes: string[];
}

export interface SubjectInventory {
  subject: Subject;
  total: number;
  topics: TopicInventory[];
  difficulty_distribution: Record<string, number>;
}

export interface BankInventory {
  subjects: Record<string, SubjectInventory>;
  total: number;
  scanned_at: number | null;
}

export interface AdaptivePolicy {
  topic: string | null;
  subtopic: string | null;
  difficulty: number;
  diagram_policy: DiagramPolicy;
  concept_or_calculation: 'conceptual' | 'calculation' | 'either';
  source_type: SourceType;
}

// ── Whiteboard types ──────────────────────────────────────────

export interface WhiteboardPoint { x: number; y: number; }

export interface WhiteboardStroke {
  points: WhiteboardPoint[];
  color: string;
  width: number;
  tool: 'pen' | 'eraser';
}

export type TutorAnnotationType = 'circle' | 'highlight' | 'arrow' | 'question_mark' | 'cross' | 'checkmark';

export interface TutorAnnotation {
  type: TutorAnnotationType;
  /** Normalized 0-1 coordinates relative to canvas dimensions */
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  label?: string;
  color: string;
}

export interface WhiteboardState {
  strokes: WhiteboardStroke[];
  annotations: TutorAnnotation[];
}

export interface AppState {
  questions: Record<string, QuestionRecord>;
  hints: Record<string, HintRecord[]>;
  solutions: Record<string, SolutionRecord>;
  tutorThreads: Record<string, TutorChatThread>;
  attempts: AttemptRecord[];
  questionSessions: Record<string, QuestionSession>;
  quickSession: QuickModeSession | null;
  paperSessions: PaperSession[];
  activePaperSessionId: string | null;
  inventory: BankInventory | null;
  lastSubject: Subject;
  lastTopic: string | null;
  whiteboards: Record<string, WhiteboardState>;
}
