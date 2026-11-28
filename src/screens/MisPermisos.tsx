import { fullName } from '../utils/identity';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { type StoredSession } from '../api/storage';
import { useCapacidadesOpcionales, type EstadoDeConsentimiento } from '../api/sugerencias';
import { AppHeaderBack } from '../components/AppHeader';
import { FilaDeTitulo } from '../components/TarjetaDeTitulo';
import { useControlFoto } from '../components/PrivacidadFotoPanel';
import { FilaFotoView, FilaPermisoOpcionalView, mensajeDeRechazo, type MensajeDeFila } from '../components/SeccionPrivacidad';
import { useIdioma } from '../i18n/idioma';

export function MisPermisos({ session, onBack, soloRevocar = false }: {
  session: StoredSession; onBack: () => void; soloRevocar?: boolean;
}) {
  const { t } = useIdioma();
  const foto = useControlFoto(session, soloRevocar);
  const capacidad = useCapacidadesOpcionales().analisis_interno;
  const [estado, setEstado] = useState<EstadoDeConsentimiento | null>(null);
  const [mensaje, setMensaje] = useState<MensajeDeFila | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [consultas, setConsultas] = useState(0);
  useEffect(() => {
    let viva = true;
    setEstado(null);
    void Promise.resolve().then(async () => {
      if (!viva) return;
      try {
        const actual = await api.getConsentimiento('analisis_interno', session);
        if (viva) { setEstado(actual); setMensaje(null); }
      } catch { if (viva) setMensaje('por_ahora'); }
    });
    return () => { viva = false; };
  }, [session, consultas]);

  const sinAlta = soloRevocar || !capacidad?.enabled;
  async function cambiar(activar: boolean) {
    if (!estado || ocupado || activar === estado.granted || (activar && sinAlta)) return;
    setOcupado(true);
    try {
      const nuevo = activar
        ? await api.grantConsentimiento('analisis_interno', (await api.getPrivacyNotice()).legal_text, session)
        : await api.revokeConsentimiento('analisis_interno', session);
      setEstado(nuevo);
      setMensaje(null);
    } catch (e) {
      setMensaje(mensajeDeRechazo(e));
    } finally { setOcupado(false); }
  }

  return <div className="screen config-screen">
    {soloRevocar ? <header className="hdr"><button type="button" className="hdr-back" onClick={onBack}>{t('Volver')}</button></header>
      : <AppHeaderBack userName={fullName(session) ?? undefined} onBack={onBack} />}
    <div className="title-card"><FilaDeTitulo icono="engranaje"><h1 className="title-card-title">{t('Mis permisos')}</h1></FilaDeTitulo></div>
    <div className="scroll" style={{ padding: 16 }}>
      <section className="card config-card" aria-label={t('Mis permisos')}>
        {!foto.noSoportado && <FilaFotoView estado={foto.estado} onCambiar={foto.cambiar} onConsultar={foto.consultar} />}
        <FilaPermisoOpcionalView finalidad="analisis_interno" estado={estado} ocupado={ocupado} mensaje={mensaje}
          soloRevocar={sinAlta} onCambiar={activar => { void cambiar(activar); }} />
        {!estado && mensaje && <button className="btn btn-ghost" onClick={() => setConsultas(n => n + 1)}>{t('Consultar estado')}</button>}
      </section>
    </div>
  </div>;
}
