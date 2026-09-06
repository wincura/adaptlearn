import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3KnowledgeRepository } from '../server/knowledge/s3-document-store.ts';
import { DynamoDbWorkspaceRepository } from '../server/storage/dynamodb-workspace-repository.ts';

// Exercise the actual adapters with an in-memory AWS transport, including a new
// adapter instance to prove no Lambda-local files are needed for retrieval.
test('S3 documents survive a fresh adapter and import preserves IDs and ownership', async (t) => {
  const objects = new Map<string, string | Buffer>();
  t.mock.method(S3Client.prototype, 'send', async (command: { input: Record<string, string | Buffer> }) => {
    const key = command.input.Key as string;
    if (command instanceof PutObjectCommand) objects.set(key, command.input.Body as string | Buffer);
    else if (command instanceof GetObjectCommand) {
      assert.ok(objects.has(key)); return { Body: { transformToString: async () => objects.get(key)!.toString() } };
    } else if (command instanceof CopyObjectCommand) {
      const source = decodeURIComponent(command.input.CopySource!).replace(/^test-bucket\//, '');
      assert.ok(objects.has(source)); objects.set(key, objects.get(source)!);
    } else if (command instanceof DeleteObjectCommand) objects.delete(key);
    return {};
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'adaptlearn-s3-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'notes'); await writeFile(file, 'Algebra uses variables and equations to solve problems.');
  const repository = new S3KnowledgeRepository('test-bucket');
  const document = await repository.ingest({ filename: 'doc-one', originalname: 'notes.txt', mimetype: 'text/plain', path: file, size: 55 }, { learnerId: 'guest-one', visibility: 'learner' });
  const fresh = new S3KnowledgeRepository('test-bucket');
  assert.match((await fresh.retrieve([document], { text: 'algebra', scope: { learnerId: 'guest-one' } }))[0].text, /Algebra/);
  assert.equal((await fresh.retrieve([document], { text: 'algebra', scope: { learnerId: 'user-other' } })).length, 0);
  const copied = await fresh.copyTo(document, 'user-one');
  assert.equal(copied.id, document.id); assert.equal(copied.scope?.learnerId, 'user-one');
  await fresh.remove([document]);
  assert.ok((await fresh.retrieve([copied], { text: 'algebra', scope: { learnerId: 'user-one' } })).length);
  assert.ok(!objects.has('knowledge/guest-one/doc-one/text'));
});

test('large DynamoDB workspaces use immutable S3 snapshots and preserve optimistic concurrency', async (t) => {
  const previous = process.env.UPLOADS_BUCKET; process.env.UPLOADS_BUCKET = 'test-bucket';
  t.after(() => { if (previous === undefined) delete process.env.UPLOADS_BUCKET; else process.env.UPLOADS_BUCKET = previous; });
  const objects = new Map<string, string>();
  let record: Record<string, unknown> | undefined;
  let conflict = true;
  t.mock.method(S3Client.prototype, 'send', async (command: { input: Record<string, string> }) => {
    if (command instanceof PutObjectCommand) { objects.set(command.input.Key!, command.input.Body as string); return {}; }
    return { Body: { transformToString: async () => objects.get(command.input.Key)! } };
  });
  t.mock.method(DynamoDBDocumentClient.prototype, 'send', async (command: { input: Record<string, unknown> }) => {
    if (command instanceof GetCommand) return { Item: record && structuredClone(record) };
    if (command instanceof PutCommand) {
      if (conflict) { conflict = false; throw Object.assign(new Error('conflict'), { name: 'ConditionalCheckFailedException' }); }
      record = structuredClone(command.input.Item); return {};
    }
    throw new Error('Unexpected command');
  });
  const store = new DynamoDbWorkspaceRepository('workspaces');
  await store.update('user-one', (workspace) => { workspace.conversation = [{ id: 'large', role: 'user', agent: 'teacher', text: 'a'.repeat(350_000), createdAt: '' }]; workspace.progress.xp += 10; });
  assert.equal(record?.workspace, undefined); assert.equal(typeof record?.workspaceKey, 'string');
  assert.equal(objects.size, 2, 'each optimistic attempt gets an immutable key');
  const restored = await new DynamoDbWorkspaceRepository('workspaces').get('user-one');
  assert.equal(restored.conversation[0].text.length, 350_000); assert.equal(restored.progress.xp, 10);
});
