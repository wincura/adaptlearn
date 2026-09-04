import type { RelevantDocumentContext, RetrievedPassage } from './contracts.ts';

export function formatRetrievedContext(passages: RetrievedPassage[]): RelevantDocumentContext {
  const usedDocuments = [...new Set(passages.map((passage) => passage.source.title))];
  const context = passages.map((passage) => (
    `--- RETRIEVED SOURCE: ${passage.source.title} · excerpt ${passage.source.excerpt} ---\n${passage.text}`
  )).join('\n\n');
  return { context, usedDocuments, passages };
}
