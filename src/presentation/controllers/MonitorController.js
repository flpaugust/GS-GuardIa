import { BIOMECHANICS_THRESHOLDS } from '../../config/thresholds.js';
import { SIMULATION_SCENARIOS } from '../../infrastructure/vision/MediaPipePoseAdapter.js';

/**
 * Presentation controller for the "Estação Edge" panel.
 * Orchestrates camera / simulator input -> ProcessPoseFrameUseCase (sync, 30 FPS) and fires
 * alert registration asynchronously (fire-and-forget) so the loop never blocks on network I/O.
 */

const MONITOR_CONFIG = Object.freeze({
  FRAME_INTERVAL_MS: 33,
  SENSITIVITY_MIN_DEG: 10,
  SENSITIVITY_MAX_DEG: 50,
  SENSITIVITY_DEFAULT_DEG: BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG,
  // At the minimum slider position the detector is effectively disabled (calibration mode).
  DISABLED_DETECTION_THRESHOLD: 10,
  ANGLE_DECIMALS: 1,
  VELOCITY_DECIMALS: 2,
  SECONDS_DECIMALS: 1,
});

const SCENARIO_LABELS = Object.freeze({
  [SIMULATION_SCENARIOS.NORMAL]: 'Simulador: Postura Normal',
  [SIMULATION_SCENARIOS.DESEQUILIBRIO]: 'Simulador: Desequilíbrio',
  [SIMULATION_SCENARIOS.QUEDA_CRITICA]: 'Simulador: Queda Crítica',
});

const CAMERA_MESSAGES = Object.freeze({
  IDLE: 'Câmera desligada — Simulador Biomecânico ativo.',
  STARTING: 'Solicitando acesso à câmera…',
  LOADING_MODEL: 'Câmera ativa — carregando modelo MediaPipe Pose (processamento local)…',
  ACTIVE: 'Câmera ativa — MediaPipe Pose rodando localmente (nenhuma imagem sai do dispositivo).',
  MODEL_UNAVAILABLE: 'Câmera ativa, mas o modelo MediaPipe está indisponível (offline) — utilize o Simulador Biomecânico.',
  UNSUPPORTED: 'Câmera indisponível neste navegador — utilize o Simulador Biomecânico.',
  DENIED: 'Permissão de câmera negada ou câmera indisponível — utilize o Simulador Biomecânico.',
});

function clampSensitivity(rawValue) {
  const numeric = Number(rawValue);
  const safe = Number.isFinite(numeric) ? numeric : MONITOR_CONFIG.SENSITIVITY_DEFAULT_DEG;
  return Math.round(
    Math.min(MONITOR_CONFIG.SENSITIVITY_MAX_DEG, Math.max(MONITOR_CONFIG.SENSITIVITY_MIN_DEG, safe))
  );
}

export class MonitorController {
  /**
   * @param {object} deps
   */
  constructor({
    elements,
    poseAdapter,
    processPoseUseCase,
    registerAlertUseCase,
    metricsUseCase,
    skeletonRenderer,
    onFrame = () => {},
    onAlertRegistered = () => {},
    logger = console,
  }) {
    this._el = elements;
    this._poseAdapter = poseAdapter;
    this._processPose = processPoseUseCase;
    this._registerAlert = registerAlertUseCase;
    this._metrics = metricsUseCase;
    this._renderer = skeletonRenderer;
    this._onFrame = onFrame;
    this._onAlertRegistered = onAlertRegistered;
    this._logger = logger;

    this._intervalId = null;
    this._cameraActive = false;
    this._cameraSession = 0;
    this._mediaStream = null;
    this._lastState = 'EM_PE';
    this._sourceLabel = SCENARIO_LABELS[SIMULATION_SCENARIOS.NORMAL];
  }

  init() {
    const el = this._el;
    el.privacyToggle.addEventListener('change', () => this._applyPrivacyMode());
    el.btnStartCamera.addEventListener('click', () => this.startCamera());
    el.btnStopCamera.addEventListener('click', () => this.stopCamera());
    el.btnSimNormal.addEventListener('click', () => this.startScenario(SIMULATION_SCENARIOS.NORMAL));
    el.btnSimImbalance.addEventListener('click', () => this.startScenario(SIMULATION_SCENARIOS.DESEQUILIBRIO));
    el.btnSimFall.addEventListener('click', () => this.startScenario(SIMULATION_SCENARIOS.QUEDA_CRITICA));
    el.sensitivitySlider.addEventListener('input', () => this._applySensitivity());
    el.sensitivitySlider.addEventListener('change', () => this._applySensitivity());

    this._applyPrivacyMode();
    this._applySensitivity();
    this._setCameraMessage(CAMERA_MESSAGES.IDLE);
    this.startScenario(SIMULATION_SCENARIOS.NORMAL);
    this._intervalId = setInterval(() => this._tick(), MONITOR_CONFIG.FRAME_INTERVAL_MS);
  }

  startScenario(scenarioName) {
    if (this._cameraActive) {
      this._teardownCamera();
      this._setCameraMessage(CAMERA_MESSAGES.IDLE);
    }
    this._processPose.reset();
    this._poseAdapter.startScenario(scenarioName, Date.now());
    this._sourceLabel = SCENARIO_LABELS[scenarioName];
    this._tick();
  }

  async startCamera() {
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
      this._setCameraMessage(CAMERA_MESSAGES.UNSUPPORTED);
      return;
    }

    const session = ++this._cameraSession;
    this._setCameraMessage(CAMERA_MESSAGES.STARTING);
    try {
      const stream = await mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      if (session !== this._cameraSession) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this._mediaStream = stream;
      this._el.video.srcObject = stream;
      await this._el.video.play?.().catch(() => {});
      this._poseAdapter.stopScenario();
      this._processPose.reset();
      this._cameraActive = true;
      this._sourceLabel = 'Webcam (MediaPipe local)';
      this._setCameraMessage(CAMERA_MESSAGES.LOADING_MODEL);

      const initResult = await this._poseAdapter.initialize();
      if (session !== this._cameraSession) {
        return;
      }
      this._setCameraMessage(initResult.ok ? CAMERA_MESSAGES.ACTIVE : CAMERA_MESSAGES.MODEL_UNAVAILABLE);
    } catch (error) {
      if (session !== this._cameraSession) {
        return;
      }
      this._logger?.warn?.('[MonitorController] getUserMedia falhou:', error?.name || error);
      this._teardownCamera();
      this._setCameraMessage(CAMERA_MESSAGES.DENIED);
      this.startScenario(SIMULATION_SCENARIOS.NORMAL);
    }
  }

  stopCamera() {
    this._cameraSession += 1;
    this._teardownCamera();
    this._setCameraMessage(CAMERA_MESSAGES.IDLE);
    this.startScenario(SIMULATION_SCENARIOS.NORMAL);
  }

  async shutdown() {
    clearInterval(this._intervalId);
    this._teardownCamera();
    await this._metrics.stop();
  }

  _teardownCamera() {
    this._cameraActive = false;
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach((track) => track.stop());
      this._mediaStream = null;
    }
    if (this._el.video) {
      this._el.video.srcObject = null;
    }
  }

  _tick() {
    const nowMs = Date.now();
    const poseFrame = this._cameraActive
      ? this._poseAdapter.detectPose(this._el.video, nowMs)
      : this._poseAdapter.sampleSimulatedPoseFrame(nowMs);

    if (!poseFrame) {
      this._renderer.render(null, { state: this._lastState, sourceLabel: this._sourceLabel });
      return;
    }

    const result = this._processPose.execute(poseFrame);
    this._metrics.recordFrame(result);
    this._lastState = result.state;

    if (result.transitionEvent) {
      // Fire-and-forget: never await network I/O inside the frame loop.
      void this._registerAlert
        .execute(result.transitionEvent, { nowMs })
        .then((outcome) => this._onAlertRegistered(outcome))
        .catch((error) => this._logger?.error?.('[MonitorController] Falha ao registrar alerta:', error));
    }

    const activeLabel = this._cameraActive
      ? (result.valid ? 'Webcam: Corpo detectado' : 'Webcam: Aguardando pessoa no quadro')
      : this._sourceLabel;

    this._renderer.render(poseFrame.landmarks, { state: result.state, sourceLabel: activeLabel });
    this._updateHud(result);
    this._onFrame(result);
  }

  _updateHud(result) {
    const el = this._el;
    if (el.postureBadge.dataset.state !== result.state) {
      el.postureBadge.dataset.state = result.state;
      el.postureBadge.textContent = result.state;
    }
    if (Number.isFinite(result.trunkAngleDeg)) {
      el.hudTrunkAngle.textContent = `${result.trunkAngleDeg.toFixed(MONITOR_CONFIG.ANGLE_DECIMALS)}°`;
    }
    const velocity = Number.isFinite(result.verticalVelocity) ? result.verticalVelocity : 0;
    el.hudVerticalVelocity.textContent = `${velocity.toFixed(MONITOR_CONFIG.VELOCITY_DECIMALS)} u/s`;
    const immobilitySec = Math.max(0, (result.immobilityDurationMs || 0) / BIOMECHANICS_THRESHOLDS.MS_PER_SECOND);
    el.hudImmobilityTimer.textContent = `${immobilitySec.toFixed(MONITOR_CONFIG.SECONDS_DECIMALS)} s`;
  }

  _applyPrivacyMode() {
    const enabled = this._el.privacyToggle.checked;
    this._renderer.setPrivacyMode(enabled);
    this._el.video.classList.toggle('is-hidden', enabled);
    this._el.monitorStage.classList.toggle('privacy-on', enabled);
  }

  _applySensitivity() {
    const slider = this._el.sensitivitySlider;
    const clamped = clampSensitivity(slider.value);
    slider.value = String(clamped);
    this._el.sensitivityValue.textContent = `${clamped}°`;

    if (clamped <= MONITOR_CONFIG.SENSITIVITY_MIN_DEG) {
      const off = MONITOR_CONFIG.DISABLED_DETECTION_THRESHOLD;
      this._processPose.updateThresholds({
        TRUNK_FALL_ANGLE_DEG: off,
        TRUNK_IMBALANCE_ANGLE_DEG: off,
        FALL_VERTICAL_VELOCITY_THRESHOLD: off,
        IMBALANCE_VERTICAL_VELOCITY_THRESHOLD: off,
      });
      this._el.sensitivityHint.textContent = 'Modo calibração: detecção desativada.';
      return;
    }

    this._processPose.updateThresholds({
      TRUNK_FALL_ANGLE_DEG: clamped,
      TRUNK_IMBALANCE_ANGLE_DEG: BIOMECHANICS_THRESHOLDS.TRUNK_IMBALANCE_ANGLE_DEG,
      FALL_VERTICAL_VELOCITY_THRESHOLD: BIOMECHANICS_THRESHOLDS.FALL_VERTICAL_VELOCITY_THRESHOLD,
      IMBALANCE_VERTICAL_VELOCITY_THRESHOLD: BIOMECHANICS_THRESHOLDS.IMBALANCE_VERTICAL_VELOCITY_THRESHOLD,
    });
    this._el.sensitivityHint.textContent = 'Ângulo do tronco abaixo do qual a postura é considerada queda.';
  }

  _setCameraMessage(text) {
    this._el.cameraStatusMsg.textContent = text;
  }
}
