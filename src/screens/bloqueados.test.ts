import { EN } from '../i18n/en';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeBlockedUsers, type BlockedUser } from '../api';

const person = {
  id: '11111111-1111-4111-8111-111111111111', payme_id: 'payme_fixture_luna',
  first_name: 'Luna', last_name: 'Prueba', full_name: 'Luna Prueba', blocked_at: '2026-11-12T10:00:00.000Z',
} satisfies BlockedUser;

describe('A5 · contrato D787 AB 2502fab9 routes/friends.js:142–157', () => {
  it('acepta exactamente las claves, con username omitido, nulo o string; conserva orden del dueño', () => {
    for (const extra of [{}, { username: null }, { username: 'luna.prueba' }]) {
      const row: BlockedUser = { ...person, ...extra };
      expect(decodeBlockedUsers({ blocked: [row] })).toEqual({ blocked: [row] });
    }
    expect(decodeBlockedUsers({ blocked: [] })).toEqual({ blocked: [] });
    expect(decodeBlockedUsers({ blocked: [person, { ...person, id: 'second' }] }).blocked.map(p => p.id)).toEqual([person.id, 'second']);
  });
  it('descarta email, teléfono, foto y claves extra del borde, sin conservar sus referencias', () => {
    const input = { ...person, email: 'luna@example.invalid', phone: 'synthetic', photo: 'synthetic', extra: {} };
    const decoded = decodeBlockedUsers({ blocked: [input], email: 'top@example.invalid' });
    expect(decoded).toEqual({ blocked: [person] });
    expect(Object.keys(decoded.blocked[0]!).sort()).toEqual(Object.keys(person).sort());
    expect(decoded.blocked[0]).not.toBe(input);
  });
  it.each([null, {}, { blocked: null }, { blocked: [{}] }, { blocked: [{ ...person, id: 1 }] },
    { blocked: [{ ...person, blocked_at: 'mal' }] }, { blocked: [{ ...person, username: 123 }] },
    { blocked: [{ ...person, full_name: undefined }] }])('rechaza un cuerpo incompleto: %j', body => {
    expect(() => decodeBlockedUsers(body)).toThrow('contract_response_invalid:friends/blocked');
  });
});

// La persistencia de payme_mock_state_v1 pertenece al backend simulado, no a la pantalla.
it('la pantalla nunca usa localStorage, sessionStorage ni IndexedDB (M13)', () => {
  const source = readFileSync(new URL('./Bloqueados.tsx', import.meta.url), 'utf8');
  expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\b/);
});

it('D812/D815 conservan los textos aprobados en español y en idioma EN', () => {
  expect(EN['Desbloqueaste a {0}']).toBe('You unblocked {0}');
  expect(EN['¿Desbloquear a {0}? No se va a sumar a tus amigos, pero va a poder mandarte solicitudes de nuevo.'])
    .toBe("Unblock {0}? They won't be added back to your friends, but they'll be able to send you requests again.");
});
