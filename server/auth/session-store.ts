import crypto from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export type SessionRecord = {
  id: string;
  expiresAt: number;
  kind: 'guest' | 'account' | 'oauth' | 'lock';
  learnerId: string;
  csrf: string;
  guestId?: string;
  verifier?: string;
  nonce?: string;
  browserId?: string;
  tokens?: { access_token: string; id_token: string; refresh_token?: string; expiresAt: number };
};
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const now = () => Math.floor(Date.now() / 1000);
export const sessionLifetime = 30 * 24 * 60 * 60;
const digest = (id: string) => crypto.createHash('sha256').update(id).digest('hex');

export interface SessionStore {
  get(id: string): Promise<SessionRecord | undefined>;
  put(record: SessionRecord): Promise<void>;
  take(id: string): Promise<SessionRecord | undefined>;
  delete(id: string): Promise<void>;
  touch(id: string, expiresAt: number, tokens?: SessionRecord['tokens'], clearGuest?: boolean): Promise<boolean>;
  acquireLock(id: string, owner: string): Promise<boolean>;
  releaseLock(id: string, owner: string): Promise<void>;
}

export class FileSessionStore implements SessionStore {
  private queue: Promise<unknown> = Promise.resolve();
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.catch(() => undefined); return result;
  }
  private directory: string;
  constructor(directory = path.resolve('data', 'sessions')) { this.directory = directory; }
  private file(id: string) { return path.join(this.directory, `${digest(id)}.json`); }
  async get(id: string) {
    try { return JSON.parse(await readFile(this.file(id), 'utf8')) as SessionRecord; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  put(record: SessionRecord) { return this.exclusive(() => this.write(record)); }
  private async write(record: SessionRecord) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.file(record.id)}.${randomToken()}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, this.file(record.id));
  }
  take(id: string) { return this.exclusive(() => this.claim(id)); }
  private async claim(id: string) {
    const claimed = `${this.file(id)}.${randomToken()}.claimed`;
    try { await rename(this.file(id), claimed); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    try { return JSON.parse(await readFile(claimed, 'utf8')) as SessionRecord; }
    finally { await unlink(claimed); }
  }
  touch(id: string, expiresAt: number, tokens?: SessionRecord['tokens'], clearGuest = false) {
    return this.exclusive(async () => {
      const record = await this.get(id);
      if (!record) return false;
      await this.write({ ...record, expiresAt, ...(tokens ? { tokens } : {}), ...(clearGuest ? { guestId: undefined } : {}) });
      return true;
    });
  }
  acquireLock(id: string, owner: string) {
    return this.exclusive(async () => {
      const existing = await this.get(id);
      if (existing && existing.expiresAt > now()) return false;
      await this.write({ id, kind: 'lock', learnerId: '', csrf: '', browserId: owner, expiresAt: now() + 300 });
      return true;
    });
  }
  releaseLock(id: string, owner: string) {
    return this.exclusive(async () => { if ((await this.get(id))?.browserId === owner) await this.claim(id); });
  }
  async delete(id: string) { await this.take(id); }
}

export class DynamoSessionStore implements SessionStore {
  private client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  private table: string;
  constructor(table = process.env.SESSION_TABLE!) { if (!table) throw new Error('SESSION_TABLE is required.'); this.table = table; }
  async get(id: string) {
    const result = await this.client.send(new GetCommand({ TableName: this.table, Key: { id: digest(id) }, ConsistentRead: true }));
    return result.Item ? { ...result.Item, id } as SessionRecord : undefined;
  }
  async put(record: SessionRecord) { await this.client.send(new PutCommand({ TableName: this.table, Item: { ...record, id: digest(record.id) } })); }
  async take(id: string) {
    const result = await this.client.send(new DeleteCommand({ TableName: this.table, Key: { id: digest(id) }, ReturnValues: 'ALL_OLD' }));
    return result.Attributes ? { ...result.Attributes, id } as SessionRecord : undefined;
  }
  async touch(id: string, expiresAt: number, tokens?: SessionRecord['tokens'], clearGuest = false) {
    try {
      await this.client.send(new UpdateCommand({ TableName: this.table, Key: { id: digest(id) },
        UpdateExpression: 'SET expiresAt = :expiry' + (tokens ? ', tokens = :tokens' : '') + (clearGuest ? ' REMOVE guestId' : ''),
        ExpressionAttributeValues: { ':expiry': expiresAt, ...(tokens ? { ':tokens': tokens } : {}) },
        ConditionExpression: 'attribute_exists(id)',
      }));
      return true;
    } catch (error) { if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false; throw error; }
  }
  async acquireLock(id: string, owner: string) {
    try {
      await this.client.send(new PutCommand({ TableName: this.table,
        Item: { id: digest(id), kind: 'lock', browserId: owner, expiresAt: now() + 300 },
        ConditionExpression: 'attribute_not_exists(id) OR expiresAt < :now', ExpressionAttributeValues: { ':now': now() },
      }));
      return true;
    } catch (error) { if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false; throw error; }
  }
  async releaseLock(id: string, owner: string) {
    try { await this.client.send(new DeleteCommand({ TableName: this.table, Key: { id: digest(id) }, ConditionExpression: 'browserId = :owner', ExpressionAttributeValues: { ':owner': owner } })); }
    catch (error) { if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error; }
  }
  async delete(id: string) { await this.take(id); }
}
