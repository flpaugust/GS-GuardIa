import { BIOMECHANICS_THRESHOLDS } from '../config/thresholds.js';
import { PoseFrame } from '../domain/entities/PoseFrame.js';
import { BiomechanicsCalculator } from '../domain/services/BiomechanicsCalculator.js';
import { PostureStateMachine } from '../domain/services/PostureStateMachine.js';

const ZERO = BIOMECHANICS_THRESHOLDS.DEFAULT_Z_COORD;
const MIN_TIMESTAMP_MS = BIOMECHANICS_THRESHOLDS.DEFAULT_Z_COORD;
const DEFAULT_SENSITIVITY_OFFSET = BIOMECHANICS_THRESHOLDS.SENSITIVITY_ANGLE_OFFSET_DEFAULT_DEG;
const MIN_SENSITIVITY_OFFSET = BIOMECHANICS_THRESHOLDS.SENSITIVITY_ANGLE_OFFSET_MIN_DEG;
const MAX_SENSITIVITY_OFFSET = BIOMECHANICS_THRESHOLDS.SENSITIVITY_ANGLE_OFFSET_MAX_DEG;

/**
 * Synchronous, network-free 30 FPS use case orchestrating:
 * PoseFrame normalization -> BiomechanicsCalculator geometry -> PostureStateMachine evaluation.
 */
export class ProcessPoseFrameUseCase {
  /**
   * @param {object} [options={}]
   * @param {PostureStateMachine|null} [options.stateMachine=null]
   * @param {object} [options.thresholdOverrides={}]
   */
  constructor(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const { stateMachine = null, thresholdOverrides = {} } = safeOptions;

    if (stateMachine && typeof stateMachine.evaluate === 'function') {
      this.stateMachine = stateMachine;
      if (
        thresholdOverrides &&
        typeof thresholdOverrides === 'object' &&
        Object.keys(thresholdOverrides).length > ZERO &&
        typeof stateMachine.updateThresholds === 'function'
      ) {
        stateMachine.updateThresholds(thresholdOverrides);
      }
    } else {
      this.stateMachine = new PostureStateMachine(thresholdOverrides);
    }

    this._previousCoM = null;
    this._previousCoMTimestampMs = null;
    this._lastEvaluatedTimestampMs = null;
  }

  /**
   * Processes a single pose frame synchronously at up to 30 FPS.
   * @param {PoseFrame|Array<object>|object|null} [input={}]
   * @param {number} [maybeTimestampMs=MIN_TIMESTAMP_MS]
   * @returns {object}
   */
  execute(input = {}, maybeTimestampMs = MIN_TIMESTAMP_MS) {
    const safeInput = input ?? {};
    const poseFrame =
      safeInput instanceof PoseFrame ? safeInput : new PoseFrame(safeInput, maybeTimestampMs);

    const thresholds = this.getThresholds();
    const minVisibility = thresholds.MIN_LANDMARK_VISIBILITY;
    const maxFrameDeltaMs = thresholds.MAX_FRAME_DELTA_MS;

    const deltaTimeMs =
      this._lastEvaluatedTimestampMs !== null
        ? Math.max(ZERO, poseFrame.timestampMs - this._lastEvaluatedTimestampMs)
        : ZERO;

    if (this._lastEvaluatedTimestampMs === null) {
      this._lastEvaluatedTimestampMs = poseFrame.timestampMs;
    } else {
      this._lastEvaluatedTimestampMs = Math.max(
        this._lastEvaluatedTimestampMs,
        poseFrame.timestampMs
      );
    }

    const minRequiredVisibility = poseFrame.getMinRequiredVisibility();
    const hasCompletePose = poseFrame.isCompletePose();

    if (!poseFrame.hasRequiredLandmarks(minVisibility)) {
      return this._evaluateInvalidFrame({
        poseFrame,
        deltaTimeMs,
        minVisibility: minRequiredVisibility,
        hasCompletePose,
      });
    }

    const torso = poseFrame.getTorsoLandmarks();
    if (!torso) {
      return this._evaluateInvalidFrame({
        poseFrame,
        deltaTimeMs,
        minVisibility: minRequiredVisibility,
        hasCompletePose,
      });
    }

    const shoulderMid = BiomechanicsCalculator.calculateMidpoint(
      torso.leftShoulder,
      torso.rightShoulder
    );
    const hipMid = BiomechanicsCalculator.calculateMidpoint(torso.leftHip, torso.rightHip);
    const centerOfMass = BiomechanicsCalculator.calculateCenterOfMass(poseFrame.landmarks);
    const rawTrunkAngleDeg = BiomechanicsCalculator.calculateTrunkAngleDegrees(
      shoulderMid,
      hipMid
    );

    if (!shoulderMid || !hipMid || !centerOfMass || !Number.isFinite(rawTrunkAngleDeg)) {
      return this._evaluateInvalidFrame({
        poseFrame,
        deltaTimeMs,
        minVisibility: minRequiredVisibility,
        hasCompletePose,
      });
    }

    let rawVerticalVelocity = ZERO;
    if (this._previousCoM !== null && this._previousCoMTimestampMs !== null) {
      const rawCoMDeltaMs = poseFrame.timestampMs - this._previousCoMTimestampMs;
      if (rawCoMDeltaMs >= ZERO && rawCoMDeltaMs <= maxFrameDeltaMs) {
        rawVerticalVelocity = BiomechanicsCalculator.calculateVerticalVelocity(
          this._previousCoM.y,
          centerOfMass.y,
          rawCoMDeltaMs
        );
      }
    }

    if (
      this._previousCoMTimestampMs === null ||
      poseFrame.timestampMs >= this._previousCoMTimestampMs
    ) {
      this._previousCoM = centerOfMass;
      this._previousCoMTimestampMs = poseFrame.timestampMs;
    }

    const fsmResult = this.stateMachine.evaluate({
      valid: true,
      trunkAngleDeg: rawTrunkAngleDeg,
      verticalVelocity: rawVerticalVelocity,
      centerOfMass,
      timestampMs: poseFrame.timestampMs,
    });

    return {
      valid: true,
      poseFrame,
      timestampMs: poseFrame.timestampMs,
      deltaTimeMs,
      state: fsmResult.state,
      previousState: fsmResult.previousState,
      trunkAngleDeg: fsmResult.trunkAngleDeg,
      rawTrunkAngleDeg,
      verticalVelocity: fsmResult.verticalVelocity,
      rawVerticalVelocity,
      centerOfMass,
      shoulderMid,
      hipMid,
      immobilityDurationMs: fsmResult.immobilityDurationMs,
      transitionEvent: fsmResult.transitionEvent,
      minVisibility: minRequiredVisibility,
      hasCompletePose,
    };
  }

  /**
   * Convenience alias for execute().
   * @param {PoseFrame|Array<object>|object|null} [input={}]
   * @param {number} [maybeTimestampMs=MIN_TIMESTAMP_MS]
   * @returns {object}
   */
  processFrame(input = {}, maybeTimestampMs = MIN_TIMESTAMP_MS) {
    return this.execute(input, maybeTimestampMs);
  }

  /**
   * Resets frame history and underlying PostureStateMachine.
   */
  reset() {
    this._previousCoM = null;
    this._previousCoMTimestampMs = null;
    this._lastEvaluatedTimestampMs = null;
    this.stateMachine.reset();
  }

  /**
   * Updates thresholds on the underlying PostureStateMachine.
   * @param {object} [thresholdOverrides={}]
   * @returns {Readonly<object>}
   */
  updateThresholds(thresholdOverrides = {}) {
    if (typeof this.stateMachine.updateThresholds === 'function') {
      this.stateMachine.updateThresholds(thresholdOverrides);
    }
    return this.getThresholds();
  }

  /**
   * Applies a clamped angle sensitivity offset in degrees for calibration sliders.
   * @param {number} [offsetDeg=DEFAULT_SENSITIVITY_OFFSET]
   * @returns {Readonly<object>}
   */
  setSensitivityOffset(offsetDeg = DEFAULT_SENSITIVITY_OFFSET) {
    const safeOffset = Number.isFinite(offsetDeg) ? offsetDeg : DEFAULT_SENSITIVITY_OFFSET;
    const clampedOffset = Math.min(
      MAX_SENSITIVITY_OFFSET,
      Math.max(MIN_SENSITIVITY_OFFSET, safeOffset)
    );

    return this.updateThresholds({
      TRUNK_FALL_ANGLE_DEG: BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG + clampedOffset,
      TRUNK_IMBALANCE_ANGLE_DEG: BIOMECHANICS_THRESHOLDS.TRUNK_IMBALANCE_ANGLE_DEG + clampedOffset,
    });
  }

  /**
   * Returns current posture state.
   * @returns {string}
   */
  getState() {
    return this.stateMachine.state;
  }

  /**
   * Returns active biomechanical thresholds.
   * @returns {Readonly<object>}
   */
  getThresholds() {
    return this.stateMachine?.thresholds ?? BIOMECHANICS_THRESHOLDS;
  }

  /**
   * Evaluates an invalid or occluded pose frame safely without updating CoM baseline.
   * @private
   */
  _evaluateInvalidFrame({ poseFrame, deltaTimeMs, minVisibility, hasCompletePose }) {
    const fsmResult = this.stateMachine.evaluate({
      valid: false,
      trunkAngleDeg: null,
      verticalVelocity: null,
      centerOfMass: null,
      timestampMs: poseFrame.timestampMs,
    });

    return {
      valid: false,
      poseFrame,
      timestampMs: poseFrame.timestampMs,
      deltaTimeMs,
      state: fsmResult.state,
      previousState: fsmResult.previousState,
      trunkAngleDeg: fsmResult.trunkAngleDeg,
      rawTrunkAngleDeg: null,
      verticalVelocity: fsmResult.verticalVelocity,
      rawVerticalVelocity: ZERO,
      centerOfMass: null,
      shoulderMid: null,
      hipMid: null,
      immobilityDurationMs: fsmResult.immobilityDurationMs,
      transitionEvent: null,
      minVisibility,
      hasCompletePose,
    };
  }
}
