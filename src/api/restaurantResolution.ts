import type {
  RestaurantResolutionRequest,
  RestaurantResolutionResponse,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

export function decodeRestaurantResolution(value: unknown): RestaurantResolutionResponse {
  const body = record(value);
  const restaurant = record(body?.restaurant);
  if (!body || !restaurant
      || !exactKeys(body, ['restaurant', 'record_only'])
      || !exactKeys(restaurant, ['id', 'name', 'category', 'address'])
      || typeof restaurant.id !== 'string' || !UUID.test(restaurant.id)
      || typeof restaurant.name !== 'string' || !restaurant.name.trim()
      || restaurant.name.length > 200
      || typeof restaurant.category !== 'string' || !restaurant.category
      || (restaurant.address !== null && typeof restaurant.address !== 'string')
      || typeof body.record_only !== 'boolean') {
    throw new Error('contract_response_invalid:restaurants/resolve');
  }
  return {
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      category: restaurant.category,
      address: restaurant.address as string | null,
    },
    record_only: body.record_only,
  };
}

/** La llamada siempre lleva al menos una identidad y el fallback es UUID real. */
export function resolutionRequest(
  merchant: { readonly name?: string; readonly rfc?: string } | undefined,
  fallbackKey: string,
): RestaurantResolutionRequest {
  if (!UUID.test(fallbackKey)) throw new Error('restaurant_resolution_fallback_invalid');
  return {
    ...(merchant?.name ? { name: merchant.name } : {}),
    ...(merchant?.rfc ? { rfc: merchant.rfc } : {}),
    fallback_key: fallbackKey,
  };
}
