import { BIOMECHANICS_THRESHOLDS } from '../../config/thresholds.js';

/**
 * Error thrown when an abstract domain repository or service contract method is not implemented.
 */
export class NotImplementedError extends Error {
  /**
   * @param {string} methodName
   * @param {string} [className='Interface']
   */
  constructor(methodName, className = 'Interface') {
    super(`${className}.${methodName}() must be implemented by a concrete adapter`);
    this.name = 'NotImplementedError';
    this.methodName = methodName;
    this.className = className;
  }
}

/**
 * Abstract persistence and real-time subscription contract for alerts and daily mobility metrics.
 * Pure domain contract with zero external or runtime environment dependencies.
 */
export class AlertRepository {
  /**
   * Persists a new MobilityAlert record.
   * @param {import('../entities/MobilityAlert.js').MobilityAlert | object} _alert
   * @returns {Promise<object>} Saved alert record including `id`
   */
  async saveAlert(_alert) {
    throw new NotImplementedError('saveAlert', this.constructor.name);
  }

  /**
   * Updates the status of an existing alert (e.g., SOCORRIDO, FALSO_POSITIVO).
   * @param {string} _alertId
   * @param {string} _status
   * @param {string} [_atendidoEm]
   * @returns {Promise<object>}
   */
  async updateAlertStatus(_alertId, _status, _atendidoEm = new Date().toISOString()) {
    throw new NotImplementedError('updateAlertStatus', this.constructor.name);
  }

  /**
   * Subscribes to real-time alert updates sorted newest-first.
   * @param {(alerts: Array<object>) => void} _callback
   * @param {string} [_idosoId]
   * @returns {() => void} Unsubscribe function
   */
  subscribeToAlerts(_callback, _idosoId = BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID) {
    throw new NotImplementedError('subscribeToAlerts', this.constructor.name);
  }

  /**
   * Creates or updates the consolidated daily mobility metrics document.
   * @param {import('../entities/DailyMetrics.js').DailyMetrics | object} _metrics
   * @returns {Promise<object>}
   */
  async upsertDailyMetrics(_metrics) {
    throw new NotImplementedError('upsertDailyMetrics', this.constructor.name);
  }

  /**
   * Subscribes to real-time 7-day sorted daily mobility metrics.
   * @param {(metricsList: Array<object>) => void} _callback
   * @param {string} [_idosoId]
   * @returns {() => void} Unsubscribe function
   */
  subscribeToDailyMetrics(_callback, _idosoId = BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID) {
    throw new NotImplementedError('subscribeToDailyMetrics', this.constructor.name);
  }

  /**
   * Returns session storage/cloud operation counters.
   * @returns {{ mode: 'FIRESTORE' | 'LOCAL_STORAGE', reads: number, writes: number, total: number }}
   */
  getCloudOpsStats() {
    throw new NotImplementedError('getCloudOpsStats', this.constructor.name);
  }
}
