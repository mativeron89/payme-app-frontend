import { describe, expect, it } from 'vitest';
import { parseHash } from './router';

describe('parseHash', () => {
  it('degrada una URI mal codificada sin lanzar', () => {
    expect(parseHash('#/mesa/%E0%A4%A').page).toBe('home');
  });
});
