/**
 * Composition root: wires infrastructure adapters, application use cases and presentation
 * controllers via dependency injection (Clean Architecture — only this file knows them all).
 */
import { BIOMECHANICS_THRESHOLDS } from './config/thresholds.js';
import {
  clearEnvConfig,
  isValidFirebaseConfig,
  loadEnvConfig,
  loadServerEnvConfig,
  saveEnvConfig,
} from './config/env.js';
import { ProcessPoseFrameUseCase } from './application/ProcessPoseFrameUseCase.js';
import { RegisterEmergencyAlertUseCase } from './application/RegisterEmergencyAlertUseCase.js';
import { UpdateMobilityMetricsUseCase } from './application/UpdateMobilityMetricsUseCase.js';
import { GeminiTriageAdapter } from './infrastructure/ai/GeminiTriageAdapter.js';
import { LocalStorageRepository } from './infrastructure/persistence/LocalStorageRepository.js';
import { RepositoryFactory } from './infrastructure/persistence/RepositoryFactory.js';
import { SwitchableRepository } from './infrastructure/persistence/SwitchableRepository.js';
import { MediaPipePoseAdapter } from './infrastructure/vision/MediaPipePoseAdapter.js';
import { DashboardController } from './presentation/controllers/DashboardController.js';
import { MonitorController } from './presentation/controllers/MonitorController.js';
import { ChartsRenderer } from './presentation/views/ChartsRenderer.js';
import { SkeletonCanvasRenderer } from './presentation/views/SkeletonCanvasRenderer.js';

const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const byId = (id) => document.getElementById(id);

function collectElements() {
  return {
    monitor: {
      monitorStage: byId('monitor-stage'),
      video: byTestId('monitor-video'),
      canvas: byTestId('monitor-canvas'),
      privacyToggle: byTestId('privacy-mode-toggle'),
      btnStartCamera: byTestId('btn-start-camera'),
      btnStopCamera: byTestId('btn-stop-camera'),
      cameraStatusMsg: byTestId('camera-status-msg'),
      postureBadge: byTestId('posture-state-badge'),
      hudTrunkAngle: byTestId('hud-trunk-angle'),
      hudVerticalVelocity: byTestId('hud-vertical-velocity'),
      hudImmobilityTimer: byTestId('hud-immobility-timer'),
      btnSimNormal: byTestId('btn-sim-normal'),
      btnSimImbalance: byTestId('btn-sim-imbalance'),
      btnSimFall: byTestId('btn-sim-fall'),
      sensitivitySlider: byTestId('sensitivity-slider'),
      sensitivityValue: byTestId('sensitivity-value'),
      sensitivityHint: byId('sensitivity-hint'),
    },
    dashboard: {
      connectionBadge: byTestId('connection-mode-badge'),
      kpiSlaStatus: byTestId('kpi-sla-status'),
      kpiSlaStatusValue: byId('kpi-sla-value'),
      kpiSlaStatusHint: byId('kpi-sla-hint'),
      kpiRiskScore: byTestId('kpi-risk-score'),
      kpiRiskScoreValue: byId('kpi-risk-value'),
      kpiRiskScoreHint: byId('kpi-risk-hint'),
      kpiWeeklyImbalances: byTestId('kpi-weekly-imbalances'),
      kpiWeeklyImbalancesValue: byId('kpi-imbalances-value'),
      kpiCloudOps: byTestId('kpi-cloud-ops'),
      kpiCloudOpsValue: byId('kpi-cloud-value'),
      emergencyBanner: byTestId('emergency-banner'),
      emergencyBannerText: byId('emergency-banner-text'),
      alertFeedList: byTestId('alert-feed-list'),
      alertFeedEmpty: byId('alert-feed-empty'),
      btnOpenConfig: byTestId('btn-open-config'),
      configModal: byTestId('config-modal'),
      inputFirebaseConfig: byTestId('input-firebase-config'),
      inputGeminiApiKey: byTestId('input-gemini-api-key'),
      btnSaveConfig: byTestId('btn-save-config'),
      btnClearConfig: byTestId('btn-clear-config'),
      btnCloseConfig: byTestId('btn-close-config'),
      configValidationError: byTestId('config-validation-error'),
    },
    charts: {
      weeklyCanvas: byTestId('chart-weekly-mobility'),
      hourlyCanvas: byTestId('chart-hourly-vulnerability'),
    },
  };
}

function hydrateTodayMetrics(repository, metricsUseCase, patientId) {
  let hydrated = false;
  let unsubscribe = null;
  unsubscribe = repository.subscribeToDailyMetrics((metricsList) => {
    if (hydrated) return;
    hydrated = true;
    const todayKey = metricsUseCase.getCurrentMetrics().data;
    const today = metricsList.find((m) => m.data === todayKey);
    if (today) metricsUseCase.hydrate(today);
    unsubscribe?.();
  }, patientId);
  if (hydrated) unsubscribe?.();
}

function bootstrap() {
  const env = loadEnvConfig();
  const patientId = env.patientId || BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID;
  const elements = collectElements();

  // Infrastructure — always start instantly on the local fallback, then upgrade to Firestore.
  const repository = new SwitchableRepository(new LocalStorageRepository({ patientId }));
  const triageService = new GeminiTriageAdapter();
  const poseAdapter = new MediaPipePoseAdapter();

  // Application
  const processPoseUseCase = new ProcessPoseFrameUseCase();
  const registerAlertUseCase = new RegisterEmergencyAlertUseCase({
    alertRepository: repository,
    triageAIService: triageService,
    patientId,
  });
  const metricsUseCase = new UpdateMobilityMetricsUseCase({ alertRepository: repository, patientId });
  hydrateTodayMetrics(repository, metricsUseCase, patientId);

  // Presentation
  const chartsRenderer = new ChartsRenderer(elements.charts);
  let backendToken = 0;

  const dashboard = new DashboardController({
    elements: elements.dashboard,
    repository,
    chartsRenderer,
    getLiveTodayMetrics: () => metricsUseCase.getCurrentMetrics(),
    envService: { loadEnvConfig, saveEnvConfig, clearEnvConfig },
    onConfigChanged: (config) => applyBackend(config),
    patientId,
  });

  async function applyBackend(config) {
    const token = ++backendToken;
    if (!isValidFirebaseConfig(config?.firebaseConfig)) {
      if (repository.mode !== 'LOCAL_STORAGE') {
        repository.switchTo(new LocalStorageRepository({ patientId }));
      }
      dashboard.setConnectionMode('LOCAL');
      dashboard.refreshAll();
      return;
    }

    dashboard.setConnectionMode('CONNECTING');
    let failed = false;
    const nextRepo = await RepositoryFactory.create({
      firebaseConfig: config.firebaseConfig,
      firestoreOptions: { patientId },
      localStorageOptions: { patientId },
      onFallback: () => {
        failed = true;
      },
    });
    if (token !== backendToken) {
      nextRepo.close?.();
      return;
    }
    if (failed) {
      nextRepo.close?.();
    } else {
      repository.switchTo(nextRepo);
    }
    dashboard.setConnectionMode(failed ? 'FIRESTORE_FAILED' : 'FIRESTORE');
    dashboard.refreshAll();
  }

  const monitor = new MonitorController({
    elements: elements.monitor,
    poseAdapter,
    processPoseUseCase,
    registerAlertUseCase,
    metricsUseCase,
    skeletonRenderer: new SkeletonCanvasRenderer(elements.monitor.canvas),
    onFrame: () => dashboard.refreshLiveKpis(),
  });

  dashboard.init();
  dashboard.setConnectionMode('LOCAL');
  monitor.init();
  if (isValidFirebaseConfig(env.firebaseConfig)) {
    void applyBackend(env);
  }
  void loadServerEnvConfig().then(() => {
    const resolvedEnv = loadEnvConfig();
    if (isValidFirebaseConfig(resolvedEnv.firebaseConfig)) {
      void applyBackend(resolvedEnv);
    }
  });
  void chartsRenderer.loadChartLibrary().then(() => {
    byId('chart-engine').textContent = `Gráficos: ${chartsRenderer.engine}`;
  });

  globalThis.addEventListener('pagehide', () => {
    void metricsUseCase.flush();
  });
}

bootstrap();
