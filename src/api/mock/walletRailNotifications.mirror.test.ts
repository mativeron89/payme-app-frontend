import { describe, expect, it } from 'vitest';
import { WALLET_NOTIFICATION_TYPES } from './store';

/**
 * OLA 5C(d) · el emisor dejó de mandar los avisos del riel saldo (`5e210fd`), y
 * lo que este archivo acredita es **que el cierre viene de allá**.
 *
 * La orden es explícita en el riesgo: *"verificá que NO agregaste un filtro que
 * tape el problema en vez de acreditar que se fue"*. Un filtro en el front
 * dejaría el hecho viajando por la red igual y, peor, daría verde a cualquier
 * medición hecha desde acá. Así que:
 *
 *  1. La lista del mock no es nuestra: se compara contra el ESPEJO del emisor.
 *  2. Ningún archivo del camino de red filtra avisos por tipo. Si alguien lo
 *     agrega, un barrido estructural lo nombra.
 *
 * Lo único que el front sí hace es **migrar su propio estado persistido**: los
 * avisos de una demo ya abierta viven en SU localStorage, no en el seed. Eso no
 * es tapar el problema del emisor — es que el mock deje de enseñar un riel que
 * ya no existe. La distinción es la que separa `store.ts` de todo el resto.
 */

const ESPEJO = import.meta.glob('/contract-mirror/services/notifications.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function tiposDelEmisor(): string[] {
  const texto = Object.values(ESPEJO)[0];
  expect(texto, 'no se encontró contract-mirror/services/notifications.js').toBeTruthy();
  const bloque = /const WALLET_RAIL_TYPES = new Set\(\[([\s\S]*?)\]\)/.exec(texto!);
  expect(bloque, 'no se encontró WALLET_RAIL_TYPES en el espejo').toBeTruthy();
  return [...bloque![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe('(d) · los avisos del riel saldo los apaga EL EMISOR', () => {
  it('el espejo declara un juego no vacío (si no, todo lo de abajo pasa en vacío)', () => {
    expect(tiposDelEmisor().length).toBeGreaterThanOrEqual(5);
  });

  /**
   * Conjunto CERRADO en las dos direcciones. No alcanza con que el mock no
   * tenga de más: si el emisor agrega un tipo y el mock no, un estado
   * persistido lo sigue mostrando. Fue el caso real de `topup_failed`.
   */
  it('el juego del mock es EXACTAMENTE el del emisor', () => {
    expect([...WALLET_NOTIFICATION_TYPES].sort()).toEqual(tiposDelEmisor());
  });

  /**
   * `tip_received` avisa a un mesero —persona identificada— de plata acreditada
   * a su nombre, obligación legacy. El emisor lo dejó fuera a propósito y lo
   * escribió. Filtrarlo por analogía sería ocultarle a alguien un movimiento
   * propio, y es exactamente la clase de "cierre por parecido" que este ciclo
   * viene cazando.
   */
  it('tip_received NO se suprime, ni allá ni acá', () => {
    expect(tiposDelEmisor()).not.toContain('tip_received');
    expect([...WALLET_NOTIFICATION_TYPES]).not.toContain('tip_received');
  });

  /**
   * ⭐ El test que hace de contra-tapón. Un `.filter()` por estos tipos en el
   * adaptador real, en la fachada o en la pantalla convertiría "el emisor dejó
   * de mandarlos" en algo imposible de medir desde acá: la pantalla se vería
   * igual estuviera o no arreglado el backend.
   *
   * Se permite exactamente un archivo —`mock/store.ts`, que migra estado
   * persistido de la demo— y los tests, que los nombran para probarlos.
   *
   * **Límite declarado:** es una heurística textual sobre "nombra los tipos Y
   * tiene forma de filtro". No ve una supresión escrita sin nombrarlos (por
   * ejemplo con una constante importada de otro archivo, o por `startsWith`),
   * y puede dar falso positivo si un archivo menciona un tipo por otra razón y
   * además filtra cualquier otra cosa. Sirve contra el caso probable —alguien
   * agrega el filtro donde duele, en la pantalla— no contra uno adversarial.
   */
  it('ningún archivo fuera del store del mock filtra avisos por estos tipos', () => {
    const fuentes = import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(fuentes).length).toBeGreaterThan(20);

    const PERMITIDOS = ['/src/api/mock/store.ts'];
    const ofensores: string[] = [];
    for (const [ruta, cuerpo] of Object.entries(fuentes)) {
      if (PERMITIDOS.includes(ruta) || ruta.includes('.test.')) continue;
      // Una supresión se escribe nombrando los tipos: si el archivo no los
      // nombra, no puede filtrarlos por tipo. Los íconos de `AvisosScreen` SÍ
      // los nombran, así que se exige además que haya un filtro/exclusión.
      const nombra = WALLET_NOTIFICATION_TYPES.some((t) => cuerpo.includes(t));
      const filtra = /\.filter\(|includes\([^)]*type|type\s*!==|!.*\.includes\(/.test(cuerpo);
      if (nombra && filtra) ofensores.push(ruta);
    }
    expect(ofensores).toEqual([]);
  });

  /**
   * `AvisosScreen` SIGUE SIN GATE, y es correcto por dos razones distintas.
   *
   * La primera es la que escribió `fb11ffa`: no fabricar sensación de cierre
   * sobre algo que no era nuestro. La segunda apareció con el arreglo del
   * emisor y es más fuerte: el gate del backend **no borra las filas que ya
   * existen**, sólo deja de crear nuevas. `GET /notifications` sigue
   * devolviendo los avisos viejos de una cuenta real, y esconderlos le ocultaría
   * a alguien un hecho que le pasó de verdad.
   *
   * Por eso los íconos también se conservan: sin ellos esos avisos legacy caen
   * en la campana genérica y se ven peor, sin que eso proteja nada.
   */
  it('la pantalla de avisos conserva los íconos de los tipos legacy', async () => {
    const fuentes = import.meta.glob('/src/screens/AvisosScreen.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const pantalla = Object.values(fuentes)[0];
    expect(pantalla, 'no se encontró AvisosScreen.tsx').toBeTruthy();
    expect(pantalla!).toContain('transfer_received');
    expect(pantalla!).toContain('topup_succeeded');
  });
});
