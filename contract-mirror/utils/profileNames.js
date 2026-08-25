'use strict';

function profileNameError(code) {
  return Object.assign(new Error(code), { code, status: 400 });
}

function normalizarNombre(value) {
  if (typeof value !== 'string') throw profileNameError('profile_name_type');
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const length = [...normalized].length;
  if (length < 1 || length > 100) throw profileNameError('profile_name_length');
  // Cc no tiene lugar en un nombre. De Cf se permiten únicamente ZWNJ/ZWJ,
  // necesarios en algunas escrituras; el resto incluye invisibles y controles
  // bidi capaces de hacer que el texto renderizado difiera del almacenado.
  const controlCandidate = normalized.replace(/[\u200C\u200D]/gu, '');
  if (/\p{Cc}|\p{Cf}/u.test(controlCandidate)) {
    throw profileNameError('profile_name_control_character');
  }
  return normalized;
}

module.exports = { normalizarNombre };
