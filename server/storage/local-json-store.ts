import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LearningEvent, LearningProfile } from '../types.ts';
import type { ProfileStore } from './profile-store.ts';

type LocalData = {
  profiles: Record<string, LearningProfile>;
  events: LearningEvent[];
};

const emptyData: LocalData = { profiles: {}, events: [] };

export class LocalJsonStore implements ProfileStore {
  private readonly filePath: string;

  constructor(dataDirectory = path.resolve(process.cwd(), 'data')) {
    this.filePath = path.join(dataDirectory, 'adaptlearn.json');
  }

  private async read(): Promise<LocalData> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as LocalData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return structuredClone(emptyData);
    }
  }

  private async write(data: LocalData) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  async getProfile(id: string) {
    const data = await this.read();
    return data.profiles[id] ?? null;
  }

  async saveProfile(profile: LearningProfile) {
    const data = await this.read();
    data.profiles[profile.id] = { ...profile, updatedAt: new Date().toISOString() };
    await this.write(data);
    return data.profiles[profile.id];
  }

  async appendEvent(event: LearningEvent) {
    const data = await this.read();
    data.events.push(event);
    await this.write(data);
  }

  async listEvents(learnerId: string) {
    const data = await this.read();
    return data.events.filter((event) => event.learnerId === learnerId);
  }
}
