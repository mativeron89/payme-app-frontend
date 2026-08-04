import { describe, expect, it } from 'vitest';
import { accountRailView, allowsWalletRoute } from './releaseGates';

describe('gate IFPE de release', () => {
  it('real conserva tarjetas y elimina todo affordance wallet', () => {
    expect(accountRailView(false)).toEqual({
      showCards: true,
      showAccountActivity: true,
      showBalance: false,
      showWalletMovements: false,
      showTopupTransfer: false,
    });
    expect(allowsWalletRoute(false, 'cargar')).toBe(false);
    expect(allowsWalletRoute(false, 'transferir')).toBe(false);
    expect(allowsWalletRoute(false, 'cuenta')).toBe(true);
  });

  it('mock explícito conserva ambos rieles', () => {
    expect(accountRailView(true)).toEqual({
      showCards: true,
      showAccountActivity: true,
      showBalance: true,
      showWalletMovements: true,
      showTopupTransfer: true,
    });
    expect(allowsWalletRoute(true, 'cargar')).toBe(true);
    expect(allowsWalletRoute(true, 'transferir')).toBe(true);
  });

  /**
   * N-10 · el error que esta ola corrige: el historial de pagos propio y sus
   * estadísticas son superficie card-only RATIFICADA QUE SE CONSERVA. Apagar el
   * riel saldo no puede apagarlos. Este test es el que impide que vuelva a
   * colgarse del mismo flag.
   */
  it('la actividad de cuenta card-only NO depende del riel saldo', () => {
    expect(accountRailView(false).showAccountActivity).toBe(true);
    expect(accountRailView(true).showAccountActivity).toBe(true);
    expect(accountRailView(false).showAccountActivity).toBe(
      accountRailView(true).showAccountActivity,
    );
  });

  it('separa la actividad de cuenta de los movimientos de wallet', () => {
    const real = accountRailView(false);
    expect(real.showAccountActivity).toBe(true);
    expect(real.showWalletMovements).toBe(false);
  });

  /**
   * G-24 · CERRADO POR ELIMINACIÓN.
   *
   * Los tests anteriores probaban que ninguna forma de `?demo=1` activaba la
   * rama del modo demo. Al eliminarse esa rama, **esos tests dejaron de probar
   * algo**: verificar que no se activa lo que no existe es exactamente el
   * antipatrón que ya nos mordió en este ciclo —defensas declaradas que no
   * ejecutan nada—. Así que no se conservan como estaban.
   *
   * Lo que sí sigue teniendo valor es el INVARIANTE que protegían: que un
   * PaymentMethod de prueba no pueda llegar a la app. Eso ahora se puede
   * afirmar mucho más fuerte, sobre el código fuente entero en vez de sobre una
   * función: si alguien reintroduce `pm_card_visa` por cualquier vía —otra
   * pantalla, otro flag, un helper nuevo— este test lo frena.
   */
  it('G-24 · ningún PaymentMethod de prueba de Stripe existe en el código fuente', () => {
    // `import.meta.glob` es nativo de Vite: barre el árbol sin agregar ninguna
    // dependencia (los tipos de node lo serían).
    const fuentes = import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const PROHIBIDOS = ['pm_card_visa', 'tok_visa'];
    const ofensores: string[] = [];
    for (const [ruta, cuerpo] of Object.entries(fuentes)) {
      if (ruta.endsWith('releaseGates.test.ts')) continue; // este archivo los nombra
      for (const token of PROHIBIDOS) {
        if (cuerpo.includes(token)) ofensores.push(`${ruta} → ${token}`);
      }
    }
    // Guardarraíl del guardarraíl: si el glob no encuentra nada, el test pasaría
    // en vacío y no probaría absolutamente nada.
    expect(Object.keys(fuentes).length).toBeGreaterThan(20);
    expect(ofensores).toEqual([]);
  });
});
