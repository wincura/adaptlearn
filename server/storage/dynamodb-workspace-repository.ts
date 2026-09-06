import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ConversationTurn, LearnerWorkspaceSummary, LearningWorkspace } from '../../shared/contracts.ts';
import { freshWorkspace, normalizedWorkspace, summarizeWorkspace } from '../memory/workspace-store.ts';
import type { WorkspaceMutation, WorkspaceRepository } from './workspace-repository.ts';

type WorkspaceRecord = {
  learnerId: string;
  workspace?: LearningWorkspace;
  workspaceKey?: string;
  summary?: LearnerWorkspaceSummary;
  version: number;
};

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const conditionalFailure = (error: unknown) =>
  (error as { name?: string }).name === 'ConditionalCheckFailedException';

export class DynamoDbWorkspaceRepository implements WorkspaceRepository {
  readonly backend = 'dynamodb';
  private readonly tableName: string;
  private readonly bucket = process.env.UPLOADS_BUCKET;
  private readonly s3 = new S3Client({});

  constructor(tableName = process.env.WORKSPACE_TABLE) {
    if (!tableName) throw new Error('WORKSPACE_TABLE is required when WORKSPACE_REPOSITORY=dynamodb.');
    this.tableName = tableName;
  }

  async list(): Promise<LearnerWorkspaceSummary[]> {
    const items: WorkspaceRecord[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await client.send(new ScanCommand({
        TableName: this.tableName,
        ExclusiveStartKey: exclusiveStartKey,
        ProjectionExpression: 'learnerId, workspace, summary',
      }));
      items.push(...(page.Items ?? []) as WorkspaceRecord[]);
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items
      .map((item) => item.summary ?? summarizeWorkspace(normalizedWorkspace(item.workspace!)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(learnerId: string): Promise<LearningWorkspace> {
    const record = await this.read(learnerId);
    return normalizedWorkspace(await this.loadWorkspace(record, learnerId));
  }

  async update(learnerId: string, mutate: WorkspaceMutation): Promise<LearningWorkspace> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const currentRecord = await this.read(learnerId);
      const current = normalizedWorkspace(await this.loadWorkspace(currentRecord, learnerId));
      const next = normalizedWorkspace(mutate(current) ?? current);
      next.updatedAt = new Date().toISOString();
      const version = (currentRecord?.version ?? 0) + 1;
      const serialized = JSON.stringify(next);
      let payload: Pick<WorkspaceRecord, 'workspace' | 'workspaceKey'> = { workspace: next };
      if (Buffer.byteLength(serialized) > 300_000) {
        if (!this.bucket) throw new Error('UPLOADS_BUCKET is required for large workspaces.');
        const key = `knowledge/workspaces/${encodeURIComponent(learnerId)}/${crypto.randomUUID()}.json`;
        await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: serialized, ContentType: 'application/json' }));
        payload = { workspaceKey: key };
      }
      try {
        await client.send(new PutCommand({
          TableName: this.tableName,
          Item: { learnerId, ...payload, summary: summarizeWorkspace(next), version },
          ...(currentRecord
            ? {
                ConditionExpression: 'version = :expectedVersion',
                ExpressionAttributeValues: { ':expectedVersion': currentRecord.version },
              }
            : { ConditionExpression: 'attribute_not_exists(learnerId)' }),
        }));
        return next;
      } catch (error) {
        if (!conditionalFailure(error) || attempt === 3) throw error;
      }
    }
    throw new Error('Workspace update could not be completed.');
  }

  appendTurn(learnerId: string, turn: Omit<ConversationTurn, 'id' | 'createdAt'>) {
    return this.update(learnerId, (workspace) => {
      workspace.conversation.push({ ...turn, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
      workspace.conversation = workspace.conversation.slice(-80);
    });
  }

  async delete(learnerId: string): Promise<void> {
    await client.send(new DeleteCommand({ TableName: this.tableName, Key: { learnerId } }));
  }

  private async loadWorkspace(record: WorkspaceRecord | undefined, learnerId: string): Promise<LearningWorkspace> {
    if (!record?.workspaceKey) return record?.workspace ?? freshWorkspace(learnerId);
    if (!this.bucket) throw new Error('UPLOADS_BUCKET is required to restore this workspace.');
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: record.workspaceKey }));
    if (!object.Body) throw new Error('Saved workspace is missing.');
    return JSON.parse(await object.Body.transformToString()) as LearningWorkspace;
  }

  private async read(learnerId: string): Promise<WorkspaceRecord | undefined> {
    const result = await client.send(new GetCommand({
      TableName: this.tableName,
      Key: { learnerId },
      ConsistentRead: true,
    }));
    return result.Item as WorkspaceRecord | undefined;
  }
}
