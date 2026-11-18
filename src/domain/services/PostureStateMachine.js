import { BIOMECHANICS_THRESHOLDS } from '../../config/thresholds.js';
import { ALERT_SEVERITIES, ALERT_TYPES } from '../entities/MobilityAlert.js';
import { BiomechanicsCalculator } from './BiomechanicsCalculator.js';

export const POSTURE_STATES = Object.freeze({
  EM_PE: 'EM_PE',
  DESEQUILIBRIO: 'DESEQUILIBRIO',
  QUEDA_DETECTADA: 'QUEDA_DETECTADA',
  ALERTA_CRITICO: 'ALERTA_CRITICO',
});

const INITIAL_ZERO = BIOMECHANICS_THRESHOLDS.DEFAULT_Z_COORD;
const MIN_WINDOW_SIZE = 1;
const FRAME_INCREMENT = 1;
const MAX_VISIBILITY = 1;
const MIN_TRUNK_ANGLE_DEG = BIOMECHANICS_THRESHOLDS.MIN_TRUNK_ANGLE_DEG;
const MAX_TRUNK_ANGLE_DEG = BIOMECHANICS_THRESHOLDS.MAX_TRUNK_ANGLE_DEG;
const MS_PER_SECOND = BIOMECHANICS_THRESHOLDS.MS_PER_SECOND;
const WINDOW_HALF_DIVISOR = BIOMECHANICS_THRESHOLDS.WINDOW_HALF_DIVISOR;
const SECONDS_PRECISION_DECIMALS = BIOMECHANICS_THRESHOLDS.SECONDS_PRECISION_DECIMALS;

const ANGLE_OVERRIDE_KEYS = new Set([
  'TRUNK_FALL_ANGLE_DEG',
  'TRUNK_IMBALANCE_ANGLE_DEG',
]);

const NON_NEGATIVE_OVERRIDE_KEYS = new Set([
  'MIN_DELTA_TIME_MS',
  'MAX_FRAME_DELTA_MS',
  'FALL_VERTICAL_VELOCITY_THRESHOLD',
  'IMBALANCE_VERTICAL_VELOCITY_THRESHOLD',
  'IMMOBILITY_CONFIRMATION_MS',
  'IMBALANCE_RECOVERY_MAX_MS',
  'MOVEMENT_STILLNESS_EPSILON',
  'ALERT_DEBOUNCE_MS',
  'METRICS_SYNC_INTERVAL_MS',
]);

function sanitizeOverrides(overrides = {}) {
  const sanitized = {};
  if (!overrides || typeof overrides !== 'object') {
    return sanitized;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in BIOMECHANICS_THRESHOLDS) || typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    if (key === 'SMOOTHING_WINDOW_SIZE') {
      const floored = Math.floor(value);
      if (floored >= MIN_WINDOW_SIZE) {
        sanitized[key] = floored;
      }
      continue;
    }
    if (key === 'MIN_LANDMARK_VISIBILITY') {
      if (value >= INITIAL_ZERO && value <= MAX_VISIBILITY) {
        sanitized[key] = value;
      }
      continue;
    }
    if (ANGLE_OVERRIDE_KEYS.has(key)) {
      if (value >= MIN_TRUNK_ANGLE_DEG && value <= MAX_TRUNK_ANGLE_DEG) {
        sanitized[key] = value;
      }
      continue;
    }
    if (NON_NEGATIVE_OVERRIDE_KEYS.has(key)) {
      if (value >= INITIAL_ZERO) {
        sanitized[key] = value;
      }
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

/**
 * Deterministic 4-state finite state machine for fall and imbalance detection.
 * Emits transitionEvent only on relevant state transitions (DESEQUILIBRIO, ALERTA_CRITICO).
 */
export class PostureStateMachine {
  constructor(thresholdOverrides = {}) {
    this.thresholds = Object.freeze({
      ...BIOMECHANICS_THRESHOLDS,
      ...sanitizeOverrides(thresholdOverrides),
    });
    this.reset();
  }

  reset() {
    this.state = POSTURE_STATES.EM_PE;
    this._smoothingBuffer = [];
    this._imbalanceStartTimestampMs = null;
    this._immobilityStartTimestampMs = null;
    this._immobilityAnchorCoM = null;
    this._lastImmobilityDurationMs = INITIAL_ZERO;
    this._lastTrunkAngleDeg = null;
    this._firstInvalidTimestampMs = null;
    this._lastTimestampMs = null;
  }

  updateThresholds(thresholdOverrides = {}) {
    this.thresholds = Object.freeze({
      ...this.thresholds,
      ...sanitizeOverrides(thresholdOverrides),
    });
    const maxWindow = this._getWindowSize();
    while (this._smoothingBuffer.length > maxWindow) {
      this._smoothingBuffer.shift();
    }
  }

  evaluate({ valid, trunkAngleDeg, verticalVelocity, centerOfMass, timestampMs } = {}) {
    const candidateTimestampMs = Number.isFinite(timestampMs)
      ? timestampMs
      : (this._lastTimestampMs ?? INITIAL_ZERO);
    const safeTimestampMs =
      this._lastTimestampMs !== null
        ? Math.max(this._lastTimestampMs, candidateTimestampMs)
        : candidateTimestampMs;
    this._lastTimestampMs = safeTimestampMs;
    const previousState = this.state;

    const isInputValid = Boolean(
      valid &&
      centerOfMass &&
      Number.isFinite(centerOfMass.x) &&
      Number.isFinite(centerOfMass.y) &&
      Number.isFinite(trunkAngleDeg) &&
      Number.isFinite(verticalVelocity)
    );

    if (!isInputValid) {
      return this._handleInvalidFrame(safeTimestampMs, previousState);
    }

    this._firstInvalidTimestampMs = null;
    const smoothed = this._pushAndSmooth({ trunkAngleDeg, verticalVelocity, centerOfMass });
    this._lastTrunkAngleDeg = smoothed.trunkAngleDeg;

    let transitionEvent = null;

    if (this.state === POSTURE_STATES.EM_PE) {
      transitionEvent = this._evaluateFromStanding(smoothed, safeTimestampMs);
    } else if (this.state === POSTURE_STATES.DESEQUILIBRIO) {
      transitionEvent = this._evaluateFromImbalance(smoothed, safeTimestampMs);
    } else if (this.state === POSTURE_STATES.QUEDA_DETECTADA) {
      transitionEvent = this._evaluateFromFallDetected(smoothed, safeTimestampMs);
    } else if (this.state === POSTURE_STATES.ALERTA_CRITICO) {
      this._evaluateFromCriticalAlert(smoothed, safeTimestampMs);
    }

    return {
      state: this.state,
      previousState,
      trunkAngleDeg: smoothed.trunkAngleDeg,
      verticalVelocity: smoothed.verticalVelocity,
      immobilityDurationMs: this._lastImmobilityDurationMs,
      transitionEvent,
    };
  }

  _handleInvalidFrame(timestampMs, previousState) {
    if (this._firstInvalidTimestampMs === null) {
      this._firstInvalidTimestampMs = timestampMs;
    }

    const invalidDurationMs = Math.max(INITIAL_ZERO, timestampMs - this._firstInvalidTimestampMs);
    if (invalidDurationMs >= this.thresholds.IMBALANCE_RECOVERY_MAX_MS) {
      this._smoothingBuffer = [];
      if (this.state === POSTURE_STATES.DESEQUILIBRIO) {
        this.state = POSTURE_STATES.EM_PE;
        this._imbalanceStartTimestampMs = null;
      } else if (this.state === POSTURE_STATES.QUEDA_DETECTADA) {
        this._immobilityStartTimestampMs = null;
        this._immobilityAnchorCoM = null;
        this._lastImmobilityDurationMs = INITIAL_ZERO;
      }
    }

    return {
      state: this.state,
      previousState,
      trunkAngleDeg: this._lastTrunkAngleDeg,
      verticalVelocity: INITIAL_ZERO,
      immobilityDurationMs: this._lastImmobilityDurationMs,
      transitionEvent: null,
    };
  }

  _getWindowSize() {
    return Math.max(MIN_WINDOW_SIZE, Math.floor(this.thresholds.SMOOTHING_WINDOW_SIZE));
  }

  _getMinConfirmFrames() {
    const windowSize = this._getWindowSize();
    return Math.min(
      windowSize,
      Math.ceil(windowSize / WINDOW_HALF_DIVISOR) + FRAME_INCREMENT
    );
  }

  _getMinHighVelocityFrames() {
    const windowSize = this._getWindowSize();
    return Math.max(MIN_WINDOW_SIZE, Math.ceil(windowSize / WINDOW_HALF_DIVISOR));
  }

  _pushAndSmooth({ trunkAngleDeg, verticalVelocity, centerOfMass }) {
    const windowSize = this._getWindowSize();
    this._smoothingBuffer.push({
      trunkAngleDeg,
      verticalVelocity,
      centerOfMass: {
        x: centerOfMass.x,
        y: centerOfMass.y,
        z: Number.isFinite(centerOfMass.z) ? centerOfMass.z : INITIAL_ZERO,
      },
    });

    while (this._smoothingBuffer.length > windowSize) {
      this._smoothingBuffer.shift();
    }

    const count = this._smoothingBuffer.length;
    let sumAngle = INITIAL_ZERO;
    let sumVelocity = INITIAL_ZERO;
    let sumX = INITIAL_ZERO;
    let sumY = INITIAL_ZERO;
    let sumZ = INITIAL_ZERO;
    let highFallVelocityFrames = INITIAL_ZERO;
    let highImbalanceVelocityFrames = INITIAL_ZERO;
    let lowFallAngleFrames = INITIAL_ZERO;
    let lowImbalanceAngleFrames = INITIAL_ZERO;

    for (const sample of this._smoothingBuffer) {
      sumAngle += sample.trunkAngleDeg;
      sumVelocity += sample.verticalVelocity;
      sumX += sample.centerOfMass.x;
      sumY += sample.centerOfMass.y;
      sumZ += sample.centerOfMass.z;
      if (sample.verticalVelocity >= this.thresholds.FALL_VERTICAL_VELOCITY_THRESHOLD) {
        highFallVelocityFrames += FRAME_INCREMENT;
      }
      if (sample.verticalVelocity >= this.thresholds.IMBALANCE_VERTICAL_VELOCITY_THRESHOLD) {
        highImbalanceVelocityFrames += FRAME_INCREMENT;
      }
      if (sample.trunkAngleDeg < this.thresholds.TRUNK_FALL_ANGLE_DEG) {
        lowFallAngleFrames += FRAME_INCREMENT;
      }
      if (sample.trunkAngleDeg < this.thresholds.TRUNK_IMBALANCE_ANGLE_DEG) {
        lowImbalanceAngleFrames += FRAME_INCREMENT;
      }
    }

    return {
      trunkAngleDeg: sumAngle / count,
      verticalVelocity: sumVelocity / count,
      centerOfMass: { x: sumX / count, y: sumY / count, z: sumZ / count },
      sampleCount: count,
      highFallVelocityFrames,
      highImbalanceVelocityFrames,
      lowFallAngleFrames,
      lowImbalanceAngleFrames,
    };
  }

  _isFallCondition(smoothed) {
    const minConfirmFrames = this._getMinConfirmFrames();
    const minHighVelFrames = this._getMinHighVelocityFrames();
    if (smoothed.sampleCount < minConfirmFrames) {
      return false;
    }
    const hasFallVelocity =
      smoothed.verticalVelocity >= this.thresholds.FALL_VERTICAL_VELOCITY_THRESHOLD ||
      smoothed.highFallVelocityFrames >= minHighVelFrames;

    return (
      smoothed.trunkAngleDeg < this.thresholds.TRUNK_FALL_ANGLE_DEG &&
      smoothed.lowFallAngleFrames >= minConfirmFrames &&
      hasFallVelocity
    );
  }

  _isImbalanceCondition(smoothed) {
    const minConfirmFrames = this._getMinConfirmFrames();
    if (smoothed.sampleCount < minConfirmFrames) {
      return false;
    }
    const hasAngleImbalance =
      smoothed.trunkAngleDeg < this.thresholds.TRUNK_IMBALANCE_ANGLE_DEG &&
      smoothed.lowImbalanceAngleFrames >= minConfirmFrames;
    const hasVelocityImbalance =
      smoothed.verticalVelocity >= this.thresholds.IMBALANCE_VERTICAL_VELOCITY_THRESHOLD &&
      smoothed.highImbalanceVelocityFrames >= minConfirmFrames;

    return hasAngleImbalance || hasVelocityImbalance;
  }

  _isUprightRecovered(smoothed) {
    return (
      smoothed.trunkAngleDeg >= this.thresholds.TRUNK_IMBALANCE_ANGLE_DEG &&
      smoothed.verticalVelocity < this.thresholds.IMBALANCE_VERTICAL_VELOCITY_THRESHOLD
    );
  }

  _enterFallDetected(smoothed, timestampMs) {
    this.state = POSTURE_STATES.QUEDA_DETECTADA;
    this._imbalanceStartTimestampMs = null;
    this._immobilityStartTimestampMs = timestampMs;
    this._immobilityAnchorCoM = smoothed.centerOfMass;
    this._lastImmobilityDurationMs = INITIAL_ZERO;
  }

  _enterStanding() {
    this.state = POSTURE_STATES.EM_PE;
    this._imbalanceStartTimestampMs = null;
    this._immobilityStartTimestampMs = null;
    this._immobilityAnchorCoM = null;
    this._lastImmobilityDurationMs = INITIAL_ZERO;
  }

  _evaluateFromStanding(smoothed, timestampMs) {
    this._lastImmobilityDurationMs = INITIAL_ZERO;

    if (this._isFallCondition(smoothed)) {
      this._enterFallDetected(smoothed, timestampMs);
      return null;
    }

    // Defer imbalance emission while high fall-velocity samples are present in the
    // smoothing window so a rapid fall transitions cleanly EM_PE -> QUEDA_DETECTADA
    // and single-frame glitches do not trigger spurious DESEQUILIBRIO alerts.
    const isPlummetingAtFallSpeed =
      smoothed.verticalVelocity >= this.thresholds.FALL_VERTICAL_VELOCITY_THRESHOLD ||
      smoothed.highFallVelocityFrames > INITIAL_ZERO;

    if (!isPlummetingAtFallSpeed && this._isImbalanceCondition(smoothed)) {
      this.state = POSTURE_STATES.DESEQUILIBRIO;
      this._imbalanceStartTimestampMs = timestampMs;
      return {
        tipo: ALERT_TYPES.DESEQUILIBRIO,
        severidade: ALERT_SEVERITIES.MEDIA,
        fromState: POSTURE_STATES.EM_PE,
        toState: POSTURE_STATES.DESEQUILIBRIO,
        trunkAngleDeg: smoothed.trunkAngleDeg,
        verticalVelocity: smoothed.verticalVelocity,
        immobilityDurationMs: INITIAL_ZERO,
        tempoImovelSeg: INITIAL_ZERO,
        timestampMs,
      };
    }

    return null;
  }

  _evaluateFromImbalance(smoothed, timestampMs) {
    this._checkImbalanceEscalation(smoothed, timestampMs);
    if (this.state !== POSTURE_STATES.DESEQUILIBRIO) {
      return null;
    }
    if (this._isUprightRecovered(smoothed)) {
      this._enterStanding();
    }
    return null;
  }

  _checkImbalanceEscalation(smoothed, timestampMs) {
    if (this._isFallCondition(smoothed)) {
      this._enterFallDetected(smoothed, timestampMs);
      return;
    }

    const imbalanceDurationMs =
      this._imbalanceStartTimestampMs === null
        ? INITIAL_ZERO
        : Math.max(INITIAL_ZERO, timestampMs - this._imbalanceStartTimestampMs);

    if (
      imbalanceDurationMs >= this.thresholds.IMBALANCE_RECOVERY_MAX_MS &&
      smoothed.trunkAngleDeg < this.thresholds.TRUNK_FALL_ANGLE_DEG
    ) {
      this._enterFallDetected(smoothed, timestampMs);
    }
  }

  _evaluateFromFallDetected(smoothed, timestampMs) {
    if (this._isUprightRecovered(smoothed)) {
      this._enterStanding();
      return null;
    }

    if (this._immobilityAnchorCoM === null || this._immobilityStartTimestampMs === null) {
      this._immobilityAnchorCoM = smoothed.centerOfMass;
      this._immobilityStartTimestampMs = timestampMs;
      this._lastImmobilityDurationMs = INITIAL_ZERO;
      return null;
    }

    const isImmobile = BiomechanicsCalculator.isBodyImmobile(
      this._immobilityAnchorCoM,
      smoothed.centerOfMass,
      this.thresholds.MOVEMENT_STILLNESS_EPSILON
    );

    if (!isImmobile) {
      this._immobilityAnchorCoM = smoothed.centerOfMass;
      this._immobilityStartTimestampMs = timestampMs;
      this._lastImmobilityDurationMs = INITIAL_ZERO;
      return null;
    }

    const immobilityDurationMs = Math.max(
      INITIAL_ZERO,
      timestampMs - (this._immobilityStartTimestampMs ?? timestampMs)
    );
    this._lastImmobilityDurationMs = immobilityDurationMs;

    if (immobilityDurationMs >= this.thresholds.IMMOBILITY_CONFIRMATION_MS) {
      this.state = POSTURE_STATES.ALERTA_CRITICO;
      return {
        tipo: ALERT_TYPES.QUEDA_CRITICA,
        severidade: ALERT_SEVERITIES.CRITICA,
        fromState: POSTURE_STATES.QUEDA_DETECTADA,
        toState: POSTURE_STATES.ALERTA_CRITICO,
        trunkAngleDeg: smoothed.trunkAngleDeg,
        verticalVelocity: smoothed.verticalVelocity,
        immobilityDurationMs,
        tempoImovelSeg: Number(
          (immobilityDurationMs / MS_PER_SECOND).toFixed(SECONDS_PRECISION_DECIMALS)
        ),
        timestampMs,
      };
    }

    return null;
  }

  _evaluateFromCriticalAlert(smoothed, timestampMs) {
    if (this._isUprightRecovered(smoothed)) {
      this._enterStanding();
      return;
    }

    const isImmobile = BiomechanicsCalculator.isBodyImmobile(
      this._immobilityAnchorCoM,
      smoothed.centerOfMass,
      this.thresholds.MOVEMENT_STILLNESS_EPSILON
    );

    if (isImmobile && this._immobilityStartTimestampMs !== null) {
      this._lastImmobilityDurationMs = Math.max(
        INITIAL_ZERO,
        timestampMs - this._immobilityStartTimestampMs
      );
    }
  }
}
