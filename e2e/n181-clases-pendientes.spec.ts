import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingresar } from './_app';
import { completarDivision, estadoN179 } from './fixtures/ticket-sin-qr';
import {
  instalarInstrumentacionN181,
  liberarBarreraN181,
  modoN181EnSiguienteDocumento,
  probeN181,
  type N181TransformEvidence,
} from './fixtures/n181-clases-pendientes';

const EVIDENCE_DIR = process.env.AF_N181_EVIDENCE_DIR;

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

interface RuntimeSnapshot {
  mesas: number;
  mesaCodes: string[];
  ledgerKeys: string[];
  journals: Array<{ storageKey: string; key: string; family: string; state: string; generation: number }>;
  sessionFamily: string | null;
}

async function snapshot(page: Page): Promise<RuntimeSnapshot> {
  return page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('payme_mock_state_v1') ?? '{}') as {
      mesas?: Array<{ code: string }>;
      idempotency?: Record<string, unknown>;
    };
    const journals: RuntimeSnapshot['journals'] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const storageKey = localStorage.key(i);
      if (!storageKey?.startsWith('payme_money_journal_v5_')) continue;
      const entry = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as {
        key?: string; family?: string; state?: string; generation?: number;
      };
      journals.push({
        storageKey,
        key: entry.key ?? '',
        family: entry.family ?? '',
        state: entry.state ?? '',
        generation: entry.generation ?? 0,
      });
    }
    const session = JSON.parse(localStorage.getItem('payme_app_session__mock') ?? 'null') as { family_id?: string } | null;
    return {
      mesas: state.mesas?.length ?? 0,
      mesaCodes: (state.mesas ?? []).map((mesa) => mesa.code),
      ledgerKeys: Object.keys(state.idempotency ?? {}).filter((key) => key.startsWith('mesa:')).sort(),
      journals: journals.sort((a, b) => a.storageKey.localeCompare(b.storageKey)),
      sessionFamily: session?.family_id ?? null,
    };
  });
}

async function abrirTicket(page: Page): Promise<void> {
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await expect(page.getByRole('heading', { name: '¿Cómo dividen?', exact: true })).toBeVisible();
  await completarDivision(page);
}

async function clickContinuar(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
}

/**
 * Oráculo de la espera (AF-HEADER-WEBKIT, adenda: CI 35748089838 rojo 3/3 en
 * el test 1 y flaky en 35744875165). El orden importa: primero la VERDAD DE
 * FONDO —la barrera reteniendo al actor/lector, que es lo que hace que el
 * flujo esté pendiente— y recién después la UI de espera, leída como UN solo
 * estado consistente (CTA «Continuando…» deshabilitado + nota `role=status`
 * visible con ese texto) en vez de dos aserciones separadas que una recarga
 * de React entre ambas dejaba sin objeto. La nota se ubica con el mismo
 * localizador que `af-n179-continuar-feedback` (`[role="status"].note`): el
 * toast también es `role=status` y no es esta señal. Ninguna aserción se
 * relaja: si la nota no está mientras la barrera retiene, sigue siendo rojo.
 */
async function esperarPendiente(page: Page, barrier: 'actor' | 'read'): Promise<{ waiters: number; ui: unknown }> {
  const waiters = await expect.poll(async () => {
    const probe = await probeN181(page);
    return barrier === 'actor' ? probe.actorWaiters : probe.readWaiters;
  }, { message: `la barrera ${barrier} no retiene a nadie: el flujo no está pendiente` }).toBeGreaterThan(0).then(async () => {
    const probe = await probeN181(page);
    return barrier === 'actor' ? probe.actorWaiters : probe.readWaiters;
  });
  const nota = page.locator('[role="status"].note');
  const cta = page.getByRole('button', { name: 'Continuando…', exact: true });
  let ui: unknown = null;
  await expect.poll(async () => {
    const [ctaCount, ctaDisabled, notaCount, notaVisible, notaText] = await Promise.all([
      cta.count(),
      cta.isDisabled().catch(() => false),
      nota.count(),
      nota.first().isVisible().catch(() => false),
      nota.first().textContent().catch(() => null),
    ]);
    ui = { ctaCount, ctaDisabled, notaCount, notaVisible, notaText };
    return ui;
  }, { message: 'la UI de espera no es consistente con la barrera retenida' })
    .toEqual({ ctaCount: 1, ctaDisabled: true, notaCount: 1, notaVisible: true, notaText: 'Continuando…' });
  return { waiters, ui };
}

async function guardarCaso(
  page: Page,
  testInfo: TestInfo,
  slug: string,
  evidence: Record<string, unknown>,
  transforms?: N181TransformEvidence,
): Promise<void> {
  const outputDir = EVIDENCE_DIR ? join(EVIDENCE_DIR, 'cases') : testInfo.outputDir;
  mkdirSync(outputDir, { recursive: true });
  const screenshot = join(outputDir, `${slug}-390x844.png`);
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
  const runtime = await snapshot(page).catch((error: unknown) => ({ error: String(error) }));
  const probe = await probeN181(page).catch((error: unknown) => ({ error: String(error) }));
  const payload = {
    slug,
    title: testInfo.title,
    statusAtCapture: testInfo.status,
    expectedStatus: testInfo.expectedStatus,
    url: page.url(),
    screenshot,
    runtime,
    probe,
    transforms,
    evidence,
  };
  writeFileSync(join(outputDir, `${slug}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}

test('1 · actor pendiente muestra espera y sale al liberar la barrera', async ({ page }, testInfo) => {
  const evidence: Record<string, unknown> = {};
  const transforms = await instalarInstrumentacionN181(page, { mode: 'actor-pending', moneyRail: 'disabled' });
  try {
    await abrirTicket(page);
    const before = await estadoN179(page);
    evidence.before = before;
    await clickContinuar(page);
    evidence.pending = await esperarPendiente(page, 'actor');
    evidence.pendingProbe = await probeN181(page);

    await liberarBarreraN181(page, 'actor');
    await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toBeVisible();
    const after = await estadoN179(page);
    evidence.after = after;
    expect(after.mesas).toHaveLength(1);
    expect(after.mesaLedgerKeys).toHaveLength(1);
  } finally {
    await guardarCaso(page, testInfo, '01-actor-pendiente', evidence, transforms);
  }
});

test('2 · actor fallido explica el bloqueo y restaura el CTA sin crear', async ({ page }, testInfo) => {
  const evidence: Record<string, unknown> = {};
  const transforms = await instalarInstrumentacionN181(page, { mode: 'actor-failed', moneyRail: 'disabled' });
  try {
    await abrirTicket(page);
    const before = await estadoN179(page);
    evidence.before = before;
    await clickContinuar(page);
    await expect(page.getByRole('button', { name: 'Continuando…', exact: true })).toBeDisabled();
    evidence.pendingProbe = await probeN181(page);

    const safePriorAttemptError = 'No pudimos descartar una apertura anterior. No vamos a tokenizar otra tarjeta ni abrir otra mesa.';
    await expect(page.getByRole('alert').filter({ hasText: safePriorAttemptError })).toHaveText(safePriorAttemptError);
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeEnabled();
    const after = await estadoN179(page);
    const afterProbe = await probeN181(page);
    evidence.after = after;
    evidence.afterProbe = afterProbe;
    expect(after.mesas).toHaveLength(0);
    expect(after.mesaLedgerKeys).toHaveLength(0);
    expect(afterProbe.actorCalls).toBeGreaterThan(0);
    expect(afterProbe.createCalls).toBe(0);
  } finally {
    await guardarCaso(page, testInfo, '02-actor-fallido', evidence, transforms);
  }
});

test('3 · readUnconfirmed pendiente conserva espera y continúa al liberar', async ({ page }, testInfo) => {
  const evidence: Record<string, unknown> = {};
  const transforms = await instalarInstrumentacionN181(page, { mode: 'read-pending', moneyRail: 'disabled' });
  try {
    await abrirTicket(page);
    const before = await estadoN179(page);
    evidence.before = before;
    await clickContinuar(page);
    evidence.pending = await esperarPendiente(page, 'read');
    evidence.pendingProbe = await probeN181(page);

    await liberarBarreraN181(page, 'read');
    await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toBeVisible();
    const after = await estadoN179(page);
    evidence.after = after;
    expect(after.mesas).toHaveLength(1);
    expect(after.mesaLedgerKeys).toHaveLength(1);
  } finally {
    await guardarCaso(page, testInfo, '03-read-pendiente', evidence, transforms);
  }
});

test('4 · readUnconfirmed fallido muestra salida segura y no crea', async ({ page }, testInfo) => {
  const evidence: Record<string, unknown> = {};
  const transforms = await instalarInstrumentacionN181(page, { mode: 'read-failed', moneyRail: 'disabled' });
  try {
    await abrirTicket(page);
    const before = await estadoN179(page);
    evidence.before = before;
    await clickContinuar(page);
    await expect(page.getByRole('alert')).toHaveText(
      'No pudimos descartar una apertura anterior. No vamos a tokenizar otra tarjeta ni abrir otra mesa.',
    );
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeEnabled();
    const after = await estadoN179(page);
    evidence.after = after;
    expect(after.mesas).toHaveLength(0);
    expect(after.mesaLedgerKeys).toHaveLength(0);
    expect((await probeN181(page)).createCalls).toBe(0);
  } finally {
    await guardarCaso(page, testInfo, '04-read-fallido', evidence, transforms);
  }
});

test('5 · otra familia y consulta fallida conservan el intento sin duplicar', async ({ page }, testInfo) => {
  const evidence: Record<string, unknown> = {};
  const transforms = await instalarInstrumentacionN181(page, { mode: 'normal', moneyRail: 'sandbox' });
  try {
    await abrirTicket(page);
    await clickContinuar(page);
    await expect(page.getByRole('heading', { name: 'Garantiza la mesa', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar', exact: true })).toBeVisible();
    const beforeReload = await snapshot(page);
    evidence.beforeReload = beforeReload;
    expect(beforeReload.journals).toHaveLength(1);

    const nextFamily = '18118118-1811-4181-8181-181181181811';
    await page.evaluate((familyId) => {
      const key = 'payme_app_session__mock';
      const session = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (!session) throw new Error('n181_session_missing');
      localStorage.setItem(key, JSON.stringify({ ...session, family_id: familyId }));
    }, nextFamily);
    await modoN181EnSiguienteDocumento(page, 'lookup-failed-once');
    await page.reload();

    await expect(page.getByText('Hay una apertura de una sesión anterior.')).toBeVisible();
    await page.getByRole('button', { name: 'Revisar cómo quedó esa apertura', exact: true }).click();
    await expect(page.getByText(
      'No pudimos verificar cómo quedó esa apertura. Prueba de nuevo en un momento; no vamos a abrir otra mesa mientras tanto.',
      { exact: true },
    )).toBeVisible();
    await expect(page.getByRole('button', { name: 'Revisar cómo quedó esa apertura', exact: true })).toBeEnabled();
    const afterFailure = await snapshot(page);
    evidence.afterFailure = afterFailure;
    expect(afterFailure.mesas).toBe(beforeReload.mesas);
    expect(afterFailure.ledgerKeys).toEqual(beforeReload.ledgerKeys);
    expect(afterFailure.journals).toEqual(beforeReload.journals);
    expect(afterFailure.sessionFamily).toBe(nextFamily);
    const probe = await probeN181(page);
    expect(probe.lookupCalls).toBe(1);
    expect(probe.lookupFailures).toBe(1);
  } finally {
    await guardarCaso(page, testInfo, '05-otra-familia-consulta-fallida', evidence, transforms);
  }
});

test('6 · respuesta bruta incoherente cae en decoder y el replay no duplica', async ({ page }, testInfo) => {
  const evidence: Record<string, unknown> = {};
  const transforms = await instalarInstrumentacionN181(page, { mode: 'predecoder-incoherent', moneyRail: 'disabled' });
  try {
    await abrirTicket(page);
    const before = await snapshot(page);
    evidence.before = before;
    await clickContinuar(page);
    const safeReplayNotice = 'No pudimos confirmar la apertura. Puede que la mesa ya se haya creado: reintenta esta misma apertura, no armes otra.';
    const replayNotice = page.getByRole('status').filter({ hasText: safeReplayNotice });
    await expect(replayNotice).toHaveText(safeReplayNotice);
    await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toHaveCount(0);
    const first = await snapshot(page);
    const firstProbe = await probeN181(page);
    evidence.first = first;
    evidence.firstProbe = firstProbe;
    expect(first.mesas).toBe(before.mesas + 1);
    expect(first.journals).toHaveLength(1);
    expect(firstProbe.createCalls).toBe(1);
    expect(firstProbe.predecoderMutations).toBe(1);

    await clickContinuar(page);
    await expect.poll(async () => {
      const [runtime, probe, ctaCount, pendingCount] = await Promise.all([
        snapshot(page),
        probeN181(page),
        page.getByRole('button', { name: 'Continuar', exact: true }).count(),
        page.getByRole('status').filter({ hasText: 'Continuando…' }).count(),
      ]);
      const ctaEnabled = ctaCount === 1
        && await page.getByRole('button', { name: 'Continuar', exact: true }).isEnabled();
      return {
        ctaEnabled,
        pendingCount,
        journalStates: runtime.journals.map((entry) => entry.state),
        rawCreateResponses: probe.rawCreateResponses,
        predecoderMutations: probe.predecoderMutations,
      };
    }).toEqual({
      ctaEnabled: true,
      pendingCount: 0,
      journalStates: ['ambiguous'],
      rawCreateResponses: 2,
      predecoderMutations: 2,
    });
    await expect(replayNotice).toHaveText(safeReplayNotice);
    await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toHaveCount(0);
    const second = await snapshot(page);
    const secondProbe = await probeN181(page);
    evidence.second = second;
    evidence.secondProbe = secondProbe;
    expect(second.mesas).toBe(first.mesas);
    expect(second.mesas).toBe(before.mesas + 1);
    expect(second.ledgerKeys).toEqual(first.ledgerKeys);
    expect(second.journals).toEqual(first.journals);
    expect(secondProbe.createCalls).toBe(2);
    expect(new Set(secondProbe.createKeys).size).toBe(1);
    expect(secondProbe.rawCreateResponses).toBe(2);
    expect(secondProbe.predecoderMutations).toBe(2);
  } finally {
    await guardarCaso(page, testInfo, '06-predecoder-incoherente', evidence, transforms);
  }
});
