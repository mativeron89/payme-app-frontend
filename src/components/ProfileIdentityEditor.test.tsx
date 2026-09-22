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

describe('M03 · «Fecha de nacimiento» en el perfil, una sola vez', () => {
  const conUsuario = (extra: Record<string, unknown>): StoredSession => ({
    ...SESSION,
    user: { ...SESSION.user!, ...extra },
  });

  it('🔴 aparece sólo cuando el servidor dice que falta (birth_date_set === false)', () => {
    const html = renderToStaticMarkup(
      <ProfileIdentityEditor session={conUsuario({ birth_date_set: false, is_adult: null, birth_date: null })} enabled adoptUser={() => true} />,
    );
    expect(html).toContain('Fecha de nacimiento');
    expect(html).toContain('type="date"');
    expect(html).toContain('Guardar fecha');
    expect(html).toContain('no mostramos tu foto a nadie más');
    expect(html).toContain('No se puede cambiar después.');
  });

  it('🔴 con la fecha ya declarada no se ofrece (write-once) y no muestra la fecha ni una edad', () => {
    const html = renderToStaticMarkup(
      <ProfileIdentityEditor session={conUsuario({ birth_date_set: true, is_adult: true, birth_date: '1988-03-14' })} enabled adoptUser={() => true} />,
    );
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain('Fecha de nacimiento');
    expect(html).not.toContain('1988');
    expect(html).not.toMatch(/\d+ años/);
  });

  it('sin saber todavía (la sesión no lo trae) no se dibuja: espera al perfil estricto', () => {
    const html = renderToStaticMarkup(
      <ProfileIdentityEditor session={SESSION} enabled adoptUser={() => true} />,
    );
    expect(html).not.toContain('type="date"');
  });

  it('con el perfil apagado no hay campo aunque falte la fecha', () => {
    const html = renderToStaticMarkup(
      <ProfileIdentityEditor session={conUsuario({ birth_date_set: false, is_adult: null, birth_date: null })} enabled={false} adoptUser={() => true} />,
    );
    expect(html).not.toContain('type="date"');
  });

  it('menor según el SERVIDOR: dice que su foto no se muestra, sin campo', () => {
    const html = renderToStaticMarkup(
      <ProfileIdentityEditor session={conUsuario({ birth_date_set: true, is_adult: false, birth_date: '2015-01-01' })} enabled adoptUser={() => true} />,
    );
    expect(html).not.toContain('type="date"');
    expect(html).toContain('no mostramos tu foto a nadie más');
    expect(html).not.toContain('2015');
  });

  it('🔴 un solo PATCH, el veredicto sale de la respuesta y el cliente no calcula edad', () => {
    expect(source.match(/api\.declareBirthDate/g)).toHaveLength(1);
    expect(source).toContain('setFechaDeclarada(response.user.birth_date_set)');
    expect(source).toContain('setEsAdulto(response.user.is_adult)');
    expect(source).toContain("status === 409 && code === 'birth_date_already_set'");
    expect(source).not.toMatch(/getFullYear|getUTCFullYear|Date\.now|new Date\(/);
  });
});
