import type { RecoveryCompleteResponse, RecoveryRequestResponse } from './types';

export type RecoveryTokenCapture =
  | { status: 'absent' | 'invalid' | 'blocked' | 'consumed' | 'processing' | 'retryable' }
  | { status: 'ready' };

type FragmentQuery = {
  path: string;
  rawQuery: string;
  params: URLSearchParams;
};

type CompletionAttempt = {
  generation: number;
  promise: Promise<RecoveryCompleteResponse>;
};

let capturedToken: string | null = null;
let captureState: RecoveryTokenCapture = { status: 'absent' };
let captureGeneration = 0;
let completionInFlight: CompletionAttempt | null = null;
const captureListeners = new Set<() => void>();

function publishCapture(next: RecoveryTokenCapture): RecoveryTokenCapture {
  captureState = next;
  for (const listener of [...captureListeners]) listener();
  return next;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 200;
}

function rawFragmentParts(hash: string): { path: string; rawQuery: string | null } | null {
  const match = /^#\/([^?]*)(?:\?(.*))?$/.exec(hash);
  if (!match) return null;
  return { path: match[1] ?? '', rawQuery: match[2] ?? null };
}

function strictFragmentQuery(hash: string): FragmentQuery | null {
  const raw = rawFragmentParts(hash);
  if (!raw) return null;
  const rawQuery = raw.rawQuery ?? '';
  // `+` crudo no representa al raw token; el emisor debe usar `%2B`.
  if (rawQuery.includes('+')) return null;
  // URLSearchParams tolera `%` inválidos; este contrato debe fallar cerrado.
  if (/%(?![0-9A-Fa-f]{2})/.test(rawQuery)) return null;
  try {
    // También rechaza UTF-8 inválido (`%FF`) en claves y valores.
    for (const pair of rawQuery.split('&')) {
      if (!pair) continue;
      const separator = pair.indexOf('=');
      const rawKey = separator < 0 ? pair : pair.slice(0, separator);
      const rawValue = separator < 0 ? '' : pair.slice(separator + 1);
      decodeURIComponent(rawKey);
      decodeURIComponent(rawValue);
    }
  } catch {
    return null;
  }
  return { path: raw.path, rawQuery, params: new URLSearchParams(rawQuery) };
}

function rawQueryNamesToken(rawQuery: string): boolean {
  return rawQuery.split('&').some((pair) => {
    if (!pair) return false;
    const separator = pair.indexOf('=');
    const rawKey = separator < 0 ? pair : pair.slice(0, separator);
    try {
      return decodeURIComponent(rawKey) === 'token';
    } catch {
      return rawKey === 'token';
    }
  });
}

function fragmentContainsToken(hash: string): boolean {
  const raw = rawFragmentParts(hash);
  if (raw?.rawQuery != null) return rawQueryNamesToken(raw.rawQuery);
  const queryStart = hash.indexOf('?');
  return queryStart >= 0 && rawQueryNamesToken(hash.slice(queryStart + 1));
}

function replaceUrlAndVerify(target: string, verify: () => boolean): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.history.replaceState(window.history.state, '', target);
    return verify();
  } catch {
    return false;
  }
}

/** Retira cualquier autoridad puesta en la query HTTP antes de red o render. */
function cleanDirectHttpToken(): { present: boolean; cleaned: boolean } {
  if (typeof window === 'undefined') return { present: false, cleaned: true };
  const params = new URLSearchParams(window.location.search);
  if (!params.has('token')) return { present: false, cleaned: true };
  params.delete('token');
  const query = params.toString();
  const expectedSearch = query ? `?${query}` : '';
  const target = `${window.location.pathname}${expectedSearch}${window.location.hash}`;
  const cleaned = replaceUrlAndVerify(target, () => {
    const current = new URLSearchParams(window.location.search);
    return window.location.search === expectedSearch && !current.has('token');
  });
  return { present: true, cleaned };
}

function cleanFragmentTo(expectedHash: string): boolean {
  if (typeof window === 'undefined') return false;
  const target = `${window.location.pathname}${window.location.search}${expectedHash}`;
  return replaceUrlAndVerify(target, () => (
    window.location.hash === expectedHash && !fragmentContainsToken(window.location.hash)
  ));
}

function cleanUnexpectedFragmentToken(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = rawFragmentParts(window.location.hash);
  if (!raw) return cleanFragmentTo('#/');
  return cleanFragmentTo(`#/${raw.path}`);
}

function publishTerminal(status: 'absent' | 'invalid' | 'blocked'): RecoveryTokenCapture {
  capturedToken = null;
  return publishCapture({ status });
}

/** Lee una vez, limpia físicamente la URL y sólo entonces publica credencial. */
export function captureRecoveryToken(): RecoveryTokenCapture {
  captureGeneration += 1;
  completionInFlight = null;
  capturedToken = null;
  if (typeof window === 'undefined') return publishTerminal('absent');

  const direct = cleanDirectHttpToken();
  if (!direct.cleaned) return publishTerminal('blocked');

  const raw = rawFragmentParts(window.location.hash);
  const parsed = strictFragmentQuery(window.location.hash);
  const exactRecoveryRoute = parsed?.path === 'recovery';
  const recoveryLikeRoute = raw?.path.toLowerCase().startsWith('recovery') === true;
  const tokenOutsideRecovery = !recoveryLikeRoute && fragmentContainsToken(window.location.hash);

  // Una query HTTP jamás es autoridad, incluso si también llegó un fragmento válido.
  if (direct.present) {
    if (recoveryLikeRoute && !cleanFragmentTo('#/recovery')) return publishTerminal('blocked');
    if (tokenOutsideRecovery && !cleanUnexpectedFragmentToken()) return publishTerminal('blocked');
    return publishTerminal('invalid');
  }

  if (tokenOutsideRecovery) {
    return publishTerminal(cleanUnexpectedFragmentToken() ? 'invalid' : 'blocked');
  }
  if (!recoveryLikeRoute) return publishTerminal('absent');

  // El contrato owner fija exactamente `#/recovery?token=...`: case, path,
  // parámetro único, encoding UTF-8 y una sola ocurrencia.
  const pairs = parsed?.rawQuery.split('&') ?? [];
  const exactSingleTokenPair = pairs.length === 1
    && pairs[0].startsWith('token=')
    && pairs[0].indexOf('=') === 'token'.length;
  const tokens = parsed?.params.getAll('token') ?? [];
  if (!parsed
      || !exactRecoveryRoute
      || !exactSingleTokenPair
      || parsed.params.size !== 1
      || tokens.length !== 1
      || !validToken(tokens[0])) {
    return publishTerminal(cleanFragmentTo('#/recovery') ? 'invalid' : 'blocked');
  }

  const token = tokens[0];
  if (!cleanFragmentTo('#/recovery')) return publishTerminal('blocked');
  capturedToken = token;
  return publishCapture({ status: 'ready' });
}

export function recoveryTokenSnapshot(): RecoveryTokenCapture {
  return captureState;
}

export function subscribeRecoveryToken(listener: () => void): () => void {
  captureListeners.add(listener);
  return () => { captureListeners.delete(listener); };
}

/** Completa aun si la capability cayó; StrictMode/doble submit comparten promise. */
export function completeRecoveryOnce(
  newPassword: string,
  complete: (token: string, password: string) => Promise<RecoveryCompleteResponse>,
): Promise<RecoveryCompleteResponse> {
  const generation = captureGeneration;
  if (completionInFlight?.generation === generation) return completionInFlight.promise;
  if ((captureState.status !== 'ready' && captureState.status !== 'retryable') || !capturedToken) {
    return Promise.reject(new Error('recovery_token_unavailable'));
  }
  const token = capturedToken;
  publishCapture({ status: 'processing' });
  let request: Promise<RecoveryCompleteResponse>;
  try {
    request = complete(token, newPassword);
  } catch (error) {
    if (captureGeneration === generation && capturedToken === token) {
      publishCapture({ status: 'retryable' });
    }
    return Promise.reject(error);
  }
  const attempt: CompletionAttempt = {
    generation,
    promise: Promise.resolve(request).then((result) => {
      if (captureGeneration === generation && capturedToken === token) {
        capturedToken = null;
        publishCapture({ status: 'consumed' });
        completionInFlight = null;
      }
      return result;
    }).catch((error) => {
      if (completionInFlight?.generation === generation) {
        completionInFlight = null;
        if (captureGeneration === generation && capturedToken === token) {
          publishCapture({ status: 'retryable' });
        }
      }
      throw error;
    }),
  };
  completionInFlight = attempt;
  return attempt.promise;
}

export function discardRecoveryToken(): void {
  captureGeneration += 1;
  capturedToken = null;
  completionInFlight = null;
  publishCapture({ status: 'absent' });
}

/** Arranca antes de React y descarta memoria al navegar fuera de recovery. */
export function bootstrapRecoveryTokenCapture(): () => void {
  const initial = captureRecoveryToken();
  if (initial.status === 'blocked') throw new Error('recovery_url_cleanup_failed');
  if (typeof window === 'undefined') return () => undefined;
  const onHashChange = (event: HashChangeEvent) => {
    if (/^#\/recovery(?:\?|$)/i.test(window.location.hash)
        || fragmentContainsToken(window.location.hash)) {
      const next = captureRecoveryToken();
      if (next.status === 'blocked') {
        // Lanzar desde un listener no corta por sí solo a los listeners
        // siguientes. El router no puede observar/adoptar el fragmento crudo.
        event.stopImmediatePropagation();
        throw new Error('recovery_url_cleanup_failed');
      }
      return;
    }
    discardRecoveryToken();
  };
  window.addEventListener('hashchange', onHashChange);
  return () => window.removeEventListener('hashchange', onHashChange);
}

export function decodeRecoveryRequestResponse(value: unknown): RecoveryRequestResponse {
  if (!plainObject(value) || !exactKeys(value, ['accepted']) || value.accepted !== true) {
    throw new Error('recovery_request_response_malformed');
  }
  return { accepted: true };
}

export function decodeRecoveryCompleteResponse(value: unknown): RecoveryCompleteResponse {
  if (!plainObject(value) || !exactKeys(value, ['completed']) || value.completed !== true) {
    throw new Error('recovery_complete_response_malformed');
  }
  return { completed: true };
}

export function resetRecoveryFlowForTests(): void {
  capturedToken = null;
  captureGeneration = 0;
  completionInFlight = null;
  publishCapture({ status: 'absent' });
}
