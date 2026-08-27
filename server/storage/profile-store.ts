import type { LearningEvent, LearningProfile } from '../types.ts';

export interface ProfileStore {
  getProfile(id: string): Promise<LearningProfile | null>;
  saveProfile(profile: LearningProfile): Promise<LearningProfile>;
  appendEvent(event: LearningEvent): Promise<void>;
  listEvents(learnerId: string): Promise<LearningEvent[]>;
}
