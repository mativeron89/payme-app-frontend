import type { OcrLocalAddress } from './types';

/**
 * D504 · D507 · D511 · la dirección del local que publica la lectura del ticket con `local_address_version=1`
 * (App Backend 2.201.0, `contract-mirror/contract/ocr-merchant-v2.json` → `local_address_v1`) y que el front reenvía,
 * sin cambios, a `POST /api/restaurants/resolve`. Sin dependencias a propósito: lo usan el decodificador de la lectura
 * y el mock del resolver.
 */

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** D504 · las seis claves de `merchant.address` (`local_address_v1` de `ocr-merchant-v2.json`). */
const OCR_ADDRESS_KEYS = ['street', 'number', 'neighborhood', 'postal_code', 'city', 'state'] as const;

/** Texto recortado, no vacío y de hasta `max` unidades UTF-16 (como `textoOpcional` del dueño); `null` también vale. */
function textoDeDireccion(value: unknown, max: number): value is string | null {
  return value === null
    || (typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim());
}

/**
 * D504 · D507 · la dirección del local con la forma exacta del dueño (`direccionPublicable` de App Backend 2.201.0):
 * las seis claves siempre, calle y número obligatorios (el número empieza con un dígito), CP de cinco dígitos o `null`.
 * `null` = no cumple: la lectura entera se rechaza como cualquier otra forma inválida (y el mock del resolver responde
 * 400, como el esquema estricto del dueño).
 * 🔴 Sólo se guarda para reenviarla a `POST /api/restaurants/resolve`: ninguna vista la muestra (Aviso 3.1.0 §6).
 */
export function direccionDelLocal(value: unknown): OcrLocalAddress | null {
  const raw = record(value);
  if (!raw
      || Object.keys(raw).length !== OCR_ADDRESS_KEYS.length
      || Object.keys(raw).some((key) => !(OCR_ADDRESS_KEYS as readonly string[]).includes(key))
      || typeof raw.street !== 'string' || !textoDeDireccion(raw.street, 200)
      || typeof raw.number !== 'string' || !textoDeDireccion(raw.number, 40) || !/^\d/.test(raw.number)
      || !textoDeDireccion(raw.neighborhood, 120)
      || !(raw.postal_code === null || (typeof raw.postal_code === 'string' && /^\d{5}$/.test(raw.postal_code)))
      || !textoDeDireccion(raw.city, 100)
      || !textoDeDireccion(raw.state, 100)) {
    return null;
  }
  return {
    street: raw.street,
    number: raw.number,
    neighborhood: raw.neighborhood,
    postal_code: raw.postal_code,
    city: raw.city,
    state: raw.state,
  };
}

