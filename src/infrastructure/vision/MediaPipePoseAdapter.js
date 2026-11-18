import {
  BIOMECHANICS_THRESHOLDS,
  POSE_LANDMARK_INDICES,
  TOTAL_POSE_LANDMARKS,
} from '../../config/thresholds.js';
import { PoseFrame } from '../../domain/entities/PoseFrame.js';

export const SIMULATION_SCENARIOS = Object.freeze({
  NORMAL: 'NORMAL',
  DESEQUILIBRIO: 'DESEQUILIBRIO',
  QUEDA_CRITICA: 'QUEDA_CRITICA',
});

export const MEDIAPIPE_DEFAULTS = Object.freeze({
  CDN_ESM_URL: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm',
  WASM_BASE_URL: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  MODEL_ASSET_PATH:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  RUNNING_MODE: 'VIDEO',
  DELEGATE_GPU: 'GPU',
  DELEGATE_CPU: 'CPU',
  NUM_POSES: 1,
  MIN_POSE_DETECTION_CONFIDENCE: 0.5,
  MIN_POSE_PRESENCE_CONFIDENCE: 0.5,
  MIN_TRACKING_CONFIDENCE: 0.5,
  VIDEO_READY_STATE_MIN: 2,
  TIMESTAMP_INCREMENT_MS: 1,
  DEFAULT_TORSO_LENGTH: 0.26,
  SYNTHETIC_VISIBILITY: 0.96,
  SHOULDER_HALF_WIDTH: 0.08,
  HIP_HALF_WIDTH: 0.06,
  HEAD_OFFSET_RATIO: 0.32,
  EYE_OFFSET_X: 0.018,
  EYE_OFFSET_Y: 0.015,
  EAR_OFFSET_X: 0.032,
  MOUTH_OFFSET_X: 0.012,
  MOUTH_OFFSET_Y: 0.018,
  UPPER_ARM_LENGTH: 0.14,
  FOREARM_LENGTH: 0.13,
  HAND_EXTENSION: 0.03,
  THIGH_LENGTH: 0.20,
  SHIN_LENGTH: 0.19,
  FOOT_EXTENSION_Y: 0.025,
  FOOT_EXTENSION_X: 0.035,
  STRIDE_AMPLITUDE_X: 0.035,
  STRIDE_LIFT_Y: 0.02,
});

const SCENARIO_TRAJECTORY_CONFIG = Object.freeze({
  WARMUP_MS: 150,
  BASELINE_X: 0.5,
  BASELINE_Y: 0.42,
  UPRIGHT_ANGLE_DEG: 88,
  TWO_PI: Math.PI * 2,
  NORMAL: Object.freeze({
    SWAY_X_AMPLITUDE: 0.02,
    SWAY_X_PERIOD_MS: 2500,
    BOB_Y_AMPLITUDE: 0.008,
    BOB_Y_PERIOD_MS: 1200,
    BASE_ANGLE_DEG: 87,
    ANGLE_SWAY_DEG: 1.5,
    ANGLE_PERIOD_MS: 1800,
    STRIDE_PERIOD_MS: 1200,
  }),
  DESEQUILIBRIO: Object.freeze({
    WARMUP_MS: 20,
    TILT_END_MS: 110,
    DESCENT_END_MS: 210,
    HOLD_END_MS: 900,
    RECOVERY_END_MS: 1350,
    TILT_X_DELTA: 0.03,
    TILT_Y_DELTA: 0.025,
    TILT_ANGLE_DEG: 46,
    DESCENT_Y_DELTA: 0.04,
    HOLD_X: 0.56,
    HOLD_Y: 0.485,
    HOLD_ANGLE_DEG: 47,
  }),
  QUEDA_CRITICA: Object.freeze({
    WARMUP_MS: 15,
    FALL_DURATION_MS: 150,
    FALL_END_MS: 170,
    FALL_X_DELTA: 0.08,
    FALL_Y_DELTA: 0.38,
    FALLEN_X: 0.58,
    FALLEN_Y: 0.8,
    FALLEN_ANGLE_DEG: 12,
    ANGLE_DROP_ACCEL: 2.5,
  }),
});

const ZERO = 0;
const ONE = 1;
const EPOCH_TIMESTAMP_THRESHOLD_MS = 1e11;
const WEBCAM_FULL_BODY_HIP_MIN_VIS = 0.65;
const WEBCAM_FULL_BODY_HIP_MAX_Y = 0.88;
const WEBCAM_UPPER_BODY_MIN_VIS = 0.25;
const WEBCAM_RENDER_BOOST_VIS = 0.82;
const WEBCAM_SYNTHETIC_HIP_VIS = 0.92;
const WEBCAM_DEADZONE_TILT_DEG = 10;
const WEBCAM_MAX_LOWER_Y = 0.96;

function isValidFiniteLandmark(lm) {
  return Boolean(lm && Number.isFinite(lm.x) && Number.isFinite(lm.y));
}

function mirrorLandmarksIfNeeded(rawLandmarks, shouldMirror) {
  return rawLandmarks.map((lm) => {
    if (!isValidFiniteLandmark(lm)) {
      return lm;
    }
    return {
      x: shouldMirror ? ONE - lm.x : lm.x,
      y: lm.y,
      z: Number.isFinite(lm.z) ? lm.z : ZERO,
      visibility: Number.isFinite(lm.visibility) ? lm.visibility : ZERO,
    };
  });
}

function estimateSeatedHipOffset(ls, rs, nose) {
  const sdx = ls.x - rs.x;
  const sdy = ls.y - rs.y;
  const shoulderWidth = Math.max(0.12, Math.hypot(sdx, sdy));
  const torsoLen = Math.min(0.45, Math.max(0.22, shoulderWidth * 1.35));

  // Perpendicular to shoulder line pointing downward in image space (y+ is down)
  let perpX = -sdy / shoulderWidth;
  let perpY = sdx / shoulderWidth;
  if (perpY < ZERO) {
    perpX = -perpX;
    perpY = -perpY;
  }

  let axisX = perpX;
  let axisY = perpY;

  if (isValidFiniteLandmark(nose) && (nose.visibility ?? ZERO) >= WEBCAM_UPPER_BODY_MIN_VIS) {
    const smX = (ls.x + rs.x) * 0.5;
    const smY = (ls.y + rs.y) * 0.5;
    const headDx = nose.x - smX;
    const headDy = smY - nose.y;
    const headLen = Math.hypot(headDx, headDy);
    if (headLen > 0.03) {
      // Opposite of nose->shoulder gives shoulder->hip downward vector
      const hAxisX = -headDx / headLen;
      const hAxisY = headDy / headLen;
      axisX = Math.abs(hAxisX) > Math.abs(perpX) ? hAxisX : perpX;
      axisY = Math.min(perpY, Math.max(0.05, hAxisY));
    }
  }

  const tiltFromVerticalDeg = Math.atan2(Math.abs(axisX), Math.max(0.01, axisY)) * BIOMECHANICS_THRESHOLDS.RAD_TO_DEG;
  if (tiltFromVerticalDeg < WEBCAM_DEADZONE_TILT_DEG) {
    axisX = ZERO;
    axisY = ONE;
  }

  const norm = Math.hypot(axisX, axisY) || ONE;
  return {
    dx: (axisX / norm) * torsoLen,
    dy: (axisY / norm) * torsoLen,
    shoulderWidth,
  };
}

/**
 * Adapts live webcam landmarks for both full-body (standing) and upper-body (seated at desk).
 * Preserves real 33 landmarks whenever hips are clearly visible inside the frame; otherwise
 * projects coherent hip/leg geometry from real shoulders and head tilt.
 * @param {Array<object>} rawLandmarks
 * @param {boolean} isDomVideo
 * @returns {Array<object>}
 */
export function adaptWebcamLandmarks(rawLandmarks, isDomVideo = false) {
  if (!Array.isArray(rawLandmarks) || rawLandmarks.length === ZERO) {
    return [];
  }

  const mirrored = mirrorLandmarksIfNeeded(rawLandmarks, isDomVideo);
  if (!isDomVideo || mirrored.length <= LANDMARK_INDEX.RIGHT_HIP) {
    return mirrored;
  }

  const ls = mirrored[LANDMARK_INDEX.LEFT_SHOULDER];
  const rs = mirrored[LANDMARK_INDEX.RIGHT_SHOULDER];
  const lh = mirrored[LANDMARK_INDEX.LEFT_HIP];
  const rh = mirrored[LANDMARK_INDEX.RIGHT_HIP];

  const hasFullBodyHips =
    isValidFiniteLandmark(ls) &&
    isValidFiniteLandmark(rs) &&
    isValidFiniteLandmark(lh) &&
    isValidFiniteLandmark(rh) &&
    (ls.visibility ?? ZERO) >= BIOMECHANICS_THRESHOLDS.MIN_LANDMARK_VISIBILITY &&
    (rs.visibility ?? ZERO) >= BIOMECHANICS_THRESHOLDS.MIN_LANDMARK_VISIBILITY &&
    (lh.visibility ?? ZERO) >= WEBCAM_FULL_BODY_HIP_MIN_VIS &&
    (rh.visibility ?? ZERO) >= WEBCAM_FULL_BODY_HIP_MIN_VIS &&
    lh.y <= WEBCAM_FULL_BODY_HIP_MAX_Y &&
    rh.y <= WEBCAM_FULL_BODY_HIP_MAX_Y;

  if (hasFullBodyHips) {
    return mirrored;
  }

  const hasSeatedUpperBody =
    isValidFiniteLandmark(ls) &&
    isValidFiniteLandmark(rs) &&
    (ls.visibility ?? ZERO) >= WEBCAM_UPPER_BODY_MIN_VIS &&
    (rs.visibility ?? ZERO) >= WEBCAM_UPPER_BODY_MIN_VIS;

  if (!hasSeatedUpperBody) {
    return mirrored;
  }

  const out = mirrored.map((lm, idx) => {
    if (idx <= 22 && isValidFiniteLandmark(lm) && (lm.visibility ?? ZERO) >= WEBCAM_UPPER_BODY_MIN_VIS) {
      return { ...lm, visibility: Math.max(lm.visibility, WEBCAM_RENDER_BOOST_VIS) };
    }
    return lm;
  });

  const nose = out[LANDMARK_INDEX.NOSE];
  const { dx, dy, shoulderWidth } = estimateSeatedHipOffset(ls, rs, nose);
  const shoulderMidX = (ls.x + rs.x) * 0.5;
  const shoulderMidY = (ls.y + rs.y) * 0.5;
  const hipMidX = shoulderMidX + dx;
  const hipMidY = shoulderMidY + dy;
  const hipHalf = shoulderWidth * 0.36;

  out[LANDMARK_INDEX.LEFT_HIP] = createLandmark(hipMidX + hipHalf, hipMidY, ZERO, WEBCAM_SYNTHETIC_HIP_VIS);
  out[LANDMARK_INDEX.RIGHT_HIP] = createLandmark(hipMidX - hipHalf, hipMidY, ZERO, WEBCAM_SYNTHETIC_HIP_VIS);

  const kneeY = Math.min(WEBCAM_MAX_LOWER_Y, hipMidY + 0.14);
  const ankleY = Math.min(WEBCAM_MAX_LOWER_Y, kneeY + 0.14);
  if ((out[LANDMARK_INDEX.LEFT_KNEE]?.visibility ?? ZERO) < WEBCAM_UPPER_BODY_MIN_VIS) {
    out[LANDMARK_INDEX.LEFT_KNEE] = createLandmark(hipMidX + hipHalf, kneeY, ZERO, WEBCAM_UPPER_BODY_MIN_VIS);
  }
  if ((out[LANDMARK_INDEX.RIGHT_KNEE]?.visibility ?? ZERO) < WEBCAM_UPPER_BODY_MIN_VIS) {
    out[LANDMARK_INDEX.RIGHT_KNEE] = createLandmark(hipMidX - hipHalf, kneeY, ZERO, WEBCAM_UPPER_BODY_MIN_VIS);
  }
  if ((out[LANDMARK_INDEX.LEFT_ANKLE]?.visibility ?? ZERO) < WEBCAM_UPPER_BODY_MIN_VIS) {
    out[LANDMARK_INDEX.LEFT_ANKLE] = createLandmark(hipMidX + hipHalf, ankleY, ZERO, WEBCAM_UPPER_BODY_MIN_VIS);
  }
  if ((out[LANDMARK_INDEX.RIGHT_ANKLE]?.visibility ?? ZERO) < WEBCAM_UPPER_BODY_MIN_VIS) {
    out[LANDMARK_INDEX.RIGHT_ANKLE] = createLandmark(hipMidX - hipHalf, ankleY, ZERO, WEBCAM_UPPER_BODY_MIN_VIS);
  }

  return out;
}

const LANDMARK_INDEX = Object.freeze({
  NOSE: POSE_LANDMARK_INDICES.NOSE,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: POSE_LANDMARK_INDICES.LEFT_SHOULDER,
  RIGHT_SHOULDER: POSE_LANDMARK_INDICES.RIGHT_SHOULDER,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: POSE_LANDMARK_INDICES.LEFT_HIP,
  RIGHT_HIP: POSE_LANDMARK_INDICES.RIGHT_HIP,
  LEFT_KNEE: POSE_LANDMARK_INDICES.LEFT_KNEE,
  RIGHT_KNEE: POSE_LANDMARK_INDICES.RIGHT_KNEE,
  LEFT_ANKLE: POSE_LANDMARK_INDICES.LEFT_ANKLE,
  RIGHT_ANKLE: POSE_LANDMARK_INDICES.RIGHT_ANKLE,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
});

function createLandmark(x, y, z = ZERO, visibility = MEDIAPIPE_DEFAULTS.SYNTHETIC_VISIBILITY) {
  return { x, y, z, visibility };
}

function populateHeadLandmarks(landmarks, shoulderMid, torsoAxisX, torsoAxisY, visibility) {
  const headCenterX = shoulderMid.x + torsoAxisX * MEDIAPIPE_DEFAULTS.DEFAULT_TORSO_LENGTH * MEDIAPIPE_DEFAULTS.HEAD_OFFSET_RATIO;
  const headCenterY = shoulderMid.y + torsoAxisY * MEDIAPIPE_DEFAULTS.DEFAULT_TORSO_LENGTH * MEDIAPIPE_DEFAULTS.HEAD_OFFSET_RATIO;

  landmarks[LANDMARK_INDEX.NOSE] = createLandmark(headCenterX, headCenterY, ZERO, visibility);
  landmarks[LANDMARK_INDEX.LEFT_EYE_INNER] = createLandmark(headCenterX + MEDIAPIPE_DEFAULTS.EYE_OFFSET_X * 0.5, headCenterY - MEDIAPIPE_DEFAULTS.EYE_OFFSET_Y, ZERO, visibility);
  landmarks[LANDMARK_INDEX.LEFT_EYE] = createLandmark(headCenterX + MEDIAPIPE_DEFAULTS.EYE_OFFSET_X, headCenterY - MEDIAPIPE_DEFAULTS.EYE_OFFSET_Y, ZERO, visibility);
  landmarks[LANDMARK_INDEX.LEFT_EYE_OUTER] = createLandmark(headCenterX + MEDIAPIPE_DEFAULTS.EYE_OFFSET_X * 1.4, headCenterY - MEDIAPIPE_DEFAULTS.EYE_OFFSET_Y, ZERO, visibility);
  landmarks[LANDMARK_INDEX.RIGHT_EYE_INNER] = createLandmark(headCenterX - MEDIAPIPE_DEFAULTS.EYE_OFFSET_X * 0.5, headCenterY - MEDIAPIPE_DEFAULTS.EYE_OFFSET_Y, ZERO, visibility);
  landmarks[LANDMARK_INDEX.RIGHT_EYE] = createLandmark(headCenterX - MEDIAPIPE_DEFAULTS.EYE_OFFSET_X, headCenterY - MEDIAPIPE_DEFAULTS.EYE_OFFSET_Y, ZERO, visibility);
  landmarks[LANDMARK_INDEX.RIGHT_EYE_OUTER] = createLandmark(headCenterX - MEDIAPIPE_DEFAULTS.EYE_OFFSET_X * 1.4, headCenterY - MEDIAPIPE_DEFAULTS.EYE_OFFSET_Y, ZERO, visibility);
  landmarks[LANDMARK_INDEX.LEFT_EAR] = createLandmark(headCenterX + MEDIAPIPE_DEFAULTS.EAR_OFFSET_X, headCenterY - MEDIAPIPE_DEFAULTS.EYE_OFFSET_Y * 0.5, ZERO, visibility);
  landmarks[LANDMARK_INDEX.RIGHT_EAR] = createLandmark(headCenterX - MEDIAPIPE_DEFAULTS.EAR_OFFSET_X, headCenterY - MEDIAPIPE_DEFAULTS.EYE_OFFSET_Y * 0.5, ZERO, visibility);
  landmarks[LANDMARK_INDEX.MOUTH_LEFT] = createLandmark(headCenterX + MEDIAPIPE_DEFAULTS.MOUTH_OFFSET_X, headCenterY + MEDIAPIPE_DEFAULTS.MOUTH_OFFSET_Y, ZERO, visibility);
  landmarks[LANDMARK_INDEX.MOUTH_RIGHT] = createLandmark(headCenterX - MEDIAPIPE_DEFAULTS.MOUTH_OFFSET_X, headCenterY + MEDIAPIPE_DEFAULTS.MOUTH_OFFSET_Y, ZERO, visibility);
}

function populateArmLandmarks(landmarks, leftShoulder, rightShoulder, torsoAxisX, torsoAxisY, armSwing, visibility) {
  const downX = -torsoAxisX;
  const downY = -torsoAxisY;

  const populateSide = (shoulder, elbowIdx, wristIdx, pinkyIdx, indexIdx, thumbIdx, sideSign, swing) => {
    const elbowX = shoulder.x + sideSign * MEDIAPIPE_DEFAULTS.SHOULDER_HALF_WIDTH * 0.35 + downX * MEDIAPIPE_DEFAULTS.UPPER_ARM_LENGTH + swing;
    const elbowY = shoulder.y + downY * MEDIAPIPE_DEFAULTS.UPPER_ARM_LENGTH;
    const wristX = elbowX + downX * MEDIAPIPE_DEFAULTS.FOREARM_LENGTH + swing * 0.6;
    const wristY = elbowY + downY * MEDIAPIPE_DEFAULTS.FOREARM_LENGTH;

    landmarks[elbowIdx] = createLandmark(elbowX, elbowY, ZERO, visibility);
    landmarks[wristIdx] = createLandmark(wristX, wristY, ZERO, visibility);
    landmarks[pinkyIdx] = createLandmark(wristX + sideSign * 0.01, wristY + MEDIAPIPE_DEFAULTS.HAND_EXTENSION, ZERO, visibility);
    landmarks[indexIdx] = createLandmark(wristX, wristY + MEDIAPIPE_DEFAULTS.HAND_EXTENSION, ZERO, visibility);
    landmarks[thumbIdx] = createLandmark(wristX - sideSign * 0.01, wristY + MEDIAPIPE_DEFAULTS.HAND_EXTENSION * 0.7, ZERO, visibility);
  };

  populateSide(leftShoulder, LANDMARK_INDEX.LEFT_ELBOW, LANDMARK_INDEX.LEFT_WRIST, LANDMARK_INDEX.LEFT_PINKY, LANDMARK_INDEX.LEFT_INDEX, LANDMARK_INDEX.LEFT_THUMB, ONE, armSwing);
  populateSide(rightShoulder, LANDMARK_INDEX.RIGHT_ELBOW, LANDMARK_INDEX.RIGHT_WRIST, LANDMARK_INDEX.RIGHT_PINKY, LANDMARK_INDEX.RIGHT_INDEX, LANDMARK_INDEX.RIGHT_THUMB, -ONE, -armSwing);
}

function populateLegLandmarks(landmarks, leftHip, rightHip, legAxisX, legAxisY, stridePhase, visibility) {
  const strideOffset = Math.sin(stridePhase) * MEDIAPIPE_DEFAULTS.STRIDE_AMPLITUDE_X;
  const leftLift = Math.max(ZERO, Math.sin(stridePhase)) * MEDIAPIPE_DEFAULTS.STRIDE_LIFT_Y;
  const rightLift = Math.max(ZERO, -Math.sin(stridePhase)) * MEDIAPIPE_DEFAULTS.STRIDE_LIFT_Y;

  const populateSide = (hip, kneeIdx, ankleIdx, heelIdx, footIdx, sideStride, lift) => {
    const kneeX = hip.x + legAxisX * MEDIAPIPE_DEFAULTS.THIGH_LENGTH + sideStride * 0.5;
    const kneeY = hip.y + legAxisY * MEDIAPIPE_DEFAULTS.THIGH_LENGTH - lift * 0.5;
    const ankleX = kneeX + legAxisX * MEDIAPIPE_DEFAULTS.SHIN_LENGTH + sideStride;
    const ankleY = kneeY + legAxisY * MEDIAPIPE_DEFAULTS.SHIN_LENGTH - lift;

    landmarks[kneeIdx] = createLandmark(kneeX, kneeY, ZERO, visibility);
    landmarks[ankleIdx] = createLandmark(ankleX, ankleY, ZERO, visibility);
    landmarks[heelIdx] = createLandmark(ankleX - MEDIAPIPE_DEFAULTS.FOOT_EXTENSION_X * 0.4, ankleY + MEDIAPIPE_DEFAULTS.FOOT_EXTENSION_Y, ZERO, visibility);
    landmarks[footIdx] = createLandmark(ankleX + MEDIAPIPE_DEFAULTS.FOOT_EXTENSION_X, ankleY + MEDIAPIPE_DEFAULTS.FOOT_EXTENSION_Y, ZERO, visibility);
  };

  populateSide(leftHip, LANDMARK_INDEX.LEFT_KNEE, LANDMARK_INDEX.LEFT_ANKLE, LANDMARK_INDEX.LEFT_HEEL, LANDMARK_INDEX.LEFT_FOOT_INDEX, strideOffset, leftLift);
  populateSide(rightHip, LANDMARK_INDEX.RIGHT_KNEE, LANDMARK_INDEX.RIGHT_ANKLE, LANDMARK_INDEX.RIGHT_HEEL, LANDMARK_INDEX.RIGHT_FOOT_INDEX, -strideOffset, rightLift);
}

/**
 * Generates 33 anatomically coherent pose landmarks via exact inverse kinematics so
 * BiomechanicsCalculator recovers exact Center of Mass and trunk angle.
 * @param {{
 *   comX?: number,
 *   comY?: number,
 *   trunkAngleDeg?: number,
 *   tiltSign?: number,
 *   stridePhase?: number,
 *   visibility?: number,
 *   torsoLength?: number
 * }} [poseParams={}]
 * @returns {Array<{ x: number, y: number, z: number, visibility: number }>}
 */
export function generateSyntheticLandmarks({
  comX = SCENARIO_TRAJECTORY_CONFIG.BASELINE_X,
  comY = SCENARIO_TRAJECTORY_CONFIG.BASELINE_Y,
  trunkAngleDeg = SCENARIO_TRAJECTORY_CONFIG.UPRIGHT_ANGLE_DEG,
  tiltSign = ONE,
  stridePhase = ZERO,
  visibility = MEDIAPIPE_DEFAULTS.SYNTHETIC_VISIBILITY,
  torsoLength = MEDIAPIPE_DEFAULTS.DEFAULT_TORSO_LENGTH,
} = {}) {
  const clampedAngle = Math.min(
    BIOMECHANICS_THRESHOLDS.MAX_TRUNK_ANGLE_DEG,
    Math.max(BIOMECHANICS_THRESHOLDS.MIN_TRUNK_ANGLE_DEG, trunkAngleDeg)
  );
  const rad = clampedAngle / BIOMECHANICS_THRESHOLDS.RAD_TO_DEG;
  const sign = tiltSign < ZERO ? -ONE : ONE;
  const dy = torsoLength * Math.sin(rad);
  const dx = torsoLength * Math.cos(rad);

  const shoulderWeight = BIOMECHANICS_THRESHOLDS.COM_SHOULDER_WEIGHT;
  const hipMid = {
    x: comX - shoulderWeight * dx * sign,
    y: comY + shoulderWeight * dy,
    z: ZERO,
  };
  const shoulderMid = {
    x: hipMid.x + dx * sign,
    y: hipMid.y - dy,
    z: ZERO,
  };

  const landmarks = new Array(TOTAL_POSE_LANDMARKS);
  const leftShoulder = createLandmark(
    shoulderMid.x + MEDIAPIPE_DEFAULTS.SHOULDER_HALF_WIDTH,
    shoulderMid.y,
    ZERO,
    visibility
  );
  const rightShoulder = createLandmark(
    shoulderMid.x - MEDIAPIPE_DEFAULTS.SHOULDER_HALF_WIDTH,
    shoulderMid.y,
    ZERO,
    visibility
  );
  const leftHip = createLandmark(
    hipMid.x + MEDIAPIPE_DEFAULTS.HIP_HALF_WIDTH,
    hipMid.y,
    ZERO,
    visibility
  );
  const rightHip = createLandmark(
    hipMid.x - MEDIAPIPE_DEFAULTS.HIP_HALF_WIDTH,
    hipMid.y,
    ZERO,
    visibility
  );

  landmarks[LANDMARK_INDEX.LEFT_SHOULDER] = leftShoulder;
  landmarks[LANDMARK_INDEX.RIGHT_SHOULDER] = rightShoulder;
  landmarks[LANDMARK_INDEX.LEFT_HIP] = leftHip;
  landmarks[LANDMARK_INDEX.RIGHT_HIP] = rightHip;

  const torsoAxisX = (shoulderMid.x - hipMid.x) / torsoLength;
  const torsoAxisY = (shoulderMid.y - hipMid.y) / torsoLength;
  const armSwing = Math.sin(stridePhase) * MEDIAPIPE_DEFAULTS.STRIDE_AMPLITUDE_X * 0.6;

  populateHeadLandmarks(landmarks, shoulderMid, torsoAxisX, torsoAxisY, visibility);
  populateArmLandmarks(landmarks, leftShoulder, rightShoulder, torsoAxisX, torsoAxisY, armSwing, visibility);
  populateLegLandmarks(landmarks, leftHip, rightHip, -torsoAxisX, -torsoAxisY, stridePhase, visibility);

  return landmarks;
}

function evaluateNormalTrajectory(elapsedMs) {
  const cfg = SCENARIO_TRAJECTORY_CONFIG.NORMAL;
  const twoPi = SCENARIO_TRAJECTORY_CONFIG.TWO_PI;
  return {
    comX:
      SCENARIO_TRAJECTORY_CONFIG.BASELINE_X +
      cfg.SWAY_X_AMPLITUDE * Math.sin((twoPi * elapsedMs) / cfg.SWAY_X_PERIOD_MS),
    comY:
      SCENARIO_TRAJECTORY_CONFIG.BASELINE_Y +
      cfg.BOB_Y_AMPLITUDE * Math.sin((twoPi * elapsedMs) / cfg.BOB_Y_PERIOD_MS),
    trunkAngleDeg:
      cfg.BASE_ANGLE_DEG +
      cfg.ANGLE_SWAY_DEG * Math.cos((twoPi * elapsedMs) / cfg.ANGLE_PERIOD_MS),
    stridePhase: (twoPi * elapsedMs) / cfg.STRIDE_PERIOD_MS,
  };
}

function evaluateImbalanceTrajectory(elapsedMs) {
  const cfg = SCENARIO_TRAJECTORY_CONFIG.DESEQUILIBRIO;
  const warmup = cfg.WARMUP_MS;
  const baseX = SCENARIO_TRAJECTORY_CONFIG.BASELINE_X;
  const baseY = SCENARIO_TRAJECTORY_CONFIG.BASELINE_Y;
  const uprightAngle = SCENARIO_TRAJECTORY_CONFIG.UPRIGHT_ANGLE_DEG;

  if (elapsedMs < warmup) {
    return { comX: baseX, comY: baseY, trunkAngleDeg: uprightAngle, stridePhase: ZERO };
  }
  if (elapsedMs < cfg.TILT_END_MS) {
    const p = (elapsedMs - warmup) / (cfg.TILT_END_MS - warmup);
    return {
      comX: baseX + cfg.TILT_X_DELTA * p,
      comY: baseY + cfg.TILT_Y_DELTA * p,
      trunkAngleDeg: uprightAngle - (uprightAngle - cfg.TILT_ANGLE_DEG) * p,
      stridePhase: ZERO,
    };
  }
  if (elapsedMs < cfg.DESCENT_END_MS) {
    const p = (elapsedMs - cfg.TILT_END_MS) / (cfg.DESCENT_END_MS - cfg.TILT_END_MS);
    return {
      comX: baseX + cfg.TILT_X_DELTA + (cfg.HOLD_X - baseX - cfg.TILT_X_DELTA) * p,
      comY: baseY + cfg.TILT_Y_DELTA + cfg.DESCENT_Y_DELTA * p,
      trunkAngleDeg: cfg.TILT_ANGLE_DEG,
      stridePhase: ZERO,
    };
  }
  if (elapsedMs < cfg.HOLD_END_MS) {
    return { comX: cfg.HOLD_X, comY: cfg.HOLD_Y, trunkAngleDeg: cfg.HOLD_ANGLE_DEG, stridePhase: ZERO };
  }
  if (elapsedMs < cfg.RECOVERY_END_MS) {
    const p = (elapsedMs - cfg.HOLD_END_MS) / (cfg.RECOVERY_END_MS - cfg.HOLD_END_MS);
    return {
      comX: cfg.HOLD_X - (cfg.HOLD_X - baseX) * p,
      comY: cfg.HOLD_Y - (cfg.HOLD_Y - baseY) * p,
      trunkAngleDeg: cfg.HOLD_ANGLE_DEG + (uprightAngle - cfg.HOLD_ANGLE_DEG) * p,
      stridePhase: ZERO,
    };
  }
  return { comX: baseX, comY: baseY, trunkAngleDeg: uprightAngle, stridePhase: ZERO };
}

function evaluateFallTrajectory(elapsedMs) {
  const cfg = SCENARIO_TRAJECTORY_CONFIG.QUEDA_CRITICA;
  const warmup = cfg.WARMUP_MS;
  const baseX = SCENARIO_TRAJECTORY_CONFIG.BASELINE_X;
  const baseY = SCENARIO_TRAJECTORY_CONFIG.BASELINE_Y;
  const uprightAngle = SCENARIO_TRAJECTORY_CONFIG.UPRIGHT_ANGLE_DEG;

  if (elapsedMs < warmup) {
    return { comX: baseX, comY: baseY, trunkAngleDeg: uprightAngle, stridePhase: ZERO };
  }
  if (elapsedMs < cfg.FALL_END_MS) {
    const p = (elapsedMs - warmup) / cfg.FALL_DURATION_MS;
    const angleDrop = (uprightAngle - cfg.FALLEN_ANGLE_DEG) * Math.min(ONE, p * cfg.ANGLE_DROP_ACCEL);
    return {
      comX: baseX + cfg.FALL_X_DELTA * p,
      comY: baseY + cfg.FALL_Y_DELTA * p,
      trunkAngleDeg: Math.max(cfg.FALLEN_ANGLE_DEG, uprightAngle - angleDrop),
      stridePhase: ZERO,
    };
  }
  return {
    comX: cfg.FALLEN_X,
    comY: cfg.FALLEN_Y,
    trunkAngleDeg: cfg.FALLEN_ANGLE_DEG,
    stridePhase: ZERO,
  };
}

/**
 * Time-parameterized biomechanical scenario generator producing PoseFrame instances
 * calibrated across 10-60 FPS and sensitivity slider bounds [25°, 45°].
 */
export class BiomechanicalScenarioSimulator {
  constructor() {
    this._activeScenario = null;
    this._startTimestampMs = null;
    this._lastTimestampMs = null;
  }

  /**
   * @param {string} scenarioName
   * @param {number|null} [startTimestampMs=null]
   */
  startScenario(scenarioName, startTimestampMs = null) {
    if (!Object.values(SIMULATION_SCENARIOS).includes(scenarioName)) {
      throw new Error(`Unknown simulation scenario: ${String(scenarioName)}`);
    }
    this._activeScenario = scenarioName;
    this._startTimestampMs =
      typeof startTimestampMs === 'number' && Number.isFinite(startTimestampMs)
        ? Math.max(ZERO, startTimestampMs)
        : null;
    this._lastTimestampMs = this._startTimestampMs;
  }

  stop() {
    this._activeScenario = null;
    this._startTimestampMs = null;
    this._lastTimestampMs = null;
  }

  getActiveScenario() {
    return this._activeScenario;
  }

  /**
   * Samples a PoseFrame for the active scenario at `timestampMs`.
   * @param {number} [timestampMs=Date.now()]
   * @returns {PoseFrame | null}
   */
  samplePoseFrame(timestampMs = Date.now()) {
    if (!this._activeScenario) {
      return null;
    }

    const numericTs =
      typeof timestampMs === 'number' && Number.isFinite(timestampMs)
        ? Math.max(ZERO, timestampMs)
        : Date.now();

    if (this._startTimestampMs === null) {
      this._startTimestampMs = numericTs;
    }

    const safeTimestampMs =
      this._lastTimestampMs !== null
        ? Math.max(numericTs, this._lastTimestampMs + MEDIAPIPE_DEFAULTS.TIMESTAMP_INCREMENT_MS)
        : numericTs;
    this._lastTimestampMs = safeTimestampMs;

    const elapsedMs = Math.max(ZERO, safeTimestampMs - this._startTimestampMs);

    let poseParams;
    if (this._activeScenario === SIMULATION_SCENARIOS.DESEQUILIBRIO) {
      poseParams = evaluateImbalanceTrajectory(elapsedMs);
    } else if (this._activeScenario === SIMULATION_SCENARIOS.QUEDA_CRITICA) {
      poseParams = evaluateFallTrajectory(elapsedMs);
    } else {
      poseParams = evaluateNormalTrajectory(elapsedMs);
    }

    return new PoseFrame({
      landmarks: generateSyntheticLandmarks(poseParams),
      timestampMs: safeTimestampMs,
    });
  }
}

/**
 * Edge MediaPipe Pose Landmarker adapter with lazy CDN ESM loading, GPU->CPU fallback,
 * graceful offline degradation, and integrated BiomechanicalScenarioSimulator.
 */
export class MediaPipePoseAdapter {
  /**
   * @param {object} [options={}]
   */
  constructor({
    cdnUrl = MEDIAPIPE_DEFAULTS.CDN_ESM_URL,
    wasmBaseUrl = MEDIAPIPE_DEFAULTS.WASM_BASE_URL,
    modelAssetPath = MEDIAPIPE_DEFAULTS.MODEL_ASSET_PATH,
    visionLoader = null,
    simulator = new BiomechanicalScenarioSimulator(),
    logger = console,
  } = {}) {
    this._cdnUrl = cdnUrl;
    this._wasmBaseUrl = wasmBaseUrl;
    this._modelAssetPath = modelAssetPath;
    this._visionLoader = typeof visionLoader === 'function' ? visionLoader : null;
    this._simulator = simulator;
    this._logger = logger;

    this._landmarker = null;
    this._lastVideoTimestampMs = -ONE;
    this._videoEpochOffsetMs = null;
    this._initPromise = null;
    this.isReady = false;
    this.activeDelegate = null;
    this.lastError = null;
  }

  async _createLandmarkerWithDelegate(PoseLandmarker, visionFileset, delegate) {
    return PoseLandmarker.createFromOptions(visionFileset, {
      baseOptions: {
        modelAssetPath: this._modelAssetPath,
        delegate,
      },
      runningMode: MEDIAPIPE_DEFAULTS.RUNNING_MODE,
      numPoses: MEDIAPIPE_DEFAULTS.NUM_POSES,
      minPoseDetectionConfidence: MEDIAPIPE_DEFAULTS.MIN_POSE_DETECTION_CONFIDENCE,
      minPosePresenceConfidence: MEDIAPIPE_DEFAULTS.MIN_POSE_PRESENCE_CONFIDENCE,
      minTrackingConfidence: MEDIAPIPE_DEFAULTS.MIN_TRACKING_CONFIDENCE,
    });
  }

  /**
   * Lazily loads `@mediapipe/tasks-vision` and creates a VIDEO-mode PoseLandmarker
   * with GPU -> CPU fallback. Never throws on offline/CDN/WebGL failures.
   * @returns {Promise<{ ok: boolean, delegate: string|null, error: Error|null }>}
   */
  async initialize() {
    if (this.isReady && this._landmarker) {
      return { ok: true, delegate: this.activeDelegate, error: null };
    }
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = this._performInitialize().finally(() => {
      this._initPromise = null;
    });
    return this._initPromise;
  }

  async _performInitialize() {
    try {
      const visionModule = this._visionLoader
        ? await this._visionLoader()
        : await import(this._cdnUrl);

      const { FilesetResolver, PoseLandmarker } = visionModule || {};
      if (!FilesetResolver || !PoseLandmarker) {
        throw new Error('MediaPipe vision module missing FilesetResolver or PoseLandmarker');
      }

      const visionFileset = await FilesetResolver.forVisionTasks(this._wasmBaseUrl);

      try {
        this._landmarker = await this._createLandmarkerWithDelegate(
          PoseLandmarker,
          visionFileset,
          MEDIAPIPE_DEFAULTS.DELEGATE_GPU
        );
        this.activeDelegate = MEDIAPIPE_DEFAULTS.DELEGATE_GPU;
      } catch (gpuError) {
        this._logger?.warn?.(
          '[MediaPipePoseAdapter] GPU delegate unavailable, falling back to CPU:',
          gpuError?.message || gpuError
        );
        this._landmarker = await this._createLandmarkerWithDelegate(
          PoseLandmarker,
          visionFileset,
          MEDIAPIPE_DEFAULTS.DELEGATE_CPU
        );
        this.activeDelegate = MEDIAPIPE_DEFAULTS.DELEGATE_CPU;
      }

      this.isReady = true;
      this.lastError = null;
      return { ok: true, delegate: this.activeDelegate, error: null };
    } catch (error) {
      this.isReady = false;
      this.activeDelegate = null;
      this._landmarker = null;
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this._logger?.warn?.(
        '[MediaPipePoseAdapter] MediaPipe initialization degraded:',
        this.lastError.message
      );
      return { ok: false, delegate: null, error: this.lastError };
    }
  }

  /**
   * Runs pose inference on a ready HTMLVideoElement with strict monotonic timestamp guard.
   * @param {HTMLVideoElement | object | null} videoElement
   * @param {number} [timestampMs=performance.now()]
   * @returns {PoseFrame | null}
   */
  detectPose(videoElement, timestampMs = Date.now()) {
    if (
      !this.isReady ||
      !this._landmarker ||
      !videoElement ||
      (videoElement.readyState ?? ZERO) < MEDIAPIPE_DEFAULTS.VIDEO_READY_STATE_MIN ||
      (videoElement.videoWidth ?? ZERO) <= ZERO
    ) {
      return null;
    }

    const numericTs =
      typeof timestampMs === 'number' && Number.isFinite(timestampMs)
        ? Math.max(ZERO, timestampMs)
        : ZERO;

    const safeTimestampMs =
      this._lastVideoTimestampMs >= ZERO && numericTs <= this._lastVideoTimestampMs
        ? this._lastVideoTimestampMs + MEDIAPIPE_DEFAULTS.TIMESTAMP_INCREMENT_MS
        : numericTs;
    this._lastVideoTimestampMs = safeTimestampMs;

    let wasmTimestampMs = safeTimestampMs;
    if (safeTimestampMs > EPOCH_TIMESTAMP_THRESHOLD_MS) {
      if (this._videoEpochOffsetMs === null) {
        this._videoEpochOffsetMs = safeTimestampMs;
      }
      wasmTimestampMs = Math.max(ONE, safeTimestampMs - this._videoEpochOffsetMs + ONE);
    }

    const isDomVideo = typeof videoElement.play === 'function';

    try {
      const result = this._landmarker.detectForVideo(videoElement, wasmTimestampMs);
      const rawLandmarks = Array.isArray(result?.landmarks?.[ZERO])
        ? result.landmarks[ZERO]
        : [];
      const adaptedLandmarks = adaptWebcamLandmarks(rawLandmarks, isDomVideo);
      return new PoseFrame({
        landmarks: adaptedLandmarks,
        timestampMs: safeTimestampMs,
      });
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this._logger?.warn?.(
        '[MediaPipePoseAdapter] detectForVideo error:',
        this.lastError.message
      );
      return null;
    }
  }

  startScenario(scenarioName, startTimestampMs = null) {
    this._simulator.startScenario(scenarioName, startTimestampMs);
  }

  stopScenario() {
    this._simulator.stop();
  }

  getActiveScenario() {
    return this._simulator.getActiveScenario();
  }

  sampleSimulatedPoseFrame(timestampMs = Date.now()) {
    return this._simulator.samplePoseFrame(timestampMs);
  }

  getStatus() {
    return {
      isReady: this.isReady,
      activeDelegate: this.activeDelegate,
      activeScenario: this._simulator.getActiveScenario(),
      lastError: this.lastError?.message ?? null,
    };
  }

  close() {
    if (this._landmarker && typeof this._landmarker.close === 'function') {
      try {
        this._landmarker.close();
      } catch (error) {
        this._logger?.warn?.('[MediaPipePoseAdapter] Error closing landmarker:', error?.message || error);
      }
    }
    this._landmarker = null;
    this.isReady = false;
    this.activeDelegate = null;
    this._lastVideoTimestampMs = -ONE;
    this._videoEpochOffsetMs = null;
  }
}
