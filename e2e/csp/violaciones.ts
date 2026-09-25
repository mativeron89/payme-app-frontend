import type { Page } from '@playwright/test';

/**
 * n186 · registra cada `securitypolicyviolation` desde ANTES de que cargue el
 * documento. Una política que bloquea algo en silencio no rompe un test que no
 * lo mira: por eso cada recorrido termina afirmando que la lista está vacía.
 */
export interface Violacion { readonly directiva: string; readonly bloqueado: string }

export async function vigilarCsp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: Array<{ directiva: string; bloqueado: string }> };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push({ directiva: e.effectiveDirective, bloqueado: e.blockedURI });
    });
  });
}

export function violaciones(page: Page): Promise<Violacion[]> {
  return page.evaluate(() => (window as unknown as { __csp?: Violacion[] }).__csp ?? []);
}
