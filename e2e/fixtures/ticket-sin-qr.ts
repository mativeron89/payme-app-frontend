import { expect, type Page } from '@playwright/test';

export async function configurarTicketSinQr(
  page: Page,
  options: {
    lostResponse?: boolean;
    ocr?: 'malformed' | 'no_items' | 'no_merchant' | 'budget_exhausted' | 'budget_unavailable';
  } = {},
): Promise<void> {
  await page.addInitScript((config) => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    if (config.lostResponse) {
      localStorage.setItem('payme.app.mock.n179.lost_response.v1', 'armed');
    }
    if (config.ocr) localStorage.setItem('payme.app.mock.n179.ocr.v1', config.ocr);
  }, options);
}

export async function completarDivision(page: Page): Promise<void> {
  await page.getByRole('radio', { name: /En partes iguales/ }).click();
  const mas = page.getByRole('button', { name: 'Un comensal más' });
  await mas.click();
  await mas.click();
  await mas.click();
  await expect(page.getByRole('group', { name: /¿Cuántos pagan\?/ })).toContainText('4');
}

export async function estadoN179(page: Page): Promise<{
  mesas: Array<{ id: string; code: string; restaurant: { id: string; name: string } }>;
  privateRestaurantIds: string[];
  mesaLedgerKeys: string[];
}> {
  return page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('payme_mock_state_v1') ?? '{}');
    const privateRestaurantIds = Object.values(state.restaurantResolutions ?? {})
      .flatMap((byUser) => Object.values(byUser as Record<string, { id: string }>))
      .map((restaurant) => restaurant.id);
    return {
      mesas: (state.mesas ?? [])
        .filter((mesa: { restaurant?: { id?: string } }) => (
          typeof mesa.restaurant?.id === 'string' && privateRestaurantIds.includes(mesa.restaurant.id)
        )),
      privateRestaurantIds,
      mesaLedgerKeys: Object.keys(state.idempotency ?? {}).filter((key) => key.startsWith('mesa:')),
    };
  });
}
