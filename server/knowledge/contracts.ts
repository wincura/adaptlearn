import type { KnowledgeDocument } from '../../shared/contracts.ts';

export type UploadedDocumentInput = {
  filename: string;
  originalname: string;
  mimetype: string;
  path: string;
  size: number;
};

export type KnowledgeScope = {
  learnerId: string;
  goalId?: string;
  visibility: 'learner' | 'goal';
};

export type RetrievalQuery = {
  text: string;
  scope: Pick<KnowledgeScope, 'learnerId' | 'goalId'>;
  topK?: number;
  maxCharacters?: number;
};

export type RetrievedPassage = {
  text: string;
  score: number;
  source: {
    documentId: string;
    title: string;
    uri?: string;
    excerpt: number;
  };
  metadata: Record<string, string | number | boolean>;
};

export type RelevantDocumentContext = {
  context: string;
  usedDocuments: string[];
  passages: RetrievedPassage[];
};

export interface KnowledgeRepository {
  readonly backend: string;
  ingest(file: UploadedDocumentInput, scope: KnowledgeScope): Promise<KnowledgeDocument>;
  retrieve(documents: KnowledgeDocument[], query: RetrievalQuery): Promise<RetrievedPassage[]>;
  remove(documents: KnowledgeDocument[]): Promise<void>;
}
