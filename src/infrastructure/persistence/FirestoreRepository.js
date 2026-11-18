import { BIOMECHANICS_THRESHOLDS } from '../../config/thresholds.js';
import { DailyMetrics } from '../../domain/entities/DailyMetrics.js';
import { ALERT_STATUSES, MobilityAlert } from '../../domain/entities/MobilityAlert.js';
import { AlertRepository } from '../../domain/repositories/AlertRepository.js';

export const FIREBASE_APP_CDN = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
export const FIREBASE_FIRESTORE_CDN =
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
export const ALERTS_COLLECTION = 'alertas';
export const METRICS_COLLECTION = 'metricas_mobilidade';

const HISTORICAL_DAYS_COUNT = 7;
const ZERO = 0;
const ONE = 1;

function sortAlertsNewestFirst(alerts) {
  return [...alerts].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function sortMetricsAscending(metricsList) {
  return [...metricsList].sort((a, b) => String(a.data).localeCompare(String(b.data)));
}

function normalizeReturnIso(rawValue) {
  if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
    return rawValue.toISOString();
  }
  if (typeof rawValue === 'string' && rawValue.trim()) {
    const parsed = new Date(rawValue.trim());
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function extractSnapshotDocs(snapshot) {
  if (!snapshot) {
    return [];
  }
  if (Array.isArray(snapshot.docs)) {
    return snapshot.docs;
  }
  const docs = [];
  if (typeof snapshot.forEach === 'function') {
    snapshot.forEach((docSnap) => docs.push(docSnap));
  }
  return docs;
}

/**
 * Cloud Firestore repository implementing AlertRepository with lazy modular CDN loading,
 * composite-index-free queries, and strict isolation of `serverTimestamp()` sentinels
 * from domain entity constructors.
 */
export class FirestoreRepository extends AlertRepository {
  /**
   * @param {object} [options={}]
   */
  constructor({
    firebaseConfig = null,
    patientId = BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID,
    sdk = null,
    sdkLoader = null,
    logger = console,
  } = {}) {
    super();
    this._firebaseConfig = firebaseConfig;
    this._patientId = patientId;
    this._injectedSdk = sdk;
    this._sdkLoader = typeof sdkLoader === 'function' ? sdkLoader : null;
    this._logger = logger;

    this._appSdk = null;
    this._firestoreSdk = null;
    this._db = null;
    this._initPromise = null;
    this._reads = ZERO;
    this._writes = ZERO;
  }

  async _loadSdkModules() {
    if (this._injectedSdk?.appSdk && this._injectedSdk?.firestoreSdk) {
      return this._injectedSdk;
    }
    if (this._sdkLoader) {
      return this._sdkLoader();
    }
    const [appSdk, firestoreSdk] = await Promise.all([
      import(FIREBASE_APP_CDN),
      import(FIREBASE_FIRESTORE_CDN),
    ]);
    return { appSdk, firestoreSdk };
  }

  /**
   * Lazily initializes Firebase App + Firestore once per instance.
   * @returns {Promise<{ db: object, firestoreSdk: object }>}
   */
  async initialize() {
    if (this._db && this._firestoreSdk) {
      return { db: this._db, firestoreSdk: this._firestoreSdk };
    }
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = (async () => {
      if (!this._firebaseConfig || typeof this._firebaseConfig !== 'object') {
        throw new Error('FirestoreRepository requires a valid firebaseConfig');
      }
      const { appSdk, firestoreSdk } = await this._loadSdkModules();
      if (!appSdk || !firestoreSdk) {
        throw new Error('Failed to resolve Firebase app/firestore SDK modules');
      }

      const appName = `guardiao_${this._firebaseConfig.projectId || 'default'}`;
      const existingApps = typeof appSdk.getApps === 'function' ? appSdk.getApps() : [];
      const app =
        existingApps.find((entry) => entry?.name === appName) ||
        appSdk.initializeApp(this._firebaseConfig, appName);

      this._appSdk = appSdk;
      this._firestoreSdk = firestoreSdk;
      this._db = firestoreSdk.getFirestore(app);
      return { db: this._db, firestoreSdk: this._firestoreSdk };
    })().catch((error) => {
      this._initPromise = null;
      throw error;
    });

    return this._initPromise;
  }

  /**
   * @param {MobilityAlert | object} alert
   * @returns {Promise<MobilityAlert>}
   */
  async saveAlert(alert) {
    const { db, firestoreSdk } = await this.initialize();
    const entity = alert instanceof MobilityAlert ? alert : new MobilityAlert(alert);
    const baseData = entity.toJSON();
    const writePayload = {
      ...baseData,
      timestamp: firestoreSdk.serverTimestamp(),
    };

    let savedId = entity.id;
    if (savedId) {
      const ref = firestoreSdk.doc(db, ALERTS_COLLECTION, savedId);
      await firestoreSdk.setDoc(ref, writePayload);
    } else {
      delete writePayload.id;
      const colRef = firestoreSdk.collection(db, ALERTS_COLLECTION);
      const docRef = await firestoreSdk.addDoc(colRef, writePayload);
      savedId = docRef.id;
    }

    this._writes += ONE;
    return new MobilityAlert({ ...baseData, id: savedId });
  }

  /**
   * @param {string} alertId
   * @param {string} status
   * @param {string|Date} [atendidoEm]
   * @returns {Promise<{ id: string, status_atendimento: string, atendido_em: string|null }>}
   */
  async updateAlertStatus(alertId, status, atendidoEm = new Date().toISOString()) {
    const allowedStatuses = Object.values(ALERT_STATUSES);
    if (!allowedStatuses.includes(status)) {
      throw new Error(`Invalid alert status_atendimento: ${String(status)}`);
    }
    const targetId = String(alertId ?? '').trim();
    if (!targetId) {
      throw new Error('updateAlertStatus requires a non-empty alertId');
    }

    const { db, firestoreSdk } = await this.initialize();
    const resolvedAtendidoEm =
      status === ALERT_STATUSES.PENDENTE ? null : normalizeReturnIso(atendidoEm);

    const ref = firestoreSdk.doc(db, ALERTS_COLLECTION, targetId);
    await firestoreSdk.updateDoc(ref, {
      status_atendimento: status,
      atendido_em:
        status === ALERT_STATUSES.PENDENTE ? null : firestoreSdk.serverTimestamp(),
    });

    this._writes += ONE;
    return {
      id: targetId,
      status_atendimento: status,
      atendido_em: resolvedAtendidoEm,
    };
  }

  /**
   * @param {(alerts: Array<MobilityAlert>) => void} callback
   * @param {string} [idosoId]
   * @returns {() => void}
   */
  subscribeToAlerts(callback, idosoId = BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID) {
    if (typeof callback !== 'function') {
      throw new TypeError('subscribeToAlerts requires a callback function');
    }

    const subscription = { cancelled: false, sdkUnsubscribe: null };

    void this.initialize()
      .then(({ db, firestoreSdk }) => {
        if (subscription.cancelled) {
          return;
        }
        const alertsQuery = firestoreSdk.query(
          firestoreSdk.collection(db, ALERTS_COLLECTION),
          firestoreSdk.where('idoso_id', '==', idosoId)
        );
        subscription.sdkUnsubscribe = firestoreSdk.onSnapshot(
          alertsQuery,
          (snapshot) => {
            if (subscription.cancelled) {
              return;
            }
            const docs = extractSnapshotDocs(snapshot);
            this._reads += Math.max(ONE, docs.length);
            const alerts = [];
            for (const docSnap of docs) {
              try {
                const raw = typeof docSnap.data === 'function' ? docSnap.data() : {};
                alerts.push(new MobilityAlert({ ...raw, id: docSnap.id }));
              } catch (error) {
                this._logger?.warn?.('[FirestoreRepository] Skipping invalid alert doc:', error?.message || error);
              }
            }
            callback(sortAlertsNewestFirst(alerts));
          },
          (error) => {
            this._logger?.error?.('[FirestoreRepository] Alerts snapshot listener error:', error);
          }
        );
      })
      .catch((error) => {
        this._logger?.error?.('[FirestoreRepository] Failed to subscribe to alerts:', error);
      });

    return () => {
      subscription.cancelled = true;
      if (typeof subscription.sdkUnsubscribe === 'function') {
        subscription.sdkUnsubscribe();
      }
    };
  }

  /**
   * @param {DailyMetrics | object} metrics
   * @returns {Promise<DailyMetrics>}
   */
  async upsertDailyMetrics(metrics) {
    const { db, firestoreSdk } = await this.initialize();
    const entity = metrics instanceof DailyMetrics ? metrics : new DailyMetrics(metrics);
    const docId = entity.id || `${entity.idoso_id}_${entity.data}`;
    const baseData = { ...entity.toJSON(), id: docId };

    const writePayload = {
      ...baseData,
      atualizado_em: firestoreSdk.serverTimestamp(),
    };

    const ref = firestoreSdk.doc(db, METRICS_COLLECTION, docId);
    await firestoreSdk.setDoc(ref, writePayload, { merge: true });
    this._writes += ONE;
    return new DailyMetrics(baseData);
  }

  /**
   * @param {(metricsList: Array<DailyMetrics>) => void} callback
   * @param {string} [idosoId]
   * @returns {() => void}
   */
  subscribeToDailyMetrics(callback, idosoId = BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID) {
    if (typeof callback !== 'function') {
      throw new TypeError('subscribeToDailyMetrics requires a callback function');
    }

    const subscription = { cancelled: false, sdkUnsubscribe: null };

    void this.initialize()
      .then(({ db, firestoreSdk }) => {
        if (subscription.cancelled) {
          return;
        }
        const metricsQuery = firestoreSdk.query(
          firestoreSdk.collection(db, METRICS_COLLECTION),
          firestoreSdk.where('idoso_id', '==', idosoId)
        );
        subscription.sdkUnsubscribe = firestoreSdk.onSnapshot(
          metricsQuery,
          (snapshot) => {
            if (subscription.cancelled) {
              return;
            }
            const docs = extractSnapshotDocs(snapshot);
            this._reads += Math.max(ONE, docs.length);
            const metricsList = [];
            for (const docSnap of docs) {
              try {
                const raw = typeof docSnap.data === 'function' ? docSnap.data() : {};
                metricsList.push(new DailyMetrics({ ...raw, id: docSnap.id }));
              } catch (error) {
                this._logger?.warn?.('[FirestoreRepository] Skipping invalid metrics doc:', error?.message || error);
              }
            }
            callback(sortMetricsAscending(metricsList).slice(-HISTORICAL_DAYS_COUNT));
          },
          (error) => {
            this._logger?.error?.('[FirestoreRepository] Metrics snapshot listener error:', error);
          }
        );
      })
      .catch((error) => {
        this._logger?.error?.('[FirestoreRepository] Failed to subscribe to daily metrics:', error);
      });

    return () => {
      subscription.cancelled = true;
      if (typeof subscription.sdkUnsubscribe === 'function') {
        subscription.sdkUnsubscribe();
      }
    };
  }

  getCloudOpsStats() {
    return {
      mode: 'FIRESTORE',
      reads: this._reads,
      writes: this._writes,
      total: this._reads + this._writes,
    };
  }
}
