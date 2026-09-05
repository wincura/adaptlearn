export type AgentId = 'coordinator' | 'teacher' | 'builder' | 'assessor' | 'researcher';

export type LearnerProfile = {
  displayName: string;
  background: string;
  preferences: string;
};

export type LearningGoal = {
  id: string;
  title: string;
  courseTemplateId?: string;
  motivation: string;
  targetOutcome: string;
  status: 'active' | 'paused' | 'complete';
  createdAt: string;
};

export type MaterialSection = {
  title: string;
  content: string;
  activities?: string[];
};

export type LessonQuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export type LearningSource = {
  title: string;
  origin: 'public-web' | 'uploaded-document';
  url?: string;
};

export type KnowledgeDocument = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: 'processing' | 'ready' | 'failed';
  characterCount: number;
  truncated: boolean;
  uploadedAt: string;
  scope?: {
    learnerId: string;
    goalId?: string;
    visibility: 'learner' | 'goal';
  };
  provider?: {
    backend: string;
    externalId?: string;
    sourceUri?: string;
  };
};

export type SupportedCodeLanguage = 'python' | 'javascript' | 'typescript' | 'sql' | 'cpp' | 'java';

export type CodingTestCase = {
  id: string;
  description: string;
  input?: string;
  expectedOutput?: string;
  assertion?: string;
  isHidden?: boolean;
};

export type TestCaseResult = {
  testCaseId?: string;
  name: string;
  passed: boolean;
  input?: string;
  expectedOutput?: string;
  actualOutput?: string;
  error?: string;
  isHidden?: boolean;
};

export type CodingChallenge = {
  id: string;
  language: SupportedCodeLanguage;
  title: string;
  prompt: string;
  starterCode: string;
  testHarness: string;
  publicTestHarness?: string;
  privateTestHarness?: string;
  testCases?: CodingTestCase[];
  hints?: string[];
};

export type ExecutionStatus = 'passed' | 'failed' | 'compile_error' | 'runtime_error' | 'timeout';

export type ExecutionResult = {
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  testResults?: TestCaseResult[];
  passedCount?: number;
  totalCount?: number;
};

export type CodeEvaluationResponse = {
  passed: boolean;
  status: ExecutionStatus;
  feedback: string;
  execution: ExecutionResult;
  xpAwarded?: number;
};

export type LearningMaterial = {
  id: string;
  goalId: string;
  owner: 'teacher' | 'builder';
  kind: 'lesson' | 'practice-lab';
  title: string;
  summary: string;
  sections: MaterialSection[];
  sources?: LearningSource[];
  topics?: string[];
  assessedLevel?: string;
  placementAssessmentId?: string;
  diagnosticFocus?: string[];
  quiz?: LessonQuizQuestion[];
  codingChallenge?: CodingChallenge;
  codingChallenges?: CodingChallenge[];
  isCodeTopic?: boolean;
  createdAt: string;
};

export type ResearchSuggestion = {
  id: string;
  goalId: string;
  purpose?: 'update' | 'refresh' | 'next-topic';
  title: string;
  summary: string;
  whyRelevant: string;
  sourceUrl?: string;
  status: 'suggested' | 'accepted' | 'dismissed';
  createdAt: string;
};

export type ConversationTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  agent: AgentId;
  mode?: 'explainer-v1';
  createdAt: string;
};

export type PlacementQuestion = {
  id: string;
  prompt: string;
  options: string[];
  dimension?: string;
  difficulty?: 'foundation' | 'basic' | 'applied' | 'advanced';
};

export type PlacementDiagnostics = {
  strengths: string[];
  focusAreas: string[];
  dimensionScores: Array<{
    dimension: string;
    correct: number;
    total: number;
    percentage: number;
  }>;
};

export type PlacementAssessment = {
  id: string;
  goalId: string;
  testType?: 'placement' | 'assessment';
  attemptNumber?: number;
  title: string;
  questions: Array<PlacementQuestion & { correctIndex: number }>;
  submittedAnswers?: number[];
  score?: number;
  level?: string;
  diagnostics?: PlacementDiagnostics;
  completedAt?: string;
  createdAt: string;
};

export type PublicPlacementAssessment = Omit<PlacementAssessment, 'questions'> & {
  questions: PlacementQuestion[];
};

export type PlacementResult = {
  score: number;
  level: string;
  xpAwarded: number;
  badgeAwarded?: string;
  diagnostics: PlacementDiagnostics;
};

export type LearnerProgress = {
  xp: number;
  level: string;
  badges: string[];
  completedAssessments: number;
};

export type LearningWorkspace = {
  learnerId: string;
  profile: LearnerProfile;
  goals: LearningGoal[];
  documents: KnowledgeDocument[];
  materials: LearningMaterial[];
  suggestions: ResearchSuggestion[];
  assessments: PlacementAssessment[];
  conversation: ConversationTurn[];
  progress: LearnerProgress;
  updatedAt: string;
};

export type LearnerWorkspaceSummary = {
  learnerId: string;
  displayName: string;
  background: string;
  activeGoalTitle?: string;
  goalCount: number;
  xp: number;
  level: string;
  updatedAt: string;
};

export type AgentTrace = {
  agent: AgentId;
  action: string;
};

export type ChatResponse = {
  reply: string;
  respondedBy: AgentId;
  trace: AgentTrace[];
  workspace: LearningWorkspace;
};
