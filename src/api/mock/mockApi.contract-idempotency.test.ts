import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateMesaRequest } from '../types';
import {
  mockAttachPaymentMethod,
  mockCreateInvitation,
  mockCreateMesa,
  mockCreateSetupIntent,
  mockInviteFriend,
} from './mockApi';
import { persist, state } from './store';

beforeEach(() => {
  vi.stubGlobal('window', {
    location: { origin: 'https://demo.payme.test', pathname: '/app/' },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mock: contrato idempotente de mesa e invitaciones', () => {
  it('falla cerrado antes de crear una mesa si falta idempotency_key', async () => {
    const restaurant = state.mesas[0].restaurant;
    const before = state.mesas.length;
    const unsafeRequest = {
      restaurant_id: restaurant.id,
      total_cents: 1000,
      division_mode: 'igual',
      expected_participants: 2,
      guarantee_method: 'card',
      stripe_payment_method_id: 'pm_missing_key',
      items: [{ name: 'Agua', price_cents: 1000, quantity: 1 }],
    } as unknown as CreateMesaRequest;

    await expect(mockCreateMesa(unsafeRequest)).rejects.toMatchObject({
      status: 400,
      message: 'validation_error',
    });
    expect(state.mesas).toHaveLength(before);
  });

  it('replaya link e invitación in-app; la autoridad canónica detecta otro destinatario', async () => {
    const mesa = state.mesas.find((candidate) => candidate.openedByUser && candidate.status === 'partially_paid');
    expect(mesa).toBeDefined();
    const [friendA, friendB] = state.friends;
    const linkKey = 'mock-invitation-link-key-1';
    const friendKey = 'mock-invitation-friend-key-1';
    const linkLedger = `invitation:${state.user.id}:${mesa!.id}:${linkKey}`;
    const friendLedger = `invitation:${state.user.id}:${mesa!.id}:${friendKey}`;
    const linkNatural = `invitation-natural:${state.user.id}:${mesa!.id}:link`;
    const friendNatural = `invitation-natural:${state.user.id}:${mesa!.id}:in_app:${friendA.id}`;

    try {
      const firstLink = await mockCreateInvitation(mesa!.code, linkKey);
      const replayLink = await mockCreateInvitation(mesa!.code, linkKey);
      expect(replayLink).toMatchObject({
        idempotent: true,
        invitation: { id: firstLink.invitation.id },
        link: firstLink.link,
      });

      const firstFriend = await mockInviteFriend(mesa!.code, friendA.payme_id, friendKey);
      const replayFriend = await mockInviteFriend(mesa!.code, friendA.payme_id, friendKey);
      expect(replayFriend).toMatchObject({
        idempotent: true,
        invitation: { id: firstFriend.invitation.id, invitation_type: 'in_app' },
      });
      await expect(mockInviteFriend(mesa!.code, friendB.payme_id, friendKey)).rejects.toMatchObject({
        status: 409,
        message: 'idempotency_conflict',
      });
    } finally {
      delete state.idempotency[linkLedger];
      delete state.idempotency[friendLedger];
      delete state.idempotency[linkNatural];
      delete state.idempotency[friendNatural];
      persist();
      await Promise.resolve();
    }
  });

  it('replaya la misma invitación vencida como expired y una key nueva crea otra autoridad', async () => {
    const mesa = state.mesas.find((candidate) => candidate.openedByUser && candidate.status === 'partially_paid');
    expect(mesa).toBeDefined();
    const firstKey = 'mock-expired-link-key-1';
    const nextKey = 'mock-expired-link-key-2';
    const firstLedger = `invitation:${state.user.id}:${mesa!.id}:${firstKey}`;
    const nextLedger = `invitation:${state.user.id}:${mesa!.id}:${nextKey}`;
    const naturalLedger = `invitation-natural:${state.user.id}:${mesa!.id}:link`;

    try {
      const first = await mockCreateInvitation(mesa!.code, firstKey);
      const stored = state.idempotency[firstLedger].response as typeof first;
      stored.invitation.expires_at = new Date(Date.now() - 1_000).toISOString();

      const expired = await mockCreateInvitation(mesa!.code, firstKey);
      expect(expired).toMatchObject({
        idempotent: true,
        invitation: { id: first.invitation.id, status: 'expired' },
      });

      const fresh = await mockCreateInvitation(mesa!.code, nextKey);
      expect(fresh.invitation.status).toBe('pending');
      expect(fresh.invitation.id).not.toBe(first.invitation.id);
    } finally {
      delete state.idempotency[firstLedger];
      delete state.idempotency[nextLedger];
      delete state.idempotency[naturalLedger];
      persist();
      await Promise.resolve();
    }
  });

  it('claves distintas convergen por autoridad natural para link y destinatario', async () => {
    const mesa = state.mesas.find((candidate) => candidate.openedByUser && candidate.status === 'partially_paid');
    expect(mesa).toBeDefined();
    const friend = state.friends[0];
    const keys = ['natural-key-a-001', 'natural-key-b-002'];
    const requestLedgers = keys.flatMap((key) => [
      `invitation:${state.user.id}:${mesa!.id}:${key}-link`,
      `invitation:${state.user.id}:${mesa!.id}:${key}-friend`,
    ]);
    const naturalLedgers = [
      `invitation-natural:${state.user.id}:${mesa!.id}:link`,
      `invitation-natural:${state.user.id}:${mesa!.id}:in_app:${friend.id}`,
    ];

    try {
      const linkA = await mockCreateInvitation(mesa!.code, `${keys[0]}-link`);
      const linkB = await mockCreateInvitation(mesa!.code, `${keys[1]}-link`);
      expect(linkB).toMatchObject({
        idempotent: true,
        invitation: { id: linkA.invitation.id },
        link: linkA.link,
      });

      const friendA = await mockInviteFriend(mesa!.code, friend.payme_id, `${keys[0]}-friend`);
      const friendB = await mockInviteFriend(mesa!.code, friend.payme_id, `${keys[1]}-friend`);
      expect(friendB).toMatchObject({
        idempotent: true,
        invitation: { id: friendA.invitation.id },
      });
    } finally {
      [...requestLedgers, ...naturalLedgers].forEach((key) => delete state.idempotency[key]);
      persist();
      await Promise.resolve();
    }
  });
});

describe('mock: setup y attach convergen sin otra tarjeta', () => {
  it('reusa SetupIntent por key y replaya attach por el mismo pm_', async () => {
    const setupKey = 'mock-setup-intent-key-1';
    const setupLedger = `setup-intent:${state.user.id}:${setupKey}`;
    const paymentMethodsBefore = structuredClone(state.paymentMethods);
    const pmId = 'pm_mock_attach_retry_stable';

    try {
      const firstSetup = await mockCreateSetupIntent(setupKey);
      const replaySetup = await mockCreateSetupIntent(setupKey);
      expect(replaySetup).toEqual(firstSetup);

      const firstAttach = await mockAttachPaymentMethod(pmId, false);
      const methodsAfterFirst = state.paymentMethods.length;
      const replayAttach = await mockAttachPaymentMethod(pmId, false);
      expect(replayAttach).toMatchObject({
        idempotent: true,
        payment_method: { id: firstAttach.payment_method.id },
      });
      expect(state.paymentMethods).toHaveLength(methodsAfterFirst);
    } finally {
      state.paymentMethods = paymentMethodsBefore;
      delete state.idempotency[setupLedger];
      persist();
      await Promise.resolve();
    }
  });
});
