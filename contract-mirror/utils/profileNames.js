'use strict';

function profileNameError(code) {
  return Object.assign(new Error(code), { code, status: 400 });
}

function normalizarNombre(value) {
  if (typeof value !== 'string') throw profileNameError('profile_name_type');
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const length = [...normalized].length;
  if (length < 1 || length > 100) throw profileNameError('profile_name_length');
  // Cc no tiene lugar en un nombre. De Cf se bloquean únicamente invisibles
  // y controles bidi de suplantación; ZWJ/ZWNJ permanecen válidos para
  // escrituras que los necesitan.
  if (/\p{Cc}|[\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/u.test(normalized)) {
    throw profileNameError('profile_name_control_character');
  }
  return normalized;
}

module.exports = { normalizarNombre };
