import {
  BIOMECHANICS_THRESHOLDS,
  POSE_LANDMARK_INDICES,
  REQUIRED_POSTURE_LANDMARK_INDICES,
  TOTAL_POSE_LANDMARKS,
} from '../../config/thresholds.js';

const DEFAULT_COORDINATE = 0;
const DEFAULT_VISIBILITY = 0;
const MIN_TIMESTAMP_MS = 0;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeLandmark(rawLandmark) {
  if (!rawLandmark || typeof rawLandmark !== 'object' || Array.isArray(rawLandmark)) {
    return null;
  }
  const { x, y, z, visibility } = rawLandmark;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return null;
  }
  const normalizedZ = isFiniteNumber(z) ? z : DEFAULT_COORDINATE;
  const normalizedVisibility = isFiniteNumber(visibility) ? visibility : DEFAULT_VISIBILITY;

  return Object.freeze({
    x,
    y,
    z: normalizedZ,
    visibility: normalizedVisibility,
  });
}

function normalizeTimestampMs(rawTimestamp) {
  return isFiniteNumber(rawTimestamp) && rawTimestamp >= MIN_TIMESTAMP_MS
    ? rawTimestamp
    : MIN_TIMESTAMP_MS;
}

/**
 * Pure domain entity encapsulating normalized anatomical pose landmarks and capture timestamp.
 * Accepts empty or incomplete landmark arrays safely without throwing.
 */
export class PoseFrame {
  /**
   * @param {object|Array<object>} [input={}]
   * @param {number} [maybeTimestampMs=0]
   */
  constructor(input = {}, maybeTimestampMs = MIN_TIMESTAMP_MS) {
    let rawLandmarks = [];
    let rawTimestamp = maybeTimestampMs;

    if (Array.isArray(input)) {
      rawLandmarks = input;
    } else if (input && typeof input === 'object') {
      rawLandmarks = Array.isArray(input.landmarks) ? input.landmarks : [];
      rawTimestamp = input.timestampMs !== undefined ? input.timestampMs : maybeTimestampMs;
    }

    this.landmarks = Object.freeze(rawLandmarks.map(normalizeLandmark));
    this.timestampMs = normalizeTimestampMs(rawTimestamp);
    Object.freeze(this);
  }

  /**
   * Returns a normalized landmark at the given index, or null if absent/invalid.
   * @param {number} index
   * @returns {{ x: number, y: number, z: number, visibility: number } | null}
   */
  getLandmark(index) {
    if (!Number.isInteger(index) || index < DEFAULT_COORDINATE || index >= this.landmarks.length) {
      return null;
    }
    return this.landmarks[index] ?? null;
  }

  /**
   * Validates that required shoulders (11, 12) and hips (23, 24) exist and meet minVisibility.
   * @param {number} [minVisibility=BIOMECHANICS_THRESHOLDS.MIN_LANDMARK_VISIBILITY]
   * @returns {boolean}
   */
  hasRequiredLandmarks(minVisibility = BIOMECHANICS_THRESHOLDS.MIN_LANDMARK_VISIBILITY) {
    const threshold = Number.isFinite(minVisibility)
      ? minVisibility
      : BIOMECHANICS_THRESHOLDS.MIN_LANDMARK_VISIBILITY;

    return REQUIRED_POSTURE_LANDMARK_INDICES.every((idx) => {
      const lm = this.getLandmark(idx);
      return lm !== null && lm.visibility >= threshold;
    });
  }

  /**
   * Returns true only when all 33 expected landmarks are present and valid.
   * @returns {boolean}
   */
  isCompletePose() {
    return (
      this.landmarks.length === TOTAL_POSE_LANDMARKS &&
      this.landmarks.every((lm) => lm !== null)
    );
  }

  /**
   * Returns the four torso landmarks used for Center of Mass and trunk angle calculations.
   * @returns {{ leftShoulder: object, rightShoulder: object, leftHip: object, rightHip: object } | null}
   */
  getTorsoLandmarks() {
    const leftShoulder = this.getLandmark(POSE_LANDMARK_INDICES.LEFT_SHOULDER);
    const rightShoulder = this.getLandmark(POSE_LANDMARK_INDICES.RIGHT_SHOULDER);
    const leftHip = this.getLandmark(POSE_LANDMARK_INDICES.LEFT_HIP);
    const rightHip = this.getLandmark(POSE_LANDMARK_INDICES.RIGHT_HIP);

    if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
      return null;
    }
    return { leftShoulder, rightShoulder, leftHip, rightHip };
  }

  /**
   * Returns the minimum visibility across required shoulder and hip landmarks, or 0 if any is missing.
   * @returns {number}
   */
  getMinRequiredVisibility() {
    let minVis = Infinity;
    for (const idx of REQUIRED_POSTURE_LANDMARK_INDICES) {
      const lm = this.getLandmark(idx);
      if (!lm) {
        return DEFAULT_VISIBILITY;
      }
      if (lm.visibility < minVis) {
        minVis = lm.visibility;
      }
    }
    return Number.isFinite(minVis) ? minVis : DEFAULT_VISIBILITY;
  }

  /**
   * Serializes the PoseFrame into a plain JSON-safe object.
   * @returns {{ landmarks: Array<object|null>, timestampMs: number }}
   */
  toJSON() {
    return {
      landmarks: this.landmarks.map((lm) => (lm ? { ...lm } : null)),
      timestampMs: this.timestampMs,
    };
  }
}
