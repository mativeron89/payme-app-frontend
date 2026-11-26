import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../src/api';
import { saveSession } from '../../src/api/storage';
import { ultimoVisto } from '../../src/api/ultimoVisto';
import type { DetalleViaje } from '../../src/api/viajes';
import type { PendingInvitationsResponse } from '../../src/api/types';
import { useDetalleViaje } from '../../src/screens/viajes/ViajeScreen';
import { useInvitacionesDeInicio } from '../../src/screens/InvitacionEnInicio';

function lecturas<T>() {
  const pendientes: { resolver: (dato: T) => void; rechazar: (error: Error) => void }[] = [];
  const pedir = () => new Promise<T>((resolver, rechazar) => pendientes.push({ resolver, rechazar }));
  return { pedir, pendientes };
}

const viajes = lecturas<DetalleViaje>();
const invitaciones = lecturas<PendingInvitationsResponse>();
api.getViaje = viajes.pedir;
api.getPendingInvitations = invitaciones.pedir;
const sesionInicial = { principal_id: 'persona-ficticia', family_id: 'familia-ficticia', access_token: 'fake-a', refresh_token: 'fake-r' };
saveSession(sesionInicial);

function viaje(nombre: string, estado: DetalleViaje['estado'] = 'abierto'): DetalleViaje {
  return { id: 'viaje-ficticio', nombre, estado, fecha_desde: null, fecha_hasta: null, creado_en: null,
    mi_miembro_id: 'miembro', miembros: [], invitados: [], mi_balance_cents: 0, gasto_del_grupo_cents: 0,
    tickets: [], sin_repartir: [], transferencias: [], transferencias_pendientes: 0, color: null, has_photo: false,
    hora_cierre: '23:59', puedo_cerrar: false, se_cierra_en: null, notas: { escribieron: 0, total: 0, nuevo: false } };
}

function Viaje() {
  const { carga, cargar, mostrar, noDisponible } = useDetalleViaje('viaje-ficticio');
  return <>
    <output>{carga.tipo === 'listo' ? carga.viaje.nombre : carga.tipo}</output>
    <button onClick={cargar}>Releer</button>
    <button onClick={() => mostrar(viaje('Editado'))}>Mostrar edición</button>
    <button onClick={noDisponible}>Marcar ausente</button>
  </>;
}

function Inicio() {
  const [sesion, setSesion] = useState(sesionInicial);
  function cambiarSesion() {
    const siguiente = { principal_id: 'otra-persona-ficticia', family_id: 'otra-familia-ficticia', access_token: 'fake-b', refresh_token: 'fake-s' };
    saveSession(siguiente);
    setSesion(siguiente);
  }
  const [sinLeer, contador] = useState(0);
  const { estado, lista, cargar } = useInvitacionesDeInicio(sesion, sinLeer);
  return <>
    <output>{[estado, ...lista.map(i => i.id)].join(' ')}</output>
    <button onClick={cargar}>Releer</button>
    <button onClick={cambiarSesion}>Cambiar sesión</button>
    <button onClick={() => contador(n => n + 1)}>Sumar aviso</button>
  </>;
}

const esViaje = location.search === '?viaje';
const raiz = createRoot(document.querySelector('#fixture')!);
raiz.render(esViaje ? <Viaje /> : <Inicio />);
export const control = {
  cantidad: () => (esViaje ? viajes : invitaciones).pendientes.length,
  desmontar: () => raiz.unmount(),
  cache: () => ultimoVisto.leer<{ id: string }[]>('inicio.invitaciones')?.map(i => i.id),
  responder(indice: number, resultado: 'correcta' | 'error' | 'cerrado') {
    if (resultado === 'error') {
      (esViaje ? viajes : invitaciones).pendientes[indice].rechazar(new Error('Lectura ficticia fallida'));
    } else if (esViaje) {
      viajes.pendientes[indice].resolver(viaje('Viaje ' + indice, resultado === 'cerrado' ? 'cerrado' : 'abierto'));
    } else {
      invitaciones.pendientes[indice].resolver({ invitations: [{ id: 'inv-' + indice, mesa_id: 'mesa',
        invitation_type: 'in_app', status: 'pending', expires_at: '', created_at: '', mesa_code: 'PA-12345',
        restaurant_name: 'Local ficticio', inviter_first_name: '', inviter_last_name: '', inviter_payme_id: '',
        mesa_joinable: true, mesa_status: 'open' }] });
    }
  },
};
