import { expect, test, type Page } from '@playwright/test';


/**
 * AF-02 · **estos recorridos DEJARON DE DORMIR, y es lo que la adjudicación
 * R105 (opción 1) pide: conservar el propósito y cambiar lo observado.**
 *
 * Hasta acá los tres dormían con `test.skip(CORTE.pagosCortados, …)`, heredado
 * de cuando el corte era una constante de este repo. Con F2 el corte lo declara
 * la capability del dueño, y entonces el skip quedaba invertido: **el recorrido
 * que existe para probar «riel cerrado sin pérdida de continuidad» se dormía
 * justo cuando el riel se cerraba.** Un caso sin vigilancia es exactamente el
 * defecto que este archivo vino a evitar, así que el skip se retira.
 *
 * 🔴 **Lo que NO cambia es el caso causal.** Se sigue probando que una key
 * fallida no fabrica continuidad y que un intento durable sobrevive al cierre
 * del riel. Lo que cambia es dónde se observa: con el guard autoritativo
 * `#/tarjetas` es ruta del corte y ya no se puede alcanzar, así que se afirma la
 * ruta fallando cerrada y el journal íntegro, en vez de una pantalla de alta que
 * con el riel cerrado no debe existir.
 *
 * ⚠️ Su entrada en el censo de `src/corteGuard.test.ts` se retiró en el mismo
 * commit: un censo que siga anunciando dos dormidos que ya no existen deja de
 * ser una medición.
 */

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

  /**
   * 🔴 **R105 · acá cambia lo observado, y el motivo es que la superficie vieja
   * ya no debe existir.**
   *
   * Antes el riel cerrado dejaba la pantalla de alta en pie con el botón
   * deshabilitado, y una sonda adversarial le quitaba el atributo para probar
   * que el handler cortaba igual. Con el guard autoritativo `#/tarjetas` es ruta
   * del corte: la persona sale a Inicio y la pantalla no se renderiza. Buscar
   * ahí un botón deshabilitado sería exigir una superficie incompatible con el
   * riel cerrado — justo lo que la adjudicación prohíbe.
   *
   * La defensa no se debilita, se mueve una capa afuera: antes se probaba que el
   * handler no disparaba; ahora que **no hay handler que disparar**, porque no
   * hay pantalla. Y lo que el recorrido existe para probar se afirma igual
   * abajo: la key fallida no dejó continuidad de ningún tipo.
   */
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/home');
  await expect(page.getByRole('button', { name: 'Guardar tarjeta', exact: true })).toHaveCount(0);
  await expect(page.getByText(/···· 4532/)).toHaveCount(0);

  await expect.poll(() => page.evaluate(() =>
    (window as BrowserWithCardProbe).__af02CardProbe)).toEqual({ uuid: 1, setup: [], attach: [] });
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem('payme_card_setup_attempt_v1__mock'))).toBeNull();
});

for (const stage of ['setup', 'attach'] as const) {
  test(`AF-02 · continuidad ${stage} durable sobrevive con el rail cerrado`, async ({ page }) => {
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

    /**
     * 🔴 **(1) La ruta falla cerrada.** Con `money_rail` en `disabled` y
     * autoritativo, `#/tarjetas` no se muestra ni se conserva en el historial:
     * el guard la reemplaza por Inicio. No se intenta alcanzar la pantalla de
     * alta ni su CTA de reintento — con el riel cerrado no deben existir.
     */
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/home');
    const accion = stage === 'attach' ? 'Reintentar la misma tarjeta' : 'Guardar tarjeta';
    await expect(page.getByRole('button', { name: accion, exact: true })).toHaveCount(0);
    await expect(page.getByText(/quedó sin confirmar/)).toHaveCount(0);

    /**
     * 🔴 **(2) …y el intento durable sigue ÍNTEGRO, que es la mitad que importa.**
     *
     * Cerrar el riel no puede costarle la continuidad a quien ya había empezado:
     * cuando los pagos vuelvan, su alta tiene que seguir donde estaba. Por eso se
     * lee el journal crudo y se afirma **campo por campo**, no su mera presencia
     * — un registro truncado, pisado o con otra `setup_key` también «está», y
     * `not.toBeNull()` lo daría por bueno.
     */
    const guardado = await page.evaluate(() =>
      sessionStorage.getItem('payme_card_setup_attempt_v1__mock'));
    expect(guardado, 'el riel cerrado perdió el intento durable').not.toBeNull();
    expect(JSON.parse(guardado!)).toMatchObject({
      v: 1,
      setup_key: `setup-key-af02-${stage}`,
      set_as_default: false,
      stage,
      ...(stage === 'attach' ? { payment_method_id: 'pm_af02_durable' } : {}),
    });

    /**
     * Y nada se consumió por el solo hecho de recargar con el riel cerrado: ni
     * una key nueva, ni un SetupIntent, ni un attach. La continuidad se
     * **conserva** para después; no se gasta ahora.
     */
    await expect.poll(() => page.evaluate(() =>
      (window as BrowserWithCardProbe).__af02CardProbe)).toEqual({ uuid: 0, setup: [], attach: [] });
  });
}
