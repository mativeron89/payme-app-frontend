import { expect, test } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * ORDEN 5 · recorrido 4 · UN LINK RECHAZADO NO PUEDE DELATAR SI LA MESA EXISTE.
 *
 * ## La regla, y por qué es de privacidad y no de copy
 *
 * El emisor contesta el MISMO `403 invitation_link_not_valid` para los cuatro
 * motivos —inválido, vencido, cancelado y supersedido— **a propósito**:
 * distinguirlos le diría a un desconocido si una mesa existe. Alguien con un
 * link reenviado podría averiguar dónde está comiendo otra persona probando
 * códigos.
 *
 * Cerrar el oráculo en el emisor **no lo cierra si el consumidor publica el
 * resultado**. Es la lección que dejó la pantalla "Enviadas", que reabrió del
 * lado del front un oráculo que el 202 ciego había cerrado en el backend. Por
 * eso esto se prueba en la pantalla, que es donde se filtraría.
 *
 * ## Cómo se prueba que no hay filtración
 *
 * No alcanza con leer la copy: hay que comparar **dos situaciones que el
 * atacante puede distinguir sólo si la app se lo dice**. Acá se contrasta un
 * token cualquiera contra un token con la forma de uno real, y se exige que la
 * pantalla resultante sea **idéntica**. Si algún día alguien "mejora" el mensaje
 * distinguiendo vencido de cancelado, estos tests se ponen rojos.
 */

const TOKENS_RECHAZADOS = [
  ['un token que no existe', 'tok-inventado-por-cualquiera'],
  ['un token con forma de real', 'mock-guest-aaaaaaaa'],
  ['un token largo', `tok-${'x'.repeat(120)}`],
] as const;

const SIGNUP_PARA_LINK = 'signup-token-link-mesa-aaaaaaaa';

test.describe('el 403 es ciego', () => {
  for (const [nombre, token] of TOKENS_RECHAZADOS) {
    test(`${nombre} muestra el rechazo genérico y nada más`, async ({ page }) => {
      await ingresar(page);
      await page.goto(`/#/mesa/PA-0001?t=${token}`);

      /**
       * ⭐ `exact: true`, y no es cosmético. Con coincidencia por subcadena,
       * agregarle *"Este link venció."* adelante al mismo texto **seguía
       * pasando** — lo verifiqué con un mutante. Esta copy está ratificada
       * palabra por palabra en `SPEC_APP.md` §1.2-B justamente porque no puede
       * variar según el motivo: exigirla exacta es la forma honesta de decirlo.
       */
      await expect(page.getByText('Este link ya no funciona', { exact: true })).toBeVisible();
      await expect(
        page.getByText('Pídele a quien te invitó que te comparta uno nuevo.', { exact: true }),
      ).toBeVisible();

      const cuerpo = await page.locator('body').innerText();
      // Ningún restaurante del seed. Nombrar uno diría que la mesa existe.
      for (const r of ['La Parolaccia', 'Hanzo Sushi', 'Tacos El Güero']) {
        expect(cuerpo, `filtró el restaurante ${r}`).not.toContain(r);
      }
      // Ni importes, ni comensales, ni estado de la mesa.
      expect(cuerpo).not.toMatch(/\$\d/);
      /**
       * Y ninguna palabra que separe los cuatro motivos. **Raíces, no palabras
       * completas**: la primera versión listaba `vencid` y no atrapó `venció`,
       * que es la forma más obvia de todas. Una lista de prohibidos ya defiende
       * poco; una que además falla la conjugación no defiende nada.
       */
      for (const m of ['venc', 'expir', 'caduc', 'cancel', 'reemplaz', 'supersed', 'anulad']) {
        expect(cuerpo.toLowerCase(), `separó el motivo "${m}"`).not.toContain(m);
      }
    });
  }

  /**
   * ⭐ EL TEST QUE DE VERDAD CIERRA EL ORÁCULO. Los de arriba miran una
   * pantalla; éste compara **dos**, y exige que sean indistinguibles.
   *
   * Un código de mesa que **existe** (recién abierta acá) contra uno que no
   * existe, los dos con un token inválido. Si la app diera cualquier señal
   * distinta —una palabra, un importe, un botón— alguien podría barrer códigos
   * y saber cuáles corresponden a una mesa abierta.
   */
  test('una mesa que existe y una que no dan exactamente la misma pantalla', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);

    await page.goto(`/#/mesa/${mesa.code}?t=tok-invalido-para-mesa-real`);
    await expect(page.getByText('Este link ya no funciona')).toBeVisible();
    const conMesaReal = await page.locator('body').innerText();

    await page.goto('/#/mesa/PA-0000?t=tok-invalido-para-mesa-real');
    await expect(page.getByText('Este link ya no funciona')).toBeVisible();
    const conMesaInexistente = await page.locator('body').innerText();

    expect(conMesaInexistente).toBe(conMesaReal);
  });

  /**
   * El 400 es distinto del 403 **a propósito**, y no es una filtración: el
   * defecto está en el link que la persona tiene en la mano —se cortó al
   * copiarlo— y eso sí se puede accionar. No dice nada de la mesa.
   *
   * Lo que importa es que **no ofrezca reintentar**: un link truncado no se
   * arregla reintentando, y cada reintento le diría que puede estar por
   * funcionar.
   */
  test('un link cortado dice que está incompleto y NO ofrece reintentar', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-0001?t=corto');

    await expect(page.getByText('Este link está incompleto')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);
  });

  /**
   * Y el 401, que es otra pantalla y no hay que confundir con el 403: dice
   * *"necesitás cuenta"*, no *"no sos de esta mesa"*.
   *
   * La burbuja **no nombra el restaurante**, y eso es deliberado: para saber
   * que el token es válido habría que preguntarle al backend, y el endpoint que
   * lo diría sin sesión es el preview público que el cierre del pago sin cuenta
   * prohíbe. Además, un link reenviado le confirmaría a cualquiera dónde está
   * comiendo otra persona.
   */
  test('sin sesión, el link no ofrece alta sin autoridad F&F ni cuenta nada de la mesa', async ({ page }) => {
    await page.goto('/#/mesa/PA-0001?t=tok-cualquiera-largo');

    await expect(page.getByText('Te invitaron a una mesa')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear cuenta gratis' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ya tengo cuenta · Entrar' })).toBeVisible();

    const cuerpo = await page.locator('body').innerText();
    for (const r of ['La Parolaccia', 'Hanzo Sushi']) {
      expect(cuerpo).not.toContain(r);
    }
    expect(cuerpo).not.toContain('PA-0001');
    expect(cuerpo).not.toMatch(/\$\d/);
  });

  /**
   * ⭐ Y el token sobrevive al alta, que es el otro lado de la misma moneda: si
   * se perdiera, la persona se registra y **queda afuera de la mesa a la que la
   * invitaron** — peor que el defecto que el cierre del pago sin cuenta vino a
   * cerrar.
   */
  test('el token de mesa sobrevive al alta F&F: las autoridades quedan separadas', async ({ page }) => {
    await page.goto(
      `/#/mesa/PA-0001?t=tok-que-tiene-que-sobrevivir&signup_invitation=${SIGNUP_PARA_LINK}`,
    );
    await expect(page.getByText('Te invitaron a una mesa')).toBeVisible();

    await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();

    const custodiado = await page.evaluate(() =>
      window.sessionStorage.getItem('payme_pending_invitation_link'),
    );
    expect(custodiado).toContain('tok-que-tiene-que-sobrevivir');
  });
});
