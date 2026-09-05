import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type BrowserContext, type Page, type Request, type Route, type TestInfo } from '@playwright/test';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
type RealServer = { origin: string; pid: number; tempDir: string };

// El runner habitual es mock5176. Este spec debe probar XHR REAL también en CI,
// sin skip ni reinterpretar el mock como prueba de transporte. Adenda AF12:
// un hijo propio en5177, configuración base íntegra y outputs atribuidos.
const test = base.extend<{}, { realServer: RealServer }>({
  realServer: [async ({}, use, info) => {
    const origin = 'http://localhost:5177';
    mkdirSync(info.project.outputDir, { recursive: true });
    const tempDir = mkdtempSync(join(info.project.outputDir, 'ocr-real-worker-'));
    const config = join(tempDir, 'vite.config.mjs');
    writeFileSync(config, `import base from ${JSON.stringify(join(REPO, 'vite.config.ts'))};\nexport default { ...base, root: ${JSON.stringify(REPO)}, cacheDir: ${JSON.stringify(join(tempDir, 'cache'))}, server: { ...base.server, host: 'localhost', port: 5177, strictPort: true }, build: { ...base.build, outDir: ${JSON.stringify(join(tempDir, 'dist'))} } };\n`);
    const child = spawn(process.execPath, [join(REPO, 'node_modules/vite/bin/vite.js'), '--config', config, '--mode', 'af12-real'], {
      cwd: REPO,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, VITE_MOCK: '0', VITE_API_URL: origin, TMPDIR: tempDir, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    let ready = false;
    let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    const closed = new Promise<void>((done) => child.once('close', (code, signal) => { exit = { code, signal }; done(); }));
    const waitClosed = async (ms: number): Promise<boolean> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([closed.then(() => true), new Promise<boolean>((done) => { timer = setTimeout(() => done(false), ms); })]); }
      finally { if (timer) clearTimeout(timer); }
    };
    try {
      await new Promise<void>((done, fail) => {
        const timeout = setTimeout(() => finish(new Error('Vite real propio no anunció disponibilidad en 20s')), 20_000);
        const finish = (error?: Error) => {
          clearTimeout(timeout);
          child.stdout.off('data', check);
          child.off('error', failed);
          child.off('close', earlyClose);
          if (error) fail(error); else done();
        };
        const check = () => {
          const plain = stdout.replace(/\u001b\[[0-9;]*m/g, '');
          if (/Local:\s+http:\/\/localhost:5177\//.test(plain)) {
            if (child.exitCode !== null || child.signalCode !== null) finish(new Error('Vite terminó durante el arranque'));
            else { ready = true; finish(); }
          }
        };
        const failed = (error: Error) => finish(error);
        const earlyClose = () => finish(new Error('Vite real propio terminó sin disponibilidad; ver logs, no adoptar otro puerto'));
        child.stdout.on('data', check);
        child.once('error', failed);
        child.once('close', earlyClose);
        check();
      });
      if (!child.pid) throw new Error('Vite propio sin PID');
      await use({ origin, pid: child.pid, tempDir });
    } finally {
      // Sólo el ChildProcess recién creado. Jamás buscar/matar por puerto.
      try {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          if (!await waitClosed(5_000)) {
            child.kill('SIGKILL');
            if (!await waitClosed(5_000)) throw new Error('No se pudo acreditar salida del hijo Vite propio');
          }
        } else {
          if (!await waitClosed(1_000)) throw new Error('No se pudo acreditar close del hijo Vite propio');
        }
      } finally {
        writeFileSync(join(tempDir, 'stdout.log'), stdout);
        writeFileSync(join(tempDir, 'stderr.log'), stderr);
        writeFileSync(join(tempDir, 'proceso.json'), JSON.stringify({ origin, pid: child.pid, root: REPO, node: process.version, nodeBin: process.execPath, ready, exit }, null, 2));
      }
    }
  }, { scope: 'worker', timeout: 45_000 }],
});
test.describe.configure({ mode: 'default', retries: 0 });

// AF12: frontend REAL, API totalmente interceptada. No backend ni Textract.
const RID = '00000000-0000-4000-8000-000000000012';
const UID = '00000000-0000-4000-8000-000000000013';
const QUOTA = 'Alcanzamos el límite de lecturas de hoy';
// Valores sintéticos explícitos, no asignaciones con forma de credencial real.
const ACCESS_FIXTURE = 'fixture-access-af12';
const REFRESH_FIXTURE = 'fixture-refresh-af12';
const PNG = {
  name: 'ticket.png', mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=', 'base64'),
};
const SESSION = {
  access_token: ACCESS_FIXTURE, refresh_token: REFRESH_FIXTURE,
  family_id: 'fixture-family-af12', principal_id: UID,
  user: { id: UID, payme_id: 'af12_fixture', email: 'af12@example.invalid', first_name: 'Prueba', last_name: 'OCR', avatar: null },
};
const CONFIG = { features: {
  wallet_rail: { enabled: false, account_activity: true },
  money_rail: { mode: 'disabled', payments_enabled: false, real_money: false },
  ocr: { mode: 'real', accepted_mime_types: ['image/jpeg', 'image/jpg', 'image/png'], provider_mime_types: ['image/jpeg', 'image/jpg', 'image/png'] },
} };

function localTree(): string {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).trim();
  return `${head}${porcelain ? `+sucio(${porcelain.split('\n')[0]?.trim() ?? ''})` : ''}`;
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function harness(context: BrowserContext, page: Page, baseURL: string | undefined, errorCode: string, holdFirst = false) {
  if (!baseURL) throw new Error('Falta baseURL del runner AF12');
  const origin = new URL(baseURL).origin;
  const blocked: string[] = [];
  const census: Array<{ method: string; url: string; type: string }> = [];
  const ocr: Request[] = [];
  let fileChoosers = 0;
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
  if (!holdFirst) releaseFirst();
  context.on('request', (r) => census.push({ method: r.method(), url: r.url(), type: r.resourceType() }));
  page.on('filechooser', () => { fileChoosers += 1; });
  await context.routeWebSocket('**', async (socket) => {
    const url = new URL(socket.url());
    if (url.protocol === 'ws:' && url.host === new URL(origin).host && url.pathname === '/') {
      socket.connectToServer();
      return;
    }
    blocked.push(`WS ${url.origin}${url.pathname}`);
    await socket.close();
  });
  await context.route('**/*', async (route) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.origin === origin && r.method() === 'GET' && url.pathname === '/api/config') {
      await json(route, CONFIG);
    } else if (url.origin === origin && r.method() === 'GET' && url.pathname === `/api/restaurants/${RID}`) {
      await json(route, { restaurant: { id: RID, name: 'Restaurante de prueba', category: 'test', address: null } });
    } else if (url.origin === origin && r.method() === 'POST' && url.pathname === '/api/ocr') {
      ocr.push(r);
      if (ocr.length === 1) await firstResponse;
      await json(route, { error: errorCode }, 429);
    } else if (url.origin === origin && r.method() === 'GET' && !url.pathname.startsWith('/api/')
      && ['document', 'script', 'stylesheet', 'image', 'font', 'manifest'].includes(r.resourceType())) {
      await route.continue();
    } else {
      blocked.push(`${r.method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
    }
  });
  await context.addInitScript((session) => {
    localStorage.setItem('payme_app_session', JSON.stringify(session));
  }, SESSION);
  await page.goto(`${origin}/?r=${RID}#/scan`);
  await expect(page.getByRole('heading', { name: 'Escanea el ticket' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Capturar', exact: true })).toBeEnabled();
  const served = await page.evaluate(() => (window as unknown as { __ARBOL_SERVIDO__?: string }).__ARBOL_SERVIDO__);
  expect(served).toBeTruthy();
  expect(served).not.toBe('desconocido');
  expect(served).toBe(localTree());
  return {
    ocr, blocked, releaseFirst, chooserCount: () => fileChoosers,
    async attach(info: TestInfo) {
      await info.attach('censo-red-ocr', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ origin, served, requests: census, blocked, ocrCount: ocr.length, fileChoosers }, null, 2)) });
    },
  };
}

async function capture(page: Page, label = 'Capturar') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: label, exact: true }).click();
  await (await chooser).setFiles(PNG);
}

async function lateInput(page: Page) {
  // Evento deliberado aun con input deshabilitado: no confiar sólo en el widget.
  await page.locator('input[type="file"]').evaluate((element) => {
    const input = element as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'late.png', { type: 'image/png' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function assertRealUpload(request: Request) {
  expect(request.resourceType()).toBe('xhr');
  expect(request.method()).toBe('POST');
  expect(request.headers()['content-type']).toContain('multipart/form-data; boundary=');
  expect(request.headers()['authorization']).toBe(`Bearer ${ACCESS_FIXTURE}`);
  expect(request.postDataBuffer()?.toString('latin1')).toContain('name="image"');
}

test('429 diario bloquea entradas tardías y conserva el bloqueo al volver de carga manual', async ({ context, page, realServer }, info) => {
  const h = await harness(context, page, realServer.origin, 'ocr_daily_quota_exhausted', true);
  try {
    const capturar = page.getByRole('button', { name: 'Capturar', exact: true });
    await capture(page);
    await expect.poll(() => h.ocr.length).toBe(1);
    assertRealUpload(h.ocr[0]!);
    await expect(capturar).toBeDisabled();
    await lateInput(page);
    await capturar.dispatchEvent('click');
    h.releaseFirst();
    const alert = page.getByRole('alert').filter({ hasText: QUOTA });
    await expect(alert.getByText(QUOTA, { exact: true })).toBeVisible();
    await expect(alert.getByText('Puedes cargar los consumos a mano.', { exact: true })).toBeVisible();
    await expect(alert.getByRole('button')).toHaveCount(1);
    await expect(alert.getByRole('button', { name: 'Cargarlo a mano', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0);
    await expect(capturar).toBeDisabled();
    await expect(page.locator('input[type="file"]')).toBeDisabled();
    await lateInput(page);
    await lateInput(page);
    await capturar.dispatchEvent('click');
    await capturar.dispatchEvent('click');
    expect(h.ocr).toHaveLength(1);
    expect(h.chooserCount()).toBe(1);
    await expect(page.locator('#splash')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('ocr-cupo-agotado.png'), fullPage: true });
    await page.getByRole('button', { name: 'Cargarlo a mano', exact: true }).click();
    await expect(page.getByRole('heading', { name: '¿Cómo dividen?' })).toBeVisible();
    await page.getByRole('button', { name: 'Ver el ticket', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByPlaceholder('Nombre del consumo')).toHaveCount(1);
    await expect(dialog.getByPlaceholder('Nombre del consumo')).toHaveValue('');
    await expect(dialog.getByLabel('Precio por unidad')).toHaveValue('');
    await expect(dialog.getByRole('button', { name: 'Eliminar', exact: true })).toHaveCount(1);
    await expect(dialog.getByRole('group', { name: 'Cantidad de consumo 1', exact: true })).toContainText('1');
    await dialog.getByPlaceholder('Nombre del consumo').fill('Agua');
    await dialog.getByLabel('Precio por unidad').fill('12');
    await expect(dialog.getByPlaceholder('Nombre del consumo')).toHaveValue('Agua');
    await expect(dialog.getByLabel('Precio por unidad')).toHaveValue('12');
    expect(h.ocr).toHaveLength(1);
    await page.screenshot({ path: info.outputPath('ocr-carga-manual.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Cerrar hoja del ticket', exact: true }).click();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Escanea el ticket' })).toBeVisible();
    await expect(page.getByText(QUOTA, { exact: true })).toBeVisible();
    await expect(capturar).toBeDisabled();
    await expect(page.locator('input[type="file"]')).toBeDisabled();
    await lateInput(page);
    await capturar.dispatchEvent('click');
    await expect(page.getByText(QUOTA, { exact: true })).toBeVisible();
    expect(h.ocr).toHaveLength(1);
    expect(h.chooserCount()).toBe(1);
    expect(h.blocked).toEqual([]);
  } finally {
    h.releaseFirst();
    await h.attach(info);
  }
});

test('429 no diario conserva reintento y no publica copy de cuota', async ({ context, page, realServer }, info) => {
  const h = await harness(context, page, realServer.origin, 'rate_limit_exceeded');
  try {
    await capture(page);
    await expect(page.getByText('No pudimos leer el ticket', { exact: true })).toBeVisible();
    await expect(page.getByText(QUOTA, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Capturar', exact: true })).toBeEnabled();
    await expect(page.locator('input[type="file"]')).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
    await expect.poll(() => h.ocr.length).toBe(1);
    assertRealUpload(h.ocr[0]!);
    await capture(page, 'Reintentar');
    await expect.poll(() => h.ocr.length).toBe(2);
    await expect(page.getByText('No pudimos leer el ticket', { exact: true })).toBeVisible();
    await expect(page.getByText(QUOTA, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Capturar', exact: true })).toBeEnabled();
    assertRealUpload(h.ocr[1]!);
    expect(h.chooserCount()).toBe(2);
    expect(h.blocked).toEqual([]);
  } finally {
    h.releaseFirst();
    await h.attach(info);
  }
});
