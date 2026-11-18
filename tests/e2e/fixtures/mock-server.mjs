import http from 'node:http';

const STATIC_ASSETS = {
  '/styles.css': {
    contentType: 'text/css; charset=utf-8',
    body: `
:root {
  color-scheme: dark;
  --bg: #0b1120;
  --panel: #111827;
  --border: #1e293b;
  --text: #f1f5f9;
  --muted: #94a3b8;
  --accent: #38bdf8;
  --danger: #ef4444;
  --warn: #f59e0b;
  --ok: #10b981;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, sans-serif;
  overflow-x: hidden;
}
.topbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: #0f172a;
  border-bottom: 1px solid var(--border);
}
.app-shell {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 16px;
  max-width: 1600px;
  margin: 0 auto;
}
@media (max-width: 960px) {
  .app-shell {
    grid-template-columns: 1fr;
  }
}
.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  min-width: 0;
}
.viewport-wrap {
  position: relative;
  background: #020617;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
}
video, canvas {
  max-width: 100%;
  height: auto;
  display: block;
}
video.hidden-privacy {
  display: none !important;
}
.hud-bar, .controls-row, .kpi-grid {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}
.hud-bar { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.controls-row { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
.card {
  background: #0f172a;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
}
button {
  background: #1e293b;
  color: var(--text);
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
}
button:hover { background: #334155; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  background: #1e293b;
}
.emergency-banner {
  background: #7f1d1d;
  color: #fef2f2;
  border: 1px solid #ef4444;
  padding: 10px 12px;
  border-radius: 8px;
  margin-top: 10px;
}
.emergency-banner[hidden] { display: none; }
.alert-feed {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.alert-card {
  background: #0f172a;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
}
.charts-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-top: 12px;
}
.chart-box {
  position: relative;
  background: #0f172a;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
}
.chart-tooltip {
  position: absolute;
  pointer-events: none;
  background: #020617;
  border: 1px solid var(--accent);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  display: none;
}
dialog.config-modal {
  background: var(--panel);
  color: var(--text);
  border: 1px solid #334155;
  border-radius: 12px;
  padding: 20px;
  max-width: 480px;
  width: 92%;
}
dialog.config-modal[hidden] { display: none; }
dialog.config-modal textarea, dialog.config-modal input {
  width: 100%;
  background: #020617;
  color: var(--text);
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 8px;
  margin-top: 4px;
}
.validation-error {
  color: #fca5a5;
  margin-top: 8px;
  font-size: 0.9rem;
}
.validation-error[hidden] { display: none; }
`,
  },
  '/package.json': {
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(
      {
        name: 'guardiao-e2e-fixture',
        version: '1.0.0',
        type: 'module',
      },
      null,
      2,
    ),
  },
  '/src/config/thresholds.js': {
    contentType: 'application/javascript; charset=utf-8',
    body: `export const BIOMECHANICS_THRESHOLDS = Object.freeze({
  MIN_LANDMARK_VISIBILITY: 0.5,
  SMOOTHING_WINDOW_SIZE: 4,
  MIN_DELTA_TIME_MS: 16,
  TRUNK_FALL_ANGLE_DEG: 35.0,
  TRUNK_IMBALANCE_ANGLE_DEG: 58.0,
  FALL_VERTICAL_VELOCITY_THRESHOLD: 0.55,
  IMBALANCE_VERTICAL_VELOCITY_THRESHOLD: 0.20,
  IMMOBILITY_CONFIRMATION_MS: 5000,
  IMBALANCE_RECOVERY_MAX_MS: 3000,
  MOVEMENT_STILLNESS_EPSILON: 0.035,
  ALERT_DEBOUNCE_MS: 15000,
  METRICS_SYNC_INTERVAL_MS: 60000,
});
`,
  },
  '/src/config/env.example.js': {
    contentType: 'application/javascript; charset=utf-8',
    body: `export const ENV_TEMPLATE = Object.freeze({
  firebaseConfig: null,
  geminiApiKey: '',
});
`,
  },
  '/src/config/env.js': {
    contentType: 'application/javascript; charset=utf-8',
    body: `export function loadRuntimeEnv() {
  try {
    const raw = localStorage.getItem('guardiao_fixture_env_v1');
    return raw ? JSON.parse(raw) : { firebaseConfig: null, geminiApiKey: '' };
  } catch {
    return { firebaseConfig: null, geminiApiKey: '' };
  }
}
`,
  },
  '/src/domain/services/PostureStateMachine.js': {
    contentType: 'application/javascript; charset=utf-8',
    body: `export const POSTURE_STATES = Object.freeze({
  EM_PE: 'EM_PE',
  DESEQUILIBRIO: 'DESEQUILIBRIO',
  QUEDA_DETECTADA: 'QUEDA_DETECTADA',
  ALERTA_CRITICO: 'ALERTA_CRITICO',
});
`,
  },
  '/src/main.js': {
    contentType: 'application/javascript; charset=utf-8',
    body: `import { BIOMECHANICS_THRESHOLDS } from './config/thresholds.js';
import { loadRuntimeEnv } from './config/env.js';

const STORAGE_KEYS = {
  env: 'guardiao_fixture_env_v1',
  alerts: 'guardiao_fixture_alerts_v1',
  metrics: 'guardiao_fixture_metrics_v1',
  ops: 'guardiao_fixture_ops_v1',
};

const CHANNEL_NAME = 'guardiao_fixture_sync_v1';
const PATIENT_ID = 'paciente_01';

function safeGetJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function safeSetJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function todayStr(offsetDays = 0) {
  const d = new Date(Date.now() - offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function computeRiskScore(m) {
  const active = Math.max(0, Number(m.tempo_ativo_min) || 0);
  const sitting = Math.max(0, Number(m.tempo_sentado_min) || 0);
  const total = active + sitting;
  const sedentaryRatio = total > 0 ? sitting / total : 0;
  const imb = Math.max(0, Number(m.qtd_desequilibrios) || 0);
  const falls = Math.max(0, Number(m.qtd_quedas) || 0);
  const gait = Number(m.velocidade_marcha_media);
  const lowGaitPts = Number.isFinite(gait) && gait > 0 && gait < 0.7 ? 15 : 0;
  const raw = Math.round(sedentaryRatio * 35 + Math.min(30, imb * 5) + Math.min(35, falls * 20) + lowGaitPts);
  return Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
}

function buildSeedMetrics() {
  const base = [];
  for (let i = 6; i >= 0; i--) {
    const rec = {
      id: PATIENT_ID + '_' + todayStr(i),
      idoso_id: PATIENT_ID,
      data: todayStr(i),
      tempo_ativo_min: 140 - i * 5,
      tempo_sentado_min: 300 + i * 10,
      qtd_desequilibrios: i % 3,
      qtd_quedas: 0,
      velocidade_marcha_media: 0.92,
      atualizado_em: new Date().toISOString(),
    };
    rec.score_risco_preventivo = computeRiskScore(rec);
    base.push(rec);
  }
  return base;
}

function loadStateFromStorage() {
  let env = loadRuntimeEnv();
  if (!env || typeof env !== 'object') env = { firebaseConfig: null, geminiApiKey: '' };

  let metrics = safeGetJson(STORAGE_KEYS.metrics, 'CORRUPT');
  if (metrics === 'CORRUPT' || !Array.isArray(metrics) || metrics.length === 0) {
    metrics = buildSeedMetrics();
    safeSetJson(STORAGE_KEYS.metrics, metrics);
  } else {
    metrics = metrics.map((m) => ({
      ...m,
      score_risco_preventivo: computeRiskScore(m),
    }));
  }

  let alerts = safeGetJson(STORAGE_KEYS.alerts, 'CORRUPT');
  if (alerts === 'CORRUPT' || !Array.isArray(alerts)) {
    alerts = [];
    safeSetJson(STORAGE_KEYS.alerts, alerts);
  }

  let ops = safeGetJson(STORAGE_KEYS.ops, 'CORRUPT');
  if (ops === 'CORRUPT' || !ops || typeof ops !== 'object') {
    ops = { reads: 1, writes: 0 };
  } else {
    ops = {
      reads: (Number(ops.reads) || 0) + 1,
      writes: Number(ops.writes) || 0,
    };
  }
  safeSetJson(STORAGE_KEYS.ops, ops);

  return { env, metrics, alerts, ops };
}

function initApp() {
  let state = loadStateFromStorage();
  let channel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
    }
  } catch {
    channel = null;
  }

  const els = {
    badge: document.querySelector('[data-testid="connection-mode-badge"]'),
    video: document.querySelector('[data-testid="monitor-video"]'),
    canvas: document.querySelector('[data-testid="monitor-canvas"]'),
    privacyToggle: document.querySelector('[data-testid="privacy-mode-toggle"]'),
    btnStartCamera: document.querySelector('[data-testid="btn-start-camera"]'),
    btnStopCamera: document.querySelector('[data-testid="btn-stop-camera"]'),
    cameraStatus: document.querySelector('[data-testid="camera-status-msg"]'),
    postureBadge: document.querySelector('[data-testid="posture-state-badge"]'),
    hudAngle: document.querySelector('[data-testid="hud-trunk-angle"]'),
    hudVel: document.querySelector('[data-testid="hud-vertical-velocity"]'),
    hudImmob: document.querySelector('[data-testid="hud-immobility-timer"]'),
    btnSimNormal: document.querySelector('[data-testid="btn-sim-normal"]'),
    btnSimImbalance: document.querySelector('[data-testid="btn-sim-imbalance"]'),
    btnSimFall: document.querySelector('[data-testid="btn-sim-fall"]'),
    slider: document.querySelector('[data-testid="sensitivity-slider"]'),
    sliderVal: document.querySelector('[data-testid="sensitivity-value"]'),
    kpiSla: document.querySelector('[data-testid="kpi-sla-status"]'),
    kpiRisk: document.querySelector('[data-testid="kpi-risk-score"]'),
    kpiImb: document.querySelector('[data-testid="kpi-weekly-imbalances"]'),
    kpiOps: document.querySelector('[data-testid="kpi-cloud-ops"]'),
    banner: document.querySelector('[data-testid="emergency-banner"]'),
    feed: document.querySelector('[data-testid="alert-feed-list"]'),
    chartWeekly: document.querySelector('[data-testid="chart-weekly-mobility"]'),
    chartHourly: document.querySelector('[data-testid="chart-hourly-vulnerability"]'),
    tooltipWeekly: document.getElementById('tooltip-weekly'),
    tooltipHourly: document.getElementById('tooltip-hourly'),
    btnOpenConfig: document.querySelector('[data-testid="btn-open-config"]'),
    modal: document.querySelector('[data-testid="config-modal"]'),
    inputFirebase: document.querySelector('[data-testid="input-firebase-config"]'),
    inputGemini: document.querySelector('[data-testid="input-gemini-api-key"]'),
    btnSaveConfig: document.querySelector('[data-testid="btn-save-config"]'),
    btnClearConfig: document.querySelector('[data-testid="btn-clear-config"]'),
    btnCloseConfig: document.querySelector('[data-testid="btn-close-config"]'),
    configError: document.querySelector('[data-testid="config-validation-error"]'),
  };

  let fallAngleThreshold = Number(els.slider.value) || BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG;
  let scenario = 'NORMAL';
  let postureState = 'EM_PE';
  let trunkAngleDeg = 84.0;
  let verticalVelocity = 0.02;
  let immobilityMs = 0;
  let imbalanceElapsedMs = 0;
  let cameraActive = false;
  let mediaStream = null;
  let lastTickTime = performance.now();
  let lastMetricsSyncTime = performance.now();
  let sessionActiveSec = 0;
  let sessionSittingSec = 0;
  const lastAlertTimestampByType = {};
  let fallAlertEmittedForCurrentFall = false;
  let imbalanceAlertEmitted = false;
  let weeklyChartInstance = null;
  let hourlyChartInstance = null;

  function updateConnectionBadge() {
    const hasFirebase =
      state.env.firebaseConfig &&
      typeof state.env.firebaseConfig === 'object' &&
      Boolean(state.env.firebaseConfig.apiKey) &&
      Boolean(state.env.firebaseConfig.projectId);
    if (hasFirebase) {
      els.badge.textContent = 'Cloud Firestore';
      els.badge.setAttribute('data-mode', 'FIRESTORE');
    } else {
      els.badge.textContent = 'Modo Fallback Local';
      els.badge.setAttribute('data-mode', 'LOCAL_STORAGE');
    }
  }

  function recordWrite() {
    state.ops.writes += 1;
    safeSetJson(STORAGE_KEYS.ops, state.ops);
    renderKpis();
  }

  function broadcast(type, payload) {
    if (!channel) return;
    try {
      channel.postMessage({ source: 'guardiao', type, payload });
    } catch {
      // Ignore BroadcastChannel errors
    }
  }

  function renderHud() {
    els.postureBadge.textContent = postureState;
    els.postureBadge.setAttribute('data-state', postureState);
    const safeAngle = Number.isFinite(trunkAngleDeg) ? trunkAngleDeg : 84.0;
    const safeVel = Number.isFinite(verticalVelocity) ? verticalVelocity : 0.0;
    const safeImmob = Number.isFinite(immobilityMs) ? immobilityMs / 1000 : 0.0;
    els.hudAngle.textContent = safeAngle.toFixed(1) + '°';
    els.hudVel.textContent = safeVel.toFixed(2) + ' u/s';
    els.hudImmob.textContent = safeImmob.toFixed(1) + 's';
  }

  function drawSkeleton(nowMs) {
    const ctx = els.canvas.getContext('2d');
    if (!ctx) return;
    const w = els.canvas.width;
    const h = els.canvas.height;
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, w, h);

    const isFall = postureState === 'QUEDA_DETECTADA' || postureState === 'ALERTA_CRITICO';
    const isImb = postureState === 'DESEQUILIBRIO';
    const sway = Math.sin(nowMs / 350) * (isImb ? 22 : 4);

    const head = isFall ? [w * 0.25, h * 0.78] : [w * 0.5 + sway, h * 0.22];
    const shoulders = isFall ? [w * 0.35, h * 0.78] : [w * 0.5 + sway, h * 0.35];
    const hips = isFall ? [w * 0.58, h * 0.80] : [w * 0.5, h * 0.56];
    const knees = isFall ? [w * 0.72, h * 0.82] : [w * 0.5, h * 0.74];
    const ankles = isFall ? [w * 0.85, h * 0.84] : [w * 0.5, h * 0.90];

    ctx.strokeStyle = isFall ? '#ef4444' : isImb ? '#f59e0b' : '#38bdf8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(head[0], head[1]);
    ctx.lineTo(shoulders[0], shoulders[1]);
    ctx.lineTo(hips[0], hips[1]);
    ctx.lineTo(knees[0], knees[1]);
    ctx.lineTo(ankles[0], ankles[1]);
    ctx.stroke();

    // Arms & 33-point approximation dots
    ctx.fillStyle = '#f8fafc';
    const pts = [head, shoulders, hips, knees, ankles,
      [shoulders[0] - 28, shoulders[1] + 20], [shoulders[0] + 28, shoulders[1] + 20],
      [hips[0] - 18, hips[1]], [hips[0] + 18, hips[1]],
    ];
    for (const [px, py] of pts) {
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px monospace';
    ctx.fillText(
      'LGPD Edge | ' + postureState + ' | θ=' + trunkAngleDeg.toFixed(1) + '° | vy=' + verticalVelocity.toFixed(2),
      12,
      22,
    );
  }

  function renderCharts() {
    const labels7 = state.metrics.map((m) => m.data.slice(5));
    const scores7 = state.metrics.map((m) => computeRiskScore(m));
    const hourlyBuckets = new Array(24).fill(0);
    for (const a of state.alerts) {
      const hr = new Date(a.timestamp).getHours();
      if (Number.isInteger(hr) && hr >= 0 && hr < 24) hourlyBuckets[hr] += 1;
    }

    if (typeof window.Chart === 'function') {
      if (!weeklyChartInstance) {
        weeklyChartInstance = new window.Chart(els.chartWeekly.getContext('2d'), {
          type: 'line',
          data: {
            labels: labels7,
            datasets: [{ label: 'Score de Risco', data: scores7, borderColor: '#38bdf8', tension: 0.3 }],
          },
          options: { animation: false, responsive: true },
        });
      } else {
        weeklyChartInstance.data.labels = labels7;
        weeklyChartInstance.data.datasets[0].data = scores7;
        weeklyChartInstance.update('none');
      }

      if (!hourlyChartInstance) {
        hourlyChartInstance = new window.Chart(els.chartHourly.getContext('2d'), {
          type: 'bar',
          data: {
            labels: hourlyBuckets.map((_, h) => h + 'h'),
            datasets: [{ label: 'Incidentes', data: hourlyBuckets, backgroundColor: '#f59e0b' }],
          },
          options: { animation: false, responsive: true },
        });
      } else {
        hourlyChartInstance.data.datasets[0].data = hourlyBuckets;
        hourlyChartInstance.update('none');
      }
      return;
    }

    // Native 2D canvas fallback when offline / Chart.js CDN blocked
    drawFallbackChart(els.chartWeekly, scores7, '#38bdf8', 'line');
    drawFallbackChart(els.chartHourly, hourlyBuckets, '#f59e0b', 'bar');
  }

  function drawFallbackChart(canvas, values, color, kind) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#334155';
    ctx.strokeRect(24, 12, w - 36, h - 32);

    const maxVal = Math.max(10, ...values);
    const plotW = w - 48;
    const plotH = h - 44;
    if (kind === 'line') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      values.forEach((v, idx) => {
        const x = 30 + (idx / Math.max(1, values.length - 1)) * plotW;
        const y = h - 24 - (v / maxVal) * plotH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        ctx.fillStyle = color;
        ctx.fillRect(x - 3, y - 3, 6, 6);
      });
      ctx.stroke();
    } else {
      const barW = Math.max(4, plotW / values.length - 2);
      ctx.fillStyle = color;
      values.forEach((v, idx) => {
        const bh = Math.max(4, (v / maxVal) * plotH);
        const x = 30 + idx * (plotW / values.length);
        ctx.fillRect(x, h - 24 - bh, barW, bh);
      });
    }
  }

  function renderKpis() {
    const todayMetric = state.metrics[state.metrics.length - 1] || {};
    const risk = computeRiskScore(todayMetric);
    const weeklyImb = state.metrics.reduce((acc, m) => acc + (Number(m.qtd_desequilibrios) || 0), 0);

    const pendingCritical = state.alerts.find(
      (a) => a.tipo === 'QUEDA_CRITICA' && a.status_atendimento === 'PENDENTE',
    );
    const lastResolved = state.alerts.find(
      (a) => a.atendido_em && (a.status_atendimento === 'SOCORRIDO' || a.status_atendimento === 'FALSO_POSITIVO'),
    );

    if (pendingCritical) {
      els.kpiSla.textContent = 'EMERGÊNCIA PENDENTE';
    } else if (lastResolved) {
      const slaSec = Math.max(
        0.1,
        (new Date(lastResolved.atendido_em).getTime() - new Date(lastResolved.timestamp).getTime()) / 1000,
      );
      els.kpiSla.textContent = 'Monitorando (Último SLA: ' + slaSec.toFixed(1) + 's)';
    } else {
      els.kpiSla.textContent = 'Estável (SLA: --)';
    }

    els.kpiRisk.textContent = String(risk);
    els.kpiRisk.setAttribute('data-value', String(risk));

    els.kpiImb.textContent = String(weeklyImb);
    els.kpiImb.setAttribute('data-value', String(weeklyImb));

    const totalOps = state.ops.reads + state.ops.writes;
    els.kpiOps.textContent =
      'Reads: ' + state.ops.reads + ' | Writes: ' + state.ops.writes + ' | Total: ' + totalOps;
    els.kpiOps.setAttribute('data-reads', String(state.ops.reads));
    els.kpiOps.setAttribute('data-writes', String(state.ops.writes));
    els.kpiOps.setAttribute('data-total', String(totalOps));

    els.banner.hidden = !pendingCritical;
  }

  function renderAlerts() {
    els.feed.innerHTML = '';
    if (state.alerts.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.textContent = 'Nenhum alerta registrado até o momento.';
      els.feed.appendChild(emptyLi);
      return;
    }

    const sorted = [...state.alerts].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    for (const alert of sorted) {
      const li = document.createElement('li');
      const card = document.createElement('article');
      card.className = 'alert-card';
      card.setAttribute('data-testid', 'alert-card');
      card.setAttribute('data-alert-id', alert.id);
      card.setAttribute('data-alert-type', alert.tipo);
      card.setAttribute('data-alert-status', alert.status_atendimento);
      card.setAttribute('data-ai-source', alert.fonte_ia);

      const header = document.createElement('div');
      header.innerHTML =
        '<strong>' +
        alert.tipo +
        '</strong> — <span>' +
        alert.status_atendimento +
        '</span> <span class="badge" data-testid="alert-ai-source">' +
        alert.fonte_ia +
        '</span>';

      const report = document.createElement('p');
      report.setAttribute('data-testid', 'alert-triage-report');
      report.textContent = alert.laudo_ia;

      const actions = document.createElement('div');
      actions.className = 'controls-row';

      const btnRescue = document.createElement('button');
      btnRescue.type = 'button';
      btnRescue.setAttribute('data-testid', 'btn-confirm-rescue');
      btnRescue.textContent = 'Confirmar Socorro';
      btnRescue.disabled = alert.status_atendimento !== 'PENDENTE';
      btnRescue.addEventListener('click', () => resolveAlert(alert.id, 'SOCORRIDO'));

      const btnFalse = document.createElement('button');
      btnFalse.type = 'button';
      btnFalse.setAttribute('data-testid', 'btn-false-positive');
      btnFalse.textContent = 'Falso Positivo';
      btnFalse.disabled = alert.status_atendimento !== 'PENDENTE';
      btnFalse.addEventListener('click', () => resolveAlert(alert.id, 'FALSO_POSITIVO'));

      actions.appendChild(btnRescue);
      actions.appendChild(btnFalse);
      card.appendChild(header);
      card.appendChild(report);
      card.appendChild(actions);
      li.appendChild(card);
      els.feed.appendChild(li);
    }
  }

  function resolveAlert(alertId, status) {
    const target = state.alerts.find((a) => a.id === alertId);
    if (!target || target.status_atendimento !== 'PENDENTE') return;
    target.status_atendimento = status;
    target.atendido_em = new Date().toISOString();
    safeSetJson(STORAGE_KEYS.alerts, state.alerts);
    recordWrite();
    renderAlerts();
    renderKpis();
    broadcast('ALERT_UPDATED', target);
  }

  function buildDeterministicFallback(ctx) {
    return (
      'Triagem Local (' +
      ctx.tipo +
      '): inclinação de tronco ' +
      ctx.angulo.toFixed(1) +
      '°, velocidade vertical ' +
      ctx.vy.toFixed(2) +
      ' u/s, imobilidade ' +
      ctx.immobSec.toFixed(1) +
      's. Ação recomendada: verificar condição do idoso imediatamente.'
    );
  }

  async function generateTriageReport(ctx) {
    const key = (state.env.geminiApiKey || '').trim();
    if (!key) {
      return { laudo_ia: buildDeterministicFallback(ctx), fonte_ia: 'FALLBACK_LOCAL' };
    }
    try {
      const endpoint =
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
        encodeURIComponent(key);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: JSON.stringify({
                    tipo: ctx.tipo,
                    angulo_tronco_graus: ctx.angulo,
                    velocidade_vertical: ctx.vy,
                    tempo_imovel_seg: ctx.immobSec,
                  }),
                },
              ],
            },
          ],
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty Gemini response');
      return { laudo_ia: text, fonte_ia: 'GEMINI' };
    } catch {
      return { laudo_ia: buildDeterministicFallback(ctx), fonte_ia: 'FALLBACK_LOCAL' };
    }
  }

  function tryBeepAlarm() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      osc.frequency.value = 880;
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(() => {});
      }
    } catch {
      // Ignore Web Audio autoplay blocks
    }
  }

  async function emitAlert(tipo, severidade, angulo, vy, immobSec) {
    const nowMs = Date.now();
    const prevMs = lastAlertTimestampByType[tipo] || 0;
    if (nowMs - prevMs < BIOMECHANICS_THRESHOLDS.ALERT_DEBOUNCE_MS) {
      return;
    }
    lastAlertTimestampByType[tipo] = nowMs;

    const fallbackLaudo = buildDeterministicFallback({ tipo, angulo, vy, immobSec });
    const record = {
      id: 'alert_' + nowMs + '_' + Math.random().toString(36).slice(2, 7),
      idoso_id: PATIENT_ID,
      tipo,
      timestamp: new Date(nowMs).toISOString(),
      angulo_tronco_graus: angulo,
      velocidade_vertical: vy,
      tempo_imovel_seg: immobSec,
      laudo_ia: fallbackLaudo,
      severidade,
      status_atendimento: 'PENDENTE',
      atendido_em: null,
      fonte_ia: 'FALLBACK_LOCAL',
    };

    state.alerts.unshift(record);
    safeSetJson(STORAGE_KEYS.alerts, state.alerts);

    const today = state.metrics[state.metrics.length - 1];
    if (today) {
      if (tipo === 'DESEQUILIBRIO') today.qtd_desequilibrios += 1;
      if (tipo === 'QUEDA_CRITICA') today.qtd_quedas += 1;
      today.score_risco_preventivo = computeRiskScore(today);
      safeSetJson(STORAGE_KEYS.metrics, state.metrics);
    }

    recordWrite();
    renderAlerts();
    renderKpis();
    renderCharts();
    if (tipo === 'QUEDA_CRITICA') tryBeepAlarm();
    broadcast('ALERT_CREATED', record);

    if ((state.env.geminiApiKey || '').trim()) {
      const aiRes = await generateTriageReport({ tipo, angulo, vy, immobSec });
      record.laudo_ia = aiRes.laudo_ia;
      record.fonte_ia = aiRes.fonte_ia;
      safeSetJson(STORAGE_KEYS.alerts, state.alerts);
      renderAlerts();
      broadcast('ALERT_UPDATED', record);
    }
  }

  function flushMetrics() {
    const today = state.metrics[state.metrics.length - 1];
    if (!today) return;
    today.tempo_ativo_min += Math.round(sessionActiveSec / 60);
    today.tempo_sentado_min += Math.round(sessionSittingSec / 60);
    sessionActiveSec = 0;
    sessionSittingSec = 0;
    today.score_risco_preventivo = computeRiskScore(today);
    today.atualizado_em = new Date().toISOString();
    safeSetJson(STORAGE_KEYS.metrics, state.metrics);
    recordWrite();
    renderKpis();
    renderCharts();
    broadcast('METRICS_UPDATED', today);
  }

  function tick(now) {
    const rawDt = now - lastTickTime;
    lastTickTime = now;
    const stepMs = Math.max(0, Math.min(rawDt, 200));

    if (scenario === 'NORMAL') {
      postureState = 'EM_PE';
      trunkAngleDeg = 84.0;
      verticalVelocity = 0.02;
      immobilityMs = 0;
      sessionActiveSec += stepMs / 1000;
    } else if (scenario === 'DESEQUILIBRIO') {
      imbalanceElapsedMs += stepMs;
      const imbalanceLimit = Math.max(40, fallAngleThreshold + 23);
      if (imbalanceElapsedMs < 1500) {
        if (48.0 < imbalanceLimit || 0.32 >= BIOMECHANICS_THRESHOLDS.IMBALANCE_VERTICAL_VELOCITY_THRESHOLD) {
          postureState = 'DESEQUILIBRIO';
          trunkAngleDeg = 48.0;
          verticalVelocity = 0.32;
          if (!imbalanceAlertEmitted) {
            imbalanceAlertEmitted = true;
            emitAlert('DESEQUILIBRIO', 'ALTA', 48.0, 0.32, 0);
          }
        }
      } else {
        scenario = 'NORMAL';
        postureState = 'EM_PE';
        trunkAngleDeg = 82.0;
        verticalVelocity = 0.03;
      }
    } else if (scenario === 'QUEDA_CRITICA') {
      trunkAngleDeg = 18.4;
      verticalVelocity = 1.85;
      if (trunkAngleDeg < fallAngleThreshold && verticalVelocity >= BIOMECHANICS_THRESHOLDS.FALL_VERTICAL_VELOCITY_THRESHOLD) {
        immobilityMs += stepMs;
        if (immobilityMs >= BIOMECHANICS_THRESHOLDS.IMMOBILITY_CONFIRMATION_MS) {
          postureState = 'ALERTA_CRITICO';
          if (!fallAlertEmittedForCurrentFall) {
            fallAlertEmittedForCurrentFall = true;
            emitAlert('QUEDA_CRITICA', 'CRITICA', trunkAngleDeg, verticalVelocity, immobilityMs / 1000);
          }
        } else {
          postureState = 'QUEDA_DETECTADA';
        }
      } else {
        // Sensitivity threshold strictly below 18.4° prevents fall trigger
        postureState = 'DESEQUILIBRIO';
        immobilityMs = 0;
      }
    }

    if (now - lastMetricsSyncTime >= BIOMECHANICS_THRESHOLDS.METRICS_SYNC_INTERVAL_MS) {
      lastMetricsSyncTime = now;
      flushMetrics();
    }

    renderHud();
    drawSkeleton(now);
    requestAnimationFrame(tick);
  }

  // Event wiring
  els.privacyToggle.addEventListener('change', () => {
    if (els.privacyToggle.checked) {
      els.video.classList.add('hidden-privacy');
    } else {
      els.video.classList.remove('hidden-privacy');
    }
  });

  els.btnStartCamera.addEventListener('click', async () => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      els.cameraStatus.textContent = 'Câmera indisponível neste navegador. Use o Simulador Biomecânico.';
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      els.video.srcObject = mediaStream;
      cameraActive = true;
      els.cameraStatus.textContent = 'Câmera ativa (processamento 100% local).';
    } catch {
      cameraActive = false;
      els.cameraStatus.textContent = 'Permissão de câmera negada ou indisponível. Simulador permanece ativo.';
    }
  });

  els.btnStopCamera.addEventListener('click', () => {
    if (mediaStream && typeof mediaStream.getTracks === 'function') {
      for (const t of mediaStream.getTracks()) t.stop();
      mediaStream = null;
    }
    els.video.srcObject = null;
    if (cameraActive) {
      cameraActive = false;
      flushMetrics();
    }
    scenario = 'NORMAL';
    postureState = 'EM_PE';
    immobilityMs = 0;
    els.cameraStatus.textContent = 'Monitoramento parado.';
    renderHud();
  });

  els.btnSimNormal.addEventListener('click', () => {
    scenario = 'NORMAL';
    postureState = 'EM_PE';
    immobilityMs = 0;
    fallAlertEmittedForCurrentFall = false;
    imbalanceAlertEmitted = false;
    els.cameraStatus.textContent = 'Simulador ativo: Postura Normal.';
  });

  els.btnSimImbalance.addEventListener('click', () => {
    scenario = 'DESEQUILIBRIO';
    imbalanceElapsedMs = 0;
    imbalanceAlertEmitted = false;
    immobilityMs = 0;
    els.cameraStatus.textContent = 'Simulador ativo: Desequilíbrio.';
  });

  els.btnSimFall.addEventListener('click', () => {
    scenario = 'QUEDA_CRITICA';
    immobilityMs = 0;
    fallAlertEmittedForCurrentFall = false;
    els.cameraStatus.textContent = 'Simulador ativo: Queda Crítica.';
  });

  els.slider.addEventListener('input', () => {
    const raw = Number(els.slider.value);
    const min = Number(els.slider.min);
    const max = Number(els.slider.max);
    const clamped = Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : 35));
    fallAngleThreshold = clamped;
    els.sliderVal.textContent = clamped + '°';
  });

  // Chart hover tooltips
  [
    [els.chartWeekly, els.tooltipWeekly, 'Risco'],
    [els.chartHourly, els.tooltipHourly, 'Eventos'],
  ].forEach(([canvas, tip, label]) => {
    canvas.addEventListener('mousemove', (ev) => {
      const rect = canvas.getBoundingClientRect();
      tip.style.display = 'block';
      tip.style.left = Math.max(8, ev.clientX - rect.left + 8) + 'px';
      tip.style.top = Math.max(8, ev.clientY - rect.top - 24) + 'px';
      tip.textContent = label + ' (' + Math.round(ev.clientX - rect.left) + 'px)';
    });
    canvas.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
    });
  });

  // Config modal
  function openModal() {
    els.inputFirebase.value = state.env.firebaseConfig ? JSON.stringify(state.env.firebaseConfig, null, 2) : '';
    els.inputGemini.value = state.env.geminiApiKey || '';
    els.configError.hidden = true;
    els.configError.textContent = '';
    els.modal.hidden = false;
    if (typeof els.modal.showModal === 'function' && !els.modal.open) {
      try { els.modal.showModal(); } catch {}
    }
  }

  function closeModal() {
    els.configError.hidden = true;
    els.modal.hidden = true;
    if (typeof els.modal.close === 'function' && els.modal.open) {
      try { els.modal.close(); } catch {}
    }
  }

  els.btnOpenConfig.addEventListener('click', openModal);
  els.btnCloseConfig.addEventListener('click', closeModal);
  els.modal.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    closeModal();
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !els.modal.hidden) closeModal();
  });

  els.btnSaveConfig.addEventListener('click', () => {
    const fbRaw = els.inputFirebase.value.trim();
    const gemRaw = els.inputGemini.value.trim();
    let parsedFb = null;

    if (fbRaw) {
      try {
        parsedFb = JSON.parse(fbRaw);
      } catch {
        els.configError.textContent = 'JSON inválido para Firebase Config.';
        els.configError.hidden = false;
        return;
      }
      if (!parsedFb || typeof parsedFb !== 'object' || !parsedFb.apiKey || !parsedFb.projectId) {
        els.configError.textContent = 'Firebase Config deve conter "apiKey" e "projectId".';
        els.configError.hidden = false;
        return;
      }
    }

    state.env = { firebaseConfig: parsedFb, geminiApiKey: gemRaw };
    safeSetJson(STORAGE_KEYS.env, state.env);
    updateConnectionBadge();
    closeModal();
  });

  els.btnClearConfig.addEventListener('click', () => {
    state.env = { firebaseConfig: null, geminiApiKey: '' };
    safeSetJson(STORAGE_KEYS.env, state.env);
    els.inputFirebase.value = '';
    els.inputGemini.value = '';
    updateConnectionBadge();
    closeModal();
  });

  if (channel) {
    channel.addEventListener('message', (ev) => {
      try {
        const msg = ev?.data;
        if (!msg || typeof msg !== 'object' || msg.source !== 'guardiao') return;
        const reloaded = loadStateFromStorage();
        state.alerts = reloaded.alerts;
        state.metrics = reloaded.metrics;
        renderAlerts();
        renderKpis();
        renderCharts();
      } catch {
        // Ignore malformed messages
      }
    });
  }

  updateConnectionBadge();
  renderHud();
  renderAlerts();
  renderKpis();
  renderCharts();
  drawSkeleton(performance.now());
  requestAnimationFrame(tick);
}

initApp();
`,
  },
};

const INDEX_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GuardIão — Monitoramento Preventivo e Detecção de Quedas</title>
  <link rel="stylesheet" href="/styles.css" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js" defer></script>
</head>
<body>
  <header class="topbar">
    <h1>GuardIão — CitizenTech</h1>
    <div style="display:flex;gap:10px;align-items:center;">
      <span role="status" class="badge" data-testid="connection-mode-badge" data-mode="LOCAL_STORAGE">Modo Fallback Local</span>
      <button type="button" data-testid="btn-open-config">Configurar Cloud / IA</button>
    </div>
  </header>

  <main class="app-shell" data-testid="app-shell">
    <section class="panel" data-testid="panel-monitor" aria-label="Estação Edge">
      <h2>Estação Edge (Visão Computacional)</h2>
      <div class="viewport-wrap">
        <video data-testid="monitor-video" autoplay playsinline muted width="320" height="240"></video>
        <canvas data-testid="monitor-canvas" aria-label="Esqueleto Biomecânico" width="640" height="360"></canvas>
      </div>

      <div class="hud-bar">
        <div class="card">
          <small>Estado</small><br />
          <span role="status" data-testid="posture-state-badge" data-state="EM_PE">EM_PE</span>
        </div>
        <div class="card">
          <small>Ângulo Tronco (θ)</small><br />
          <strong data-testid="hud-trunk-angle">84.0°</strong>
        </div>
        <div class="card">
          <small>Velocidade Vertical (vy)</small><br />
          <strong data-testid="hud-vertical-velocity">0.02 u/s</strong>
        </div>
        <div class="card">
          <small>Imobilidade</small><br />
          <strong data-testid="hud-immobility-timer">0.0s</strong>
        </div>
      </div>

      <div class="controls-row">
        <label style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" role="switch" data-testid="privacy-mode-toggle" />
          Modo Privacidade LGPD
        </label>
        <button type="button" data-testid="btn-start-camera">Iniciar Câmera</button>
        <button type="button" data-testid="btn-stop-camera">Parar Câmera</button>
      </div>
      <p role="status" data-testid="camera-status-msg">Pronto para monitoramento.</p>

      <div class="controls-row">
        <button type="button" data-testid="btn-sim-normal">Postura Normal</button>
        <button type="button" data-testid="btn-sim-imbalance">Desequilíbrio</button>
        <button type="button" data-testid="btn-sim-fall">Queda Crítica</button>
      </div>

      <div style="margin-top:12px;">
        <label for="sens-range">Sensibilidade (Ângulo de Queda): <span data-testid="sensitivity-value">35°</span></label>
        <input id="sens-range" type="range" min="15" max="60" value="35" data-testid="sensitivity-slider" aria-label="Sensibilidade" style="width:100%;" />
      </div>
    </section>

    <section class="panel" data-testid="panel-dashboard" aria-label="Dashboard Preventivo">
      <h2>Dashboard Preventivo</h2>
      <div class="kpi-grid">
        <article class="card" aria-label="Status e SLA de Socorro">
          <small>Status / SLA de Socorro</small>
          <div data-testid="kpi-sla-status">Estável (SLA: --)</div>
        </article>
        <article class="card" aria-label="Score de Risco Preventivo">
          <small>Score de Risco Preventivo</small>
          <div data-testid="kpi-risk-score" data-value="0">0</div>
        </article>
        <article class="card" aria-label="Desequilíbrios na Semana">
          <small>Desequilíbrios na Semana</small>
          <div data-testid="kpi-weekly-imbalances" data-value="0">0</div>
        </article>
        <article class="card" aria-label="Operações Cloud da Sessão">
          <small>Operações Cloud da Sessão</small>
          <div data-testid="kpi-cloud-ops" data-reads="1" data-writes="0" data-total="1">Reads: 1 | Writes: 0 | Total: 1</div>
        </article>
      </div>

      <div role="alert" class="emergency-banner" data-testid="emergency-banner" hidden>
        ALERTA CRÍTICO: Queda detectada com imobilidade! Verifique o idoso imediatamente.
      </div>

      <h3>Feed de Alertas em Tempo Real</h3>
      <ul class="alert-feed" data-testid="alert-feed-list" aria-label="Feed de Alertas"></ul>

      <div class="charts-grid">
        <div class="chart-box">
          <h4>Evolução Semanal de Mobilidade vs. Risco</h4>
          <canvas data-testid="chart-weekly-mobility" aria-label="Evolução Semanal" width="520" height="160"></canvas>
          <div id="tooltip-weekly" class="chart-tooltip"></div>
        </div>
        <div class="chart-box">
          <h4>Mapa Horário de Vulnerabilidade</h4>
          <canvas data-testid="chart-hourly-vulnerability" aria-label="Mapa Horário de Vulnerabilidade" width="520" height="160"></canvas>
          <div id="tooltip-hourly" class="chart-tooltip"></div>
        </div>
      </div>
    </section>
  </main>

  <dialog class="config-modal" data-testid="config-modal" aria-label="Configuração Cloud e IA" hidden>
    <h3>Configurar Cloud / IA</h3>
    <label>Firebase Config (JSON)
      <textarea rows="4" data-testid="input-firebase-config" aria-label="Firebase Config"></textarea>
    </label>
    <label style="display:block;margin-top:10px;">Gemini API Key
      <input type="text" data-testid="input-gemini-api-key" aria-label="Gemini API Key" placeholder="Cole sua chave opcional" />
    </label>
    <div role="alert" class="validation-error" data-testid="config-validation-error" hidden></div>
    <div class="controls-row" style="margin-top:12px;">
      <button type="button" data-testid="btn-save-config">Salvar</button>
      <button type="button" data-testid="btn-clear-config">Usar Modo Local</button>
      <button type="button" data-testid="btn-close-config">Fechar</button>
    </div>
  </dialog>

  <script type="module" src="/src/main.js"></script>
</body>
</html>
`;

export function createMockServerHandler() {
  return (req, res) => {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const rawUrl = req.url || '/';
    if (/%2e%2e|\.\./i.test(rawUrl)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const pathname = rawUrl.split('?')[0];
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(method === 'HEAD' ? '' : INDEX_HTML);
      return;
    }

    const asset = STATIC_ASSETS[pathname];
    if (asset) {
      res.writeHead(200, { 'Content-Type': asset.contentType });
      res.end(method === 'HEAD' ? '' : asset.body);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  };
}

export async function startMockServer({ port = 0, host = '127.0.0.1' } = {}) {
  const server = http.createServer(createMockServerHandler());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    port: actualPort,
    baseUrl: `http://${host}:${actualPort}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
