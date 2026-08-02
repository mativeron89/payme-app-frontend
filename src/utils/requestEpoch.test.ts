import { describe, expect, it } from 'vitest';
import { RequestEpoch } from './requestEpoch';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('RequestEpoch', () => {
  it('una lectura guest A tardía no puede pintar B ni sus errores, locks o tarjetas', async () => {
    const gate = new RequestEpoch();
    const a = gate.next();
    const mesaA = deferred<'mesa-A'>();
    const cardsA = deferred<'cards-A'>();
    const errorA = deferred<'error-A'>();
    const lockA = deferred<'lock-A'>();
    const resultA = deferred<'result-A'>();
    const b = gate.next();
    const mesaB = deferred<'mesa-B'>();
    const rendered: string[] = [];
    const write = (epoch: number, value: string) => { if (gate.isCurrent(epoch)) rendered.push(value); };

    void mesaA.promise.then((value) => write(a, value));
    void cardsA.promise.then((value) => write(a, value));
    void errorA.promise.then((value) => write(a, value));
    void lockA.promise.then((value) => write(a, value));
    void resultA.promise.then((value) => write(a, value));
    void mesaB.promise.then((value) => write(b, value));
    mesaB.resolve('mesa-B');
    await Promise.resolve();
    mesaA.resolve('mesa-A');
    cardsA.resolve('cards-A');
    errorA.resolve('error-A');
    lockA.resolve('lock-A');
    resultA.resolve('result-A');
    await Promise.resolve();

    expect(rendered).toEqual(['mesa-B']);
  });

  it('invalidar antes de una respuesta diferida impide todo write', async () => {
    const gate = new RequestEpoch();
    const request = gate.next();
    const read = deferred<'not-found'>();
    const rendered: string[] = [];
    void read.promise.then((value) => { if (gate.isCurrent(request)) rendered.push(value); });
    gate.next();
    read.resolve('not-found');
    await Promise.resolve();
    expect(rendered).toEqual([]);
  });
});
