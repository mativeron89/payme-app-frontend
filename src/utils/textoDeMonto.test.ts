import { expect, it } from 'vitest';
import { textoDeMonto } from './textoDeMonto';

it('permite borrar el último dígito', () => {
  expect(textoDeMonto('', '5')).toBe('');
});
