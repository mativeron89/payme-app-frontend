import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ejemploLocal } from './ejemplo/estadoEjemplo';
import { PLATOS_DE_EJEMPLO } from './ejemplo/fixtureEjemplo';
import { TarjetaMesaDeEjemplo, TarjetaTutorial } from './TarjetaTutorial';

const guia = vi.hoisted(() => ({
  valor: null as null | { noVolverAMostrar: boolean | null; tarjetaOculta: boolean | null; abrir: () => void; ocultarTarjeta: () => void; terminar: () => void },
  enFechasDeViaje: false as boolean | null,
}));
vi.mock('./GuiaProvider', () => ({ useGuia: () => guia.valor }));
vi.mock('./inicioGuia', async (original) => ({
  ...(await original<typeof import('./inicioGuia')>()),
  useEnFechasDeViaje: () => guia.enFechasDeViaje,
}));

beforeEach(() => {
  guia.valor = { noVolverAMostrar: false, tarjetaOculta: false, abrir: vi.fn(), ocultarTarjeta: vi.fn(), terminar: vi.fn() };
  guia.enFechasDeViaje = false;
});
afterEach(() => ejemploLocal.descartar());

describe('D363 · 2f · la tarjeta Tutorial', () => {
  it('con todo sabido y en «no», se ve: abrir y quitar son dos botones hermanos', () => {
    const html = renderToStaticMarkup(<TarjetaTutorial aperturaPendiente={false} />);
    expect(html).toContain('data-guia="tarjeta-tutorial"');
    expect(html).toContain('>Tutorial<');
    expect(html).toContain('aria-label="Quitar el tutorial de Inicio"');
    expect(html.match(/<button/g)).toHaveLength(2);
    // Hermanos: el primero cierra antes de que abra el segundo.
    expect(html.indexOf('</button>')).toBeLessThan(html.lastIndexOf('<button'));
  });

  it('no se ve sin la guía, con una apertura pendiente o sin saberlo, en fechas de viaje, oculta o con el opt-out', () => {
    expect(renderToStaticMarkup(<TarjetaTutorial aperturaPendiente />)).toBe('');
    expect(renderToStaticMarkup(<TarjetaTutorial aperturaPendiente={null} />)).toBe('');
    guia.enFechasDeViaje = true;
    expect(renderToStaticMarkup(<TarjetaTutorial aperturaPendiente={false} />)).toBe('');
    guia.enFechasDeViaje = false;
    guia.valor = { ...guia.valor!, tarjetaOculta: true };
    expect(renderToStaticMarkup(<TarjetaTutorial aperturaPendiente={false} />)).toBe('');
    guia.valor = { ...guia.valor, tarjetaOculta: false, noVolverAMostrar: true };
    expect(renderToStaticMarkup(<TarjetaTutorial aperturaPendiente={false} />)).toBe('');
    guia.valor = null;
    expect(renderToStaticMarkup(<TarjetaTutorial aperturaPendiente={false} />)).toBe('');
  });

  it('4a · con la mesa de ejemplo en Inicio, la tarjeta le deja el lugar', () => {
    ejemploLocal.empezar();
    ejemploLocal.armarMesa('consumo', 1, 0);
    expect(renderToStaticMarkup(<TarjetaTutorial aperturaPendiente={false} />)).not.toBe('');
    ejemploLocal.irA('listo');
    expect(renderToStaticMarkup(<TarjetaTutorial aperturaPendiente={false} />)).toBe('');
  });
});

describe('D363 · 4a · la tarjeta de la mesa de ejemplo', () => {
  it('sólo después del «Listo»: antes no hay nada en Inicio', () => {
    expect(renderToStaticMarkup(<TarjetaMesaDeEjemplo />)).toBe('');
    ejemploLocal.empezar();
    ejemploLocal.armarMesa('consumo', 1, 0);
    expect(renderToStaticMarkup(<TarjetaMesaDeEjemplo />)).toBe('');
    ejemploLocal.irA('listo');
    expect(renderToStaticMarkup(<TarjetaMesaDeEjemplo />)).not.toBe('');
  });

  it('la ficha: con el Tagliatelle elegido, $195 de $600, la píldora «Ejemplo» y «Mesa PA-1224 · 1 persona»', () => {
    ejemploLocal.empezar();
    ejemploLocal.armarMesa('consumo', 1, 0);
    ejemploLocal.elegir(new Map([[PLATOS_DE_EJEMPLO[0]!.id, 10000]]), 1);
    ejemploLocal.irA('listo');
    const html = renderToStaticMarkup(<TarjetaMesaDeEjemplo />);
    expect(html).toContain('data-guia="mesa-ejemplo"');
    expect(html).toContain('>Restaurante Ejemplo<');
    expect(html).toContain('>Mesa PA-1224 · 1 persona<');
    expect(html).toContain('class="badge badge-ejemplo">Ejemplo<');
    expect(html).toMatch(/class="mesa-paid">\$195(\.00)?</);
    expect(html).toMatch(/class="mesa-total">de \$600(\.00)?</);
    expect(html).toContain('width:33%');
    expect(html).toContain('Ver mesa →');
  });

  it('en «igual», lo elegido sale de la selección informativa', () => {
    ejemploLocal.empezar();
    ejemploLocal.armarMesa('igual', 2, 0);
    ejemploLocal.elegir(new Map([[PLATOS_DE_EJEMPLO[1]!.id, 5000]]), 1);
    ejemploLocal.irA('listo');
    expect(renderToStaticMarkup(<TarjetaMesaDeEjemplo />)).toMatch(/class="mesa-paid">\$110(\.00)?</);
  });
});

describe('D363 · el cableado en Inicio', () => {
  const inicio = readFileSync(new URL('../screens/HomeScreen.tsx', import.meta.url), 'utf8');
  it('Q5 · la tarjeta va debajo de la invitación pendiente, y la mesa de ejemplo en su lugar', () => {
    const invitacion = inicio.indexOf('<InvitacionEnInicio />');
    const tarjeta = inicio.indexOf('<TarjetaTutorial aperturaPendiente={aperturaPendiente} />');
    const ejemplo = inicio.indexOf('<TarjetaMesaDeEjemplo />');
    expect(invitacion).toBeGreaterThan(-1);
    expect(tarjeta).toBeGreaterThan(invitacion);
    expect(ejemplo).toBeGreaterThan(tarjeta);
    expect(ejemplo).toBeLessThan(inicio.indexOf('<FriendAvatarNotice />'));
  });
  it('enmienda 2 · con la mesa de ejemplo en Inicio no se dice «No tienes mesas abiertas»', () => {
    expect(inicio).toContain('const ejemploEnInicio = mesaDeEjemploEnInicio(useEjemplo());');
    expect(inicio).toMatch(/const avisoSinMesas = [^;]*&& !ejemploEnInicio;/);
  });
});
