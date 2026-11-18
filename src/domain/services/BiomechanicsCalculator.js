import { BIOMECHANICS_THRESHOLDS, POSE_LANDMARK_INDICES } from '../../config/thresholds.js';

const ZERO = BIOMECHANICS_THRESHOLDS.DEFAULT_Z_COORD;
const MIDPOINT_DIVISOR = BIOMECHANICS_THRESHOLDS.MIDPOINT_DIVISOR;
const RAD_TO_DEG = BIOMECHANICS_THRESHOLDS.RAD_TO_DEG;
const MIN_TRUNK_ANGLE_DEG = BIOMECHANICS_THRESHOLDS.MIN_TRUNK_ANGLE_DEG;
const MAX_TRUNK_ANGLE_DEG = BIOMECHANICS_THRESHOLDS.MAX_TRUNK_ANGLE_DEG;
const MS_PER_SECOND = BIOMECHANICS_THRESHOLDS.MS_PER_SECOND;

function isValidPoint2D(point) {
  return (
    Boolean(point) &&
    typeof point === 'object' &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

/**
 * Computes the 3D midpoint between two normalized pose landmarks.
 * @param {object} pointA
 * @param {object} pointB
 * @returns {{ x: number, y: number, z: number } | null}
 */
export function calculateMidpoint(pointA, pointB) {
  if (!isValidPoint2D(pointA) || !isValidPoint2D(pointB)) {
    return null;
  }
  const zA = Number.isFinite(pointA.z) ? pointA.z : ZERO;
  const zB = Number.isFinite(pointB.z) ? pointB.z : ZERO;
  return {
    x: (pointA.x + pointB.x) / MIDPOINT_DIVISOR,
    y: (pointA.y + pointB.y) / MIDPOINT_DIVISOR,
    z: (zA + zB) / MIDPOINT_DIVISOR,
  };
}

/**
 * Computes the weighted Center of Mass (CoM) from shoulders (11, 12) and hips (23, 24).
 * @param {Array<object>} landmarks
 * @returns {{ x: number, y: number, z: number } | null}
 */
export function calculateCenterOfMass(landmarks) {
  if (!Array.isArray(landmarks)) {
    return null;
  }

  const leftShoulder = landmarks[POSE_LANDMARK_INDICES.LEFT_SHOULDER];
  const rightShoulder = landmarks[POSE_LANDMARK_INDICES.RIGHT_SHOULDER];
  const leftHip = landmarks[POSE_LANDMARK_INDICES.LEFT_HIP];
  const rightHip = landmarks[POSE_LANDMARK_INDICES.RIGHT_HIP];

  const shoulderMid = calculateMidpoint(leftShoulder, rightShoulder);
  const hipMid = calculateMidpoint(leftHip, rightHip);

  if (!shoulderMid || !hipMid) {
    return null;
  }

  const wShoulder = BIOMECHANICS_THRESHOLDS.COM_SHOULDER_WEIGHT;
  const wHip = BIOMECHANICS_THRESHOLDS.COM_HIP_WEIGHT;

  return {
    x: shoulderMid.x * wShoulder + hipMid.x * wHip,
    y: shoulderMid.y * wShoulder + hipMid.y * wHip,
    z: shoulderMid.z * wShoulder + hipMid.z * wHip,
  };
}

/**
 * Computes the trunk angle in degrees [0, 90] relative to the horizontal ground plane.
 * Upright posture yields ~90 deg; horizontal fallen posture yields ~0-15 deg.
 * @param {object} shoulderMid
 * @param {object} hipMid
 * @returns {number | null}
 */
export function calculateTrunkAngleDegrees(shoulderMid, hipMid) {
  if (!isValidPoint2D(shoulderMid) || !isValidPoint2D(hipMid)) {
    return null;
  }

  const dy = Math.abs(hipMid.y - shoulderMid.y);
  const dx = Math.abs(shoulderMid.x - hipMid.x);
  const angleDeg = Math.atan2(dy, dx) * RAD_TO_DEG;

  return Math.min(MAX_TRUNK_ANGLE_DEG, Math.max(MIN_TRUNK_ANGLE_DEG, angleDeg));
}

/**
 * Computes vertical velocity (normalized units/second; positive = downward drop).
 * Guards against division by zero or negative deltaTimeMs using MIN_DELTA_TIME_MS.
 * @param {number} previousY
 * @param {number} currentY
 * @param {number} deltaTimeMs
 * @returns {number}
 */
export function calculateVerticalVelocity(previousY, currentY, deltaTimeMs) {
  if (!Number.isFinite(previousY) || !Number.isFinite(currentY)) {
    return ZERO;
  }

  const safeDeltaMs = Number.isFinite(deltaTimeMs)
    ? Math.max(deltaTimeMs, BIOMECHANICS_THRESHOLDS.MIN_DELTA_TIME_MS)
    : BIOMECHANICS_THRESHOLDS.MIN_DELTA_TIME_MS;

  const deltaSeconds = safeDeltaMs / MS_PER_SECOND;
  return (currentY - previousY) / deltaSeconds;
}

/**
 * Checks whether the body Center of Mass displacement is within the stillness epsilon.
 * @param {object} previousCoM
 * @param {object} currentCoM
 * @param {number} [epsilon=BIOMECHANICS_THRESHOLDS.MOVEMENT_STILLNESS_EPSILON]
 * @returns {boolean}
 */
export function isBodyImmobile(
  previousCoM,
  currentCoM,
  epsilon = BIOMECHANICS_THRESHOLDS.MOVEMENT_STILLNESS_EPSILON
) {
  if (!isValidPoint2D(previousCoM) || !isValidPoint2D(currentCoM)) {
    return false;
  }

  const threshold =
    Number.isFinite(epsilon) && epsilon >= ZERO
      ? epsilon
      : BIOMECHANICS_THRESHOLDS.MOVEMENT_STILLNESS_EPSILON;

  const displacement = Math.hypot(currentCoM.x - previousCoM.x, currentCoM.y - previousCoM.y);
  return displacement <= threshold;
}

/**
 * Pure static geometry service facade for biomechanical metrics.
 */
export class BiomechanicsCalculator {
  static calculateMidpoint(pointA, pointB) {
    return calculateMidpoint(pointA, pointB);
  }

  static calculateCenterOfMass(landmarks) {
    return calculateCenterOfMass(landmarks);
  }

  static calculateTrunkAngleDegrees(shoulderMid, hipMid) {
    return calculateTrunkAngleDegrees(shoulderMid, hipMid);
  }

  static calculateVerticalVelocity(previousY, currentY, deltaTimeMs) {
    return calculateVerticalVelocity(previousY, currentY, deltaTimeMs);
  }

  static isBodyImmobile(
    previousCoM,
    currentCoM,
    epsilon = BIOMECHANICS_THRESHOLDS.MOVEMENT_STILLNESS_EPSILON
  ) {
    return isBodyImmobile(previousCoM, currentCoM, epsilon);
  }
}
