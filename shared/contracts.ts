export type AgentId = 'coordinator' | 'teacher' | 'builder' | 'assessor' | 'researcher';

export type LearnerProfile = {
  displayName: string;
  background: string;
  preferences: string;
};

export type LearningGoal = {
  id: string;
  title: string;
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
  status: 'ready';
  characterCount: number;
  truncated: boolean;
  uploadedAt: string;
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
  createdAt: string;
};

export type ResearchSuggestion = {
  id: string;
  goalId: string;
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
  createdAt: string;
};

export type PlacementQuestion = {
  id: string;
  prompt: string;
  options: string[];
};

export type PlacementAssessment = {
  id: string;
  goalId: string;
  title: string;
  questions: Array<PlacementQuestion & { correctIndex: number }>;
  submittedAnswers?: number[];
  score?: number;
  level?: string;
  completedAt?: string;
  createdAt: string;
};

export type PublicPlacementAssessment = Omit<PlacementAssessment, 'questions'> & {
  questions: PlacementQuestion[];
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
