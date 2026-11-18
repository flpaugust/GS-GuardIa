import { BIOMECHANICS_THRESHOLDS } from '../config/thresholds.js';
import { DailyMetrics } from '../domain/entities/DailyMetrics.js';
import { ALERT_TYPES } from '../domain/entities/MobilityAlert.js';
import { BiomechanicsCalculator } from '../domain/services/BiomechanicsCalculator.js';
import { POSTURE_STATES } from '../domain/services/PostureStateMachine.js';

const ZERO = BIOMECHANICS_THRESHOLDS.DEFAULT_Z_COORD;
const COUNT_INCREMENT = 1;
const MIN_DELTA_TIME_MS = BIOMECHANICS_THRESHOLDS.MIN_DELTA_TIME_MS;
const MAX_FRAME_DELTA_MS = BIOMECHANICS_THRESHOLDS.MAX_FRAME_DELTA_MS;
const MS_PER_SECOND = BIOMECHANICS_THRESHOLDS.MS_PER_SECOND;
const MS_PER_MINUTE = BIOMECHANICS_THRESHOLDS.MS_PER_MINUTE;
const ROUNDING_PRECISION_FACTOR = BIOMECHANICS_THRESHOLDS.ROUNDING_PRECISION_FACTOR;
const TRUNK_IMBALANCE_ANGLE_DEG = BIOMECHANICS_THRESHOLDS.TRUNK_IMBALANCE_ANGLE_DEG;
const MOVEMENT_STILLNESS_EPSILON = BIOMECHANICS_THRESHOLDS.MOVEMENT_STILLNESS_EPSILON;
const METRICS_SYNC_INTERVAL_MS = BIOMECHANICS_THRESHOLDS.METRICS_SYNC_INTERVAL_MS;
const DEFAULT_PATIENT_ID = BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID;
const MIN_EPOCH_MS = Date.parse('2000-01-01T00:00:00.000Z');

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toNonNegativeFinite(value, fallback = ZERO) {
  return isFiniteNumber(value) && value >= ZERO ? value : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function defaultUtcDateKey(timestampMs) {
  const safeMs = isFiniteNumber(timestampMs) ? timestampMs : Date.now();
  return new Date(safeMs).toISOString().split('T')[ZERO];
}

function roundToTwoDecimals(value) {
  return Math.round(value * ROUNDING_PRECISION_FACTOR) / ROUNDING_PRECISION_FACTOR;
}

/**
 * In-memory mobility telemetry accumulator with 60s throttled persistence and on-stop flush.
 * Synchronous recordFrame() is safe for 30 FPS RAF loops and never blocks on network I/O.
 */
export class UpdateMobilityMetricsUseCase {
  /**
   * @param {object} dependencies
   * @param {object} dependencies.alertRepository
   * @param {string} [dependencies.patientId=DEFAULT_PATIENT_ID]
   * @param {number} [dependencies.syncIntervalMs=METRICS_SYNC_INTERVAL_MS]
   * @param {number} [dependencies.maxFrameDeltaMs=MAX_FRAME_DELTA_MS]
   * @param {() => number} [dependencies.nowFn=() => Date.now()]
   * @param {(timestampMs: number) => string} [dependencies.getDateKey=defaultUtcDateKey]
   * @param {object} [dependencies.logger=console]
   * @param {object|null} [dependencies.initialMetrics=null]
   */
  constructor(dependencies = {}) {
    const safeDeps = isPlainObject(dependencies) ? dependencies : {};
    const {
      alertRepository,
      patientId = DEFAULT_PATIENT_ID,
      syncIntervalMs = METRICS_SYNC_INTERVAL_MS,
      maxFrameDeltaMs = MAX_FRAME_DELTA_MS,
      nowFn = () => Date.now(),
      getDateKey = defaultUtcDateKey,
      logger = console,
      initialMetrics = null,
    } = safeDeps;

    if (!alertRepository || typeof alertRepository.upsertDailyMetrics !== 'function') {
      throw new TypeError(
        'UpdateMobilityMetricsUseCase requires an alertRepository with an upsertDailyMetrics() method'
      );
    }

    this._alertRepository = alertRepository;
    this._patientId =
      typeof patientId === 'string' && patientId.trim().length > ZERO
        ? patientId.trim()
        : DEFAULT_PATIENT_ID;
    this._syncIntervalMs =
      isFiniteNumber(syncIntervalMs) && syncIntervalMs >= ZERO
        ? syncIntervalMs
        : METRICS_SYNC_INTERVAL_MS;
    this._maxFrameDeltaMs =
      isFiniteNumber(maxFrameDeltaMs) && maxFrameDeltaMs >= MIN_DELTA_TIME_MS
        ? maxFrameDeltaMs
        : MAX_FRAME_DELTA_MS;
    this._nowFn = typeof nowFn === 'function' ? nowFn : () => Date.now();
    this._getDateKey = typeof getDateKey === 'function' ? getDateKey : defaultUtcDateKey;
    this._logger = logger;

    this._activeSyncPromise = null;
    this._isSyncing = false;
    this.reset();

    if (initialMetrics) {
      this.hydrate(initialMetrics);
    }
  }

  /**
   * Synchronously records a single processed frame result and schedules throttled persistence.
   * @param {object|null} frameResult
   * @param {object} [options={}]
   * @returns {DailyMetrics}
   */
  recordFrame(frameResult, options = {}) {
    if (!isPlainObject(frameResult)) {
      return this.getCurrentMetrics();
    }

    const safeOptions = isPlainObject(options) ? options : {};
    const hasFrameTimestamp = isFiniteNumber(frameResult.timestampMs);
    const timelineMs = hasFrameTimestamp ? frameResult.timestampMs : this._safeNow();

    const wallClockMs = isFiniteNumber(safeOptions.wallClockMs)
      ? safeOptions.wallClockMs
      : hasFrameTimestamp && frameResult.timestampMs >= MIN_EPOCH_MS
        ? frameResult.timestampMs
        : this._safeNow();

    this._handleDayRolloverIfNeeded(wallClockMs, timelineMs);
    this._lastWallClockMs = wallClockMs;

    if (this._lastSyncTimestampMs === null || timelineMs < this._lastSyncTimestampMs) {
      this._lastSyncTimestampMs = timelineMs;
    }

    const dt = this._computeClampedFrameDelta(timelineMs);

    if (frameResult.valid === false) {
      this._maybeTriggerThrottledSync(timelineMs, wallClockMs);
      return this.getCurrentMetrics(wallClockMs);
    }

    this._recordTransitionEvents(frameResult, timelineMs);
    this._accumulateActivityAndGait(frameResult, timelineMs, dt);
    this._maybeTriggerThrottledSync(timelineMs, wallClockMs);

    return this.getCurrentMetrics(wallClockMs);
  }

  /**
   * Convenience alias for recordFrame().
   * @param {object|null} frameResult
   * @param {object} [options={}]
   * @returns {DailyMetrics}
   */
  execute(frameResult, options = {}) {
    return this.recordFrame(frameResult, options);
  }

  /**
   * Persists accumulated metrics if dirty (or when force=true), serializing concurrent flushes.
   * Never throws or returns a rejected Promise.
   * @param {object} [options={}]
   * @param {boolean} [options.force=false]
   * @param {number} [options.timestampMs]
   * @returns {Promise<{ ok: boolean, synced: boolean, skipped: boolean, metrics: DailyMetrics, saved?: object, error?: string }>}
   */
  async flush({ force = false, timestampMs } = {}) {
    if (this._activeSyncPromise) {
      try {
        await this._activeSyncPromise;
      } catch (_ignored) {
        // _activeSyncPromise catches and resolves internally; guard defensively
      }
    }

    const resolvedTimestampMs = isFiniteNumber(timestampMs)
      ? timestampMs
      : (this._lastWallClockMs ?? this._safeNow());

    if (!this._dirty && !force) {
      return {
        ok: true,
        synced: false,
        skipped: true,
        metrics: this.getCurrentMetrics(resolvedTimestampMs),
      };
    }

    const metricsSnapshot = this.getCurrentMetrics(resolvedTimestampMs);
    this._isSyncing = true;
    this._dirty = false;

    const runFlush = async () => {
      try {
        const saved = await this._alertRepository.upsertDailyMetrics(metricsSnapshot);
        return {
          ok: true,
          synced: true,
          skipped: false,
          metrics: metricsSnapshot,
          saved,
        };
      } catch (error) {
        this._dirty = true;
        const errorMessage = error?.message || String(error);
        this._log(
          'error',
          '[UpdateMobilityMetricsUseCase] Failed to upsert daily metrics:',
          errorMessage
        );
        return {
          ok: false,
          synced: false,
          skipped: false,
          metrics: metricsSnapshot,
          error: errorMessage,
        };
      } finally {
        this._isSyncing = false;
        this._activeSyncPromise = null;
      }
    };

    this._activeSyncPromise = runFlush();
    return this._activeSyncPromise;
  }

  /**
   * Flushes pending metrics when monitoring stops and resets frame-tracking anchors
   * while preserving daily totals for potential same-day resume.
   * @param {object} [options={}]
   * @returns {Promise<{ ok: boolean, synced: boolean, skipped: boolean, metrics: DailyMetrics, saved?: object, error?: string }>}
   */
  async stop(options = {}) {
    const result = await this.flush(options);
    this._previousFrameTimestampMs = null;
    this._activityAnchorCoM = null;
    this._activityAnchorTimestampMs = null;
    this._lastMovementTimestampMs = null;
    return result;
  }

  /**
   * Builds and returns a frozen DailyMetrics snapshot for the current day.
   * @param {number} [timestampMs]
   * @returns {DailyMetrics}
   */
  getCurrentMetrics(timestampMs) {
    const safeTimestampMs = isFiniteNumber(timestampMs)
      ? timestampMs
      : (this._lastWallClockMs ?? this._safeNow());

    const activeMinutes = roundToTwoDecimals(this._activeMs / MS_PER_MINUTE);
    const seatedMinutes = roundToTwoDecimals(this._seatedMs / MS_PER_MINUTE);
    const averageGaitSpeed =
      this._gaitSpeedCount > ZERO
        ? roundToTwoDecimals(this._gaitSpeedSum / this._gaitSpeedCount)
        : ZERO;

    return new DailyMetrics({
      id: `${this._patientId}_${this._currentDateKey}`,
      idoso_id: this._patientId,
      data: this._currentDateKey,
      tempo_ativo_min: activeMinutes,
      tempo_sentado_min: seatedMinutes,
      qtd_desequilibrios: this._imbalanceCount,
      qtd_quedas: this._fallCount,
      velocidade_marcha_media: averageGaitSpeed,
      atualizado_em: new Date(safeTimestampMs).toISOString(),
    });
  }

  /**
   * Hydrates same-day, same-patient totals from persisted DailyMetrics.
   * Ignores stale dates, mismatched patients, or malformed inputs.
   * @param {object|DailyMetrics|null} metricsData
   * @returns {boolean}
   */
  hydrate(metricsData) {
    if (!isPlainObject(metricsData)) {
      return false;
    }

    const candidatePatientId =
      typeof metricsData.idoso_id === 'string' && metricsData.idoso_id.trim().length > ZERO
        ? metricsData.idoso_id.trim()
        : this._patientId;

    if (candidatePatientId !== this._patientId) {
      return false;
    }

    const candidateDate = typeof metricsData.data === 'string' ? metricsData.data.trim() : '';
    if (candidateDate !== this._currentDateKey) {
      return false;
    }

    this._activeMs = toNonNegativeFinite(metricsData.tempo_ativo_min, ZERO) * MS_PER_MINUTE;
    this._seatedMs = toNonNegativeFinite(metricsData.tempo_sentado_min, ZERO) * MS_PER_MINUTE;
    this._imbalanceCount = Math.trunc(toNonNegativeFinite(metricsData.qtd_desequilibrios, ZERO));
    this._fallCount = Math.trunc(toNonNegativeFinite(metricsData.qtd_quedas, ZERO));

    const hydratedGait = toNonNegativeFinite(metricsData.velocidade_marcha_media, ZERO);
    if (hydratedGait > ZERO) {
      this._gaitSpeedSum = hydratedGait;
      this._gaitSpeedCount = COUNT_INCREMENT;
    } else {
      this._gaitSpeedSum = ZERO;
      this._gaitSpeedCount = ZERO;
    }

    this._dirty = false;
    return true;
  }

  /**
   * Resets all accumulated daily metrics and frame-tracking state.
   */
  reset() {
    this._currentDateKey = this._getDateKey(this._safeNow());
    this._resetDailyCounters();
    this._lastWallClockMs = null;
    this._lastSyncTimestampMs = null;
  }

  /**
   * @private
   */
  _resetDailyCounters() {
    this._activeMs = ZERO;
    this._seatedMs = ZERO;
    this._imbalanceCount = ZERO;
    this._fallCount = ZERO;
    this._gaitSpeedSum = ZERO;
    this._gaitSpeedCount = ZERO;
    this._previousFrameTimestampMs = null;
    this._activityAnchorCoM = null;
    this._activityAnchorTimestampMs = null;
    this._lastMovementTimestampMs = null;
    this._lastEventKey = null;
    this._dirty = false;
  }

  /**
   * @private
   */
  _handleDayRolloverIfNeeded(wallClockMs, timelineMs) {
    const frameDateKey = this._getDateKey(wallClockMs);
    if (frameDateKey === this._currentDateKey) {
      return;
    }

    if (this._dirty) {
      const priorMetrics = this.getCurrentMetrics(this._lastWallClockMs ?? wallClockMs);
      this._persistRolloverSnapshot(priorMetrics);
    }

    this._currentDateKey = frameDateKey;
    this._resetDailyCounters();
    this._lastSyncTimestampMs = timelineMs;
  }

  /**
   * @private
   */
  _persistRolloverSnapshot(priorMetrics) {
    const priorSync = this._activeSyncPromise;
    const rolloverPromise = (async () => {
      if (priorSync) {
        try {
          await priorSync;
        } catch (_ignored) {
          // Safe guard
        }
      }
      try {
        await this._alertRepository.upsertDailyMetrics(priorMetrics);
      } catch (error) {
        this._log(
          'error',
          `[UpdateMobilityMetricsUseCase] Failed to flush rollover metrics for ${priorMetrics.data}:`,
          error?.message || String(error)
        );
      } finally {
        if (this._activeSyncPromise === rolloverPromise) {
          this._activeSyncPromise = null;
        }
      }
    })();

    this._activeSyncPromise = rolloverPromise;
  }

  /**
   * @private
   */
  _computeClampedFrameDelta(timelineMs) {
    if (this._previousFrameTimestampMs === null) {
      this._previousFrameTimestampMs = timelineMs;
      return ZERO;
    }

    const rawDt = timelineMs - this._previousFrameTimestampMs;
    this._previousFrameTimestampMs = timelineMs;

    if (rawDt < ZERO) {
      this._activityAnchorCoM = null;
      this._activityAnchorTimestampMs = null;
      this._lastMovementTimestampMs = null;
      return ZERO;
    }

    if (rawDt > this._maxFrameDeltaMs) {
      this._activityAnchorCoM = null;
      this._activityAnchorTimestampMs = null;
      return this._maxFrameDeltaMs;
    }

    return rawDt;
  }

  /**
   * @private
   */
  _recordTransitionEvents(frameResult, timelineMs) {
    const transitionEvent = frameResult.transitionEvent;
    if (!isPlainObject(transitionEvent)) {
      return;
    }

    const isTransitionEdge =
      transitionEvent.fromState !== transitionEvent.toState ||
      frameResult.previousState !== frameResult.state;

    if (!isTransitionEdge) {
      return;
    }

    const eventTimestamp = isFiniteNumber(transitionEvent.timestampMs)
      ? transitionEvent.timestampMs
      : timelineMs;
    const eventKey = `${transitionEvent.tipo}:${eventTimestamp}`;

    if (eventKey === this._lastEventKey) {
      return;
    }

    this._lastEventKey = eventKey;

    if (transitionEvent.tipo === ALERT_TYPES.DESEQUILIBRIO) {
      this._imbalanceCount += COUNT_INCREMENT;
      this._dirty = true;
    } else if (transitionEvent.tipo === ALERT_TYPES.QUEDA_CRITICA) {
      this._fallCount += COUNT_INCREMENT;
      this._dirty = true;
    }
  }

  /**
   * @private
   */
  _accumulateActivityAndGait(frameResult, timelineMs, dt) {
    const { centerOfMass, state, trunkAngleDeg, isSeated, gaitSpeed } = frameResult;
    const hasValidCoM =
      isPlainObject(centerOfMass) && isFiniteNumber(centerOfMass.x) && isFiniteNumber(centerOfMass.y);

    const isStandingState = state === POSTURE_STATES.EM_PE;
    const isUprightAngle =
      trunkAngleDeg === null ||
      trunkAngleDeg === undefined ||
      (isFiniteNumber(trunkAngleDeg) && trunkAngleDeg >= TRUNK_IMBALANCE_ANGLE_DEG);

    if (hasValidCoM) {
      if (this._activityAnchorCoM === null) {
        this._activityAnchorCoM = { x: centerOfMass.x, y: centerOfMass.y };
        this._activityAnchorTimestampMs = timelineMs;
      } else {
        const isImmobile = BiomechanicsCalculator.isBodyImmobile(
          this._activityAnchorCoM,
          centerOfMass,
          MOVEMENT_STILLNESS_EPSILON
        );

        if (!isImmobile) {
          if (isStandingState && isUprightAngle && isSeated !== true) {
            const displacement = Math.hypot(
              centerOfMass.x - this._activityAnchorCoM.x,
              centerOfMass.y - this._activityAnchorCoM.y
            );
            const anchorElapsedMs = Math.max(
              timelineMs - (this._activityAnchorTimestampMs ?? timelineMs),
              MIN_DELTA_TIME_MS
            );
            const sampleSpeed = displacement / (anchorElapsedMs / MS_PER_SECOND);
            if (isFiniteNumber(sampleSpeed) && sampleSpeed > ZERO) {
              this._gaitSpeedSum += sampleSpeed;
              this._gaitSpeedCount += COUNT_INCREMENT;
              this._dirty = true;
            }
          }

          this._activityAnchorCoM = { x: centerOfMass.x, y: centerOfMass.y };
          this._activityAnchorTimestampMs = timelineMs;
          this._lastMovementTimestampMs = timelineMs;
        }
      }
    }

    if (isFiniteNumber(gaitSpeed) && gaitSpeed > ZERO && isStandingState && isSeated !== true) {
      this._gaitSpeedSum += gaitSpeed;
      this._gaitSpeedCount += COUNT_INCREMENT;
      this._dirty = true;
    }

    if (dt > ZERO) {
      const isFallOrCritical =
        state === POSTURE_STATES.QUEDA_DETECTADA || state === POSTURE_STATES.ALERTA_CRITICO;
      const isRecentlyActive =
        this._lastMovementTimestampMs !== null &&
        timelineMs - this._lastMovementTimestampMs <= this._maxFrameDeltaMs;

      if (isSeated === true || isFallOrCritical) {
        this._seatedMs += dt;
      } else if (isRecentlyActive) {
        this._activeMs += dt;
      } else {
        this._seatedMs += dt;
      }

      this._dirty = true;
    }
  }

  /**
   * @private
   */
  _maybeTriggerThrottledSync(timelineMs, wallClockMs) {
    if (
      this._dirty &&
      !this._isSyncing &&
      this._lastSyncTimestampMs !== null &&
      timelineMs - this._lastSyncTimestampMs >= this._syncIntervalMs
    ) {
      this._lastSyncTimestampMs = timelineMs;
      this.flush({ timestampMs: wallClockMs });
    }
  }

  /**
   * @private
   */
  _safeNow() {
    const value = this._nowFn();
    return isFiniteNumber(value) ? value : Date.now();
  }

  /**
   * @private
   */
  _log(level, ...args) {
    if (this._logger && typeof this._logger[level] === 'function') {
      this._logger[level](...args);
    }
  }
}
