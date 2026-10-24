import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdiomaProvider } from '../i18n/idioma';
import { PrivacidadFotoView, type EstadoPrivacidadFoto } from './PrivacidadFotoPanel';
import { FOTO_NOTICE, type PermisoFoto } from '../api/fotoPerfilNoAmigos';

const never: PermisoFoto = { purpose_key: 'foto_perfil_no_amigos', granted: false, state: 'never', since: null, notice_version: null, notice_hash: null };
const granted: PermisoFoto = { ...never, granted: true, state: 'granted', since: '2026-10-23T18:00:00.000Z', notice_version: FOTO_NOTICE.version, notice_hash: FOTO_NOTICE.hash };
const initial: EstadoPrivacidadFoto = { permiso: never, permiteGrant: false, aviso: null, ocupado: false, error: null };
const aviso = { kind: 'aviso_privacidad' as const, ...FOTO_NOTICE, effective_from: '2026-10-23T00:00:00.000Z', body: 'Texto de prueba de la vista; la verificación se prueba en la API.' };
const render = (e: EstadoPrivacidadFoto, soloRevocar = false) => renderToStaticMarkup(<IdiomaProvider><PrivacidadFotoView
  estado={e} soloRevocar={soloRevocar} onCambiar={() => undefined} onConsultar={() => undefined} /></IdiomaProvider>);
const control = (html: string) => /<button[^>]*role="switch"[^>]*>/.exec(html)?.[0];

describe('D457 · presentación accesible y sin defaults inventados', () => {
  it('never está apagado; sin capability no ofrece activación', () => {
    const html = render(initial);
    expect(control(html)).toContain('aria-checked="false"');
    expect(control(html)).toContain('disabled');
    expect(html).toContain('Permiso desactivado');
    expect(html).toContain('aria-describedby=');
  });
  it('estado desconocido no se presenta como apagado ni éxito', () => {
    const html = render({ ...initial, permiso: null, error: 'No se confirmó el cambio. Consulta el estado antes de volver a intentarlo.' });
    expect(control(html)).toBeUndefined();
    expect(html).not.toContain('Permiso desactivado');
    expect(html).toContain('role="alert"');
  });
  it('revocar no depende de capability/texto; el pendiente no invierte el estado', () => {
    expect(control(render({ ...initial, permiso: granted }))).not.toContain('disabled');
    const pending = control(render({ ...initial, permiso: granted, ocupado: true }));
    expect(pending).toContain('aria-checked="true"');
    expect(pending).toContain('disabled');
  });
  it('puerta legal sólo permite revocar: ningún grant aunque llegue capability y texto', () => {
    const e = { ...initial, permiteGrant: true, aviso };
    expect(control(render(e))).not.toContain('disabled');
    expect(control(render(e, true))).toContain('disabled');
    expect(control(render({ ...e, permiso: granted }, true))).not.toContain('disabled');
    expect(render(e, true)).not.toContain('type="checkbox"');
  });
});
