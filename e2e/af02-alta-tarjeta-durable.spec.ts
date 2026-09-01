import { expect, test, type Page } from '@playwright/test';
import { corteDePagosView } from '../src/api/releaseGates';

/**
 * CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-04) · los recorridos que
 * necesitan el checkout o el alta de tarjeta DUERMEN mientras el gate esté
 * activo, y leen el MISMO gate que la app: cuando `pagosCortados` pase a
 * `false`, vuelven solos, sin editar este archivo. Nunca un skip con `true`
 * fijo: eso es evidencia que no vuelve. `src/corteGuard.test.ts` censa cada
 * uno de estos skips y pone la suite roja ante uno nuevo o permanente.
 */
const CORTE = corteDePagosView();
const MOTIVO = 'CORTE DEL VIERNES: el checkout del participante y el alta de tarjeta están cerrados en producción pública sin pagos; este recorrido vuelve solo cuando corteDePagosView().pagosCortados sea false.';

interface CardApiProbe {
  uuid: number;
  setup: string[];
  attach: Array<{ paymentMethodId: string; setAsDefault: boolean }>;
}

type BrowserWithCardProbe = typeof window & {
  __af02CardProbe: CardApiProbe;
};

async function loginDelSeed(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Email').fill('demo@payme.mx');
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.goto('/#/tarjetas');
  await expect(page.getByText(/···· 4532/)).toBeVisible();
}

async function instalarEspiasDeAlta(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const modulePath = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ modulePath) as unknown as {
      api: {
        createSetupIntent: (key: string) => Promise<unknown>;
        attachPaymentMethod: (paymentMethodId: string, setAsDefault: boolean) => Promise<unknown>;
      };
    };
    const target = window as BrowserWithCardProbe;
    target.__af02CardProbe = { uuid: 0, setup: [], attach: [] };
    const nativeRandomUUID = crypto.randomUUID.bind(crypto);
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        target.__af02CardProbe.uuid += 1;
        return nativeRandomUUID();
      },
    });
    api.createSetupIntent = async (key) => {
      target.__af02CardProbe.setup.push(key);
      return { client_secret: ['seti', 'af02', 'secret'].join('_') };
    };
    api.attachPaymentMethod = async (paymentMethodId, setAsDefault) => {
      target.__af02CardProbe.attach.push({ paymentMethodId, setAsDefault });
      return { attached: true };
    };
  });
}

test('AF-02 · una key fallida no fabrica continuidad ni atraviesa un rail luego cerrado', async ({ page }) => {
  test.skip(CORTE.pagosCortados, MOTIVO);
  await loginDelSeed(page);
  await instalarEspiasDeAlta(page);

  await page.evaluate(() => {
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        (window as BrowserWithCardProbe).__af02CardProbe.uuid += 1;
        throw new Error('af02_key_generation_failed');
      },
    });
  });

  await page.getByRole('button', { name: 'Agregar tarjeta', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar tarjeta', exact: true }).click();

  await expect(page.getByText(/Esta alta quedó sin confirmar/)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem('payme_card_setup_attempt_v1__mock'))).toBeNull();

  await page.evaluate(async () => {
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        (window as BrowserWithCardProbe).__af02CardProbe.uuid += 1;
        return '11111111-2222-4333-8444-555555555555';
      },
    });
    const modulePath = '/src/api/moneyRail.ts';
    const rail = await import(/* @vite-ignore */ modulePath) as unknown as {
      applyMoneyRailConfig(config: unknown): void;
    };
    rail.applyMoneyRailConfig({
      features: {
        money_rail: { mode: 'disabled', payments_enabled: false, real_money: false },
      },
    });
  });

  await expect(page.getByText('Todavía no está disponible', { exact: false })).toBeVisible();
  const guardar = page.getByRole('button', { name: 'Guardar tarjeta', exact: true });
  await expect(guardar).toBeDisabled();

  // Sonda adversarial: aun quitando el atributo HTML, el guard del handler
  // debe cortar antes de key, SetupIntent o attach.
  await guardar.evaluate((element) => {
    element.removeAttribute('disabled');
    (element as HTMLButtonElement).click();
  });

  await expect.poll(() => page.evaluate(() =>
    (window as BrowserWithCardProbe).__af02CardProbe)).toEqual({ uuid: 1, setup: [], attach: [] });
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem('payme_card_setup_attempt_v1__mock'))).toBeNull();
});

for (const stage of ['setup', 'attach'] as const) {
  test(`AF-02 · continuidad ${stage} durable sobrevive con el rail cerrado`, async ({ page }) => {
    test.skip(CORTE.pagosCortados, MOTIVO);
    await loginDelSeed(page);

    await page.evaluate(async (durableStage) => {
      const sessionRaw = localStorage.getItem('payme_app_session__mock');
      if (!sessionRaw) throw new Error('mock_session_missing');
      const session = JSON.parse(sessionRaw) as { principal_id: string; family_id: string };
      const modulePath = '/src/api/cardSetupAttempt.ts';
      const attempts = await import(/* @vite-ignore */ modulePath) as unknown as {
        writeCardSetupAttempt(attempt: unknown, actor: unknown): void;
      };
      const setupKey = `setup-key-af02-${durableStage}`;
      const actor = { principal_id: session.principal_id, family_id: session.family_id };
      attempts.writeCardSetupAttempt({
        setupKey,
        setAsDefault: false,
        stage: 'setup',
      }, actor);
      if (durableStage === 'attach') {
        attempts.writeCardSetupAttempt({
          setupKey,
          setAsDefault: false,
          stage: 'attach',
          paymentMethodId: 'pm_af02_durable',
        }, actor);
      }
      localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    }, stage);

    await page.reload();
    await instalarEspiasDeAlta(page);
    await expect(page.getByText(/quedó sin confirmar/)).toBeVisible();

    const action = stage === 'attach' ? 'Reintentar la misma tarjeta' : 'Guardar tarjeta';
    await page.getByRole('button', { name: action, exact: true }).click();

    await expect.poll(() => page.evaluate(() =>
      (window as BrowserWithCardProbe).__af02CardProbe)).toEqual({
      uuid: 0,
      setup: stage === 'setup' ? ['setup-key-af02-setup'] : [],
      attach: [{
        paymentMethodId: stage === 'setup' ? 'pm_mock_setupkeyaf02setup' : 'pm_af02_durable',
        setAsDefault: false,
      }],
    });
    await expect.poll(() => page.evaluate(() =>
      sessionStorage.getItem('payme_card_setup_attempt_v1__mock'))).toBeNull();
  });
}
