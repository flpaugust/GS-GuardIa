import { AlertRepository } from '../../domain/repositories/AlertRepository.js';

/**
 * Proxy AlertRepository that delegates to the currently active backend (LocalStorage or
 * Firestore) and transparently re-binds live subscriptions when the backend is switched
 * at runtime (e.g. after the user saves credentials in the Quick Config modal).
 */
export class SwitchableRepository extends AlertRepository {
  /**
   * @param {AlertRepository} initialRepository
   */
  constructor(initialRepository) {
    super();
    this._current = initialRepository;
    this._subscriptions = new Set();
  }

  get current() {
    return this._current;
  }

  get mode() {
    return this._current?.getCloudOpsStats?.().mode ?? 'UNKNOWN';
  }

  saveAlert(alert) {
    return this._current.saveAlert(alert);
  }

  updateAlertStatus(alertId, status, atendidoEm) {
    return this._current.updateAlertStatus(alertId, status, atendidoEm);
  }

  upsertDailyMetrics(metrics) {
    return this._current.upsertDailyMetrics(metrics);
  }

  subscribeToAlerts(callback, idosoId) {
    return this._track('subscribeToAlerts', callback, idosoId);
  }

  subscribeToDailyMetrics(callback, idosoId) {
    return this._track('subscribeToDailyMetrics', callback, idosoId);
  }

  getCloudOpsStats() {
    return this._current.getCloudOpsStats();
  }

  /**
   * Switches the active backend and re-subscribes every live listener.
   * @param {AlertRepository} nextRepository
   */
  switchTo(nextRepository) {
    if (!nextRepository || nextRepository === this._current) {
      return;
    }
    for (const entry of this._subscriptions) {
      entry.unsubscribe?.();
    }
    this._current?.close?.();
    this._current = nextRepository;
    for (const entry of this._subscriptions) {
      entry.unsubscribe = this._current[entry.method](entry.callback, entry.idosoId);
    }
  }

  _track(method, callback, idosoId) {
    const entry = { method, callback, idosoId, unsubscribe: null };
    this._subscriptions.add(entry);
    entry.unsubscribe = this._current[method](callback, idosoId);
    return () => {
      entry.unsubscribe?.();
      this._subscriptions.delete(entry);
    };
  }
}
