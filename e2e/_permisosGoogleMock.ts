// Doble de la fachada para las pruebas de alta y redirección. Se carga antes de React.
import { api } from '../src/api';
import type { LegalAcceptanceRequest } from '../src/api/types';
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

if (sessionStorage.getItem('e2e.avisoDeAlta')) {
  const hashAnterior = 'a'.repeat(64);
  const aviso = api.getPrivacyNotice.bind(api);
  api.getPrivacyNotice = async () => {
    const documento = await aviso();
    const revision = sessionStorage.getItem('e2e.avisoDeAlta')!;
    sessionStorage.setItem('e2e.lecturaAviso', revision);
    return revision === 'anterior'
      ? { legal_text: { ...documento.legal_text, hash: hashAnterior, body: 'Aviso sintético anterior.' } }
      : documento;
  };

  async function aceptar(metodo: string, aceptacion?: LegalAcceptanceRequest) {
    if (sessionStorage.getItem('e2e.popupSinCredencial')) {
      sessionStorage.removeItem('e2e.popupSinCredencial');
      throw new HttpError(503, { error: 'registration_unavailable' });
    }
    const vigente = (await aviso()).legal_text;
    if (aceptacion?.aviso_hash === hashAnterior) {
      sessionStorage.setItem('e2e.avisoDeAlta', 'vigente');
      eventos.push(metodo + ':409');
      throw new HttpError(409, { error: 'legal_version_mismatch' });
    }
    if (aceptacion?.aviso_hash !== vigente.hash || aceptacion.aviso_version !== vigente.version) {
      throw Error('El reintento debe enviar el par vigente.');
    }
    eventos.push(metodo + ':vigente');
  }
  const correo = api.register.bind(api);
  api.register = async datos => { await aceptar('correo', datos.legal_acceptance); return correo(datos); };
  const registroGoogle = api.googleRegister.bind(api);
  api.googleRegister = async datos => { await aceptar('registro', datos.legal_acceptance); return registroGoogle(datos); };
  const continuar = api.googleContinue.bind(api);
  api.googleContinue = async datos => { await aceptar('un toque', datos.legal_acceptance); return continuar(datos); };
  const redireccion = api.googleRedirectSignup.bind(api);
  api.googleRedirectSignup = async datos => { await aceptar('redirección', datos.legal_acceptance); return redireccion(datos); };
}

export function operaciones() { return [...eventos]; }
export async function estadoAnalisis() {
  return (await api.getConsentimiento('analisis_interno', loadSession()!)).state;
}
