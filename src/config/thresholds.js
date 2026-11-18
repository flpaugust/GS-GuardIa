/**
 * Deeply freezes an object graph in place so thresholds cannot be mutated at runtime.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

export const TOTAL_POSE_LANDMARKS = 33;

export const POSE_LANDMARK_INDICES = deepFreeze({
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
});

export const REQUIRED_POSTURE_LANDMARK_INDICES = deepFreeze([
  POSE_LANDMARK_INDICES.LEFT_SHOULDER,
  POSE_LANDMARK_INDICES.RIGHT_SHOULDER,
  POSE_LANDMARK_INDICES.LEFT_HIP,
  POSE_LANDMARK_INDICES.RIGHT_HIP,
]);

export const RISK_SCORE_WEIGHTS = deepFreeze({
  MIN_SCORE: 0,
  MAX_SCORE: 100,
  MIN_TOTAL_MINUTES: 1,
  MIN_GAIT_SPEED: 0,
  SEDENTARY_MAX_POINTS: 30,
  IMBALANCE_POINT_VALUE: 6,
  IMBALANCE_MAX_POINTS: 30,
  FALL_POINT_VALUE: 25,
  FALL_MAX_POINTS: 40,
  LOW_GAIT_SPEED_THRESHOLD: 0.85,
  LOW_GAIT_MAX_POINTS: 20,
});

/**
 * Centralized, deeply frozen biomechanical, FSM, quota-protection, and risk-scoring constants.
 * Zero magic numbers are permitted in domain/ or application/.
 */
export const BIOMECHANICS_THRESHOLDS = deepFreeze({
  // Landmark validation & MediaPipe indices
  MIN_LANDMARK_VISIBILITY: 0.5,
  EXPECTED_LANDMARK_COUNT: TOTAL_POSE_LANDMARKS,
  LANDMARK_INDICES: POSE_LANDMARK_INDICES,
  REQUIRED_LANDMARK_INDICES: REQUIRED_POSTURE_LANDMARK_INDICES,

  // Temporal smoothing & numerical stability
  SMOOTHING_WINDOW_SIZE: 4,
  MIN_DELTA_TIME_MS: 16,
  MAX_FRAME_DELTA_MS: 1000,
  MS_PER_SECOND: 1000,
  MS_PER_MINUTE: 60000,
  MIDPOINT_DIVISOR: 2,
  HALF_CIRCLE_DEG: 180,
  RAD_TO_DEG: 180 / Math.PI,
  MIN_TRUNK_ANGLE_DEG: 0,
  MAX_TRUNK_ANGLE_DEG: 90,
  DEFAULT_Z_COORD: 0,
  ROUNDING_PRECISION_FACTOR: 100,
  WINDOW_HALF_DIVISOR: 2,
  SECONDS_PRECISION_DECIMALS: 1,

  // Center of Mass weights
  COM_SHOULDER_WEIGHT: 0.4,
  COM_HIP_WEIGHT: 0.6,

  // Posture State Machine thresholds
  TRUNK_FALL_ANGLE_DEG: 35.0,
  TRUNK_IMBALANCE_ANGLE_DEG: 58.0,
  FALL_VERTICAL_VELOCITY_THRESHOLD: 0.55,
  IMBALANCE_VERTICAL_VELOCITY_THRESHOLD: 0.20,
  IMMOBILITY_CONFIRMATION_MS: 5000,
  IMBALANCE_RECOVERY_MAX_MS: 3000,
  MOVEMENT_STILLNESS_EPSILON: 0.035,

  // Sensitivity calibration bounds (degrees offset)
  SENSITIVITY_ANGLE_OFFSET_MIN_DEG: -10,
  SENSITIVITY_ANGLE_OFFSET_MAX_DEG: 10,
  SENSITIVITY_ANGLE_OFFSET_DEFAULT_DEG: 0,

  // Cloud quota protection (debounce / throttle)
  ALERT_DEBOUNCE_MS: 15000,
  METRICS_SYNC_INTERVAL_MS: 60000,

  // Default patient identifier
  DEFAULT_PATIENT_ID: 'paciente_01',

  // Preventive Risk Score weights (DailyMetrics)
  RISK_SCORE_WEIGHTS,
});
