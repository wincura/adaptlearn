import crypto from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { WorkspaceRepository } from '../storage/workspace-repository.ts';
import type { KnowledgeRepository } from '../knowledge/contracts.ts';
import { DynamoSessionStore, FileSessionStore, now, randomToken, sessionLifetime, type SessionRecord, type SessionStore } from './session-store.ts';
import { HttpError, identity, type PrivateWorkspace } from './ownership.ts';
import { importGuest } from './import-guest.ts';

export type AuthConfig = { siteUrl: string; domain?: string; clientId?: string; userPoolId?: string };
export type AuthDependencies = { sessions?: SessionStore; fetch?: typeof fetch; config?: AuthConfig; verify?: (tokens: SessionRecord['tokens'], nonce?: string) => Promise<{ sub: string; name?: string }> };
const cookieName = 'adaptlearn_session';
const sessionId = (request: Request) => request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('base64url');
const valid = (session?: SessionRecord) => session && session.expiresAt > now();
const configured = (config: AuthConfig) => Boolean(config.domain && config.clientId && config.userPoolId);
let configuration: Promise<AuthConfig> | undefined;
export function loadAuthConfig(): Promise<AuthConfig> {
  configuration ??= (async () => {
    if (process.env.AUTH_CONFIG_PARAMETER) {
      const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
      const result = await new SSMClient({}).send(new GetParameterCommand({ Name: process.env.AUTH_CONFIG_PARAMETER }));
      return JSON.parse(result.Parameter!.Value!) as AuthConfig;
    }
    return { siteUrl: process.env.SITE_URL ?? 'http://localhost:3000', domain: process.env.COGNITO_DOMAIN, clientId: process.env.COGNITO_CLIENT_ID, userPoolId: process.env.COGNITO_USER_POOL_ID };
  })().catch((error) => { configuration = undefined; throw error; });
  return configuration;
}

export function installAuth(app: Express, store: WorkspaceRepository, knowledge: KnowledgeRepository, dependencies: AuthDependencies = {}) {
  const sessions = dependencies.sessions ?? (process.env.SESSION_TABLE ? new DynamoSessionStore() : new FileSessionStore());
  const config = () => dependencies.config ? Promise.resolve(dependencies.config) : loadAuthConfig();
  const setCookie = (response: Response, session: SessionRecord, settings: AuthConfig) => response.cookie(cookieName, session.id, {
    httpOnly: true, secure: settings.siteUrl.startsWith('https:'), sameSite: 'lax', path: '/', maxAge: sessionLifetime * 1000,
  });
  const read = async (request: Request) => { const id = sessionId(request); return id ? sessions.get(id) : undefined; };
  const createGuest = async (response: Response, settings: AuthConfig) => {
    const session: SessionRecord = { id: randomToken(), kind: 'guest', learnerId: `guest-${crypto.randomUUID()}`, csrf: randomToken(), expiresAt: now() + sessionLifetime };
    await sessions.put(session);
    setCookie(response, session, settings);
    return session;
  };
  const verify = async (tokens: SessionRecord['tokens'], settings: AuthConfig, nonce?: string) => {
    if (dependencies.verify) return dependencies.verify(tokens, nonce);
    if (!tokens) throw new HttpError(401, 'Sign in again to continue.');
    try {
      const access = await CognitoJwtVerifier.create({ userPoolId: settings.userPoolId!, clientId: settings.clientId!, tokenUse: 'access' }).verify(tokens.access_token);
      const id = await CognitoJwtVerifier.create({ userPoolId: settings.userPoolId!, clientId: settings.clientId!, tokenUse: 'id' }).verify(tokens.id_token);
      if (id.sub !== access.sub) throw new HttpError(401, 'Invalid sign-in response.');
      if (nonce && typeof id.nonce === 'string' && id.nonce !== nonce) throw new HttpError(401, 'Invalid sign-in response.');
      const displayName = [id.name, id.given_name].find((value) => typeof value === 'string' && value.trim());
      return { sub: id.sub, name: displayName?.trim() };
    } catch (error) {
      console.error('[AdaptLearn] Token verification failed', error);
      throw error;
    }
  };
  const tokenRequest = async (settings: AuthConfig, body: URLSearchParams): Promise<NonNullable<SessionRecord['tokens']>> => {
    const result = await (dependencies.fetch ?? fetch)(`${settings.domain}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
    if (!result.ok) {
      const details = await result.text().catch(() => '');
      console.error('[AdaptLearn] Cognito token request failed', result.status, details);
      throw new HttpError(401, 'Sign in again to continue.');
    }
    const tokens = await result.json() as { access_token: string; id_token: string; refresh_token?: string; expires_in: number | string };
    const expiresIn = Number(tokens.expires_in);
    if (!tokens.access_token || !tokens.id_token || !Number.isFinite(expiresIn)) throw new HttpError(401, 'Invalid sign-in response.');
    return { ...tokens, expires_in: expiresIn, expiresAt: now() + expiresIn };
  };
  const requireSession = async (request: Request, response: Response, settings: AuthConfig) => {
    const session = await read(request);
    if (!valid(session) || !['guest', 'account'].includes(session!.kind)) throw new HttpError(401, 'Your session expired. Sign in again, or explicitly start a new guest session.');
    if (session!.kind === 'account' && (!session!.tokens || session!.tokens.expiresAt <= now() + 60)) {
      if (!session!.tokens?.refresh_token) throw new HttpError(401, 'Sign in again to continue.');
      const refreshed = await tokenRequest(settings, new URLSearchParams({ grant_type: 'refresh_token', client_id: settings.clientId!, refresh_token: session!.tokens.refresh_token }));
      const user = await verify(refreshed, settings);
      if (`user-${user.sub}` !== session!.learnerId) throw new HttpError(401, 'Invalid session.');
      session!.tokens = { ...refreshed, refresh_token: refreshed.refresh_token ?? session!.tokens.refresh_token };
    }
    session!.expiresAt = now() + sessionLifetime;
    if (!await sessions.touch(session!.id, session!.expiresAt, session!.tokens)) throw new HttpError(401, 'Your session has ended.');
    setCookie(response, session!, settings);
    return session!;
  };
  const checkCsrf = (request: Request, session: SessionRecord, settings: AuthConfig) => {
    if (request.headers.origin !== new URL(settings.siteUrl).origin || request.headers['x-csrf-token'] !== session.csrf) throw new HttpError(403, 'Refresh the page before trying again.');
  };
  app.use('/api', (_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });

  const finishImports = async (session: SessionRecord) => {
    const account = await store.get(session.learnerId) as PrivateWorkspace;
    for (const guestId of new Set([...(account.auth?.pendingGuests ?? []), ...(session.guestId ? [session.guestId] : [])])) {
      const lock = `lock:${guestId}`; const owner = randomToken();
      if (!await sessions.acquireLock(lock, owner)) throw new HttpError(409, 'Guest work is still saving. Please retry the import shortly.');
      try { await importGuest(store, knowledge, guestId, session.learnerId); }
      finally { await sessions.releaseLock(lock, owner); }
    }
    session.guestId = undefined;
    if (!await sessions.touch(session.id, session.expiresAt, undefined, true)) throw new HttpError(401, 'Your session has ended.');
  };

  app.get('/api/auth/session', async (request, response) => {
    const settings = await config();
    const session = sessionId(request) ? await requireSession(request, response, settings) : await createGuest(response, settings);
    const workspace = await store.get(session.learnerId) as PrivateWorkspace;
    response.json({ kind: session.kind, learnerId: session.learnerId, csrfToken: session.csrf, signInAvailable: configured(settings), needsName: session.kind === 'account' && !workspace.auth?.nameCollected, importPending: Boolean(session.guestId || workspace.auth?.pendingGuests?.length), displayName: session.kind === 'guest' ? 'Guest' : workspace.profile.displayName });
  });

  app.get('/api/auth/login', async (request, response) => {
    const settings = await config();
    if (!configured(settings)) throw new HttpError(503, 'Sign-in is not configured yet. You can keep learning as a guest.');
    // Bind the one-time state to this browser, including an expired account cookie.
    let browserId = sessionId(request);
    if (!browserId) browserId = (await createGuest(response, settings)).id;
    const current = await sessions.get(browserId);
    const state: SessionRecord = { id: randomToken(), kind: 'oauth', learnerId: '', csrf: '', browserId, guestId: valid(current) ? current!.kind === 'guest' ? current!.learnerId : current!.guestId : undefined, verifier: randomToken(), nonce: randomToken(), expiresAt: now() + 600 };
    await sessions.put(state);
    const url = new URL(`${settings.domain}/oauth2/authorize`);
    url.search = new URLSearchParams({ client_id: settings.clientId!, response_type: 'code', redirect_uri: `${settings.siteUrl}/api/auth/callback`, scope: 'openid email profile', state: state.id, nonce: state.nonce!, code_challenge: hash(state.verifier!), code_challenge_method: 'S256' }).toString();
    response.redirect(url.toString());
  });

  app.get('/api/auth/callback', async (request, response) => {
    const settings = await config();
    const stateId = typeof request.query.state === 'string' ? request.query.state : '';
    const candidate = stateId ? await sessions.get(stateId) : undefined;
    if (!valid(candidate) || candidate?.kind !== 'oauth' || candidate.browserId !== sessionId(request)) return response.redirect(`${settings.siteUrl}/?authError=invalid`);
    const state = await sessions.take(stateId);
    if (!state) return response.redirect(`${settings.siteUrl}/?authError=invalid`);
    if (request.query.error || typeof request.query.code !== 'string') return response.redirect(`${settings.siteUrl}/?authError=canceled`);
    try {
      const tokens = await tokenRequest(settings, new URLSearchParams({ grant_type: 'authorization_code', client_id: settings.clientId!, code: request.query.code, redirect_uri: `${settings.siteUrl}/api/auth/callback`, code_verifier: state.verifier! }));
      const user = await verify(tokens, settings, state.nonce);
      const learnerId = `user-${user.sub}`;
      await store.update(learnerId, (workspace: PrivateWorkspace) => {
        if (state.guestId && !workspace.auth?.importedGuests?.includes(state.guestId)) workspace.auth = { ...workspace.auth, pendingGuests: [...new Set([...(workspace.auth?.pendingGuests ?? []), state.guestId])] };
        if (!workspace.auth?.nameCollected && user.name?.trim()) {
          workspace.profile.displayName = user.name.trim().slice(0, 100);
          workspace.auth = { ...workspace.auth, nameCollected: true };
        }
      });
      const session: SessionRecord = { id: randomToken(), kind: 'account', learnerId, csrf: randomToken(), tokens, guestId: state.guestId, expiresAt: now() + sessionLifetime };
      // Persist the pending import before attempting it, so failures can be retried.
      await sessions.put(session);
      setCookie(response, session, settings);
      if (state.browserId) await sessions.delete(state.browserId);
      try { await finishImports(session); }
      catch { return response.redirect(`${settings.siteUrl}/?authError=import`); }
      return response.redirect(`${settings.siteUrl}/?signedIn=1`);
    } catch (error) {
      console.error('[AdaptLearn] Sign-in callback failed', error);
      return response.redirect(`${settings.siteUrl}/?authError=signin`);
    }
  });

  app.post('/api/auth/import', async (request, response) => {
    const settings = await config();
    const session = await requireSession(request, response, settings);
    checkCsrf(request, session, settings);
    if (session.kind !== 'account') throw new HttpError(403, 'Sign in to import your progress.');
    await finishImports(session);
    response.json({ success: true });
  });

  app.post('/api/auth/logout', async (request, response) => {
    const settings = await config();
    const session = await read(request);
    // Same-origin fetch header also permits deliberately clearing an expired cookie.
    if (request.headers.origin !== new URL(settings.siteUrl).origin || request.headers['x-requested-with'] !== 'AdaptLearn') throw new HttpError(403, 'Invalid logout request.');
    if (session) {
      if (session.tokens?.refresh_token && configured(settings)) {
        const revoked = await (dependencies.fetch ?? fetch)(`${settings.domain}/oauth2/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: session.tokens.refresh_token, client_id: settings.clientId! }), signal: AbortSignal.timeout(10000) });
        if (!revoked.ok) throw new HttpError(503, 'Could not finish signing out. Please retry.');
      }
      await sessions.delete(session.id);
    }
    await createGuest(response, settings);
    response.json({ redirect: session?.kind === 'account' && configured(settings) ? `${settings.domain}/logout?${new URLSearchParams({ client_id: settings.clientId!, logout_uri: `${settings.siteUrl}/` })}` : '/' });
  });

  app.use('/api', async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (request.path === '/course-image' || request.path === '/agents') return next();
      const settings = await config();
      const session = await requireSession(request, response, settings);
      const pathLearner = request.path.match(/^\/(?:workspace|profiles)\/([^/]+)/)?.[1];
      if ((pathLearner && decodeURIComponent(pathLearner) !== session.learnerId) || (request.body?.learnerId && request.body.learnerId !== session.learnerId)) throw new HttpError(403, 'This workspace belongs to another session.');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        checkCsrf(request, session, settings);
        const lock = `lock:${session.learnerId}`; const owner = randomToken();
        if (!await sessions.acquireLock(lock, owner)) throw new HttpError(409, 'Your previous change is still saving. Please retry shortly.');
        // Finish releasing before Express/serverless-http ends the response:
        // Lambda can freeze the process as soon as the response completes.
        const end = response.end.bind(response);
        let ending = false;
        response.end = ((...args: Parameters<Response['end']>) => {
          if (!ending) {
            ending = true;
            void sessions.releaseLock(lock, owner).catch(() => { console.error('[AdaptLearn] Could not release workspace lease; it will expire.'); }).then(() => end(...args));
          }
          return response;
        }) as Response['end'];
        response.once('close', () => { if (!ending) void sessions.releaseLock(lock, owner).catch(() => undefined); });
        const workspace = await store.get(session.learnerId) as PrivateWorkspace;
        if (workspace.auth?.importingTo) throw new HttpError(409, 'Guest progress is being imported. Finish signing in to continue.');
      }
      identity.run({ learnerId: session.learnerId }, next);
    } catch (error) { next(error); }
  });
}
