import type {
  AttachPaymentMethodResponse,
  AttachedPaymentMethod,
  CreateInvitationResponse,
  CreateSetupIntentResponse,
} from './types';

/** Un 2xx malformado no acredita éxito: el caller debe conservar su intento. */
export class ContractResponseError extends Error {
  constructor(endpoint: string) {
    super(`contract_response_invalid:${endpoint}`);
    this.name = 'ContractResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function invitationLinkMatches(value: unknown, expectedCode: string): boolean {
  if (!nonEmpty(value) || !nonEmpty(expectedCode)) return false;
  try {
    const url = new URL(value, 'https://payme.invalid');
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const [hashPath, hashQuery = ''] = hash.split('?', 2);
    const expectedPath = `/mesa/${encodeURIComponent(expectedCode)}`;
    const targetMatches = url.pathname.endsWith(expectedPath) || hashPath.endsWith(expectedPath);
    const token = url.searchParams.get('t') ?? new URLSearchParams(hashQuery).get('t');
    return targetMatches && nonEmpty(token);
  } catch {
    return false;
  }
}

export function setupIntentResponse(value: unknown): CreateSetupIntentResponse {
  const body = record(value);
  if (!body || !nonEmpty(body.setup_intent_id) || !nonEmpty(body.client_secret)) {
    throw new ContractResponseError('payment-methods/setup-intent');
  }
  return value as CreateSetupIntentResponse;
}

function attachedPaymentMethod(
  value: unknown,
  expectedStripePaymentMethodId: string,
): value is AttachedPaymentMethod {
  const method = record(value);
  if (!method) return false;
  if (
    !nonEmpty(method.id) ||
    method.stripe_payment_method_id !== expectedStripePaymentMethodId ||
    !nonEmpty(method.brand) ||
    (method.bank_name !== null && typeof method.bank_name !== 'string') ||
    !['credit', 'debit'].includes(String(method.type)) ||
    typeof method.last_four !== 'string' || !/^\d{4}$/.test(method.last_four) ||
    !Number.isSafeInteger(method.exp_month) || Number(method.exp_month) < 1 || Number(method.exp_month) > 12 ||
    !Number.isSafeInteger(method.exp_year) || Number(method.exp_year) < 1 ||
    typeof method.is_default !== 'boolean' ||
    !nonEmpty(method.display)
  ) return false;
  return true;
}

export function attachPaymentMethodResponse(
  value: unknown,
  expectedStripePaymentMethodId: string,
): AttachPaymentMethodResponse {
  const body = record(value);
  if (
    !body ||
    !nonEmpty(expectedStripePaymentMethodId) ||
    !attachedPaymentMethod(body.payment_method, expectedStripePaymentMethodId) ||
    !optionalBoolean(body.idempotent)
  ) throw new ContractResponseError('payment-methods');
  return value as AttachPaymentMethodResponse;
}

export function invitationResponse(
  value: unknown,
  expectedType: 'link' | 'in_app',
  expectedCode: string,
): CreateInvitationResponse {
  const body = record(value);
  const invitation = record(body?.invitation);
  if (
    !body ||
    !invitation ||
    !nonEmpty(invitation.id) ||
    invitation.invitation_type !== expectedType ||
    !['pending', 'expired'].includes(String(invitation.status)) ||
    !nonEmpty(invitation.expires_at) ||
    !nonEmpty(invitation.created_at) ||
    !optionalBoolean(body.idempotent) ||
    (body.link !== undefined && !nonEmpty(body.link)) ||
    (expectedType === 'link' && !invitationLinkMatches(body.link, expectedCode))
  ) throw new ContractResponseError('mesas/invitations');
  return value as CreateInvitationResponse;
}
