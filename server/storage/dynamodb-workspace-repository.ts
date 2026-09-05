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
  workspace: LearningWorkspace;
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
        ProjectionExpression: 'learnerId, workspace',
      }));
      items.push(...(page.Items ?? []) as WorkspaceRecord[]);
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items
      .map((item) => summarizeWorkspace(normalizedWorkspace(item.workspace)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(learnerId: string): Promise<LearningWorkspace> {
    const record = await this.read(learnerId);
    return normalizedWorkspace(record?.workspace ?? freshWorkspace(learnerId));
  }

  async update(learnerId: string, mutate: WorkspaceMutation): Promise<LearningWorkspace> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const currentRecord = await this.read(learnerId);
      const current = normalizedWorkspace(currentRecord?.workspace ?? freshWorkspace(learnerId));
      const next = normalizedWorkspace(mutate(current) ?? current);
      next.updatedAt = new Date().toISOString();
      const version = (currentRecord?.version ?? 0) + 1;
      try {
        await client.send(new PutCommand({
          TableName: this.tableName,
          Item: { learnerId, workspace: next, version },
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

  private async read(learnerId: string): Promise<WorkspaceRecord | undefined> {
    const result = await client.send(new GetCommand({
      TableName: this.tableName,
      Key: { learnerId },
      ConsistentRead: true,
    }));
    return result.Item as WorkspaceRecord | undefined;
  }
}
