import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { KnowledgeDocument } from '../../shared/contracts.ts';

const knowledgeDirectory = path.resolve(process.cwd(), 'data', 'knowledge');
const maximumStoredCharacters = 2_000_000;
const maximumContextCharacters = 45_000;
const chunkSize = 3_200;
const chunkOverlap = 300;
const supportedExtensions = new Set(['.pdf', '.docx', '.txt', '.md', '.csv']);

type UploadedFile = {
  filename: string;
  originalname: string;
  mimetype: string;
  path: string;
  size: number;
};

const knowledgePath = (documentId: string) => path.join(knowledgeDirectory, `${documentId}.txt`);

async function extractText(file: UploadedFile): Promise<string> {
  const extension = path.extname(file.originalname).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error('Unsupported document type. Upload a PDF, DOCX, TXT, Markdown, or CSV file.');
  }

  const buffer = await readFile(file.path);
  if (extension === '.pdf') {
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

export async function ingestDocument(file: UploadedFile): Promise<KnowledgeDocument> {
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
  };
}

type RankedChunk = { documentName: string; index: number; text: string; score: number };

const queryTerms = (query: string) => [...new Set(
  query.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{2,}/g)?.filter((term) => ![
    'and', 'the', 'for', 'with', 'from', 'that', 'this', 'want', 'learn', 'learning', 'goal', 'into', 'your',
  ].includes(term)) ?? [],
)].slice(0, 30);

function makeChunks(documentName: string, text: string, terms: string[]): RankedChunk[] {
  const chunks: RankedChunk[] = [];
  let index = 0;
  for (let start = 0; start < text.length; start += chunkSize - chunkOverlap) {
    const chunk = text.slice(start, start + chunkSize).trim();
    if (!chunk) continue;
    const lower = chunk.toLowerCase();
    const matches = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
    chunks.push({ documentName, index, text: chunk, score: matches * 10 + (index === 0 ? 2 : 0) });
    index += 1;
  }
  return chunks;
}

export async function loadRelevantDocumentContext(
  documents: KnowledgeDocument[],
  query: string,
): Promise<{ context: string; usedDocuments: string[] }> {
  if (!documents.length) return { context: '', usedDocuments: [] };
  const terms = queryTerms(query);
  const chunks: RankedChunk[] = [];
  for (const document of documents.filter((item) => item.status === 'ready')) {
    try {
      chunks.push(...makeChunks(document.name, await readFile(knowledgePath(document.id), 'utf8'), terms));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  chunks.sort((left, right) => right.score - left.score || left.index - right.index);

  const selected: RankedChunk[] = [];
  let length = 0;
  for (const chunk of chunks) {
    const renderedLength = chunk.text.length + chunk.documentName.length + 60;
    if (length + renderedLength > maximumContextCharacters) continue;
    selected.push(chunk);
    length += renderedLength;
    if (selected.length >= 14) break;
  }
  const usedDocuments = [...new Set(selected.map((chunk) => chunk.documentName))];
  const context = selected.map((chunk) => (
    `--- UPLOADED DOCUMENT: ${chunk.documentName} · excerpt ${chunk.index + 1} ---\n${chunk.text}`
  )).join('\n\n');
  return { context, usedDocuments };
}
