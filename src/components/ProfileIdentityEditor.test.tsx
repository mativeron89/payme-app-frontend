import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StoredSession } from '../api/storage';
import { ProfileIdentityEditor } from './ProfileIdentityEditor';

const SESSION: StoredSession = {
  access_token: 'access',
  refresh_token: 'refresh',
  family_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  principal_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  user: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    payme_id: 'payme_mx_a1b2',
    email: 'owner@laparolaccia.mx',
    first_name: 'Sofía',
    last_name: 'Fernández',
    avatar: null,
  },
};

const source = readFileSync(new URL('./ProfileIdentityEditor.tsx', import.meta.url), 'utf8');

describe('ProfileIdentityEditor · superficie DARK y lifecycle privado', () => {
  it('OFF conserva identidad de sólo lectura y no crea controles ni input de archivo', () => {
    const html = renderToStaticMarkup(
      <ProfileIdentityEditor session={SESSION} enabled={false} adoptUser={() => true} />,
    );
    expect(html).toContain('Sofía Fernández');
    expect(html).toContain('payme_mx_a1b2');
    expect(html).not.toContain('profile-avatar-edit');
    expect(html).not.toContain('profile-name-edit');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('Eliminar foto');
  });

  it('ON de prueba monta los controles sin volver editable el payme_id', () => {
    const html = renderToStaticMarkup(
      <ProfileIdentityEditor session={SESSION} enabled adoptUser={() => true} />,
    );
    expect(html).toContain('profile-avatar-edit');
    expect(html).toContain('profile-name-edit');
    expect(html).toContain('type="file"');
    expect(html).toContain('payme_mx_a1b2');
    expect(html).not.toContain('value="payme_mx_a1b2"');
  });

  it('cada mutación se envía una vez; 409 relee y exige reintento explícito', () => {
    expect(source.match(/api\.putProfileAvatar/g)).toHaveLength(1);
    expect(source.match(/api\.deleteProfileAvatar/g)).toHaveLength(1);
    expect(source).toContain('extractApiError(error).status === 409');
    expect(source).toContain('refreshProfileAfterMutation(expected, epoch)');
    expect(source).toContain("Tu foto cambió en otra sesión. Reintenta.");
    expect(source).toContain('adoptProfileMutationUser(');
  });

  it('revoca ObjectURL al fallar la imagen y al desmontar', () => {
    expect(source).toContain('onError={handleAvatarError}');
    expect(source).toContain('avatarLease.current?.clear()');
    expect(source).toContain('avatarLease.current?.dispose()');
  });
});
