import { readFile, unlink } from 'node:fs/promises';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import type { KnowledgeDocument } from '../../shared/contracts.ts';
import type { KnowledgeRepository, KnowledgeScope, RetrievalQuery, UploadedDocumentInput } from './contracts.ts';
import { extractText, normalizeText, retrieveLocalPassages } from './document-store.ts';

export class S3KnowledgeRepository implements KnowledgeRepository {
  readonly backend = 's3';
  private client = new S3Client({});
  private bucket: string;
  constructor(bucket = process.env.UPLOADS_BUCKET!) { if (!bucket) throw new Error('UPLOADS_BUCKET is required.'); this.bucket = bucket; }
  private prefix(learnerId: string, id: string) { return `knowledge/${encodeURIComponent(learnerId)}/${encodeURIComponent(id)}`; }
  private key(document: KnowledgeDocument) {
    if (!document.scope?.learnerId) throw new Error('Document ownership is missing.');
    return this.prefix(document.scope.learnerId, document.id);
  }
  async ingest(file: UploadedDocumentInput, scope: KnowledgeScope): Promise<KnowledgeDocument> {
    try {
      const extracted = normalizeText(await extractText(file));
      if (!extracted) throw new Error('No readable text was found in this document.');
      const text = extracted.slice(0, 2_000_000);
      const prefix = this.prefix(scope.learnerId, file.filename);
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: `${prefix}/original`, Body: await readFile(file.path), ContentType: file.mimetype || 'application/octet-stream' }));
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: `${prefix}/text`, Body: text, ContentType: 'text/plain; charset=utf-8' }));
      return { id: file.filename, name: file.originalname, mimeType: file.mimetype, size: file.size, status: 'ready', characterCount: text.length, truncated: extracted.length > text.length, uploadedAt: new Date().toISOString(), scope, provider: { backend: 's3', sourceUri: `s3://${this.bucket}/${prefix}/original` } };
    } finally { await unlink(file.path).catch(() => undefined); }
  }
  retrieve(documents: KnowledgeDocument[], query: RetrievalQuery) {
    return retrieveLocalPassages(documents, query, async (document) => {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: `${this.key(document)}/text` }));
      if (!result.Body) throw new Error('Document text is missing.');
      return result.Body.transformToString();
    });
  }
  async copyTo(document: KnowledgeDocument, learnerId: string): Promise<KnowledgeDocument> {
    const destination = this.prefix(learnerId, document.id);
    for (const suffix of ['original', 'text']) await this.client.send(new CopyObjectCommand({ Bucket: this.bucket, Key: `${destination}/${suffix}`, CopySource: `${this.bucket}/${this.key(document)}/${suffix}`.split('/').map(encodeURIComponent).join('/') }));
    return { ...document, scope: { ...document.scope, visibility: document.scope?.visibility ?? 'learner', learnerId }, provider: { backend: 's3', sourceUri: `s3://${this.bucket}/${destination}/original` } };
  }
  async remove(documents: KnowledgeDocument[]) {
    for (const document of documents) for (const suffix of ['original', 'text']) await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: `${this.key(document)}/${suffix}` }));
  }
}
