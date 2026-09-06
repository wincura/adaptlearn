import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.ts';
import { freshWorkspace } from '../server/memory/workspace-store.ts';
import type { WorkspaceRepository, WorkspaceMutation } from '../server/storage/workspace-repository.ts';
import type { LearningWorkspace, ConversationTurn, KnowledgeDocument } from '../shared/contracts.ts';
import { FileSessionStore, now, type SessionRecord } from '../server/auth/session-store.ts';
import { importGuest, mergeGuest } from '../server/auth/import-guest.ts';
import { identity, OwnedWorkspaceRepository, type PrivateWorkspace } from '../server/auth/ownership.ts';
import type { KnowledgeRepository } from '../server/knowledge/contracts.ts';

class MemoryWorkspace implements WorkspaceRepository {
  backend = 'test';
  data = new Map<string, LearningWorkspace>();
  async list() { return []; }
  async get(id: string) { return structuredClone(this.data.get(id) ?? freshWorkspace(id)); }
  async update(id: string, mutate: WorkspaceMutation) {
    const workspace = structuredClone(this.data.get(id) ?? freshWorkspace(id));
    const next = mutate(workspace) ?? workspace;
    this.data.set(id, structuredClone(next));
    return next;
  }
  async delete(id: string) { this.data.delete(id); }
  appendTurn(id: string, turn: Omit<ConversationTurn, 'id' | 'createdAt'>) { return this.update(id, (w) => { w.conversation.push({ ...turn, id: crypto.randomUUID(), createdAt: new Date().toISOString() }); }); }
}
const knowledge: KnowledgeRepository = { backend: 'test', async ingest() { throw new Error('unused'); }, async retrieve() { return []; }, async remove() {}, async copyTo(document, learnerId) { return { ...document, scope: { visibility: 'learner', learnerId } }; } };
const profile = { displayName: 'Alice', background: '', preferences: '' };
const settings = { siteUrl: 'http://localhost:5173', domain: 'https://example.auth.us-east-1.amazoncognito.com', clientId: 'test-client', userPoolId: 'us-east-1_example' };

async function fixture(t: test.TestContext, options: { omitName?: boolean; knowledge?: KnowledgeRepository; tokenExpiresIn?: number | string } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'adaptlearn-auth-'));
  const sessions = new FileSessionStore(directory);
  const store = new MemoryWorkspace();
  const app = createApp({ workspaceRepository: store, knowledgeRepository: options.knowledge ?? knowledge, auth: { sessions, config: settings,
    fetch: (async () => new Response(JSON.stringify({ access_token: 'access', id_token: 'id', refresh_token: 'refresh', expires_in: options.tokenExpiresIn ?? 3600 }), { status: 200 })) as typeof fetch,
    verify: async () => ({ sub: 'account-one', name: options.omitName ? undefined : 'Alice' }),
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  const call = (url: string, cookie = '', init: RequestInit = {}) => fetch(`${base}${url}`, { ...init, redirect: 'manual', headers: { Cookie: cookie, Origin: settings.siteUrl, ...init.headers } });
  const guest = async () => {
    const response = await call('/api/auth/session');
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], session: await response.json() as { learnerId: string; csrfToken: string; kind: string } };
  };
  return { call, guest, sessions, store };
}

test('guest persists across visits; cookie is HttpOnly and private responses are uncached', async (t) => {
  const { call, guest } = await fixture(t);
  const first = await guest();
  const second = await call('/api/auth/session', first.cookie);
  assert.equal((await second.json()).learnerId, first.session.learnerId);
  assert.match(second.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(second.headers.get('set-cookie')!, /SameSite=Lax/);
  assert.equal(second.headers.get('cache-control'), 'no-store');
});

test('workspace and mutation routes reject other identities and CSRF', async (t) => {
  const { call, guest } = await fixture(t);
  const a = await guest(); const b = await guest();
  assert.equal((await call(`/api/workspace/${b.session.learnerId}`, a.cookie)).status, 403);
  assert.equal((await call(`/api/workspace/${a.session.learnerId}/profile`, a.cookie, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })).status, 403);
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': a.session.csrfToken };
  assert.equal((await call(`/api/workspace/${a.session.learnerId}/profile`, a.cookie, { method: 'PUT', headers, body: JSON.stringify(profile) })).status, 200);
  assert.equal((await call('/api/chat', a.cookie, { method: 'POST', headers, body: JSON.stringify({ learnerId: b.session.learnerId, message: 'hello' }) })).status, 403);
  const listed = await (await call('/api/profiles', a.cookie)).json();
  assert.equal(listed.length, 1); assert.equal(listed[0].learnerId, a.session.learnerId);
  assert.equal((await call('/api/profiles', a.cookie, { method: 'POST', headers, body: JSON.stringify(profile) })).status, 403);
  assert.equal((await call('/api/workspace/local-learner', a.cookie)).status, 403);
  for (const route of ['/api/materials/generate', '/api/assessments/placement', '/api/assessments/test/submit', '/api/research/suggestions', '/api/research/suggestions/test/accept', '/api/sandbox/evaluate', '/api/materials/test/coding-challenge']) {
    assert.equal((await call(route, a.cookie, { method: 'POST', headers, body: JSON.stringify({ learnerId: b.session.learnerId }) })).status, 403, route);
  }
  const form = new FormData(); form.append('learnerId', b.session.learnerId); form.append('document', new Blob(['private']), 'test.txt');
  assert.equal((await call('/api/documents', a.cookie, { method: 'POST', headers: { 'X-CSRF-Token': a.session.csrfToken }, body: form })).status, 403);
});

test('Cognito login uses PKCE; callback imports exactly once and rotates session', async (t) => {
  const { call, guest, store } = await fixture(t);
  const a = await guest();
  await store.update(a.session.learnerId, (workspace) => { workspace.progress.xp = 90; });
  const login = await call('/api/auth/login', a.cookie);
  const url = new URL(login.headers.get('location')!);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.ok(url.searchParams.get('nonce'));
  const callback = `/api/auth/callback?state=${url.searchParams.get('state')}&code=code`;
  const result = await call(callback, a.cookie);
  assert.match(result.headers.get('location')!, /signedIn=1/);
  const accountCookie = result.headers.get('set-cookie')!.split(';')[0];
  assert.notEqual(accountCookie, a.cookie);
  const auth = await (await call('/api/auth/session', accountCookie)).json();
  assert.equal(auth.kind, 'account'); assert.equal(auth.displayName, 'Alice');
  const workspace = await (await call(`/api/workspace/${auth.learnerId}`, accountCookie)).json();
  assert.equal(workspace.progress.xp, 90); assert.equal(workspace.auth, undefined);
  assert.match((await call(callback, a.cookie)).headers.get('location')!, /authError=invalid/);
  assert.equal((await call(`/api/workspace/${a.session.learnerId}`, a.cookie)).status, 401);
  const logout = await call('/api/auth/logout', accountCookie, { method: 'POST', headers: { 'X-Requested-With': 'AdaptLearn' } });
  assert.equal(logout.status, 200);
  const nextCookie = logout.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await (await call('/api/auth/session', nextCookie)).json()).kind, 'guest');
  assert.equal((await call(`/api/workspace/${auth.learnerId}`, nextCookie)).status, 403);
});

test('canceled login retains guest; state from another browser is rejected without consuming it', async (t) => {
  const { call, guest } = await fixture(t); const a = await guest(); const b = await guest();
  const login = await call('/api/auth/login', a.cookie);
  const state = new URL(login.headers.get('location')!).searchParams.get('state');
  assert.match((await call(`/api/auth/callback?state=${state}&code=x`, b.cookie)).headers.get('location')!, /authError=invalid/);
  assert.match((await call(`/api/auth/callback?state=${state}&error=access_denied`, a.cookie)).headers.get('location')!, /authError=canceled/);
  assert.equal((await (await call('/api/auth/session', a.cookie)).json()).learnerId, a.session.learnerId);
});

test('expired account cannot become a guest implicitly', async (t) => {
  const { call, sessions } = await fixture(t);
  const account: SessionRecord = { id: 'expired-token', csrf: 'csrf', learnerId: 'user-alice', kind: 'account', expiresAt: now() - 1 };
  await sessions.put(account);
  const response = await call('/api/auth/session', 'adaptlearn_session=expired-token');
  assert.equal(response.status, 401); assert.equal(response.headers.get('set-cookie'), null);
});

test('merge preserves account preferences, active goal, IDs and level, and is idempotent', () => {
  const guest = freshWorkspace('guest-one'); const account = freshWorkspace('user-one');
  account.profile = { displayName: 'Alice', background: 'existing', preferences: '' };
  guest.profile.preferences = 'examples'; account.progress.xp = 100; guest.progress.xp = 50;
  account.progress.badges = ['First placement']; guest.progress.badges = ['First placement', 'Practice'];
  account.goals = [{ id: 'a', title: 'existing', status: 'active', createdAt: '', motivation: '', targetOutcome: '' }];
  guest.goals = [{ id: 'g', title: 'guest', status: 'active', createdAt: '', motivation: '', targetOutcome: '' }];
  mergeGuest(account, guest); mergeGuest(account, guest);
  assert.equal(account.progress.xp, 150); assert.equal(account.goals.length, 2);
  assert.equal(account.goals[1].status, 'paused'); assert.equal(account.profile.background, 'existing');
  assert.equal(account.profile.preferences, 'examples'); assert.deepEqual(account.progress.badges, ['First placement', 'Practice']);
});

test('failed document import keeps source, freezes guest writes, and safely retries concurrently', async () => {
  const store = new MemoryWorkspace();
  const document: KnowledgeDocument = { id: 'doc', name: 'notes', mimeType: 'text/plain', size: 10, status: 'ready', characterCount: 10, truncated: false, uploadedAt: '', scope: { learnerId: 'guest-a', visibility: 'learner' } };
  await store.update('guest-a', (w) => { w.documents = [document]; w.progress.xp = 25; });
  const failing = { ...knowledge, async copyTo(): Promise<KnowledgeDocument> { throw new Error('S3 unavailable'); } };
  await assert.rejects(importGuest(store, failing, 'guest-a', 'user-a'), /S3 unavailable/);
  assert.equal((await store.get('guest-a')).documents.length, 1);
  assert.equal((await store.get('user-a')).progress.xp, 0);
  const owned = new OwnedWorkspaceRepository(store);
  await identity.run({ learnerId: 'guest-a' }, async () => { await assert.rejects(owned.update('guest-a', (w) => { w.progress.xp++; }), /being imported/); });
  await Promise.all([importGuest(store, knowledge, 'guest-a', 'user-a'), importGuest(store, knowledge, 'guest-a', 'user-a')]);
  const result = await store.get('user-a') as PrivateWorkspace;
  assert.equal(result.progress.xp, 25); assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].id, 'doc'); assert.equal(result.documents[0].scope?.learnerId, 'user-a');
  await assert.rejects(importGuest(store, knowledge, 'guest-a', 'user-b'), /another account/);
});


test('missing Cognito name is requested once and saved to the account', async (t) => {
  const { call, guest } = await fixture(t, { omitName: true }); const a = await guest();
  const login = await call('/api/auth/login', a.cookie);
  const state = new URL(login.headers.get('location')!).searchParams.get('state');
  const callback = await call(`/api/auth/callback?state=${state}&code=x`, a.cookie);
  const cookie = callback.headers.get('set-cookie')!.split(';')[0];
  const auth = await (await call('/api/auth/session', cookie)).json();
  assert.equal(auth.needsName, true);
  assert.equal((await call(`/api/workspace/${auth.learnerId}/profile`, cookie, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': auth.csrfToken }, body: JSON.stringify({ ...profile, displayName: 'Learner' }) })).status, 200);
  assert.equal((await (await call('/api/auth/session', cookie)).json()).needsName, false);
});

test('Cognito callback accepts string token expiry values', async (t) => {
  const { call, guest } = await fixture(t, { tokenExpiresIn: '3600' });
  const a = await guest();
  const login = await call('/api/auth/login', a.cookie);
  const state = new URL(login.headers.get('location')!).searchParams.get('state');
  const callback = await call(`/api/auth/callback?state=${state}&code=x`, a.cookie);
  assert.match(callback.headers.get('location')!, /signedIn=1/);
});

test('pending imports survive a lost session and complete on a later login', async (t) => {
  let fail = true;
  const flaky = { ...knowledge, async copyTo(document: KnowledgeDocument, learnerId: string) { if (fail) throw new Error('temporary outage'); return knowledge.copyTo!(document, learnerId); } };
  const { call, guest, store } = await fixture(t, { knowledge: flaky });
  const a = await guest();
  await store.update(a.session.learnerId, (w) => { w.progress.xp = 55; w.documents = [{ id: 'doc', name: 'notes', mimeType: 'text/plain', size: 1, characterCount: 1, truncated: false, status: 'ready', uploadedAt: '' }]; });
  const login = await call('/api/auth/login', a.cookie);
  const state = new URL(login.headers.get('location')!).searchParams.get('state');
  const callback = await call(`/api/auth/callback?state=${state}&code=x`, a.cookie);
  assert.match(callback.headers.get('location')!, /authError=import/);
  assert.equal((await store.get('user-account-one') as PrivateWorkspace).auth?.pendingGuests?.[0], a.session.learnerId);
  fail = false;
  const b = await guest();
  const secondLogin = await call('/api/auth/login', b.cookie);
  const secondState = new URL(secondLogin.headers.get('location')!).searchParams.get('state');
  const restored = await call(`/api/auth/callback?state=${secondState}&code=y`, b.cookie);
  assert.match(restored.headers.get('location')!, /signedIn=1/);
  assert.equal((await store.get('user-account-one')).progress.xp, 55);
  assert.equal((await store.get('user-account-one') as PrivateWorkspace).auth?.pendingGuests?.length, 0);
});

test('session leases and revocation prevent stale renewal from recreating a session', async (t) => {
  const { sessions } = await fixture(t);
  await sessions.put({ id: 'test', kind: 'guest', csrf: '', learnerId: 'guest-test', expiresAt: now() + 100 });
  assert.deepEqual(await Promise.all([sessions.acquireLock('lock:test', 'one'), sessions.acquireLock('lock:test', 'two')]), [true, false]);
  await sessions.releaseLock('lock:test', 'wrong');
  assert.equal(await sessions.acquireLock('lock:test', 'two'), false);
  await sessions.releaseLock('lock:test', 'one');
  assert.equal(await sessions.acquireLock('lock:test', 'two'), true);
  await sessions.delete('test');
  assert.equal(await sessions.touch('test', now() + 1000), false);
});
