import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { capacidadFoto, confirmarMutacionFoto, decodePermisoFoto, FOTO_NOTICE, verificarAvisoFoto } from './fotoPerfilNoAmigos';

const never = { purpose_key: 'foto_perfil_no_amigos', granted: false, state: 'never', since: null, notice_version: null, notice_hash: null };
const granted = { ...never, granted: true, state: 'granted', since: '2026-10-23T18:30:17.500Z', notice_version: FOTO_NOTICE.version, notice_hash: FOTO_NOTICE.hash };
const aviso = { kind: 'aviso_privacidad' as const, ...FOTO_NOTICE, effective_from: '2026-10-23T00:00:00.000Z',
  body: readFileSync(new URL('../../test-fixtures/legal-d457/aviso_privacidad.txt', import.meta.url), 'utf8') };

describe('D457 · contrato de foto owner-first-v2', () => {
  it.each([undefined, null, {}, { features: {} }, { features: { foto_perfil_no_amigos: true } },
    { features: { foto_perfil_no_amigos: { supported: true, enabled: true, user_id: 'alguien' } } },
    { features: { foto_perfil_no_amigos: { supported: false, enabled: true } } },
    { features: { foto_perfil_no_amigos: { supported: true, enabled: 'true' } } },
  ])('no ofrece grants con capability ausente/ajena/malformada: %j', (config) => {
    expect(capacidadFoto(config).enabled).toBe(false);
  });
  it('supported no significa enabled ni permiso del titular', () => {
    expect(capacidadFoto({ features: { foto_perfil_no_amigos: { supported: true, enabled: false } } })).toEqual({ supported: true, enabled: false });
    expect(capacidadFoto({ features: { foto_perfil_no_amigos: { supported: true, enabled: true } } }).enabled).toBe(true);
    expect(decodePermisoFoto({ consent: never }).granted).toBe(false);
  });
  it('conserva never y evidencia histórica de revoked sin exigir un par vigente', () => {
    expect(decodePermisoFoto({ consent: never })).toEqual(never);
    const revoked = { ...granted, granted: false, state: 'revoked', notice_version: '3.0.0', notice_hash: 'a'.repeat(64) };
    expect(decodePermisoFoto({ consent: revoked })).toEqual(revoked);
    expect(confirmarMutacionFoto({ consent: never }, false)).toEqual(never);
  });
  it.each([
    { ...never, granted: true }, { ...never, since: granted.since }, { ...never, notice_hash: FOTO_NOTICE.hash },
    { ...granted, purpose_key: 'sugerencias' }, { ...granted, extra: true }, { ...granted, state: 'revoked' },
    { ...granted, since: 'ayer' }, { ...granted, notice_hash: FOTO_NOTICE.hash + '\n' },
  ])('rechaza estado incoherente sin inventar un default: %j', (consent) => {
    expect(() => decodePermisoFoto({ consent })).toThrow('foto_consent_response_malformed');
  });
  it('verifica el cuerpo exacto puesto a disposición, no sólo el par declarado', async () => {
    expect(await verificarAvisoFoto(aviso)).toBe(true);
    expect(await verificarAvisoFoto({ ...aviso, body: aviso.body.replace('PayMe', 'Otra app') })).toBe(false);
    expect(await verificarAvisoFoto({ ...aviso, version: '3.0.0' })).toBe(false);
    expect(await verificarAvisoFoto({ ...aviso, hash: 'b'.repeat(64) })).toBe(false);
  });
  it('no afirma éxito si el POST confirma el estado opuesto o un par distinto', () => {
    expect(confirmarMutacionFoto({ consent: granted }, true).granted).toBe(true);
    expect(() => confirmarMutacionFoto({ consent: never }, true)).toThrow('foto_consent_change_unconfirmed');
    expect(() => confirmarMutacionFoto({ consent: granted }, false)).toThrow('foto_consent_change_unconfirmed');
    expect(() => confirmarMutacionFoto({ consent: { ...granted, notice_hash: 'b'.repeat(64) } }, true)).toThrow();
  });
});
