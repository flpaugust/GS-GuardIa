import {
  getFirebaseConfig,
  isValidFirebaseConfig,
  normalizeFirebaseConfig,
} from '../../config/env.js';
import { FirestoreRepository } from './FirestoreRepository.js';
import { LocalStorageRepository } from './LocalStorageRepository.js';

/**
 * Factory selecting FirestoreRepository when valid Firebase configuration is present
 * and reachable, transparently degrading to LocalStorageRepository otherwise.
 */
export class RepositoryFactory {
  /**
   * Validates whether a Firebase configuration object contains all required non-placeholder fields.
   * @param {unknown} firebaseConfig
   * @returns {boolean}
   */
  static isConfigValid(firebaseConfig) {
    return isValidFirebaseConfig(firebaseConfig);
  }

  /**
   * Creates and initializes the optimal AlertRepository for the runtime environment.
   * @param {object} [options={}]
   * @returns {Promise<FirestoreRepository | LocalStorageRepository>}
   */
  static async create({
    firebaseConfig = undefined,
    storage = null,
    firestoreOptions = {},
    localStorageOptions = {},
    onFallback = null,
    logger = console,
  } = {}) {
    const resolvedConfig =
      firebaseConfig !== undefined ? firebaseConfig : getFirebaseConfig(storage);

    if (!isValidFirebaseConfig(resolvedConfig)) {
      return new LocalStorageRepository({
        storage,
        logger,
        ...localStorageOptions,
      });
    }

    const normalizedConfig = normalizeFirebaseConfig(resolvedConfig);
    const firestoreRepo = new FirestoreRepository({
      firebaseConfig: normalizedConfig,
      logger,
      ...firestoreOptions,
    });

    try {
      await firestoreRepo.initialize();
      return firestoreRepo;
    } catch (error) {
      logger?.warn?.(
        '[RepositoryFactory] Firestore unavailable, degrading to LocalStorageRepository:',
        error?.message || error
      );
      if (typeof onFallback === 'function') {
        onFallback(error);
      }
      return new LocalStorageRepository({
        storage,
        logger,
        ...localStorageOptions,
      });
    }
  }
}

export async function createRepository(options = {}) {
  return RepositoryFactory.create(options);
}
