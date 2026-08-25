import type {
  ProfileAvatarMetadata,
  ProfileAvatarResponse,
  ProfileIdentityResponse,
  ProfileIdentityUser,
  User,
} from './types';
import type { StoredSession } from './storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAYME_ID = /^payme_[a-z]{2}_[a-z0-9]{4}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_AVATAR_SIDE = 512;
export const MAX_AVATAR_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_OUTPUT_BYTES = 256 * 1024;
export const PROFILE_AVATAR_MIME = 'image/jpeg';
export const PROFILE_AVATAR_INPUT_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function nonEmptyString(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function validProfileName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const length = [...value].length;
  return length >= 1 && length <= 100
    && !/\p{Cc}|\p{Cf}/u.test(value.replace(/[\u200C\u200D]/gu, ''));
}

function isoDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 24 || !ISO_UTC.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function decodeAvatarMetadata(value: unknown): ProfileAvatarMetadata | null | undefined {
  if (value === null) return null;
  if (!plainObject(value) || !exactKeys(value, ['revision', 'width', 'height', 'updated_at'])) {
    return undefined;
  }
  if (typeof value.revision !== 'string' || !UUID.test(value.revision)
      || !Number.isSafeInteger(value.width) || Number(value.width) < 1 || Number(value.width) > MAX_AVATAR_SIDE
      || !Number.isSafeInteger(value.height) || Number(value.height) < 1 || Number(value.height) > MAX_AVATAR_SIDE
      || !isoDateTime(value.updated_at)) {
    return undefined;
  }
  return {
    revision: value.revision.toLowerCase(),
    width: Number(value.width),
    height: Number(value.height),
    updated_at: value.updated_at,
  };
}

const USER_KEYS = [
  'id', 'payme_id', 'email', 'first_name', 'last_name', 'phone',
  'birth_date', 'created_at', 'birth_date_set', 'is_adult', 'avatar',
] as const;

function decodeUser(value: unknown): ProfileIdentityUser | null {
  if (!plainObject(value) || !exactKeys(value, USER_KEYS)) return null;
  const avatar = decodeAvatarMetadata(value.avatar);
  if (avatar === undefined
      || typeof value.id !== 'string' || !UUID.test(value.id)
      || typeof value.payme_id !== 'string' || !PAYME_ID.test(value.payme_id)
      || !nonEmptyString(value.email, 320)
      || !validProfileName(value.first_name)
      || !validProfileName(value.last_name)
      || !(value.phone === null || nonEmptyString(value.phone, 40))
      || !(value.birth_date === null || (typeof value.birth_date === 'string' && DATE.test(value.birth_date)))
      || !isoDateTime(value.created_at)
      || typeof value.birth_date_set !== 'boolean'
      || !(value.is_adult === null || typeof value.is_adult === 'boolean')) {
    return null;
  }
  if (value.birth_date_set !== (value.birth_date !== null)) return null;
  return {
    id: value.id.toLowerCase(),
    payme_id: value.payme_id,
    email: value.email,
    first_name: value.first_name,
    last_name: value.last_name,
    phone: value.phone,
    birth_date: value.birth_date,
    created_at: value.created_at,
    birth_date_set: value.birth_date_set,
    is_adult: value.is_adult,
    avatar,
  };
}

export function decodeProfileIdentityResponse(value: unknown): ProfileIdentityResponse {
  if (!plainObject(value) || !exactKeys(value, ['user'])) throw new Error('profile_identity_response_malformed');
  const user = decodeUser(value.user);
  if (!user) throw new Error('profile_identity_response_malformed');
  return { user };
}

export function decodeProfileAvatarResponse(value: unknown): ProfileAvatarResponse {
  if (!plainObject(value) || !exactKeys(value, ['avatar'])) throw new Error('profile_avatar_response_malformed');
  const avatar = decodeAvatarMetadata(value.avatar);
  if (!avatar) throw new Error('profile_avatar_response_malformed');
  return { avatar };
}

/** El backend normaliza definitivamente; esto sólo frena entradas imposibles. */
export function profileNameInput(value: string): string {
  const normalized = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const length = [...normalized].length;
  if (length < 1 || length > 100
      || /\p{Cc}|\p{Cf}/u.test(normalized.replace(/[\u200C\u200D]/gu, ''))) {
    throw new Error('profile_name_invalid');
  }
  return normalized;
}

export function validateAvatarInput(file: Blob): void {
  if (!PROFILE_AVATAR_INPUT_MIMES.includes(file.type as typeof PROFILE_AVATAR_INPUT_MIMES[number])) {
    throw new Error('avatar_media_type_unsupported');
  }
  if (file.size < 1) throw new Error('avatar_file_required');
  if (file.size > MAX_AVATAR_INPUT_BYTES) throw new Error('avatar_input_too_large');
}

export interface PrivateAvatarBlob {
  readonly blob: Blob;
}

/** Refresh de tokens es válido; cambio de familia/principal nunca lo es. */
export function currentSamePrincipalSession(
  origin: StoredSession,
  current: StoredSession | null,
): StoredSession | null {
  return current
    && current.family_id === origin.family_id
    && current.principal_id === origin.principal_id
    ? current
    : null;
}

/**
 * Minimiza la adopción de GET/PATCH privados: esta superficie sólo es dueña
 * de nombre y avatar. Email, payme_id y datos personales baseline permanecen
 * en la sesión corriente; nunca se amplía localStorage con el DTO privado.
 */
export function mergeProfileIdentityIntoCurrentUser(
  current: StoredSession,
  remote: ProfileIdentityUser,
): User | null {
  if (!current.user
      || current.principal_id !== remote.id
      || current.user.id !== remote.id) return null;
  return {
    ...current.user,
    first_name: remote.first_name,
    last_name: remote.last_name,
    avatar: remote.avatar,
  };
}

interface ProfileMutationAdoptionDependencies {
  readonly loadCurrent: () => StoredSession | null;
  readonly isCurrent: (session: StoredSession) => boolean;
  readonly adoptUser: (session: StoredSession, user: User) => boolean;
}

/**
 * Adopta una mutación con los tokens ACTUALES de la misma familia/principal.
 * El selector recibe esa sesión para que avatar PUT/DELETE no reconstruyan el
 * perfil desde un objeto capturado antes de un refresh.
 */
export function adoptProfileMutationUser(
  origin: StoredSession,
  selectUser: (current: StoredSession) => User | null,
  dependencies: ProfileMutationAdoptionDependencies,
): boolean {
  const current = currentSamePrincipalSession(origin, dependencies.loadCurrent());
  if (!current || !dependencies.isCurrent(current)) return false;
  const user = selectUser(current);
  return user ? dependencies.adoptUser(current, user) : false;
}

export function validatePrivateAvatarBlob(blob: Blob): PrivateAvatarBlob {
  if (blob.type.toLowerCase() !== PROFILE_AVATAR_MIME) throw new Error('avatar_response_media_type_invalid');
  if (blob.size < 1 || blob.size > MAX_AVATAR_OUTPUT_BYTES) throw new Error('avatar_response_size_invalid');
  return { blob };
}

/**
 * Dueño único de cada ObjectURL. Reemplazar y limpiar revocan primero la URL
 * anterior; `dispose` hace lo mismo al desmontar. Nunca persiste bytes ni URLs.
 */
export class AvatarObjectUrlLease {
  private current: string | null = null;

  constructor(
    private readonly create: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
    private readonly revoke: (url: string) => void = (url) => URL.revokeObjectURL(url),
  ) {}

  replace(blob: Blob): string {
    const next = this.create(blob);
    this.clear();
    this.current = next;
    return next;
  }

  clear(): void {
    if (!this.current) return;
    const previous = this.current;
    this.current = null;
    this.revoke(previous);
  }

  dispose(): void {
    this.clear();
  }
}
