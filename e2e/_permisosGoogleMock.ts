// Este módulo lo carga únicamente la prueba de redirección en cada documento del mock.
import { api } from '../src/api';
import { HttpError } from '../src/api/http';
import { mockRevokeConsentimiento } from '../src/api/mock/mockSugerencias';
import { loadSession } from '../src/api/storage';

const config = api.getConfig.bind(api);
api.getConfig = async () => {
  const c = await config();
  return { ...c, features: { ...c.features, foto_perfil_no_amigos: { supported: true, enabled: true } } };
};

const eventos: string[] = [];
const canje = api.googleRedirectSignup.bind(api);
api.googleRedirectSignup = async solicitud => {
  if (sessionStorage.getItem('e2e.c308.no-disponible')) {
    sessionStorage.removeItem('e2e.c308.no-disponible');
    throw new HttpError(503, { error: 'registration_unavailable' });
  }
  if (localStorage.getItem('payme.app.mock.google_sin_cuenta.v1') === 'false') {
    await mockRevokeConsentimiento('analisis_interno');
  }
  const r = await canje(solicitud);
  eventos.push(r.created ? 'creada' : 'existente');
  return r;
};
const otorgarAnalisis = api.grantConsentimiento.bind(api);
api.grantConsentimiento = async (...args) => {
  eventos.push(args[0]);
  return otorgarAnalisis(...args);
};
api.grantFotoPerfilNoAmigos = async aviso => {
  eventos.push('foto_perfil_no_amigos');
  return { purpose_key: 'foto_perfil_no_amigos', state: 'granted', granted: true,
    since: new Date().toISOString(), notice_version: aviso.version, notice_hash: aviso.hash };
};

export function operaciones() { return [...eventos]; }
export async function estadoAnalisis() {
  return (await api.getConsentimiento('analisis_interno', loadSession()!)).state;
}
