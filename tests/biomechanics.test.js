import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BIOMECHANICS_THRESHOLDS,
  POSE_LANDMARK_INDICES,
  REQUIRED_POSTURE_LANDMARK_INDICES,
  RISK_SCORE_WEIGHTS,
  TOTAL_POSE_LANDMARKS,
} from '../src/config/thresholds.js';
import { ENV_TEMPLATE } from '../src/config/env.example.js';
import {
  ENV_STORAGE_KEY,
  clearEnvConfig,
  createDefaultEnvConfig,
  getFirebaseConfig,
  getGeminiApiKey,
  isValidFirebaseConfig,
  loadEnvConfig,
  normalizeFirebaseConfig,
  normalizeGeminiApiKey,
  saveEnvConfig,
} from '../src/config/env.js';
import { PoseFrame } from '../src/domain/entities/PoseFrame.js';
import {
  AI_SOURCES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  MobilityAlert,
} from '../src/domain/entities/MobilityAlert.js';
import { DailyMetrics } from '../src/domain/entities/DailyMetrics.js';
import { BiomechanicsCalculator } from '../src/domain/services/BiomechanicsCalculator.js';
import {
  POSTURE_STATES,
  PostureStateMachine,
} from '../src/domain/services/PostureStateMachine.js';
import {
  AlertRepository,
  NotImplementedError,
} from '../src/domain/repositories/AlertRepository.js';
import { TriageAIService } from '../src/domain/repositories/TriageAIService.js';
import { ProcessPoseFrameUseCase } from '../src/application/ProcessPoseFrameUseCase.js';
import {
  REGISTER_ALERT_RESULTS,
  RegisterEmergencyAlertUseCase,
} from '../src/application/RegisterEmergencyAlertUseCase.js';
import { UpdateMobilityMetricsUseCase } from '../src/application/UpdateMobilityMetricsUseCase.js';

function createSyntheticLandmarks({
  shoulderX = 0.5,
  shoulderY = 0.25,
  hipX = 0.5,
  hipY = 0.55,
  visibility = 0.95,
  z = 0,
  count = TOTAL_POSE_LANDMARKS,
} = {}) {
  const landmarks = Array.from({ length: count }, () => ({
    x: 0.5,
    y: 0.5,
    z,
    visibility,
  }));

  if (count > POSE_LANDMARK_INDICES.RIGHT_HIP) {
    landmarks[POSE_LANDMARK_INDICES.LEFT_SHOULDER] = {
      x: shoulderX - 0.08,
      y: shoulderY,
      z,
      visibility,
    };
    landmarks[POSE_LANDMARK_INDICES.RIGHT_SHOULDER] = {
      x: shoulderX + 0.08,
      y: shoulderY,
      z,
      visibility,
    };
    landmarks[POSE_LANDMARK_INDICES.LEFT_HIP] = {
      x: hipX - 0.06,
      y: hipY,
      z,
      visibility,
    };
    landmarks[POSE_LANDMARK_INDICES.RIGHT_HIP] = {
      x: hipX + 0.06,
      y: hipY,
      z,
      visibility,
    };
  }

  return landmarks;
}

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

describe('Config: thresholds.js & env.js', () => {
  it('thresholds.js is deeply frozen and contains all canonical constants', () => {
    assert.equal(Object.isFrozen(BIOMECHANICS_THRESHOLDS), true);
    assert.equal(Object.isFrozen(BIOMECHANICS_THRESHOLDS.RISK_SCORE_WEIGHTS), true);
    assert.equal(Object.isFrozen(RISK_SCORE_WEIGHTS), true);
    assert.equal(Object.isFrozen(POSE_LANDMARK_INDICES), true);
    assert.equal(Object.isFrozen(REQUIRED_POSTURE_LANDMARK_INDICES), true);
    assert.equal(TOTAL_POSE_LANDMARKS, 33);

    assert.equal(BIOMECHANICS_THRESHOLDS.MIN_LANDMARK_VISIBILITY, 0.5);
    assert.equal(BIOMECHANICS_THRESHOLDS.SMOOTHING_WINDOW_SIZE, 4);
    assert.equal(BIOMECHANICS_THRESHOLDS.MIN_DELTA_TIME_MS, 16);
    assert.equal(BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG, 35.0);
    assert.equal(BIOMECHANICS_THRESHOLDS.TRUNK_IMBALANCE_ANGLE_DEG, 58.0);
    assert.equal(BIOMECHANICS_THRESHOLDS.FALL_VERTICAL_VELOCITY_THRESHOLD, 0.55);
    assert.equal(BIOMECHANICS_THRESHOLDS.IMBALANCE_VERTICAL_VELOCITY_THRESHOLD, 0.20);
    assert.equal(BIOMECHANICS_THRESHOLDS.IMMOBILITY_CONFIRMATION_MS, 5000);
    assert.equal(BIOMECHANICS_THRESHOLDS.IMBALANCE_RECOVERY_MAX_MS, 3000);
    assert.equal(BIOMECHANICS_THRESHOLDS.MOVEMENT_STILLNESS_EPSILON, 0.035);
    assert.equal(BIOMECHANICS_THRESHOLDS.ALERT_DEBOUNCE_MS, 15000);
    assert.equal(BIOMECHANICS_THRESHOLDS.METRICS_SYNC_INTERVAL_MS, 60000);
    assert.equal(BIOMECHANICS_THRESHOLDS.RISK_SCORE_WEIGHTS, RISK_SCORE_WEIGHTS);

    assert.throws(() => {
      BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG = 99;
    }, TypeError);
    assert.throws(() => {
      BIOMECHANICS_THRESHOLDS.RISK_SCORE_WEIGHTS.FALL_MAX_POINTS = 99;
    }, TypeError);
  });

  it('env.example.js exports a secret-free frozen template', () => {
    assert.equal(Object.isFrozen(ENV_TEMPLATE), true);
    assert.equal(Object.isFrozen(ENV_TEMPLATE.firebaseConfig), true);
    assert.equal(ENV_TEMPLATE.firebaseConfig.apiKey, '');
    assert.equal(ENV_TEMPLATE.geminiApiKey, '');
  });

  it('env.js handles Node environment safely without localStorage and validates credentials', () => {
    const loaded = loadEnvConfig();
    assert.deepEqual(loaded, createDefaultEnvConfig());
    assert.equal(getFirebaseConfig(), null);
    assert.equal(getGeminiApiKey(), '');
    assert.equal(isValidFirebaseConfig(null), false);
    assert.equal(isValidFirebaseConfig({ apiKey: 'YOUR_API_KEY' }), false);

    const memoryStorage = createMemoryStorage();
    const validFirebaseJson = JSON.stringify({
      apiKey: 'AIzaSyDemoKey123',
      authDomain: 'guardiao-demo.firebaseapp.com',
      projectId: 'guardiao-demo',
      appId: '1:123456:web:abcdef',
    });

    assert.equal(isValidFirebaseConfig(validFirebaseJson), true);
    assert.deepEqual(normalizeFirebaseConfig(validFirebaseJson), {
      apiKey: 'AIzaSyDemoKey123',
      authDomain: 'guardiao-demo.firebaseapp.com',
      projectId: 'guardiao-demo',
      storageBucket: '',
      messagingSenderId: '',
      appId: '1:123456:web:abcdef',
    });
    assert.equal(normalizeGeminiApiKey('  SUA_CHAVE_AQUI  '), '');
    assert.equal(normalizeGeminiApiKey('  gem-key-123  '), 'gem-key-123');

    const saveResult = saveEnvConfig(
      { firebaseConfig: validFirebaseJson, geminiApiKey: 'gem-key-123', patientId: 'idoso_99' },
      memoryStorage
    );
    assert.equal(saveResult.ok, true);
    assert.equal(saveResult.persisted, true);
    assert.ok(memoryStorage.getItem(ENV_STORAGE_KEY));

    assert.deepEqual(getFirebaseConfig(memoryStorage)?.projectId, 'guardiao-demo');
    assert.equal(getGeminiApiKey(memoryStorage), 'gem-key-123');

    const clearResult = clearEnvConfig(memoryStorage);
    assert.equal(clearResult.ok, true);
    assert.equal(clearResult.cleared, true);
    assert.equal(getFirebaseConfig(memoryStorage), null);

    for (const invalidInput of [null, 'bad', 123, []]) {
      const invalidSave = saveEnvConfig(invalidInput, memoryStorage);
      assert.equal(invalidSave.ok, false);
      assert.equal(invalidSave.persisted, false);
      assert.equal(typeof invalidSave.error, 'string');
      assert.deepEqual(invalidSave.config, createDefaultEnvConfig());
    }
  });
});

describe('Domain Entity: PoseFrame', () => {
  it('accepts 33 landmarks and validates critical shoulder/hip visibility', () => {
    const landmarks = createSyntheticLandmarks({ visibility: 0.9 });
    const frame = new PoseFrame({ landmarks, timestampMs: 1200 });

    assert.equal(frame.timestampMs, 1200);
    assert.equal(frame.hasRequiredLandmarks(), true);
    assert.equal(frame.isCompletePose(), true);
    assert.ok(frame.getTorsoLandmarks());
  });

  it('returns false when any critical landmark (11, 12, 23, 24) has low visibility (< 0.5)', () => {
    const landmarks = createSyntheticLandmarks({ visibility: 0.9 });
    landmarks[POSE_LANDMARK_INDICES.LEFT_HIP].visibility = 0.2;

    const frame = new PoseFrame({ landmarks, timestampMs: 1233 });
    assert.equal(frame.hasRequiredLandmarks(), false);
    assert.equal(frame.getMinRequiredVisibility(), 0.2);
  });

  it('accepts empty and incomplete landmark arrays without throwing', () => {
    const emptyFrame = new PoseFrame({ landmarks: [], timestampMs: 100 });
    assert.equal(emptyFrame.landmarks.length, 0);
    assert.equal(emptyFrame.hasRequiredLandmarks(), false);
    assert.equal(emptyFrame.isCompletePose(), false);
    assert.equal(emptyFrame.getTorsoLandmarks(), null);
    assert.equal(emptyFrame.getMinRequiredVisibility(), 0);

    const incompleteLandmarks = createSyntheticLandmarks({ count: 10 });
    const incompleteFrame = new PoseFrame(incompleteLandmarks, 200);
    assert.equal(incompleteFrame.landmarks.length, 10);
    assert.equal(incompleteFrame.hasRequiredLandmarks(), false);
    assert.equal(incompleteFrame.isCompletePose(), false);
  });

  it('rejects null, empty string, and boolean landmark coordinates or visibilities', () => {
    const nullFilled = Array.from({ length: TOTAL_POSE_LANDMARKS }, () => ({
      x: null,
      y: null,
      z: null,
      visibility: 0.9,
    }));
    const nullFrame = new PoseFrame(nullFilled, 100);
    assert.equal(nullFrame.getLandmark(0), null);
    assert.equal(nullFrame.hasRequiredLandmarks(), false);

    const mixedInvalid = createSyntheticLandmarks({ visibility: 0.9 });
    mixedInvalid[POSE_LANDMARK_INDICES.LEFT_SHOULDER] = {
      x: '',
      y: false,
      z: null,
      visibility: true,
    };
    mixedInvalid[POSE_LANDMARK_INDICES.RIGHT_SHOULDER] = {
      x: 0.58,
      y: 0.25,
      z: 0,
      visibility: true,
    };
    const mixedFrame = new PoseFrame(mixedInvalid, 150);
    assert.equal(mixedFrame.getLandmark(POSE_LANDMARK_INDICES.LEFT_SHOULDER), null);
    assert.equal(mixedFrame.getLandmark(POSE_LANDMARK_INDICES.RIGHT_SHOULDER)?.visibility, 0);
    assert.equal(mixedFrame.hasRequiredLandmarks(), false);
  });
});

describe('Domain Entity: MobilityAlert', () => {
  it('accepts all valid tipo and status_atendimento combinations and serializes 12 schema fields', () => {
    for (const tipo of Object.values(ALERT_TYPES)) {
      for (const status of Object.values(ALERT_STATUSES)) {
        const alert = new MobilityAlert({
          id: 'alert_1',
          tipo,
          status_atendimento: status,
          angulo_tronco_graus: 20,
          velocidade_vertical: 1.2,
          tempo_imovel_seg: 5.5,
          fonte_ia: AI_SOURCES.FALLBACK_LOCAL,
        });

        const json = alert.toJSON();
        assert.equal(Object.keys(json).length, 12);
        assert.equal(json.tipo, tipo);
        assert.equal(json.status_atendimento, status);
        assert.ok(Object.values(ALERT_SEVERITIES).includes(json.severidade));
      }
    }

    const baseAlert = new MobilityAlert({ tipo: ALERT_TYPES.QUEDA_CRITICA });
    assert.equal(baseAlert.isCritical(), true);
    assert.equal(baseAlert.isPending(), true);
    const resolved = baseAlert.withStatus(ALERT_STATUSES.SOCORRIDO);
    assert.equal(resolved.isResolved(), true);
    assert.ok(resolved.atendido_em);
  });

  it('rejects invalid tipo, status_atendimento, severidade, or fonte_ia', () => {
    assert.throws(() => new MobilityAlert({ tipo: 'OUTRO' }));
    assert.throws(
      () => new MobilityAlert({ tipo: ALERT_TYPES.DESEQUILIBRIO, status_atendimento: 'INVALIDO' })
    );
    assert.throws(
      () => new MobilityAlert({ tipo: ALERT_TYPES.DESEQUILIBRIO, severidade: 'MODERADA' })
    );
    assert.throws(
      () => new MobilityAlert({ tipo: ALERT_TYPES.DESEQUILIBRIO, fonte_ia: 'UNKNOWN_AI' })
    );
  });

  it('preserves PostureStateMachine transitionEvent telemetry and guards withTriageReport(null)', () => {
    const fsm = new PostureStateMachine();
    for (let i = 0; i < 4; i += 1) {
      fsm.evaluate({
        valid: true,
        trunkAngleDeg: 85,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: 1700000000000 + i * 33,
      });
    }

    let imbalanceEvent = null;
    for (let i = 0; i < 4; i += 1) {
      const res = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 45,
        verticalVelocity: 0.28,
        centerOfMass: { x: 0.52, y: 0.49, z: 0 },
        timestampMs: 1700000000132 + i * 33,
      });
      if (res.transitionEvent) imbalanceEvent = res.transitionEvent;
    }
    assert.ok(imbalanceEvent);

    const directImbalanceAlert = new MobilityAlert(imbalanceEvent);
    assert.equal(directImbalanceAlert.angulo_tronco_graus, imbalanceEvent.trunkAngleDeg);
    assert.equal(directImbalanceAlert.velocidade_vertical, imbalanceEvent.verticalVelocity);
    assert.equal(directImbalanceAlert.tempo_imovel_seg, imbalanceEvent.tempoImovelSeg);
    assert.equal(
      directImbalanceAlert.timestamp,
      new Date(imbalanceEvent.timestampMs).toISOString()
    );

    const enriched = directImbalanceAlert.withTriageReport({
      laudo: 'Instabilidade postural moderada.',
      severidade: ALERT_SEVERITIES.ALTA,
      fonte: AI_SOURCES.GEMINI,
    });
    assert.equal(enriched.laudo_ia, 'Instabilidade postural moderada.');
    assert.equal(enriched.severidade, ALERT_SEVERITIES.ALTA);
    assert.equal(enriched.fonte_ia, AI_SOURCES.GEMINI);
    assert.equal(directImbalanceAlert.laudo_ia, '');

    for (const badReport of [null, undefined, 'bad', []]) {
      const safeClone = enriched.withTriageReport(badReport);
      assert.deepEqual(safeClone.toJSON(), enriched.toJSON());
    }

    fsm.reset();
    for (let i = 0; i < 4; i += 1) {
      fsm.evaluate({
        valid: true,
        trunkAngleDeg: 85,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: 1700000000000 + i * 33,
      });
    }
    for (let i = 0; i < 4; i += 1) {
      fsm.evaluate({
        valid: true,
        trunkAngleDeg: 18,
        verticalVelocity: 1.1,
        centerOfMass: { x: 0.5, y: 0.82, z: 0 },
        timestampMs: 1700000000132 + i * 33,
      });
    }
    const criticalRes = fsm.evaluate({
      valid: true,
      trunkAngleDeg: 18,
      verticalVelocity: 0,
      centerOfMass: { x: 0.5, y: 0.82, z: 0 },
      timestampMs: 1700000005600,
    });
    assert.ok(criticalRes.transitionEvent);
    const directCriticalAlert = new MobilityAlert(criticalRes.transitionEvent);
    assert.equal(directCriticalAlert.angulo_tronco_graus, criticalRes.transitionEvent.trunkAngleDeg);
    assert.equal(directCriticalAlert.tempo_imovel_seg, criticalRes.transitionEvent.tempoImovelSeg);
    assert.ok(directCriticalAlert.tempo_imovel_seg >= 5);
    assert.equal(
      directCriticalAlert.timestamp,
      new Date(criticalRes.transitionEvent.timestampMs).toISOString()
    );
  });
});

describe('Domain Service: BiomechanicsCalculator', () => {
  it('calculateMidpoint computes exact 3D midpoint and guards missing points', () => {
    const midpoint = BiomechanicsCalculator.calculateMidpoint(
      { x: 0.4, y: 0.2, z: 0 },
      { x: 0.6, y: 0.4, z: 0.2 }
    );
    assert.ok(Math.abs(midpoint.x - 0.5) < 1e-9);
    assert.ok(Math.abs(midpoint.y - 0.3) < 1e-9);
    assert.ok(Math.abs(midpoint.z - 0.1) < 1e-9);
    assert.equal(BiomechanicsCalculator.calculateMidpoint(null, { x: 0.1, y: 0.2 }), null);
  });

  it('calculateCenterOfMass applies 0.4 shoulder + 0.6 hip weighting', () => {
    const landmarks = createSyntheticLandmarks({
      shoulderX: 0.4,
      shoulderY: 0.2,
      hipX: 0.5,
      hipY: 0.6,
      z: 0.1,
    });
    const com = BiomechanicsCalculator.calculateCenterOfMass(landmarks);
    assert.ok(Math.abs(com.x - (0.4 * 0.4 + 0.5 * 0.6)) < 1e-9);
    assert.ok(Math.abs(com.y - (0.2 * 0.4 + 0.6 * 0.6)) < 1e-9);
    assert.ok(Math.abs(com.z - 0.1) < 1e-9);
  });

  it('calculateTrunkAngleDegrees computes ~90 deg standing and ~10 deg fallen', () => {
    const standingAngle = BiomechanicsCalculator.calculateTrunkAngleDegrees(
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.6 }
    );
    assert.ok(Math.abs(standingAngle - 90) < 0.01);

    const fallenAngle = BiomechanicsCalculator.calculateTrunkAngleDegrees(
      { x: 0.2, y: 0.73 },
      { x: 0.6, y: 0.80 }
    );
    assert.ok(fallenAngle >= 0 && fallenAngle < 15);
    assert.ok(fallenAngle < BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG);
  });

  it('calculateVerticalVelocity computes downward velocity and guards deltaTimeMs = 0', () => {
    const velocity = BiomechanicsCalculator.calculateVerticalVelocity(0.4, 0.6, 200);
    assert.ok(Math.abs(velocity - 1.0) < 1e-9);

    const guardedZeroDt = BiomechanicsCalculator.calculateVerticalVelocity(0.4, 0.6, 0);
    const guardedNegativeDt = BiomechanicsCalculator.calculateVerticalVelocity(0.4, 0.6, -10);
    assert.equal(Number.isFinite(guardedZeroDt), true);
    assert.ok(Math.abs(guardedZeroDt - 12.5) < 1e-9);
    assert.equal(guardedZeroDt, guardedNegativeDt);
  });

  it('isBodyImmobile respects MOVEMENT_STILLNESS_EPSILON', () => {
    assert.equal(
      BiomechanicsCalculator.isBodyImmobile({ x: 0.5, y: 0.8 }, { x: 0.508, y: 0.806 }),
      true
    );
    assert.equal(
      BiomechanicsCalculator.isBodyImmobile({ x: 0.5, y: 0.8 }, { x: 0.6, y: 0.8 }),
      false
    );
    assert.equal(BiomechanicsCalculator.isBodyImmobile(null, { x: 0.5, y: 0.8 }), false);
  });
});

describe('Domain Service: PostureStateMachine', () => {
  it('Scenario 1: normal standing & walking keeps EM_PE with zero transition events', () => {
    const fsm = new PostureStateMachine();
    for (let i = 0; i < 12; i += 1) {
      const result = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 85 + (i % 3),
        verticalVelocity: i % 2 === 0 ? 0.02 : -0.02,
        centerOfMass: { x: 0.48 + i * 0.005, y: 0.45, z: 0 },
        timestampMs: i * 33,
      });
      assert.equal(result.state, POSTURE_STATES.EM_PE);
      assert.equal(result.transitionEvent, null);
    }
  });

  it('Scenario 2: slow crouch / squat keeps EM_PE with zero false positives', () => {
    const fsm = new PostureStateMachine();
    for (let i = 0; i < 8; i += 1) {
      const result = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 68,
        verticalVelocity: 0.10,
        centerOfMass: { x: 0.5, y: 0.45 + i * 0.025, z: 0 },
        timestampMs: i * 100,
      });
      assert.equal(result.state, POSTURE_STATES.EM_PE);
      assert.equal(result.transitionEvent, null);
    }
    for (let i = 0; i < 7; i += 1) {
      const result = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 74,
        verticalVelocity: -0.10,
        centerOfMass: { x: 0.5, y: 0.62 - i * 0.025, z: 0 },
        timestampMs: 800 + i * 100,
      });
      assert.equal(result.state, POSTURE_STATES.EM_PE);
      assert.equal(result.transitionEvent, null);
    }
  });

  it('Scenario 3: rapid tilt + recovery < 3s emits DESEQUILIBRIO (MEDIA) and recovers to EM_PE', () => {
    const fsm = new PostureStateMachine();
    const events = [];

    for (let i = 0; i < 4; i += 1) {
      const res = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 85,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: i * 33,
      });
      if (res.transitionEvent) events.push(res.transitionEvent);
    }

    for (let i = 0; i < 5; i += 1) {
      const res = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 45,
        verticalVelocity: 0.28,
        centerOfMass: { x: 0.53, y: 0.49, z: 0 },
        timestampMs: 132 + i * 33,
      });
      if (res.transitionEvent) events.push(res.transitionEvent);
    }

    assert.equal(fsm.state, POSTURE_STATES.DESEQUILIBRIO);
    assert.equal(events.length, 1);
    assert.equal(events[0].tipo, ALERT_TYPES.DESEQUILIBRIO);
    assert.equal(events[0].severidade, ALERT_SEVERITIES.MEDIA);

    // Ensure transitionEvent maps cleanly to MobilityAlert without throwing
    const alertEntity = new MobilityAlert({
      tipo: events[0].tipo,
      severidade: events[0].severidade,
      angulo_tronco_graus: events[0].trunkAngleDeg,
      velocidade_vertical: events[0].verticalVelocity,
      tempo_imovel_seg: events[0].tempoImovelSeg,
    });
    assert.equal(alertEntity.severidade, ALERT_SEVERITIES.MEDIA);

    for (let i = 0; i < 5; i += 1) {
      const res = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 84,
        verticalVelocity: -0.15,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: 1200 + i * 33,
      });
      assert.equal(res.transitionEvent, null);
    }
    assert.equal(fsm.state, POSTURE_STATES.EM_PE);
  });

  it('Scenario 4a: rapid fall + immobility >= 5s transitions QUEDA_DETECTADA -> ALERTA_CRITICO', () => {
    const fsm = new PostureStateMachine();
    const events = [];

    for (let i = 0; i < 4; i += 1) {
      const res = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 85,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: i * 33,
      });
      if (res.transitionEvent) events.push(res.transitionEvent);
    }

    for (let i = 0; i < 5; i += 1) {
      const res = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 18,
        verticalVelocity: 1.1,
        centerOfMass: { x: 0.5, y: 0.82, z: 0 },
        timestampMs: 132 + i * 33,
      });
      if (res.transitionEvent) events.push(res.transitionEvent);
    }

    assert.equal(fsm.state, POSTURE_STATES.QUEDA_DETECTADA);
    assert.equal(events.length, 0);

    const floor2s = fsm.evaluate({
      valid: true,
      trunkAngleDeg: 18,
      verticalVelocity: 0,
      centerOfMass: { x: 0.505, y: 0.822, z: 0 },
      timestampMs: 2000,
    });
    assert.equal(floor2s.state, POSTURE_STATES.QUEDA_DETECTADA);
    assert.equal(floor2s.transitionEvent, null);
    assert.ok(floor2s.immobilityDurationMs < BIOMECHANICS_THRESHOLDS.IMMOBILITY_CONFIRMATION_MS);

    const floor4s = fsm.evaluate({
      valid: true,
      trunkAngleDeg: 18,
      verticalVelocity: 0,
      centerOfMass: { x: 0.504, y: 0.821, z: 0 },
      timestampMs: 4000,
    });
    assert.equal(floor4s.state, POSTURE_STATES.QUEDA_DETECTADA);
    assert.equal(floor4s.transitionEvent, null);

    const floorCritical = fsm.evaluate({
      valid: true,
      trunkAngleDeg: 18,
      verticalVelocity: 0,
      centerOfMass: { x: 0.502, y: 0.82, z: 0 },
      timestampMs: 5300,
    });
    assert.equal(floorCritical.state, POSTURE_STATES.ALERTA_CRITICO);
    assert.ok(floorCritical.transitionEvent);
    assert.equal(floorCritical.transitionEvent.tipo, ALERT_TYPES.QUEDA_CRITICA);
    assert.equal(floorCritical.transitionEvent.severidade, ALERT_SEVERITIES.CRITICA);

    const floorHold = fsm.evaluate({
      valid: true,
      trunkAngleDeg: 18,
      verticalVelocity: 0,
      centerOfMass: { x: 0.501, y: 0.82, z: 0 },
      timestampMs: 6000,
    });
    assert.equal(floorHold.state, POSTURE_STATES.ALERTA_CRITICO);
    assert.equal(floorHold.transitionEvent, null);
  });

  it('Scenario 4b: rapid fall + recovery < 5s returns to EM_PE without ALERTA_CRITICO', () => {
    const fsm = new PostureStateMachine();
    for (let i = 0; i < 4; i += 1) {
      fsm.evaluate({
        valid: true,
        trunkAngleDeg: 85,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: i * 33,
      });
    }
    for (let i = 0; i < 5; i += 1) {
      fsm.evaluate({
        valid: true,
        trunkAngleDeg: 18,
        verticalVelocity: 1.1,
        centerOfMass: { x: 0.5, y: 0.82, z: 0 },
        timestampMs: 132 + i * 33,
      });
    }
    assert.equal(fsm.state, POSTURE_STATES.QUEDA_DETECTADA);

    const midFloor = fsm.evaluate({
      valid: true,
      trunkAngleDeg: 20,
      verticalVelocity: 0,
      centerOfMass: { x: 0.5, y: 0.82, z: 0 },
      timestampMs: 2500,
    });
    assert.equal(midFloor.state, POSTURE_STATES.QUEDA_DETECTADA);

    for (let i = 0; i < 5; i += 1) {
      const res = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 84,
        verticalVelocity: -0.3,
        centerOfMass: { x: 0.5, y: 0.46, z: 0 },
        timestampMs: 2800 + i * 33,
      });
      assert.equal(res.transitionEvent, null);
    }
    assert.equal(fsm.state, POSTURE_STATES.EM_PE);
  });

  it('Scenario 5: rejects 1-frame glitch, guards invalid frames, supports overrides & reset()', () => {
    const fsm = new PostureStateMachine();
    for (let i = 0; i < 4; i += 1) {
      fsm.evaluate({
        valid: true,
        trunkAngleDeg: 85,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: i * 33,
      });
    }

    const glitch = fsm.evaluate({
      valid: true,
      trunkAngleDeg: 15,
      verticalVelocity: 1.2,
      centerOfMass: { x: 0.5, y: 0.8, z: 0 },
      timestampMs: 132,
    });
    assert.equal(glitch.state, POSTURE_STATES.EM_PE);
    assert.equal(glitch.transitionEvent, null);

    for (let i = 0; i < 4; i += 1) {
      const afterGlitch = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 85,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: 165 + i * 33,
      });
      assert.equal(afterGlitch.state, POSTURE_STATES.EM_PE);
      assert.equal(afterGlitch.transitionEvent, null);
    }

    const invalidResult = fsm.evaluate({
      valid: false,
      trunkAngleDeg: null,
      verticalVelocity: null,
      centerOfMass: null,
      timestampMs: 500,
    });
    assert.equal(invalidResult.state, POSTURE_STATES.EM_PE);
    assert.equal(invalidResult.transitionEvent, null);

    const customFsm = new PostureStateMachine({ TRUNK_FALL_ANGLE_DEG: 42, SMOOTHING_WINDOW_SIZE: 1 });
    const fallRes = customFsm.evaluate({
      valid: true,
      trunkAngleDeg: 40,
      verticalVelocity: 0.8,
      centerOfMass: { x: 0.5, y: 0.78, z: 0 },
      timestampMs: 100,
    });
    assert.equal(fallRes.state, POSTURE_STATES.QUEDA_DETECTADA);

    customFsm.reset();
    assert.equal(customFsm.state, POSTURE_STATES.EM_PE);
  });

  it('Scenario 6: cold-start 1-frame & warm 2-frame glitch immunity while catching 2-frame fall + floor', () => {
    // Cold-start 1-frame fall glitch and angle-only glitch must remain EM_PE
    for (const glitchInput of [
      { trunkAngleDeg: 5, verticalVelocity: 5.0 },
      { trunkAngleDeg: 5, verticalVelocity: 0 },
    ]) {
      const coldFsm = new PostureStateMachine();
      const res = coldFsm.evaluate({
        valid: true,
        ...glitchInput,
        centerOfMass: { x: 0.5, y: 0.8, z: 0 },
        timestampMs: 100,
      });
      assert.equal(res.state, POSTURE_STATES.EM_PE);
      assert.equal(res.transitionEvent, null);
    }

    // Warm-buffer 2-frame fall glitch from borderline upright (60 deg)
    const borderlineFsm = new PostureStateMachine();
    for (let i = 0; i < 4; i += 1) {
      borderlineFsm.evaluate({
        valid: true,
        trunkAngleDeg: 60,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.5, z: 0 },
        timestampMs: i * 33,
      });
    }
    for (let i = 0; i < 2; i += 1) {
      const res = borderlineFsm.evaluate({
        valid: true,
        trunkAngleDeg: 5,
        verticalVelocity: 5.0,
        centerOfMass: { x: 0.5, y: 0.8, z: 0 },
        timestampMs: 132 + i * 33,
      });
      assert.equal(res.state, POSTURE_STATES.EM_PE);
      assert.equal(res.transitionEvent, null);
    }
    for (let i = 0; i < 4; i += 1) {
      const res = borderlineFsm.evaluate({
        valid: true,
        trunkAngleDeg: 60,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.5, z: 0 },
        timestampMs: 198 + i * 33,
      });
      assert.equal(res.state, POSTURE_STATES.EM_PE);
      assert.equal(res.transitionEvent, null);
    }

    // Warm-buffer 2-frame angle-only glitch from standing (88 deg)
    const angleGlitchFsm = new PostureStateMachine();
    for (let i = 0; i < 4; i += 1) {
      angleGlitchFsm.evaluate({
        valid: true,
        trunkAngleDeg: 88,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: i * 33,
      });
    }
    for (let i = 0; i < 2; i += 1) {
      const res = angleGlitchFsm.evaluate({
        valid: true,
        trunkAngleDeg: 5,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: 132 + i * 33,
      });
      assert.equal(res.state, POSTURE_STATES.EM_PE);
      assert.equal(res.transitionEvent, null);
    }

    // Real 2-frame drop (25 deg, vy = 0.85) + floor deceleration (12 deg, vy = 0) at 30 FPS
    const realFallFsm = new PostureStateMachine();
    for (let i = 0; i < 4; i += 1) {
      realFallFsm.evaluate({
        valid: true,
        trunkAngleDeg: 85,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: i * 33,
      });
    }
    for (let i = 0; i < 2; i += 1) {
      realFallFsm.evaluate({
        valid: true,
        trunkAngleDeg: 25,
        verticalVelocity: 0.85,
        centerOfMass: { x: 0.5, y: 0.72 + i * 0.08, z: 0 },
        timestampMs: 132 + i * 33,
      });
    }
    for (let i = 0; i < 3; i += 1) {
      realFallFsm.evaluate({
        valid: true,
        trunkAngleDeg: 12,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.84, z: 0 },
        timestampMs: 198 + i * 33,
      });
    }
    assert.equal(realFallFsm.state, POSTURE_STATES.QUEDA_DETECTADA);
  });

  it('Scenario 7: guards NaN/Infinity timestamps, handles >=3s occlusion in QUEDA_DETECTADA, enforces override bounds, and escalates DESEQUILIBRIO', () => {
    const fsm = new PostureStateMachine();
    for (let i = 0; i < 4; i += 1) {
      fsm.evaluate({
        valid: true,
        trunkAngleDeg: 85,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: 1000 + i * 33,
      });
    }
    for (let i = 0; i < 4; i += 1) {
      fsm.evaluate({
        valid: true,
        trunkAngleDeg: 18,
        verticalVelocity: 1.1,
        centerOfMass: { x: 0.5, y: 0.82, z: 0 },
        timestampMs: 1132 + i * 33,
      });
    }
    assert.equal(fsm.state, POSTURE_STATES.QUEDA_DETECTADA);

    // Non-finite timestamps (NaN / Infinity) must NOT jump to Date.now()
    for (const badTs of [NaN, Infinity, -Infinity]) {
      const tsGuardRes = fsm.evaluate({
        valid: true,
        trunkAngleDeg: 18,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.82, z: 0 },
        timestampMs: badTs,
      });
      assert.equal(tsGuardRes.state, POSTURE_STATES.QUEDA_DETECTADA);
      assert.equal(tsGuardRes.transitionEvent, null);
      assert.ok(tsGuardRes.immobilityDurationMs < BIOMECHANICS_THRESHOLDS.IMMOBILITY_CONFIRMATION_MS);
    }

    // Prolonged occlusion (>= 3000ms) during QUEDA_DETECTADA resets immobility anchor
    fsm.evaluate({ valid: false, timestampMs: 1500 });
    fsm.evaluate({ valid: false, timestampMs: 4600 });
    const resumedRes = fsm.evaluate({
      valid: true,
      trunkAngleDeg: 12,
      verticalVelocity: 0,
      centerOfMass: { x: 0.5, y: 0.82, z: 0 },
      timestampMs: 5200,
    });
    assert.equal(resumedRes.state, POSTURE_STATES.QUEDA_DETECTADA);
    assert.equal(resumedRes.immobilityDurationMs, 0);
    assert.equal(resumedRes.transitionEvent, null);

    // After 5000ms of observed post-occlusion immobility, ALERTA_CRITICO triggers
    const postOcclusionCritical = fsm.evaluate({
      valid: true,
      trunkAngleDeg: 12,
      verticalVelocity: 0,
      centerOfMass: { x: 0.5, y: 0.82, z: 0 },
      timestampMs: 10200,
    });
    assert.equal(postOcclusionCritical.state, POSTURE_STATES.ALERTA_CRITICO);
    assert.ok(postOcclusionCritical.transitionEvent);

    // Out-of-bounds overrides are rejected, while updateThresholds() applies valid bounds & trims buffer
    const boundedFsm = new PostureStateMachine({
      SMOOTHING_WINDOW_SIZE: -5,
      IMMOBILITY_CONFIRMATION_MS: -100,
      TRUNK_FALL_ANGLE_DEG: -10,
    });
    assert.equal(boundedFsm.thresholds.SMOOTHING_WINDOW_SIZE, BIOMECHANICS_THRESHOLDS.SMOOTHING_WINDOW_SIZE);
    assert.equal(boundedFsm.thresholds.IMMOBILITY_CONFIRMATION_MS, BIOMECHANICS_THRESHOLDS.IMMOBILITY_CONFIRMATION_MS);
    assert.equal(boundedFsm.thresholds.TRUNK_FALL_ANGLE_DEG, BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG);

    boundedFsm.updateThresholds({ TRUNK_FALL_ANGLE_DEG: 42, SMOOTHING_WINDOW_SIZE: 2 });
    assert.equal(boundedFsm.thresholds.TRUNK_FALL_ANGLE_DEG, 42);
    assert.equal(boundedFsm.thresholds.SMOOTHING_WINDOW_SIZE, 2);

    // DESEQUILIBRIO -> QUEDA_DETECTADA time-based escalation (>= IMBALANCE_RECOVERY_MAX_MS)
    const escFsm = new PostureStateMachine();
    for (let i = 0; i < 4; i += 1) {
      escFsm.evaluate({
        valid: true,
        trunkAngleDeg: 85,
        verticalVelocity: 0,
        centerOfMass: { x: 0.5, y: 0.45, z: 0 },
        timestampMs: i * 33,
      });
    }
    for (let i = 0; i < 4; i += 1) {
      escFsm.evaluate({
        valid: true,
        trunkAngleDeg: 45,
        verticalVelocity: 0.25,
        centerOfMass: { x: 0.52, y: 0.5, z: 0 },
        timestampMs: 132 + i * 33,
      });
    }
    assert.equal(escFsm.state, POSTURE_STATES.DESEQUILIBRIO);

    for (let i = 0; i < 4; i += 1) {
      escFsm.evaluate({
        valid: true,
        trunkAngleDeg: 25,
        verticalVelocity: 0.05,
        centerOfMass: { x: 0.52, y: 0.78, z: 0 },
        timestampMs: 3300 + i * 33,
      });
    }
    assert.equal(escFsm.state, POSTURE_STATES.QUEDA_DETECTADA);
  });
});

describe('Domain Entity: DailyMetrics', () => {
  it('calculates deterministic score_risco_preventivo in [0, 100]', () => {
    const healthy = new DailyMetrics({
      tempo_ativo_min: 180,
      tempo_sentado_min: 240,
      qtd_desequilibrios: 0,
      qtd_quedas: 0,
      velocidade_marcha_media: 1.0,
    });
    const highRisk = new DailyMetrics({
      tempo_ativo_min: 20,
      tempo_sentado_min: 600,
      qtd_desequilibrios: 6,
      qtd_quedas: 2,
      velocidade_marcha_media: 0.45,
    });

    const healthyScore = healthy.calculatePreventiveRiskScore();
    const highRiskScore = highRisk.calculatePreventiveRiskScore();

    assert.equal(Number.isInteger(healthyScore), true);
    assert.equal(Number.isInteger(highRiskScore), true);
    assert.ok(healthyScore >= 0 && healthyScore <= 100);
    assert.ok(highRiskScore >= 0 && highRiskScore <= 100);
    assert.ok(healthyScore < highRiskScore);
  });

  it('is safe against zero division', () => {
    const emptyDay = new DailyMetrics({
      tempo_ativo_min: 0,
      tempo_sentado_min: 0,
      qtd_desequilibrios: 0,
      qtd_quedas: 0,
      velocidade_marcha_media: 0,
    });
    const score = emptyDay.calculatePreventiveRiskScore();
    assert.equal(Number.isFinite(score), true);
    assert.equal(score, 0);
    assert.equal(Object.keys(emptyDay.toJSON()).length, 10);
  });

  it('clamps extreme risk scores to 100 and preserves explicit score_risco_preventivo across toJSON/fromJSON', () => {
    const maxRisk = new DailyMetrics({
      tempo_ativo_min: 0,
      tempo_sentado_min: 1000,
      qtd_desequilibrios: 50,
      qtd_quedas: 10,
      velocidade_marcha_media: 0.1,
    });
    assert.equal(maxRisk.calculatePreventiveRiskScore(), 100);
    assert.equal(maxRisk.score_risco_preventivo, 100);

    const explicit = new DailyMetrics({
      tempo_ativo_min: 180,
      tempo_sentado_min: 240,
      qtd_desequilibrios: 0,
      qtd_quedas: 0,
      velocidade_marcha_media: 1.0,
      score_risco_preventivo: 95,
    });
    assert.equal(explicit.score_risco_preventivo, 95);
    assert.equal(explicit.toJSON().score_risco_preventivo, 95);
    assert.equal(DailyMetrics.fromJSON(explicit.toJSON()).score_risco_preventivo, 95);
  });
});

describe('Domain Contracts: AlertRepository & TriageAIService', () => {
  it('abstract methods throw NotImplementedError', async () => {
    const repo = new AlertRepository();
    const aiService = new TriageAIService();

    await assert.rejects(() => repo.saveAlert({}), NotImplementedError);
    await assert.rejects(() => repo.updateAlertStatus('1', ALERT_STATUSES.SOCORRIDO), NotImplementedError);
    assert.throws(() => repo.subscribeToAlerts(() => {}), NotImplementedError);
    await assert.rejects(() => repo.upsertDailyMetrics({}), NotImplementedError);
    assert.throws(() => repo.subscribeToDailyMetrics(() => {}), NotImplementedError);
    assert.throws(() => repo.getCloudOpsStats(), NotImplementedError);
    await assert.rejects(() => aiService.generateTriageReport({}), NotImplementedError);
  });
});

function createFakeClock(startMs = 1700000000000) {
  let currentMs = startMs;
  return {
    now: () => currentMs,
    advance(ms) {
      currentMs += ms;
      return currentMs;
    },
    set(ms) {
      currentMs = ms;
      return currentMs;
    },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class MockAlertRepository extends AlertRepository {
  constructor({
    shouldRejectSave = false,
    shouldRejectUpsert = false,
    saveErrorMessage = 'Firestore save failure',
    upsertErrorMessage = 'Firestore upsert failure',
  } = {}) {
    super();
    this.savedAlerts = [];
    this.upsertedMetrics = [];
    this.shouldRejectSave = shouldRejectSave;
    this.shouldRejectUpsert = shouldRejectUpsert;
    this.saveErrorMessage = saveErrorMessage;
    this.upsertErrorMessage = upsertErrorMessage;
    this.saveDeferredQueue = [];
    this.upsertDeferredQueue = [];
  }

  async saveAlert(alert) {
    if (this.saveDeferredQueue.length > 0) {
      await this.saveDeferredQueue.shift().promise;
    }
    if (this.shouldRejectSave) {
      throw new Error(this.saveErrorMessage);
    }
    const stored = {
      ...(typeof alert.toJSON === 'function' ? alert.toJSON() : alert),
      id: alert.id || `alert_${this.savedAlerts.length + 1}`,
    };
    this.savedAlerts.push(stored);
    return stored;
  }

  async upsertDailyMetrics(metrics) {
    if (this.upsertDeferredQueue.length > 0) {
      await this.upsertDeferredQueue.shift().promise;
    }
    if (this.shouldRejectUpsert) {
      throw new Error(this.upsertErrorMessage);
    }
    const stored = typeof metrics.toJSON === 'function' ? metrics.toJSON() : { ...metrics };
    this.upsertedMetrics.push(stored);
    return stored;
  }
}

class MockTriageAIService extends TriageAIService {
  constructor({ response = null, shouldReject = false, errorMessage = 'Gemini timeout' } = {}) {
    super();
    this.calls = [];
    this.response = response;
    this.shouldReject = shouldReject;
    this.errorMessage = errorMessage;
    this.deferredQueue = [];
  }

  async generateTriageReport(eventContext) {
    this.calls.push(eventContext);
    if (this.deferredQueue.length > 0) {
      await this.deferredQueue.shift().promise;
    }
    if (this.shouldReject) {
      throw new Error(this.errorMessage);
    }
    if (typeof this.response === 'function') {
      return this.response(eventContext);
    }
    if (this.response !== null) {
      return this.response;
    }
    return {
      laudo: `Triagem IA: evento ${eventContext.tipo} com angulo ${eventContext.angulo_tronco_graus} graus.`,
      severidade: eventContext.severidade,
      acaoRecomendada: 'Contatar cuidador imediatamente.',
      fonte: AI_SOURCES.GEMINI,
    };
  }
}

const silentLogger = Object.freeze({
  warn() {},
  error() {},
  info() {},
});

describe('Application UseCase: ProcessPoseFrameUseCase', () => {
  it('orchestrates 30 FPS standing & walking synchronously with complete return payload', () => {
    const useCase = new ProcessPoseFrameUseCase();

    for (let i = 0; i < 10; i += 1) {
      const landmarks = createSyntheticLandmarks({
        shoulderX: 0.45 + i * 0.005,
        shoulderY: 0.25,
        hipX: 0.45 + i * 0.005,
        hipY: 0.55,
      });
      const result = i % 2 === 0
        ? useCase.execute({ landmarks, timestampMs: 1000 + i * 33 })
        : useCase.processFrame(landmarks, 1000 + i * 33);

      assert.equal(typeof result.then, 'undefined');
      assert.equal(result.valid, true);
      assert.ok(result.poseFrame instanceof PoseFrame);
      assert.equal(result.timestampMs, 1000 + i * 33);
      assert.equal(result.deltaTimeMs, i === 0 ? 0 : 33);
      assert.equal(result.state, POSTURE_STATES.EM_PE);
      assert.equal(result.previousState, POSTURE_STATES.EM_PE);
      assert.ok(result.trunkAngleDeg > 80);
      assert.ok(result.rawTrunkAngleDeg > 80);
      assert.equal(Number.isFinite(result.verticalVelocity), true);
      assert.equal(Number.isFinite(result.rawVerticalVelocity), true);
      assert.ok(result.centerOfMass && Number.isFinite(result.centerOfMass.y));
      assert.ok(result.shoulderMid && Number.isFinite(result.shoulderMid.x));
      assert.ok(result.hipMid && Number.isFinite(result.hipMid.x));
      assert.equal(result.immobilityDurationMs, 0);
      assert.equal(result.transitionEvent, null);
      assert.ok(result.minVisibility >= BIOMECHANICS_THRESHOLDS.MIN_LANDMARK_VISIBILITY);
      assert.equal(result.hasCompletePose, true);
    }
  });

  it('guards low-visibility, empty, null, and incomplete poses without throwing', () => {
    const useCase = new ProcessPoseFrameUseCase();

    const lowVisLandmarks = createSyntheticLandmarks({ visibility: 0.9 });
    lowVisLandmarks[POSE_LANDMARK_INDICES.RIGHT_HIP].visibility = 0.2;

    for (const badInput of [null, [], { landmarks: lowVisLandmarks, timestampMs: 100 }, createSyntheticLandmarks({ count: 10 })]) {
      const res = useCase.execute(badInput, 100);
      assert.equal(res.valid, false);
      assert.equal(res.transitionEvent, null);
      assert.equal(res.centerOfMass, null);
      assert.equal(res.shoulderMid, null);
      assert.equal(res.hipMid, null);
      assert.equal(res.trunkAngleDeg, null);
      assert.equal(res.rawTrunkAngleDeg, null);
      assert.equal(res.verticalVelocity, 0);
      assert.equal(res.rawVerticalVelocity, 0);
    }
  });

  it('guards dt = 0, dt > MAX_FRAME_DELTA_MS, backward timestamps, and NaN timestamps', () => {
    const useCase = new ProcessPoseFrameUseCase();

    useCase.execute(createSyntheticLandmarks({ shoulderY: 0.25, hipY: 0.55 }), 1000);

    // dt = 0 with vertical change uses MIN_DELTA_TIME_MS -> finite velocity (never Infinity/NaN)
    const zeroDtRes = useCase.execute(
      createSyntheticLandmarks({ shoulderY: 0.27, hipY: 0.57 }),
      1000
    );
    assert.equal(zeroDtRes.valid, true);
    assert.equal(zeroDtRes.deltaTimeMs, 0);
    assert.equal(Number.isFinite(zeroDtRes.rawVerticalVelocity), true);
    assert.equal(Number.isFinite(zeroDtRes.verticalVelocity), true);

    // Backward and NaN timestamps never invert velocity or regress clock
    const backRes = useCase.execute(
      createSyntheticLandmarks({ shoulderY: 0.45, hipY: 0.75 }),
      500
    );
    assert.equal(backRes.deltaTimeMs, 0);
    assert.equal(backRes.rawVerticalVelocity, 0);

    const nanRes = useCase.execute(
      createSyntheticLandmarks({ shoulderY: 0.45, hipY: 0.75 }),
      NaN
    );
    assert.equal(nanRes.deltaTimeMs, 0);
    assert.equal(nanRes.rawVerticalVelocity, 0);

    // Stale gap > MAX_FRAME_DELTA_MS resets rawVerticalVelocity to 0
    const gapRes = useCase.execute(
      createSyntheticLandmarks({ shoulderY: 0.55, hipY: 0.85 }),
      1000 + BIOMECHANICS_THRESHOLDS.MAX_FRAME_DELTA_MS + 500
    );
    assert.equal(gapRes.valid, true);
    assert.equal(gapRes.rawVerticalVelocity, 0);
  });

  it('distinguishes slow crouch (EM_PE) from rapid fall + 5s immobility (ALERTA_CRITICO)', () => {
    const crouchUseCase = new ProcessPoseFrameUseCase();
    for (let i = 0; i < 10; i += 1) {
      const offset = i * 0.015;
      const res = crouchUseCase.execute(
        createSyntheticLandmarks({
          shoulderX: 0.52,
          shoulderY: 0.25 + offset,
          hipX: 0.50,
          hipY: 0.55 + offset,
        }),
        i * 200
      );
      assert.equal(res.state, POSTURE_STATES.EM_PE);
      assert.equal(res.transitionEvent, null);
    }

    const fallUseCase = new ProcessPoseFrameUseCase();
    // Standing baseline
    for (let i = 0; i < 4; i += 1) {
      fallUseCase.execute(
        createSyntheticLandmarks({ shoulderX: 0.5, shoulderY: 0.22, hipX: 0.5, hipY: 0.52 }),
        i * 33
      );
    }
    // Rapid downward horizontal fall
    for (let i = 0; i < 5; i += 1) {
      const shoulderY = 0.35 + i * 0.095;
      const hipY = 0.58 + i * 0.06;
      const shoulderX = 0.42 - i * 0.05;
      fallUseCase.execute(
        createSyntheticLandmarks({ shoulderX, shoulderY, hipX: 0.55, hipY }),
        132 + i * 33
      );
    }
    assert.equal(fallUseCase.getState(), POSTURE_STATES.QUEDA_DETECTADA);

    // Floor settling (30 FPS) + immobility >= IMMOBILITY_CONFIRMATION_MS (5000ms)
    let criticalEvent = null;
    const floorLandmarks = createSyntheticLandmarks({
      shoulderX: 0.22,
      shoulderY: 0.74,
      hipX: 0.55,
      hipY: 0.80,
    });
    for (let i = 0; i < 4; i += 1) {
      fallUseCase.execute(floorLandmarks, 300 + i * 33);
    }
    const floorRes = fallUseCase.execute(
      floorLandmarks,
      400 + BIOMECHANICS_THRESHOLDS.IMMOBILITY_CONFIRMATION_MS + 200
    );
    if (floorRes.transitionEvent) criticalEvent = floorRes.transitionEvent;

    assert.equal(floorRes.state, POSTURE_STATES.ALERTA_CRITICO);
    assert.ok(criticalEvent);
    assert.equal(criticalEvent.tipo, ALERT_TYPES.QUEDA_CRITICA);
    assert.equal(criticalEvent.severidade, ALERT_SEVERITIES.CRITICA);
  });

  it('supports updateThresholds(), clamped setSensitivityOffset(), and reset()', () => {
    const useCase = new ProcessPoseFrameUseCase();

    const updated = useCase.updateThresholds({ TRUNK_FALL_ANGLE_DEG: 40 });
    assert.equal(updated.TRUNK_FALL_ANGLE_DEG, 40);
    assert.equal(useCase.getThresholds().TRUNK_FALL_ANGLE_DEG, 40);

    // Clamps extreme offsets to [-10, +10]
    const clampedHigh = useCase.setSensitivityOffset(50);
    assert.equal(
      clampedHigh.TRUNK_FALL_ANGLE_DEG,
      BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG + BIOMECHANICS_THRESHOLDS.SENSITIVITY_ANGLE_OFFSET_MAX_DEG
    );
    const clampedLow = useCase.setSensitivityOffset(-50);
    assert.equal(
      clampedLow.TRUNK_FALL_ANGLE_DEG,
      BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG + BIOMECHANICS_THRESHOLDS.SENSITIVITY_ANGLE_OFFSET_MIN_DEG
    );

    useCase.execute(createSyntheticLandmarks(), 100);
    useCase.reset();
    assert.equal(useCase.getState(), POSTURE_STATES.EM_PE);
    const afterReset = useCase.execute(createSyntheticLandmarks(), 200);
    assert.equal(afterReset.deltaTimeMs, 0);
  });
});

describe('Application UseCase: RegisterEmergencyAlertUseCase', () => {
  it('validates alertRepository DI and skips null or invalid transition events', async () => {
    assert.throws(() => new RegisterEmergencyAlertUseCase(), TypeError);
    assert.throws(() => new RegisterEmergencyAlertUseCase(null), TypeError);
    assert.throws(() => new RegisterEmergencyAlertUseCase({ alertRepository: {} }), TypeError);

    const repo = new MockAlertRepository();
    const ai = new MockTriageAIService();
    const useCase = new RegisterEmergencyAlertUseCase({
      alertRepository: repo,
      triageAIService: ai,
      logger: silentLogger,
    });

    for (const invalidEvent of [null, undefined, {}, { tipo: 'UNKNOWN_TYPE' }]) {
      const res = await useCase.execute(invalidEvent);
      assert.equal(res.status, REGISTER_ALERT_RESULTS.SKIPPED);
      assert.equal(res.registered, false);
      assert.equal(res.alert, null);
    }
    assert.equal(repo.savedAlerts.length, 0);
    assert.equal(ai.calls.length, 0);
  });

  it('maps transitionEvent -> TriageAIService -> MobilityAlert -> AlertRepository with metadata-only context', async () => {
    const repo = new MockAlertRepository();
    const ai = new MockTriageAIService();
    const useCase = new RegisterEmergencyAlertUseCase({
      alertRepository: repo,
      triageAIService: ai,
      patientId: 'idoso_demo',
      logger: silentLogger,
    });

    const event = {
      tipo: ALERT_TYPES.DESEQUILIBRIO,
      severidade: ALERT_SEVERITIES.MEDIA,
      fromState: POSTURE_STATES.EM_PE,
      toState: POSTURE_STATES.DESEQUILIBRIO,
      trunkAngleDeg: 46.5,
      verticalVelocity: 0.32,
      immobilityDurationMs: 0,
      tempoImovelSeg: 0,
      timestampMs: 1700000001000,
    };

    const result = await useCase.execute(event);
    assert.equal(result.status, REGISTER_ALERT_RESULTS.REGISTERED);
    assert.equal(result.registered, true);
    assert.equal(result.debounced, false);
    assert.equal(result.degraded, false);
    assert.equal(repo.savedAlerts.length, 1);
    assert.equal(ai.calls.length, 1);
    assert.equal('landmarks' in ai.calls[0], false);
    assert.equal(repo.savedAlerts[0].idoso_id, 'idoso_demo');
    assert.equal(repo.savedAlerts[0].tipo, ALERT_TYPES.DESEQUILIBRIO);
    assert.equal(repo.savedAlerts[0].angulo_tronco_graus, 46.5);
    assert.equal(repo.savedAlerts[0].fonte_ia, AI_SOURCES.GEMINI);
    assert.equal(Object.keys(repo.savedAlerts[0]).length, 12);
  });

  it('enforces per-tipo 15s debounce (ALERT_DEBOUNCE_MS) for DESEQUILIBRIO and QUEDA_CRITICA', async () => {
    const repo = new MockAlertRepository();
    const ai = new MockTriageAIService();
    const useCase = new RegisterEmergencyAlertUseCase({
      alertRepository: repo,
      triageAIService: ai,
      logger: silentLogger,
    });

    const first = await useCase.execute({
      tipo: ALERT_TYPES.DESEQUILIBRIO,
      severidade: ALERT_SEVERITIES.MEDIA,
      trunkAngleDeg: 45,
      verticalVelocity: 0.25,
      tempoImovelSeg: 0,
      timestampMs: 10000,
    });
    assert.equal(first.status, REGISTER_ALERT_RESULTS.REGISTERED);

    const withinCooldown = await useCase.execute({
      tipo: ALERT_TYPES.DESEQUILIBRIO,
      severidade: ALERT_SEVERITIES.MEDIA,
      trunkAngleDeg: 44,
      verticalVelocity: 0.26,
      tempoImovelSeg: 0,
      timestampMs: 10000 + BIOMECHANICS_THRESHOLDS.ALERT_DEBOUNCE_MS - 1,
    });
    assert.equal(withinCooldown.status, REGISTER_ALERT_RESULTS.DEBOUNCED);
    assert.equal(withinCooldown.debounced, true);
    assert.equal(withinCooldown.registered, false);
    assert.equal(repo.savedAlerts.length, 1);
    assert.equal(ai.calls.length, 1);

    const afterCooldown = await useCase.execute({
      tipo: ALERT_TYPES.DESEQUILIBRIO,
      severidade: ALERT_SEVERITIES.MEDIA,
      trunkAngleDeg: 43,
      verticalVelocity: 0.27,
      tempoImovelSeg: 0,
      timestampMs: 10000 + BIOMECHANICS_THRESHOLDS.ALERT_DEBOUNCE_MS,
    });
    assert.equal(afterCooldown.status, REGISTER_ALERT_RESULTS.REGISTERED);
    assert.equal(repo.savedAlerts.length, 2);
  });

  it('allows DESEQUILIBRIO -> QUEDA_CRITICA escalation within 15s while debouncing duplicate QUEDA_CRITICA', async () => {
    const repo = new MockAlertRepository();
    const ai = new MockTriageAIService();
    const useCase = new RegisterEmergencyAlertUseCase({
      alertRepository: repo,
      triageAIService: ai,
      logger: silentLogger,
    });

    const imbalance = await useCase.execute({
      tipo: ALERT_TYPES.DESEQUILIBRIO,
      severidade: ALERT_SEVERITIES.MEDIA,
      trunkAngleDeg: 45,
      verticalVelocity: 0.28,
      tempoImovelSeg: 0,
      timestampMs: 1000,
    });
    assert.equal(imbalance.registered, true);

    // 5.5s later (< 15s), escalating to QUEDA_CRITICA must NOT be suppressed
    const fall = await useCase.execute({
      tipo: ALERT_TYPES.QUEDA_CRITICA,
      severidade: ALERT_SEVERITIES.CRITICA,
      trunkAngleDeg: 14,
      verticalVelocity: 1.2,
      tempoImovelSeg: 5.2,
      timestampMs: 6500,
    });
    assert.equal(fall.registered, true);
    assert.equal(fall.debounced, false);
    assert.equal(repo.savedAlerts.length, 2);

    // Duplicate QUEDA_CRITICA 3.5s later IS debounced
    const dupFall = await useCase.execute({
      tipo: ALERT_TYPES.QUEDA_CRITICA,
      severidade: ALERT_SEVERITIES.CRITICA,
      trunkAngleDeg: 14,
      verticalVelocity: 0,
      tempoImovelSeg: 8.7,
      timestampMs: 10000,
    });
    assert.equal(dupFall.status, REGISTER_ALERT_RESULTS.DEBOUNCED);
    assert.equal(dupFall.debounced, true);
    assert.equal(repo.savedAlerts.length, 2);
  });

  it('guards concurrent Promise.all re-entrancy, timestampMs=0, backward clock jumps, and reset()', async () => {
    const repo = new MockAlertRepository();
    const ai = new MockTriageAIService();
    const deferred = createDeferred();
    ai.deferredQueue.push(deferred);

    const useCase = new RegisterEmergencyAlertUseCase({
      alertRepository: repo,
      triageAIService: ai,
      logger: silentLogger,
    });

    const eventAtZero = {
      tipo: ALERT_TYPES.DESEQUILIBRIO,
      severidade: ALERT_SEVERITIES.MEDIA,
      trunkAngleDeg: 48,
      verticalVelocity: 0.25,
      tempoImovelSeg: 0,
      timestampMs: 0,
    };

    const p1 = useCase.execute(eventAtZero);
    const p2 = useCase.execute(eventAtZero);

    assert.equal(useCase.isDebounced(ALERT_TYPES.DESEQUILIBRIO, 0), true);
    deferred.resolve();

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.registered, true);
    assert.equal(r2.status, REGISTER_ALERT_RESULTS.DEBOUNCED);
    assert.equal(r2.reason, 'IN_FLIGHT');
    assert.equal(repo.savedAlerts.length, 1);
    assert.equal(ai.calls.length, 1);

    // Verify timestampMs = 0 was recorded (t = 5000ms is still debounced)
    const debouncedAt5s = await useCase.execute({ ...eventAtZero, timestampMs: 5000 });
    assert.equal(debouncedAt5s.debounced, true);

    // Advance to t = 100000ms then simulate backward jump to t = 0 (simulator restart)
    const at100s = await useCase.execute({ ...eventAtZero, timestampMs: 100000 });
    assert.equal(at100s.registered, true);
    const afterRestart = await useCase.execute({ ...eventAtZero, timestampMs: 0 });
    assert.equal(afterRestart.registered, true);

    // reset() clears cooldown immediately
    assert.equal(useCase.isDebounced(ALERT_TYPES.DESEQUILIBRIO, 1000), true);
    useCase.reset(ALERT_TYPES.DESEQUILIBRIO);
    assert.equal(useCase.isDebounced(ALERT_TYPES.DESEQUILIBRIO, 1000), false);
  });

  it('degrades gracefully on TriageAIService failure/invalid output and never rejects on saveAlert failure', async () => {
    const repo = new MockAlertRepository();
    const rejectingAI = new MockTriageAIService({ shouldReject: true });
    const useCase1 = new RegisterEmergencyAlertUseCase({
      alertRepository: repo,
      triageAIService: rejectingAI,
      logger: silentLogger,
    });

    const fallbackRes = await useCase1.execute({
      tipo: ALERT_TYPES.QUEDA_CRITICA,
      severidade: ALERT_SEVERITIES.CRITICA,
      trunkAngleDeg: 15,
      verticalVelocity: 1.4,
      tempoImovelSeg: 5.5,
      timestampMs: 1000,
    });
    assert.equal(fallbackRes.status, REGISTER_ALERT_RESULTS.DEGRADED_AI_FALLBACK);
    assert.equal(fallbackRes.registered, true);
    assert.equal(fallbackRes.degraded, true);
    assert.equal(repo.savedAlerts.length, 1);
    assert.equal(repo.savedAlerts[0].fonte_ia, AI_SOURCES.FALLBACK_LOCAL);
    assert.ok(repo.savedAlerts[0].laudo_ia.length > 0);

    const malformedAI = new MockTriageAIService({
      response: { severidade: 'INVALID', fonte: 'BAD', laudo: '' },
    });
    const useCase2 = new RegisterEmergencyAlertUseCase({
      alertRepository: repo,
      triageAIService: malformedAI,
      logger: silentLogger,
    });
    const malformedRes = await useCase2.execute({
      tipo: ALERT_TYPES.DESEQUILIBRIO,
      trunkAngleDeg: 44,
      verticalVelocity: 0.3,
      tempoImovelSeg: 0,
      timestampMs: 2000,
    });
    assert.equal(malformedRes.status, REGISTER_ALERT_RESULTS.DEGRADED_AI_FALLBACK);
    assert.equal(malformedRes.registered, true);
    assert.equal(repo.savedAlerts[1].fonte_ia, AI_SOURCES.FALLBACK_LOCAL);
    assert.equal(repo.savedAlerts[1].severidade, ALERT_SEVERITIES.MEDIA);

    const failingRepo = new MockAlertRepository({ shouldRejectSave: true });
    const useCase3 = new RegisterEmergencyAlertUseCase({
      alertRepository: failingRepo,
      triageAIService: new MockTriageAIService(),
      logger: silentLogger,
    });
    const failedRes = await useCase3.execute({
      tipo: ALERT_TYPES.QUEDA_CRITICA,
      trunkAngleDeg: 12,
      verticalVelocity: 1.1,
      tempoImovelSeg: 6,
      timestampMs: 3000,
    });
    assert.equal(failedRes.status, REGISTER_ALERT_RESULTS.FAILED);
    assert.equal(failedRes.registered, false);
    assert.equal(failedRes.degraded, true);
    assert.ok(failedRes.error.includes('Firestore save failure'));
  });
});

describe('Application UseCase: UpdateMobilityMetricsUseCase', () => {
  it('validates DI, accumulates active/seated time and gait speed without dilution, and clamps gaps', () => {
    assert.throws(() => new UpdateMobilityMetricsUseCase(), TypeError);
    assert.throws(() => new UpdateMobilityMetricsUseCase({ alertRepository: {} }), TypeError);

    const repo = new MockAlertRepository();
    const clock = createFakeClock(Date.parse('2026-11-17T12:00:00.000Z'));
    const useCase = new UpdateMobilityMetricsUseCase({
      alertRepository: repo,
      nowFn: clock.now,
      logger: silentLogger,
    });

    // Walking sequence (CoM moving > MOVEMENT_STILLNESS_EPSILON while EM_PE) for 10 seconds
    for (let i = 0; i <= 300; i += 1) {
      const t = i * 33;
      useCase.recordFrame({
        valid: true,
        state: POSTURE_STATES.EM_PE,
        previousState: POSTURE_STATES.EM_PE,
        trunkAngleDeg: 85,
        centerOfMass: { x: 0.2 + (i % 20) * 0.03, y: 0.45, z: 0 },
        transitionEvent: null,
        timestampMs: t,
      });
    }

    // Invalid frames are ignored (do not inflate active or seated time)
    useCase.recordFrame({ valid: false, timestampMs: 10000 });

    // Seated stationary frames for 30 seconds (must NOT dilute gait speed)
    const speedBeforeSeated = useCase.getCurrentMetrics().velocidade_marcha_media;
    assert.ok(speedBeforeSeated > 0);

    for (let i = 1; i <= 30; i += 1) {
      useCase.recordFrame({
        valid: true,
        state: POSTURE_STATES.EM_PE,
        previousState: POSTURE_STATES.EM_PE,
        trunkAngleDeg: 86,
        isSeated: true,
        centerOfMass: { x: 0.5, y: 0.55, z: 0 },
        transitionEvent: null,
        timestampMs: 10000 + i * 1000,
      });
    }

    // Long 5-second gap clamped to MAX_FRAME_DELTA_MS (1000ms)
    useCase.recordFrame({
      valid: true,
      state: POSTURE_STATES.QUEDA_DETECTADA,
      previousState: POSTURE_STATES.EM_PE,
      trunkAngleDeg: 18,
      centerOfMass: { x: 0.5, y: 0.82, z: 0 },
      transitionEvent: null,
      timestampMs: 45000,
    });

    const snapshot = useCase.getCurrentMetrics();
    assert.ok(snapshot instanceof DailyMetrics);
    assert.ok(snapshot.tempo_ativo_min > 0);
    assert.ok(snapshot.tempo_sentado_min >= 0.5);
    assert.equal(snapshot.velocidade_marcha_media, speedBeforeSeated);
    assert.equal(repo.upsertedMetrics.length, 0);
  });

  it('counts qtd_desequilibrios and qtd_quedas strictly once per transition edge', () => {
    const repo = new MockAlertRepository();
    const clock = createFakeClock(Date.parse('2026-11-17T14:00:00.000Z'));
    const useCase = new UpdateMobilityMetricsUseCase({
      alertRepository: repo,
      nowFn: clock.now,
      logger: silentLogger,
    });

    const imbalanceTransition = {
      tipo: ALERT_TYPES.DESEQUILIBRIO,
      fromState: POSTURE_STATES.EM_PE,
      toState: POSTURE_STATES.DESEQUILIBRIO,
      timestampMs: 500,
    };

    useCase.recordFrame({
      valid: true,
      state: POSTURE_STATES.DESEQUILIBRIO,
      previousState: POSTURE_STATES.EM_PE,
      trunkAngleDeg: 45,
      centerOfMass: { x: 0.5, y: 0.5, z: 0 },
      transitionEvent: imbalanceTransition,
      timestampMs: 500,
    });
    // Replay / hold frames must NOT double-count
    useCase.recordFrame({
      valid: true,
      state: POSTURE_STATES.DESEQUILIBRIO,
      previousState: POSTURE_STATES.EM_PE,
      trunkAngleDeg: 45,
      centerOfMass: { x: 0.5, y: 0.5, z: 0 },
      transitionEvent: imbalanceTransition,
      timestampMs: 500,
    });
    useCase.recordFrame({
      valid: true,
      state: POSTURE_STATES.DESEQUILIBRIO,
      previousState: POSTURE_STATES.DESEQUILIBRIO,
      trunkAngleDeg: 46,
      centerOfMass: { x: 0.5, y: 0.5, z: 0 },
      transitionEvent: null,
      timestampMs: 533,
    });

    useCase.recordFrame({
      valid: true,
      state: POSTURE_STATES.ALERTA_CRITICO,
      previousState: POSTURE_STATES.QUEDA_DETECTADA,
      trunkAngleDeg: 15,
      centerOfMass: { x: 0.5, y: 0.82, z: 0 },
      transitionEvent: {
        tipo: ALERT_TYPES.QUEDA_CRITICA,
        fromState: POSTURE_STATES.QUEDA_DETECTADA,
        toState: POSTURE_STATES.ALERTA_CRITICO,
        timestampMs: 6000,
      },
      timestampMs: 6000,
    });

    const metrics = useCase.getCurrentMetrics();
    assert.equal(metrics.qtd_desequilibrios, 1);
    assert.equal(metrics.qtd_quedas, 1);
  });

  it('throttles upsertDailyMetrics to METRICS_SYNC_INTERVAL_MS (60s) across 30 FPS frames', async () => {
    const repo = new MockAlertRepository();
    const clock = createFakeClock(Date.parse('2026-11-17T10:00:00.000Z'));
    const useCase = new UpdateMobilityMetricsUseCase({
      alertRepository: repo,
      nowFn: clock.now,
      logger: silentLogger,
    });

    // 1818 frames at 33ms = 0..59961ms (< 60000ms) -> 0 writes!
    for (let i = 0; i <= 1817; i += 1) {
      useCase.execute({
        valid: true,
        state: POSTURE_STATES.EM_PE,
        previousState: POSTURE_STATES.EM_PE,
        trunkAngleDeg: 85,
        centerOfMass: { x: 0.3 + (i % 10) * 0.04, y: 0.45, z: 0 },
        transitionEvent: null,
        timestampMs: i * 33,
      });
    }
    assert.equal(repo.upsertedMetrics.length, 0);

    // Crossing 60000ms triggers 1st async throttled sync
    useCase.execute({
      valid: true,
      state: POSTURE_STATES.EM_PE,
      previousState: POSTURE_STATES.EM_PE,
      trunkAngleDeg: 85,
      centerOfMass: { x: 0.35, y: 0.45, z: 0 },
      transitionEvent: null,
      timestampMs: BIOMECHANICS_THRESHOLDS.METRICS_SYNC_INTERVAL_MS,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(repo.upsertedMetrics.length, 1);
    assert.equal(repo.upsertedMetrics[0].id, 'paciente_01_2026-11-17');
    assert.ok(
      repo.upsertedMetrics[0].score_risco_preventivo >= 0 &&
        repo.upsertedMetrics[0].score_risco_preventivo <= 100
    );

    // Crossing 120000ms triggers 2nd cumulative sync
    useCase.execute({
      valid: true,
      state: POSTURE_STATES.EM_PE,
      previousState: POSTURE_STATES.EM_PE,
      trunkAngleDeg: 85,
      centerOfMass: { x: 0.4, y: 0.45, z: 0 },
      transitionEvent: null,
      timestampMs: BIOMECHANICS_THRESHOLDS.METRICS_SYNC_INTERVAL_MS * 2,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(repo.upsertedMetrics.length, 2);
  });

  it('supports flush(), stop(), clean skips, and concurrent flush serialization', async () => {
    const repo = new MockAlertRepository();
    const clock = createFakeClock(Date.parse('2026-11-17T10:00:00.000Z'));
    const useCase = new UpdateMobilityMetricsUseCase({
      alertRepository: repo,
      nowFn: clock.now,
      logger: silentLogger,
    });

    const cleanFlush = await useCase.flush();
    assert.equal(cleanFlush.ok, true);
    assert.equal(cleanFlush.synced, false);
    assert.equal(cleanFlush.skipped, true);
    assert.equal(repo.upsertedMetrics.length, 0);

    useCase.recordFrame({
      valid: true,
      state: POSTURE_STATES.EM_PE,
      previousState: POSTURE_STATES.EM_PE,
      trunkAngleDeg: 85,
      centerOfMass: { x: 0.5, y: 0.45, z: 0 },
      transitionEvent: null,
      timestampMs: 0,
    });
    useCase.recordFrame({
      valid: true,
      state: POSTURE_STATES.EM_PE,
      previousState: POSTURE_STATES.EM_PE,
      trunkAngleDeg: 85,
      centerOfMass: { x: 0.55, y: 0.45, z: 0 },
      transitionEvent: null,
      timestampMs: 1000,
    });

    const deferred = createDeferred();
    repo.upsertDeferredQueue.push(deferred);

    const f1 = useCase.flush();
    const f2 = useCase.flush();
    deferred.resolve();

    const [res1, res2] = await Promise.all([f1, f2]);
    assert.equal(res1.synced, true);
    assert.equal(res2.skipped, true);
    assert.equal(repo.upsertedMetrics.length, 1);

    useCase.recordFrame({
      valid: true,
      state: POSTURE_STATES.EM_PE,
      previousState: POSTURE_STATES.EM_PE,
      trunkAngleDeg: 85,
      centerOfMass: { x: 0.6, y: 0.45, z: 0 },
      transitionEvent: null,
      timestampMs: 2000,
    });
    const stopRes = await useCase.stop();
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.synced, true);
    assert.equal(repo.upsertedMetrics.length, 2);
  });

  it('preserves accumulated totals and dirty flag when upsertDailyMetrics fails', async () => {
    const repo = new MockAlertRepository({ shouldRejectUpsert: true });
    const clock = createFakeClock(Date.parse('2026-11-17T10:00:00.000Z'));
    const useCase = new UpdateMobilityMetricsUseCase({
      alertRepository: repo,
      nowFn: clock.now,
      logger: silentLogger,
    });

    useCase.recordFrame({
      valid: true,
      state: POSTURE_STATES.DESEQUILIBRIO,
      previousState: POSTURE_STATES.EM_PE,
      trunkAngleDeg: 45,
      centerOfMass: { x: 0.5, y: 0.5, z: 0 },
      transitionEvent: {
        tipo: ALERT_TYPES.DESEQUILIBRIO,
        fromState: POSTURE_STATES.EM_PE,
        toState: POSTURE_STATES.DESEQUILIBRIO,
        timestampMs: 500,
      },
      timestampMs: 500,
    });

    const failedFlush = await useCase.flush();
    assert.equal(failedFlush.ok, false);
    assert.equal(failedFlush.synced, false);
    assert.ok(failedFlush.error.includes('Firestore upsert failure'));

    repo.shouldRejectUpsert = false;
    const retryFlush = await useCase.flush();
    assert.equal(retryFlush.ok, true);
    assert.equal(retryFlush.synced, true);
    assert.equal(repo.upsertedMetrics.length, 1);
    assert.equal(repo.upsertedMetrics[0].qtd_desequilibrios, 1);
  });

  it('flushes prior day on midnight rollover and hydrates same-day totals while ignoring stale dates', async () => {
    const repo = new MockAlertRepository();
    const day1Late = Date.parse('2026-11-17T23:59:59.000Z');
    const day2Early = Date.parse('2026-11-18T00:00:01.000Z');
    const clock = createFakeClock(day1Late);

    const useCase = new UpdateMobilityMetricsUseCase({
      alertRepository: repo,
      nowFn: clock.now,
      logger: silentLogger,
    });

    useCase.recordFrame({
      valid: true,
      state: POSTURE_STATES.DESEQUILIBRIO,
      previousState: POSTURE_STATES.EM_PE,
      trunkAngleDeg: 45,
      centerOfMass: { x: 0.5, y: 0.5, z: 0 },
      transitionEvent: {
        tipo: ALERT_TYPES.DESEQUILIBRIO,
        fromState: POSTURE_STATES.EM_PE,
        toState: POSTURE_STATES.DESEQUILIBRIO,
        timestampMs: day1Late,
      },
      timestampMs: day1Late,
    });

    // Cross midnight into 2026-11-18
    clock.set(day2Early);
    useCase.recordFrame({
      valid: true,
      state: POSTURE_STATES.EM_PE,
      previousState: POSTURE_STATES.EM_PE,
      trunkAngleDeg: 85,
      centerOfMass: { x: 0.52, y: 0.45, z: 0 },
      transitionEvent: null,
      timestampMs: day2Early,
    });

    // Wait for rollover flush via flush()
    await useCase.flush();
    assert.equal(repo.upsertedMetrics.length, 1);
    assert.equal(repo.upsertedMetrics[0].data, '2026-11-17');
    assert.equal(repo.upsertedMetrics[0].qtd_desequilibrios, 1);

    const day2Metrics = useCase.getCurrentMetrics();
    assert.equal(day2Metrics.data, '2026-11-18');
    assert.equal(day2Metrics.qtd_desequilibrios, 0);

    // hydrate() ignores stale date or wrong patient, restores same-day same-patient
    assert.equal(
      useCase.hydrate({ idoso_id: 'paciente_01', data: '2026-11-17', tempo_ativo_min: 50 }),
      false
    );
    assert.equal(
      useCase.hydrate({ idoso_id: 'outro_paciente', data: '2026-11-18', tempo_ativo_min: 50 }),
      false
    );
    assert.equal(
      useCase.hydrate({
        idoso_id: 'paciente_01',
        data: '2026-11-18',
        tempo_ativo_min: 12,
        tempo_sentado_min: 30,
        qtd_desequilibrios: 2,
        qtd_quedas: 0,
        velocidade_marcha_media: 0.9,
      }),
      true
    );
    const hydrated = useCase.getCurrentMetrics();
    assert.equal(hydrated.tempo_ativo_min, 12);
    assert.equal(hydrated.tempo_sentado_min, 30);
    assert.equal(hydrated.qtd_desequilibrios, 2);
    assert.equal(hydrated.velocidade_marcha_media, 0.9);
  });
});

describe('Application Integration: M2 Use Cases End-to-End 30 FPS Pipeline', () => {
  it('processes walking -> DESEQUILIBRIO -> rapid fall -> 5s immobility -> stop() across all 3 use cases', async () => {
    const repo = new MockAlertRepository();
    const ai = new MockTriageAIService();
    const clock = createFakeClock(Date.parse('2026-11-17T15:00:00.000Z'));

    const processPose = new ProcessPoseFrameUseCase();
    const registerAlert = new RegisterEmergencyAlertUseCase({
      alertRepository: repo,
      triageAIService: ai,
      logger: silentLogger,
    });
    const updateMetrics = new UpdateMobilityMetricsUseCase({
      alertRepository: repo,
      nowFn: clock.now,
      logger: silentLogger,
    });

    const pendingAlerts = [];
    const step = (landmarks, tMs) => {
      const frameRes = processPose.execute(landmarks, tMs);
      updateMetrics.recordFrame(frameRes);
      if (frameRes.transitionEvent) {
        pendingAlerts.push(registerAlert.execute(frameRes.transitionEvent));
      }
      return frameRes;
    };

    // 1. Walking for 1.5s (45 frames @ 33ms)
    let t = 0;
    for (let i = 0; i < 45; i += 1) {
      const x = 0.35 + (i % 15) * 0.02;
      step(createSyntheticLandmarks({ shoulderX: x, shoulderY: 0.25, hipX: x, hipY: 0.55 }), t);
      t += 33;
    }

    // 2. Sudden imbalance (tilt < 58 deg, vy >= 0.20)
    for (let i = 0; i < 5; i += 1) {
      step(
        createSyntheticLandmarks({
          shoulderX: 0.36,
          shoulderY: 0.38 + i * 0.015,
          hipX: 0.50,
          hipY: 0.55 + i * 0.01,
        }),
        t
      );
      t += 33;
    }

    // 3. Escalation into rapid fall (within < 15s of imbalance)
    for (let i = 0; i < 6; i += 1) {
      step(
        createSyntheticLandmarks({
          shoulderX: 0.28 - i * 0.015,
          shoulderY: 0.52 + i * 0.045,
          hipX: 0.55,
          hipY: 0.62 + i * 0.03,
        }),
        t
      );
      t += 33;
    }
    assert.equal(processPose.getState(), POSTURE_STATES.QUEDA_DETECTADA);

    // 4. Floor immobility >= 5s (still < 60s metric sync interval)
    const floorLandmarks = createSyntheticLandmarks({
      shoulderX: 0.20,
      shoulderY: 0.74,
      hipX: 0.55,
      hipY: 0.80,
    });
    for (let i = 0; i < 160; i += 1) {
      step(floorLandmarks, t);
      t += 33;
    }
    assert.equal(processPose.getState(), POSTURE_STATES.ALERTA_CRITICO);

    await Promise.all(pendingAlerts);
    assert.equal(repo.savedAlerts.length, 2);
    assert.equal(repo.savedAlerts[0].tipo, ALERT_TYPES.DESEQUILIBRIO);
    assert.equal(repo.savedAlerts[1].tipo, ALERT_TYPES.QUEDA_CRITICA);
    assert.equal(repo.upsertedMetrics.length, 0);

    const stopResult = await updateMetrics.stop();
    assert.equal(stopResult.synced, true);
    assert.equal(repo.upsertedMetrics.length, 1);

    const finalMetrics = repo.upsertedMetrics[0];
    assert.equal(finalMetrics.qtd_desequilibrios, 1);
    assert.equal(finalMetrics.qtd_quedas, 1);
    assert.ok(finalMetrics.tempo_ativo_min > 0);
    assert.ok(finalMetrics.velocidade_marcha_media > 0);
    assert.ok(
      finalMetrics.score_risco_preventivo >= 0 && finalMetrics.score_risco_preventivo <= 100
    );
  });

  it('processes slow crouch 30 FPS trajectory with zero alerts and positive active time', async () => {
    const repo = new MockAlertRepository();
    const ai = new MockTriageAIService();
    const clock = createFakeClock(Date.parse('2026-11-17T16:00:00.000Z'));

    const processPose = new ProcessPoseFrameUseCase();
    const registerAlert = new RegisterEmergencyAlertUseCase({
      alertRepository: repo,
      triageAIService: ai,
      logger: silentLogger,
    });
    const updateMetrics = new UpdateMobilityMetricsUseCase({
      alertRepository: repo,
      nowFn: clock.now,
      logger: silentLogger,
    });

    let t = 0;
    for (let i = 0; i < 20; i += 1) {
      const yOffset = i * 0.01;
      const frameRes = processPose.execute(
        createSyntheticLandmarks({
          shoulderX: 0.53,
          shoulderY: 0.25 + yOffset,
          hipX: 0.50,
          hipY: 0.55 + yOffset,
        }),
        t
      );
      updateMetrics.recordFrame(frameRes);
      if (frameRes.transitionEvent) {
        await registerAlert.execute(frameRes.transitionEvent);
      }
      t += 150;
    }

    const stopResult = await updateMetrics.stop();
    assert.equal(repo.savedAlerts.length, 0);
    assert.equal(ai.calls.length, 0);
    assert.equal(stopResult.synced, true);
    assert.equal(repo.upsertedMetrics[0].qtd_desequilibrios, 0);
    assert.equal(repo.upsertedMetrics[0].qtd_quedas, 0);
    assert.ok(repo.upsertedMetrics[0].tempo_ativo_min > 0);
  });
});
