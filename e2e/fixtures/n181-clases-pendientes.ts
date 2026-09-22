import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';

export type N181Mode =
  | 'normal'
  | 'actor-pending'
  | 'actor-failed'
  | 'read-pending'
  | 'read-failed'
  | 'lookup-failed-once'
  | 'predecoder-incoherent';

export interface ModuleTransformEvidence {
  requests: number;
  originalSha256: string | null;
  transformedSha256: string | null;
  exportsBefore: number | null;
  exportsAfter: number | null;
  matches: Record<string, number>;
}

export interface N181TransformEvidence {
  idempotency: ModuleTransformEvidence;
  api: ModuleTransformEvidence;
  networkViolations: string[];
}

export interface N181ProbeSnapshot {
  mode: N181Mode;
  actorCalls: number;
  actorReleased: number;
  actorWaiters: number;
  readCalls: number;
  readsReleased: number;
  readWaiters: number;
  createCalls: number;
  createKeys: string[];
  rawCreateResponses: number;
  predecoderMutations: number;
  lookupCalls: number;
  lookupFailures: number;
}

interface InstallOptions {
  mode: N181Mode;
  moneyRail: 'disabled' | 'sandbox';
}

const IDEMPOTENCY_ROUTE = /\/src\/api\/idempotency\.ts(?:\?.*)?$/;
const API_ROUTE = /\/src\/api\/index\.ts(?:\?.*)?$/;

const ACTOR_MARKER = 'export async function resolveMoneyActor(guestToken) {';
const READ_MARKER = 'export async function readUnconfirmed(area, operation) {';
const MOCK_CREATE = `  createMesa: async (req, intent) => withPreparedMonetaryRequest(
    "create_mesa",
    intent,
    req,
    void 0,
    async () => createMesaResponse(await mock.mockCreateMesa(req), req)
  ),`;
const MOCK_LOOKUP = `  getMesaCreation: async (idempotencyKey, payloadHash) => {
    try {
      return mesaCreationResponse(await mock.mockGetMesaCreation(idempotencyKey, payloadHash));
    } catch (err) {
      return creacionDesdeError(err);
    }
  },`;

const ACTOR_INSTRUMENTED = `${ACTOR_MARKER}
  const __n181 = globalThis.__paymeN181;
  if (__n181) {
    __n181.actorCalls += 1;
    if (__n181.mode === "actor-pending") {
      await new Promise((resolve, reject) => __n181.actorWaiters.push({ resolve, reject }));
    } else if (__n181.mode === "actor-failed") {
      throw new Error("n181_actor_failed");
    }
  }`;

const READ_INSTRUMENTED = `${READ_MARKER}
  const __n181 = globalThis.__paymeN181;
  if (__n181) {
    __n181.readCalls += 1;
    if (__n181.mode === "read-pending") {
      await new Promise((resolve, reject) => __n181.readWaiters.push({ resolve, reject }));
    } else if (__n181.mode === "read-failed") {
      throw new Error("n181_read_unconfirmed_failed");
    }
  }`;

const MOCK_CREATE_INSTRUMENTED = `  createMesa: async (req, intent) => withPreparedMonetaryRequest(
    "create_mesa",
    intent,
    req,
    void 0,
    async () => {
      const __n181 = globalThis.__paymeN181;
      if (__n181) {
        __n181.createCalls += 1;
        __n181.createKeys.push(req.idempotency_key);
      }
      const __raw = await mock.mockCreateMesa(req);
      if (__n181) __n181.rawCreateResponses += 1;
      if (__n181?.mode === "predecoder-incoherent") {
        __n181.predecoderMutations += 1;
        return createMesaResponse({ ...__raw, mesa: { ...__raw.mesa, status: "pending_auth" } }, req);
      }
      return createMesaResponse(__raw, req);
    }
  ),`;

const MOCK_LOOKUP_INSTRUMENTED = `  getMesaCreation: async (idempotencyKey, payloadHash) => {
    const __n181 = globalThis.__paymeN181;
    if (__n181) {
      __n181.lookupCalls += 1;
      if (__n181.mode === "lookup-failed-once" && __n181.lookupFailures === 0) {
        __n181.lookupFailures += 1;
        throw new Error("n181_lookup_failed_once");
      }
    }
    try {
      return mesaCreationResponse(await mock.mockGetMesaCreation(idempotencyKey, payloadHash));
    } catch (err) {
      return creacionDesdeError(err);
    }
  },`;

function emptyModuleEvidence(): ModuleTransformEvidence {
  return {
    requests: 0,
    originalSha256: null,
    transformedSha256: null,
    exportsBefore: null,
    exportsAfter: null,
    matches: {},
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function exportCount(source: string): number {
  return source.match(/^export\s/gm)?.length ?? 0;
}

function replaceExactlyOnce(source: string, from: string, to: string, label: string): string {
  const count = occurrences(source, from);
  if (count !== 1) throw new Error(`n181_${label}_match_count_${count}`);
  return source.replace(from, to);
}

async function fulfillTransformed(
  route: Route,
  evidence: ModuleTransformEvidence,
  transform: (source: string, matches: Record<string, number>) => string,
): Promise<void> {
  const response = await route.fetch();
  const original = await response.text();
  const matches: Record<string, number> = {};
  const transformed = transform(original, matches);
  evidence.requests += 1;
  evidence.originalSha256 = sha256(original);
  evidence.transformedSha256 = sha256(transformed);
  evidence.exportsBefore = exportCount(original);
  evidence.exportsAfter = exportCount(transformed);
  evidence.matches = matches;
  if (evidence.exportsBefore !== evidence.exportsAfter) throw new Error('n181_export_contract_changed');
  await route.fulfill({ response, body: transformed, contentType: 'text/javascript' });
}

export async function instalarInstrumentacionN181(
  page: Page,
  options: InstallOptions,
): Promise<N181TransformEvidence> {
  const evidence: N181TransformEvidence = {
    idempotency: emptyModuleEvidence(),
    api: emptyModuleEvidence(),
    networkViolations: [],
  };

  await page.addInitScript(({ initialMode, moneyRail }) => {
    const storedMode = localStorage.getItem('payme.test.n181.mode') as N181Mode | null;
    const mode = storedMode ?? initialMode;
    localStorage.setItem('payme.test.n181.mode', mode);
    localStorage.setItem('payme.app.mock.money_rail.v1', moneyRail);
    const actorWaiters: Array<{ resolve(): void; reject(error: Error): void }> = [];
    const readWaiters: Array<{ resolve(): void; reject(error: Error): void }> = [];
    Object.assign(globalThis, {
      __paymeN181: {
        mode,
        actorCalls: 0,
        actorReleased: 0,
        actorWaiters,
        readCalls: 0,
        readsReleased: 0,
        readWaiters,
        createCalls: 0,
        createKeys: [] as string[],
        rawCreateResponses: 0,
        predecoderMutations: 0,
        lookupCalls: 0,
        lookupFailures: 0,
      },
    });
  }, { initialMode: options.mode, moneyRail: options.moneyRail });

  // Falla cerrado ante cualquier salida de loopback. Se registra el intento y
  // se aborta; ninguna prueba puede tocar producción por un asset inesperado.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      evidence.networkViolations.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }
    await route.fallback();
  });

  await page.route(IDEMPOTENCY_ROUTE, async (route) => {
    await fulfillTransformed(route, evidence.idempotency, (source, matches) => {
      matches.resolveMoneyActor = occurrences(source, ACTOR_MARKER);
      matches.readUnconfirmed = occurrences(source, READ_MARKER);
      let transformed = replaceExactlyOnce(source, ACTOR_MARKER, ACTOR_INSTRUMENTED, 'actor');
      transformed = replaceExactlyOnce(transformed, READ_MARKER, READ_INSTRUMENTED, 'read');
      return transformed;
    });
  });

  await page.route(API_ROUTE, async (route) => {
    await fulfillTransformed(route, evidence.api, (source, matches) => {
      matches.mockCreateMesa = occurrences(source, MOCK_CREATE);
      matches.mockGetMesaCreation = occurrences(source, MOCK_LOOKUP);
      let transformed = replaceExactlyOnce(source, MOCK_CREATE, MOCK_CREATE_INSTRUMENTED, 'mock_create');
      transformed = replaceExactlyOnce(transformed, MOCK_LOOKUP, MOCK_LOOKUP_INSTRUMENTED, 'mock_lookup');
      return transformed;
    });
  });

  return evidence;
}

export async function liberarBarreraN181(page: Page, barrier: 'actor' | 'read'): Promise<void> {
  await page.evaluate((kind) => {
    const control = (globalThis as typeof globalThis & {
      __paymeN181?: {
        mode: N181Mode;
        actorReleased: number;
        readsReleased: number;
        actorWaiters: Array<{ resolve(): void }>;
        readWaiters: Array<{ resolve(): void }>;
      };
    }).__paymeN181;
    if (!control) throw new Error('n181_control_missing');
    control.mode = 'normal';
    localStorage.setItem('payme.test.n181.mode', 'normal');
    const waiters = kind === 'actor' ? control.actorWaiters.splice(0) : control.readWaiters.splice(0);
    if (kind === 'actor') control.actorReleased += waiters.length;
    else control.readsReleased += waiters.length;
    waiters.forEach(({ resolve }) => resolve());
  }, barrier);
}

export async function modoN181EnSiguienteDocumento(page: Page, mode: N181Mode): Promise<void> {
  await page.evaluate((nextMode) => localStorage.setItem('payme.test.n181.mode', nextMode), mode);
}

export async function probeN181(page: Page): Promise<N181ProbeSnapshot> {
  return page.evaluate(() => {
    const control = (globalThis as typeof globalThis & {
      __paymeN181?: N181ProbeSnapshot & {
        actorWaiters: unknown[];
        readWaiters: unknown[];
      };
    }).__paymeN181;
    if (!control) throw new Error('n181_control_missing');
    return {
      mode: control.mode,
      actorCalls: control.actorCalls,
      actorReleased: control.actorReleased,
      actorWaiters: control.actorWaiters.length,
      readCalls: control.readCalls,
      readsReleased: control.readsReleased,
      readWaiters: control.readWaiters.length,
      createCalls: control.createCalls,
      createKeys: [...control.createKeys],
      rawCreateResponses: control.rawCreateResponses,
      predecoderMutations: control.predecoderMutations,
      lookupCalls: control.lookupCalls,
      lookupFailures: control.lookupFailures,
    };
  });
}
