import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import type { KnowledgeDocument } from '../../shared/contracts.ts';
import type {
  KnowledgeRepository,
  KnowledgeScope,
  RelevantDocumentContext,
  RetrievalQuery,
  RetrievedPassage,
  UploadedDocumentInput,
} from './contracts.ts';
import { formatRetrievedContext } from './rag.ts';

const knowledgeDirectory = path.resolve(process.cwd(), 'data', 'knowledge');
const uploadDirectory = path.resolve(process.cwd(), process.env.UPLOAD_DIRECTORY ?? path.join('data', 'uploads'));
const maximumStoredCharacters = 2_000_000;
const maximumContextCharacters = 45_000;
const chunkSize = 3_200;
const chunkOverlap = 300;
const supportedExtensions = new Set(['.pdf', '.docx', '.txt', '.md', '.csv']);

const knowledgePath = (documentId: string) => path.join(knowledgeDirectory, `${documentId}.txt`);

async function extractText(file: UploadedDocumentInput): Promise<string> {
  const extension = path.extname(file.originalname).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error('Unsupported document type. Upload a PDF, DOCX, TXT, Markdown, or CSV file.');
  }

  const buffer = await readFile(file.path);
  if (extension === '.pdf') {
    // pdf-parse initializes browser-oriented PDF.js globals. Loading it only
    // for a PDF upload keeps the Lambda's ordinary API startup Node-safe.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  if (extension === '.docx') return (await mammoth.extractRawText({ buffer })).value;
  return buffer.toString('utf8');
}

const normalizeText = (text: string) => text
  .replace(/\0/g, '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\t ]+\n/g, '\n')
  .replace(/\n{4,}/g, '\n\n\n')
  .trim();

export async function ingestDocument(file: UploadedDocumentInput, scope: KnowledgeScope): Promise<KnowledgeDocument> {
  const extracted = normalizeText(await extractText(file));
  if (!extracted) throw new Error('No readable text was found in this document. Scanned PDFs need OCR, which is not available yet.');
  const truncated = extracted.length > maximumStoredCharacters;
  const stored = extracted.slice(0, maximumStoredCharacters);
  await mkdir(knowledgeDirectory, { recursive: true });
  await writeFile(knowledgePath(file.filename), stored, 'utf8');
  return {
    id: file.filename,
    name: file.originalname,
    mimeType: file.mimetype || 'application/octet-stream',
    size: file.size,
    status: 'ready',
    characterCount: stored.length,
    truncated,
    uploadedAt: new Date().toISOString(),
    scope,
    provider: { backend: 'local-filesystem', sourceUri: `local-knowledge://${file.filename}` },
  };
}

type RankedChunk = {
  document: KnowledgeDocument;
  index: number;
  text: string;
  score: number;
};

const queryTerms = (query: string) => [...new Set(
  query.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{2,}/g)?.filter((term) => ![
    'and', 'the', 'for', 'with', 'from', 'that', 'this', 'want', 'learn', 'learning', 'goal', 'into', 'your',
  ].includes(term)) ?? [],
)].slice(0, 30);

function makeChunks(document: KnowledgeDocument, text: string, terms: string[]): RankedChunk[] {
  const chunks: RankedChunk[] = [];
  let index = 0;
  for (let start = 0; start < text.length; start += chunkSize - chunkOverlap) {
    const chunk = text.slice(start, start + chunkSize).trim();
    if (!chunk) continue;
    const lower = chunk.toLowerCase();
    const matches = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
    chunks.push({ document, index, text: chunk, score: matches * 10 + (index === 0 ? 2 : 0) });
    index += 1;
  }
  return chunks;
}

const documentIsVisible = (document: KnowledgeDocument, query: RetrievalQuery) => {
  if (!document.scope) return true;
  if (document.scope.learnerId !== query.scope.learnerId) return false;
  return document.scope.visibility === 'learner' || document.scope.goalId === query.scope.goalId;
};

export async function retrieveLocalPassages(
  documents: KnowledgeDocument[],
  query: RetrievalQuery,
): Promise<RetrievedPassage[]> {
  if (!documents.length) return [];
  const terms = queryTerms(query.text);
  const chunks: RankedChunk[] = [];
  for (const document of documents.filter((item) => item.status === 'ready' && documentIsVisible(item, query))) {
    try {
      chunks.push(...makeChunks(document, await readFile(knowledgePath(document.id), 'utf8'), terms));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  chunks.sort((left, right) => right.score - left.score || left.index - right.index);

  const selected: RankedChunk[] = [];
  let length = 0;
  const characterLimit = query.maxCharacters ?? maximumContextCharacters;
  for (const chunk of chunks) {
    const renderedLength = chunk.text.length + chunk.document.name.length + 60;
    if (length + renderedLength > characterLimit) continue;
    selected.push(chunk);
    length += renderedLength;
    if (selected.length >= (query.topK ?? 14)) break;
  }
  return selected.map((chunk) => ({
    text: chunk.text,
    score: chunk.score,
    source: {
      documentId: chunk.document.id,
      title: chunk.document.name,
      uri: chunk.document.provider?.sourceUri,
      excerpt: chunk.index + 1,
    },
    metadata: {
      learnerId: chunk.document.scope?.learnerId ?? query.scope.learnerId,
      ...(chunk.document.scope?.goalId ? { goalId: chunk.document.scope.goalId } : {}),
      visibility: chunk.document.scope?.visibility ?? 'learner',
      backend: chunk.document.provider?.backend ?? 'local-filesystem',
    },
  }));
}

export async function loadRelevantDocumentContext(
  documents: KnowledgeDocument[],
  query: string,
  scope: Pick<KnowledgeScope, 'learnerId' | 'goalId'>,
): Promise<RelevantDocumentContext> {
  return formatRetrievedContext(await retrieveLocalPassages(documents, { text: query, scope }));
}

export class LocalKnowledgeRepository implements KnowledgeRepository {
  readonly backend = 'local-filesystem';
  ingest = ingestDocument;
  retrieve = retrieveLocalPassages;
  async remove(documents: KnowledgeDocument[]): Promise<void> {
    await Promise.all(documents.flatMap((document) => [
      unlink(knowledgePath(document.id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }),
      unlink(path.join(uploadDirectory, document.id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }),
    ]));
  }
}

export const localKnowledgeRepository = new LocalKnowledgeRepository();
