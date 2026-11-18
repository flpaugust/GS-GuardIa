import { BIOMECHANICS_THRESHOLDS } from './thresholds.js';

export const ENV_STORAGE_KEY = 'guardiao_env_config';
const SERVER_ENV_ENDPOINT = '/api/env';

let _runtimeEnvDefaults = null;

// Minimum fields required to attempt a Firestore connection. authDomain/appId are
// optional for Firestore-only usage and are normalized to '' when absent.
const REQUIRED_FIREBASE_FIELDS = Object.freeze([
  'apiKey',
  'projectId',
]);

const ALL_FIREBASE_FIELDS = Object.freeze([
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
]);

function isPlaceholderValue(value) {
  const upper = value.toUpperCase();
  return (
    upper.startsWith('YOUR_') ||
    upper.startsWith('SUA_') ||
    upper.startsWith('SEU_') ||
    upper.includes('REPLACE_ME')
  );
}

function getSafeStorage(storageOverride = null) {
  if (storageOverride) {
    return storageOverride;
  }
  try {
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.localStorage &&
      typeof globalThis.localStorage.getItem === 'function' &&
      typeof globalThis.localStorage.setItem === 'function' &&
      typeof globalThis.localStorage.removeItem === 'function'
    ) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Normalizes a Firebase config object or JSON string. Returns null if not an object/JSON object.
 * @param {unknown} rawConfig
 * @returns {Record<string, string>|null}
 */
export function normalizeFirebaseConfig(rawConfig) {
  let parsed = rawConfig;
  if (typeof rawConfig === 'string') {
    const trimmed = rawConfig.trim();
    if (!trimmed) {
      return null;
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const normalized = {};
  for (const field of ALL_FIREBASE_FIELDS) {
    const rawVal = parsed[field];
    normalized[field] = typeof rawVal === 'string' ? rawVal.trim() : '';
  }
  return normalized;
}

/**
 * Checks whether a firebaseConfig contains all required non-placeholder fields.
 * @param {unknown} rawConfig
 * @returns {boolean}
 */
export function isValidFirebaseConfig(rawConfig) {
  const normalized = normalizeFirebaseConfig(rawConfig);
  if (!normalized) {
    return false;
  }
  return REQUIRED_FIREBASE_FIELDS.every((field) => {
    const value = normalized[field];
    return typeof value === 'string' && value.length > 0 && !isPlaceholderValue(value);
  });
}

/**
 * Normalizes a Gemini API key string.
 * @param {unknown} rawKey
 * @returns {string}
 */
export function normalizeGeminiApiKey(rawKey) {
  if (typeof rawKey !== 'string') {
    return '';
  }
  const trimmed = rawKey.trim();
  if (!trimmed || isPlaceholderValue(trimmed)) {
    return '';
  }
  return trimmed;
}

export function createDefaultEnvConfig() {
  return {
    firebaseConfig: null,
    geminiApiKey: '',
    patientId: BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID,
  };
}

/**
 * Sets in-memory runtime defaults loaded from the local server's `.env` endpoint.
 * @param {unknown} rawEnv
 * @returns {{ firebaseConfig: Record<string, string>|null, geminiApiKey: string, patientId: string }}
 */
export function setRuntimeEnvDefaults(rawEnv) {
  if (!rawEnv || typeof rawEnv !== 'object' || Array.isArray(rawEnv)) {
    _runtimeEnvDefaults = null;
    return createDefaultEnvConfig();
  }

  const firebaseConfig = isValidFirebaseConfig(rawEnv.firebaseConfig)
    ? normalizeFirebaseConfig(rawEnv.firebaseConfig)
    : null;
  const geminiApiKey = normalizeGeminiApiKey(rawEnv.geminiApiKey);
  const patientId =
    typeof rawEnv.patientId === 'string' && rawEnv.patientId.trim()
      ? rawEnv.patientId.trim()
      : BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID;

  _runtimeEnvDefaults = { firebaseConfig, geminiApiKey, patientId };
  return { ..._runtimeEnvDefaults };
}

/**
 * Fetches runtime defaults from `/api/env` (backed by gitignored `.env` in `server.js`).
 * Gracefully degrades to `createDefaultEnvConfig()` when offline or running in Node.js.
 * @param {typeof fetch|null} [fetchFn]
 * @returns {Promise<{ firebaseConfig: Record<string, string>|null, geminiApiKey: string, patientId: string }>}
 */
export async function loadServerEnvConfig(
  fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null
) {
  if (typeof fetchFn !== 'function' || typeof globalThis.window === 'undefined') {
    return createDefaultEnvConfig();
  }
  try {
    const response = await fetchFn(SERVER_ENV_ENDPOINT, { cache: 'no-store' });
    if (!response || !response.ok) {
      return createDefaultEnvConfig();
    }
    const payload = await response.json();
    return setRuntimeEnvDefaults(payload);
  } catch {
    return createDefaultEnvConfig();
  }
}

/**
 * Reads persisted environment config from localStorage, falling back to runtime
 * `.env` defaults loaded from `/api/env`.
 * Gracefully returns safe empty/null defaults in Node.js or on corrupt storage.
 * @param {Storage|null} [storageOverride]
 * @returns {{ firebaseConfig: Record<string, string>|null, geminiApiKey: string, patientId: string }}
 */
export function loadEnvConfig(storageOverride = null) {
  const defaults =
    !storageOverride && _runtimeEnvDefaults
      ? { ..._runtimeEnvDefaults }
      : createDefaultEnvConfig();
  const storage = getSafeStorage(storageOverride);
  if (!storage) {
    return defaults;
  }

  try {
    const raw = storage.getItem(ENV_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return defaults;
    }

    let firebaseConfig = defaults.firebaseConfig;
    if ('firebaseConfig' in parsed) {
      if (parsed.firebaseConfig === null || parsed.firebaseConfig === '') {
        firebaseConfig = null;
      } else if (isValidFirebaseConfig(parsed.firebaseConfig)) {
        firebaseConfig = normalizeFirebaseConfig(parsed.firebaseConfig);
      }
    }

    const geminiApiKey =
      'geminiApiKey' in parsed
        ? normalizeGeminiApiKey(parsed.geminiApiKey)
        : defaults.geminiApiKey;
    const patientId =
      typeof parsed.patientId === 'string' && parsed.patientId.trim()
        ? parsed.patientId.trim()
        : defaults.patientId;

    return { firebaseConfig, geminiApiKey, patientId };
  } catch {
    return defaults;
  }
}

/**
 * Validates and persists environment config to localStorage.
 * Gracefully returns { persisted: false, ... } in Node.js without throwing.
 * @param {{ firebaseConfig?: unknown, geminiApiKey?: unknown, patientId?: unknown }} input
 * @param {Storage|null} [storageOverride]
 */
export function saveEnvConfig(input = {}, storageOverride = null) {
  const current = loadEnvConfig(storageOverride);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      persisted: false,
      error: 'Invalid configuration input object.',
      config: current,
    };
  }

  let nextFirebaseConfig = current.firebaseConfig;
  if ('firebaseConfig' in input) {
    if (input.firebaseConfig === null || input.firebaseConfig === '') {
      nextFirebaseConfig = null;
    } else if (isValidFirebaseConfig(input.firebaseConfig)) {
      nextFirebaseConfig = normalizeFirebaseConfig(input.firebaseConfig);
    } else {
      return {
        ok: false,
        persisted: false,
        error: 'Invalid firebaseConfig: apiKey and projectId are required.',
        config: current,
      };
    }
  }

  const nextGeminiApiKey =
    'geminiApiKey' in input
      ? normalizeGeminiApiKey(input.geminiApiKey)
      : current.geminiApiKey;

  const nextPatientId =
    typeof input.patientId === 'string' && input.patientId.trim()
      ? input.patientId.trim()
      : current.patientId;

  const nextConfig = {
    firebaseConfig: nextFirebaseConfig,
    geminiApiKey: nextGeminiApiKey,
    patientId: nextPatientId,
  };

  const storage = getSafeStorage(storageOverride);
  if (!storage) {
    return {
      ok: true,
      persisted: false,
      config: nextConfig,
    };
  }

  try {
    storage.setItem(ENV_STORAGE_KEY, JSON.stringify(nextConfig));
    return {
      ok: true,
      persisted: true,
      config: nextConfig,
    };
  } catch (error) {
    return {
      ok: false,
      persisted: false,
      error: error?.message || 'Failed to persist configuration to localStorage.',
      config: nextConfig,
    };
  }
}

/**
 * Clears stored credentials from localStorage without throwing in Node.js.
 * @param {Storage|null} [storageOverride]
 * @returns {{ ok: boolean, cleared: boolean, config: { firebaseConfig: null, geminiApiKey: string, patientId: string } }}
 */
export function clearEnvConfig(storageOverride = null) {
  if (!storageOverride) {
    _runtimeEnvDefaults = null;
  }
  const defaults = createDefaultEnvConfig();
  const storage = getSafeStorage(storageOverride);
  if (!storage) {
    return { ok: true, cleared: false, config: defaults };
  }

  try {
    storage.removeItem(ENV_STORAGE_KEY);
    return { ok: true, cleared: true, config: defaults };
  } catch {
    return { ok: false, cleared: false, config: defaults };
  }
}

export function getFirebaseConfig(storageOverride = null) {
  return loadEnvConfig(storageOverride).firebaseConfig;
}

export function getGeminiApiKey(storageOverride = null) {
  return loadEnvConfig(storageOverride).geminiApiKey;
}
