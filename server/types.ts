export type Familiarity = 'Absolute beginner' | 'Beginner' | 'Intermediate' | 'Professional';

export type LearningProfile = {
  id: string;
  displayName: string;
  topic: string;
  familiarity: Familiarity;
  learningStyle: string;
  goals: string[];
  xp: number;
  currentLevel: string;
  updatedAt: string;
};

export type LearningEvent = {
  id: string;
  learnerId: string;
  type: 'lesson' | 'assessment' | 'conversation' | 'achievement';
  summary: string;
  evidence?: Record<string, unknown>;
  createdAt: string;
};

export type ChatRequest = {
  message: string;
  mode: 'Teacher' | 'Conversation';
  profile: {
    topic: string;
    level: string;
    style: string;
    xp: number;
  };
};
