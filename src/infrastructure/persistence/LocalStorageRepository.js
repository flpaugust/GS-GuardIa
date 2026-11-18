import { BIOMECHANICS_THRESHOLDS } from '../../config/thresholds.js';
import { DailyMetrics } from '../../domain/entities/DailyMetrics.js';
import { MobilityAlert } from '../../domain/entities/MobilityAlert.js';
import { AlertRepository } from '../../domain/repositories/AlertRepository.js';

export const ALERTS_STORAGE_KEY = 'guardiao_alertas';
export const METRICS_STORAGE_KEY = 'guardiao_metricas_mobilidade';
export const SYNC_CHANNEL_NAME = 'guardiao_sync_channel';

const REPO_SYNC_SOURCE = 'guardiao_local_repo';
const SYNC_EVENT_ALERTS = 'ALERTS_UPDATED';
const SYNC_EVENT_METRICS = 'METRICS_UPDATED';
const HISTORICAL_DAYS_COUNT = 7;
const MS_PER_DAY = 86400000;
const ISO_DATE_LENGTH = 10;
const ZERO = 0;

const DEFAULT_WEEKLY_SEED_PROFILE = Object.freeze([
  { tempo_ativo_min: 175, tempo_sentado_min: 330, qtd_desequilibrios: 1, qtd_quedas: 0, velocidade_marcha_media: 1.02 },
  { tempo_ativo_min: 162, tempo_sentado_min: 345, qtd_desequilibrios: 1, qtd_quedas: 0, velocidade_marcha_media: 0.98 },
  { tempo_ativo_min: 155, tempo_sentado_min: 360, qtd_desequilibrios: 2, qtd_quedas: 0, velocidade_marcha_media: 0.95 },
  { tempo_ativo_min: 148, tempo_sentado_min: 375, qtd_desequilibrios: 2, qtd_quedas: 0, velocidade_marcha_media: 0.91 },
  { tempo_ativo_min: 140, tempo_sentado_min: 385, qtd_desequilibrios: 3, qtd_quedas: 0, velocidade_marcha_media: 0.88 },
  { tempo_ativo_min: 132, tempo_sentado_min: 395, qtd_desequilibrios: 2, qtd_quedas: 0, velocidade_marcha_media: 0.86 },
  { tempo_ativo_min: 126, tempo_sentado_min: 410, qtd_desequilibrios: 3, qtd_quedas: 0, velocidade_marcha_media: 0.83 },
]);

function createMemoryStorageFallback() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function resolveSafeStorage(storageOverride) {
  if (
    storageOverride &&
    typeof storageOverride.getItem === 'function' &&
    typeof storageOverride.setItem === 'function'
  ) {
    return storageOverride;
  }
  try {
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.localStorage &&
      typeof globalThis.localStorage.getItem === 'function' &&
      typeof globalThis.localStorage.setItem === 'function'
    ) {
      return globalThis.localStorage;
    }
  } catch {
    return createMemoryStorageFallback();
  }
  return createMemoryStorageFallback();
}

function createInstanceId() {
  return `repo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sortAlertsNewestFirst(alerts) {
  return [...alerts].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

function sortMetricsAscending(metricsList) {
  return [...metricsList].sort((a, b) => String(a.data).localeCompare(String(b.data)));
}

function buildSeededWeeklyMetrics(patientId, nowDate) {
  const baseTimeMs = nowDate.getTime();
  return DEFAULT_WEEKLY_SEED_PROFILE.map((entry, idx) => {
    const daysAgo = HISTORICAL_DAYS_COUNT - 1 - idx;
    const dayDate = new Date(baseTimeMs - daysAgo * MS_PER_DAY);
    const isoDate = dayDate.toISOString().slice(ZERO, ISO_DATE_LENGTH);
    return new DailyMetrics({
      id: `${patientId}_${isoDate}`,
      idoso_id: patientId,
      data: isoDate,
      tempo_ativo_min: entry.tempo_ativo_min,
      tempo_sentado_min: entry.tempo_sentado_min,
      qtd_desequilibrios: entry.qtd_desequilibrios,
      qtd_quedas: entry.qtd_quedas,
      velocidade_marcha_media: entry.velocidade_marcha_media,
      atualizado_em: dayDate.toISOString(),
    });
  });
}

/**
 * LocalStorage persistence adapter implementing AlertRepository with automatic
 * 7-day historical seed, QuotaExceededError resilience, and BroadcastChannel sync.
 */
export class LocalStorageRepository extends AlertRepository {
  /**
   * @param {object} [options={}]
   */
  constructor({
    storage = null,
    broadcastChannelFactory = null,
    channelName = SYNC_CHANNEL_NAME,
    patientId = BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID,
    seedIfEmpty = true,
    nowProvider = () => new Date(),
    logger = console,
  } = {}) {
    super();
    this._storage = resolveSafeStorage(storage);
    this._channelName = channelName;
    this._patientId = patientId;
    this._nowProvider = typeof nowProvider === 'function' ? nowProvider : () => new Date();
    this._logger = logger;
    this._instanceId = createInstanceId();

    this._reads = ZERO;
    this._writes = ZERO;
    this._alertListeners = new Set();
    this._metricsListeners = new Set();
    this._alertsCache = [];
    this._metricsCache = [];
    this._channel = null;
    this._storageEventHandler = null;

    this._initializeData(seedIfEmpty);
    this._setupCrossTabSync(broadcastChannelFactory);
  }

  _readParsedArray(key) {
    try {
      const raw = this._storage.getItem(key);
      if (!raw) {
        return { valid: false, items: [] };
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return { valid: false, items: [] };
      }
      return { valid: true, items: parsed };
    } catch (error) {
      this._logger?.warn?.(`[LocalStorageRepository] Corrupt JSON at "${key}":`, error?.message || error);
      return { valid: false, items: [] };
    }
  }

  _writeArraySafely(key, items) {
    const serialized = JSON.stringify(items.map((item) => (typeof item.toJSON === 'function' ? item.toJSON() : item)));
    try {
      this._storage.setItem(key, serialized);
      return true;
    } catch (error) {
      this._logger?.warn?.(
        `[LocalStorageRepository] Storage write failed for "${key}" (continuing in memory):`,
        error?.message || error
      );
      return false;
    }
  }

  _parseAlertsArray(rawItems) {
    const valid = [];
    for (const item of rawItems) {
      try {
        valid.push(item instanceof MobilityAlert ? item : new MobilityAlert(item));
      } catch (error) {
        this._logger?.warn?.('[LocalStorageRepository] Skipping invalid alert record:', error?.message || error);
      }
    }
    return sortAlertsNewestFirst(valid);
  }

  _parseMetricsArray(rawItems) {
    const valid = [];
    for (const item of rawItems) {
      try {
        valid.push(item instanceof DailyMetrics ? item : new DailyMetrics(item));
      } catch (error) {
        this._logger?.warn?.('[LocalStorageRepository] Skipping invalid metrics record:', error?.message || error);
      }
    }
    return sortMetricsAscending(valid);
  }

  _initializeData(seedIfEmpty) {
    const alertsRead = this._readParsedArray(ALERTS_STORAGE_KEY);
    if (alertsRead.valid) {
      this._alertsCache = this._parseAlertsArray(alertsRead.items);
    } else {
      this._alertsCache = [];
      if (seedIfEmpty) {
        this._writeArraySafely(ALERTS_STORAGE_KEY, this._alertsCache);
      }
    }

    const metricsRead = this._readParsedArray(METRICS_STORAGE_KEY);
    const parsedMetrics = metricsRead.valid ? this._parseMetricsArray(metricsRead.items) : [];
    if (parsedMetrics.length > ZERO) {
      this._metricsCache = parsedMetrics;
    } else if (seedIfEmpty) {
      this._metricsCache = buildSeededWeeklyMetrics(this._patientId, this._nowProvider());
      this._writeArraySafely(METRICS_STORAGE_KEY, this._metricsCache);
    } else {
      this._metricsCache = [];
    }
  }

  _setupCrossTabSync(broadcastChannelFactory) {
    try {
      if (typeof broadcastChannelFactory === 'function') {
        this._channel = broadcastChannelFactory(this._channelName);
      } else if (typeof globalThis.BroadcastChannel === 'function') {
        this._channel = new globalThis.BroadcastChannel(this._channelName);
      }
      if (this._channel) {
        this._channel.onmessage = (event) => this._handleSyncPayload(event?.data);
      }
    } catch (error) {
      this._logger?.warn?.('[LocalStorageRepository] BroadcastChannel unavailable:', error?.message || error);
      this._channel = null;
    }

    if (typeof globalThis.window?.addEventListener === 'function') {
      this._storageEventHandler = (event) => {
        if (event?.key === ALERTS_STORAGE_KEY) {
          this._reloadAndNotifyAlerts();
        } else if (event?.key === METRICS_STORAGE_KEY) {
          this._reloadAndNotifyMetrics();
        }
      };
      globalThis.window.addEventListener('storage', this._storageEventHandler);
    }
  }

  _handleSyncPayload(data) {
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      data.source !== REPO_SYNC_SOURCE ||
      data.senderId === this._instanceId
    ) {
      return;
    }
    if (data.type === SYNC_EVENT_ALERTS) {
      this._reloadAndNotifyAlerts();
    } else if (data.type === SYNC_EVENT_METRICS) {
      this._reloadAndNotifyMetrics();
    }
  }

  _broadcast(type, idosoId) {
    if (!this._channel || typeof this._channel.postMessage !== 'function') {
      return;
    }
    try {
      this._channel.postMessage({
        source: REPO_SYNC_SOURCE,
        type,
        idoso_id: idosoId,
        senderId: this._instanceId,
      });
    } catch (error) {
      this._logger?.warn?.('[LocalStorageRepository] Broadcast postMessage failed:', error?.message || error);
    }
  }

  _reloadAlertsCache() {
    const readResult = this._readParsedArray(ALERTS_STORAGE_KEY);
    if (readResult.valid) {
      this._alertsCache = this._parseAlertsArray(readResult.items);
    }
    return this._alertsCache;
  }

  _reloadMetricsCache() {
    const readResult = this._readParsedArray(METRICS_STORAGE_KEY);
    if (readResult.valid) {
      const parsed = this._parseMetricsArray(readResult.items);
      if (parsed.length > ZERO) {
        this._metricsCache = parsed;
      }
    }
    return this._metricsCache;
  }

  _getAlertsForPatient(idosoId) {
    return sortAlertsNewestFirst(
      this._alertsCache.filter((item) => item.idoso_id === idosoId)
    );
  }

  _getMetricsForPatient(idosoId) {
    return sortMetricsAscending(
      this._metricsCache.filter((item) => item.idoso_id === idosoId)
    ).slice(-HISTORICAL_DAYS_COUNT);
  }

  _notifyAlertListeners() {
    for (const entry of this._alertListeners) {
      try {
        entry.callback(this._getAlertsForPatient(entry.idosoId));
      } catch (error) {
        this._logger?.error?.('[LocalStorageRepository] Alert subscriber error:', error);
      }
    }
  }

  _notifyMetricsListeners() {
    for (const entry of this._metricsListeners) {
      try {
        entry.callback(this._getMetricsForPatient(entry.idosoId));
      } catch (error) {
        this._logger?.error?.('[LocalStorageRepository] Metrics subscriber error:', error);
      }
    }
  }

  _reloadAndNotifyAlerts() {
    this._reloadAlertsCache();
    this._reads += 1;
    this._notifyAlertListeners();
  }

  _reloadAndNotifyMetrics() {
    this._reloadMetricsCache();
    this._reads += 1;
    this._notifyMetricsListeners();
  }

  /**
   * @param {MobilityAlert | object} alert
   * @returns {Promise<MobilityAlert>}
   */
  async saveAlert(alert) {
    const raw = alert instanceof MobilityAlert ? alert.toJSON() : { ...alert };
    const assignedId =
      raw.id !== undefined && raw.id !== null && String(raw.id).trim()
        ? String(raw.id).trim()
        : `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const entity = new MobilityAlert({ ...raw, id: assignedId });
    const nextList = sortAlertsNewestFirst([
      entity,
      ...this._alertsCache.filter((existing) => existing.id !== entity.id),
    ]);

    this._alertsCache = nextList;
    this._writeArraySafely(ALERTS_STORAGE_KEY, nextList);
    this._writes += 1;
    this._notifyAlertListeners();
    this._broadcast(SYNC_EVENT_ALERTS, entity.idoso_id);
    return entity;
  }

  /**
   * @param {string} alertId
   * @param {string} status
   * @param {string} [atendidoEm]
   * @returns {Promise<MobilityAlert>}
   */
  async updateAlertStatus(alertId, status, atendidoEm = this._nowProvider().toISOString()) {
    const targetId = String(alertId ?? '');
    const existing = this._alertsCache.find((item) => item.id === targetId);
    if (!existing) {
      throw new Error(`Alert not found for status update: ${targetId}`);
    }

    const updated = existing.withStatus(status, atendidoEm);
    const nextList = sortAlertsNewestFirst(
      this._alertsCache.map((item) => (item.id === targetId ? updated : item))
    );

    this._alertsCache = nextList;
    this._writeArraySafely(ALERTS_STORAGE_KEY, nextList);
    this._writes += 1;
    this._notifyAlertListeners();
    this._broadcast(SYNC_EVENT_ALERTS, updated.idoso_id);
    return updated;
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

    const entry = { callback, idosoId };
    this._alertListeners.add(entry);
    this._reloadAlertsCache();
    this._reads += 1;
    callback(this._getAlertsForPatient(idosoId));

    return () => {
      this._alertListeners.delete(entry);
    };
  }

  /**
   * @param {DailyMetrics | object} metrics
   * @returns {Promise<DailyMetrics>}
   */
  async upsertDailyMetrics(metrics) {
    const raw = metrics instanceof DailyMetrics ? metrics.toJSON() : { ...metrics };
    const provisional = new DailyMetrics(raw);
    const resolvedId = provisional.id || `${provisional.idoso_id}_${provisional.data}`;
    const entity = new DailyMetrics({ ...provisional.toJSON(), id: resolvedId });

    const filtered = this._metricsCache.filter(
      (item) =>
        item.id !== entity.id &&
        !(item.idoso_id === entity.idoso_id && item.data === entity.data)
    );
    const nextList = sortMetricsAscending([...filtered, entity]);

    this._metricsCache = nextList;
    this._writeArraySafely(METRICS_STORAGE_KEY, nextList);
    this._writes += 1;
    this._notifyMetricsListeners();
    this._broadcast(SYNC_EVENT_METRICS, entity.idoso_id);
    return entity;
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

    const entry = { callback, idosoId };
    this._metricsListeners.add(entry);
    this._reloadMetricsCache();
    this._reads += 1;
    callback(this._getMetricsForPatient(idosoId));

    return () => {
      this._metricsListeners.delete(entry);
    };
  }

  getCloudOpsStats() {
    return {
      mode: 'LOCAL_STORAGE',
      reads: this._reads,
      writes: this._writes,
      total: this._reads + this._writes,
    };
  }

  close() {
    if (this._channel && typeof this._channel.close === 'function') {
      try {
        this._channel.close();
      } catch (error) {
        this._logger?.warn?.('[LocalStorageRepository] Error closing BroadcastChannel:', error?.message || error);
      }
    }
    this._channel = null;

    if (
      this._storageEventHandler &&
      typeof globalThis.window?.removeEventListener === 'function'
    ) {
      globalThis.window.removeEventListener('storage', this._storageEventHandler);
    }
    this._storageEventHandler = null;
    this._alertListeners.clear();
    this._metricsListeners.clear();
  }

  dispose() {
    this.close();
  }
}
