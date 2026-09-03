import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * 🔴 **Método adjudicado por Codex (ACK R98) para las aserciones negativas que
 * NO tienen testigo UI en esta pantalla.**
 *
 * El requisito general es que toda ausencia sobre superficie gateada lleve antes
 * un testigo positivo de la misma capability. **En Inicio y en Más no existe**,
 * y está medido: con el riel apagado el corte esconde lo suyo, así que `pending`
 * y `authoritative + disabled` producen exactamente la misma pantalla; y los
 * testigos a mano —«Ver pagos», «Volver», «Idioma»— cuelgan de otras
 * capabilities, una de ellas fail-OPEN.
 *
 * Tampoco vale esperar la respuesta HTTP: **en modo mock no hay red**, el mock
 * resuelve `getConfig()` en JS. Se probó y da timeout.
 *
 * Lo que sí se hace, y es lo adjudicado: **fijar el seam del mock en `disabled`
 * antes del render**, para que la ausencia se afirme sobre un estado declarado y
 * no sobre uno que todavía viaja. La app y el censo leen el MISMO origen
 * (`MODO_MONETARIO_MOCK_POR_DEFECTO` en `src/api/mock/store.ts`), así que fijar
 * la clave no crea una segunda autoridad: reafirma la que ya rige.
 *
 * ⚠️ **Esta evidencia es más débil que la de Mesa Detail**, donde el aviso «Los
 * pagos llegan pronto» sólo existe con el riel autoritativo y sirve de testigo
 * de verdad. Acá lo que acredita la vigilancia es el **mutante**: con el riel
 * abierto, esta aserción se pone roja.
 */
async function conRielApagado(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
}

/**
 * §1.11 · **la pestaña lanza, no muestra** — y esto prueba que llega.
 *
 * ## Por qué existe este recorrido
 *
 * Las tres pantallas destino son rutas de PRIMER NIVEL: `#/tarjetas`, `#/pagos`
 * y `#/estadisticas`, cada una con su `case` en el switch de `src/App.tsx`.
 * Sin este spec, borrar cualquiera de esos tres `case` **no rompía nada**: el
 * switch no tiene `default`, así que la pantalla simplemente no se monta y la
 * app queda en blanco sin que ningún test se entere. Un `case` que nadie
 * ejercita es una ruta declarada, no una ruta que funciona.
 *
 * Cubre además el otro extremo del cable: que el acceso de la pestaña de Inicio
 * **navegue de verdad**. Los dos lados fallan igual de silenciosos.
 *
 * Se prueba por rol y por texto visible, no por CSS, y sin un solo
 * `waitForTimeout`.
 */

/** El acceso tal cual lo toca la persona → la pantalla a la que tiene que caer. */
const ACCESOS = [
  { pestana: 'Cuenta', acceso: 'Ver pagos', hash: '#/pagos', titulo: 'Mis pagos' },
  {
    pestana: 'Estadísticas',
    acceso: 'Ver mis estadísticas',
    hash: '#/estadisticas',
    titulo: 'Mis estadísticas',
  },
] as const;

test.describe('los accesos de las pestañas de Inicio llegan a su pantalla', () => {
  for (const { pestana, acceso, hash, titulo } of ACCESOS) {
    test(`"${acceso}" abre ${titulo}`, async ({ page }) => {
      await ingresar(page);

      await page.getByRole('tab', { name: pestana, exact: true }).click();
      await page.getByRole('button', { name: acceso, exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`${hash.replace('#/', '#\\/')}$`));
      await expect(page.getByText(titulo, { exact: true })).toBeVisible();

      /**
       * Y la vuelta: "Volver" devuelve a Inicio, no a una pantalla intermedia.
       *
       * Se afirma por lo que se VE y no por el hash, a propósito: `goBack`
       * camina el historial real del navegador, y la entrada anterior es la
       * que dejó `page.goto('/')` — o sea la URL **sin** hash, que el router
       * resuelve a Inicio por default. Pedir `#/home` acá haría fallar un
       * regreso que es correcto.
       */
      await page.getByRole('button', { name: 'Volver', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Cuenta', exact: true })).toBeVisible();
    });
  }

  /**
   * CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-02) · la pestaña Cuenta ya no
   * ofrece «Ver tarjetas»: el alta de tarjeta está cerrada en producción pública
   * sin pagos. Se afirma la AUSENCIA con el control positivo al lado —«Ver
   * pagos» sigue, y sigue llegando—, porque una ausencia la rompe alguien
   * «completando» la pestaña de buena fe.
   */
  test('Cuenta ofrece Ver pagos y NO Ver tarjetas (corte del viernes)', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    await page.getByRole('tab', { name: 'Cuenta', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ver pagos', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver tarjetas', exact: true })).toHaveCount(0);
  });

  /**
   * La pestaña Asociadas **existe y no tiene interior**, a propósito: hijos es
   * Cuentas Junior y pareja es un instrumento de pago compartido, las dos stop
   * conditions del gobierno. Lo único permitido es un estado honesto.
   *
   * El test afirma la AUSENCIA de accesos, que es lo que hay que defender: el
   * día que alguien le agregue una fila, este recorrido lo dice.
   */
  test('Asociadas muestra un estado honesto y ningún acceso', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('tab', { name: 'Asociadas', exact: true }).click();

    await expect(page.getByText('Todavía no está disponible', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Ver / })).toHaveCount(0);
  });
});
