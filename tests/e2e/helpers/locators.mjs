// 3-Level Resilient Locator Resolver:
// Level 1: [data-testid] (canonical TEST_INFRA.md contract + known aliases)
// Level 2: Semantic ARIA role / accessible name
// Level 3: Visible PT-BR text / CSS structural fallback

export const LOCATOR_SPECS = {
  appShell: {
    testIds: ['app-shell'],
    role: () => ['main'],
    cssFallback: 'main, .app-shell, .app-container',
  },
  panelMonitor: {
    testIds: ['panel-monitor'],
    role: () => ['region', { name: /Estação Edge|Monitoramento/i }],
    cssFallback: 'section:has-text("Estação Edge"), section:has-text("Monitoramento")',
  },
  panelDashboard: {
    testIds: ['panel-dashboard'],
    role: () => ['region', { name: /Dashboard Preventivo/i }],
    cssFallback: 'section:has-text("Dashboard Preventivo")',
  },
  connectionBadge: {
    testIds: ['connection-mode-badge'],
    role: () => ['status', { name: /Modo Fallback Local|Cloud Firestore/i }],
    fallback: (root) => root.getByText(/Modo Fallback Local|Cloud Firestore/i),
  },
  monitorVideo: {
    testIds: ['monitor-video', 'webcam-video'],
    fallback: (root) => root.locator('video'),
  },
  monitorCanvas: {
    testIds: ['monitor-canvas', 'skeleton-canvas'],
    role: () => ['img', { name: /Esqueleto Biomecânico/i }],
    fallback: (root) => root.locator('[data-testid="panel-monitor"] canvas, canvas'),
  },
  privacyToggle: {
    testIds: ['privacy-mode-toggle'],
    role: () => ['checkbox', { name: /Modo Privacidade LGPD|Privacidade/i }],
    fallback: (root) =>
      root.locator('input[type="checkbox"]:near(:text("Privacidade"))').or(
        root.locator('button:has-text("Modo Privacidade")'),
      ),
  },
  btnStartCamera: {
    testIds: ['btn-start-camera', 'camera-toggle-btn'],
    role: () => ['button', { name: /Iniciar Câmera|Ligar Câmera/i }],
    fallback: (root) => root.locator('button:has-text("Iniciar Câmera")'),
  },
  btnStopCamera: {
    testIds: ['btn-stop-camera', 'camera-toggle-btn'],
    role: () => ['button', { name: /Parar Câmera|Desligar Câmera|Parar/i }],
    fallback: (root) => root.locator('button:has-text("Parar Câmera")'),
  },
  cameraStatusMsg: {
    testIds: ['camera-status-msg'],
    fallback: (root) =>
      root.locator('[data-testid="panel-monitor"] [role="status"]:not([data-testid="posture-state-badge"])'),
  },
  postureStateBadge: {
    testIds: ['posture-state-badge'],
    fallback: (root) =>
      root.locator('[data-state]').or(
        root.getByText(/^(EM_PE|DESEQUILIBRIO|QUEDA_DETECTADA|ALERTA_CRITICO)$/),
      ),
  },
  hudTrunkAngle: {
    testIds: ['hud-trunk-angle', 'telemetry-angle'],
    fallback: (root) => root.locator('strong:near(:text("Ângulo")), output:near(:text("Ângulo"))'),
  },
  hudVerticalVelocity: {
    testIds: ['hud-vertical-velocity', 'telemetry-velocity'],
    fallback: (root) => root.locator('strong:near(:text("Velocidade")), output:near(:text("Velocidade"))'),
  },
  hudImmobilityTimer: {
    testIds: ['hud-immobility-timer', 'telemetry-immobility'],
    fallback: (root) => root.locator('strong:near(:text("Imobilidade")), output:near(:text("Imobilidade"))'),
  },
  btnSimNormal: {
    testIds: ['btn-sim-normal', 'sim-normal-btn'],
    role: () => ['button', { name: /Postura Normal/i }],
    fallback: (root) => root.locator('button:has-text("Postura Normal")'),
  },
  btnSimImbalance: {
    testIds: ['btn-sim-imbalance', 'sim-imbalance-btn'],
    role: () => ['button', { name: /Desequilíbrio/i }],
    fallback: (root) => root.locator('button:has-text("Desequilíbrio")'),
  },
  btnSimFall: {
    testIds: ['btn-sim-fall', 'sim-fall-btn'],
    role: () => ['button', { name: /Queda Crítica/i }],
    fallback: (root) => root.locator('button:has-text("Queda Crítica")'),
  },
  sensitivitySlider: {
    testIds: ['sensitivity-slider'],
    role: () => ['slider', { name: /Sensibilidade/i }],
    fallback: (root) => root.locator('input[type="range"]'),
  },
  sensitivityValue: {
    testIds: ['sensitivity-value'],
    fallback: (root) => root.locator('output, [data-testid="sensitivity-slider"] + span'),
  },
  kpiSlaStatus: {
    testIds: ['kpi-sla-status', 'kpi-sla'],
    role: () => ['region', { name: /Status|SLA/i }],
    fallback: (root) => root.locator('article:has-text("SLA"), div:has-text("Status / SLA")'),
  },
  kpiRiskScore: {
    testIds: ['kpi-risk-score'],
    role: () => ['region', { name: /Score de Risco/i }],
    fallback: (root) => root.locator('article:has-text("Score de Risco")'),
  },
  kpiWeeklyImbalances: {
    testIds: ['kpi-weekly-imbalances'],
    role: () => ['region', { name: /Desequilíbrios na Semana/i }],
    fallback: (root) => root.locator('article:has-text("Desequilíbrios")'),
  },
  kpiCloudOps: {
    testIds: ['kpi-cloud-ops'],
    role: () => ['region', { name: /Operações Cloud/i }],
    fallback: (root) => root.locator('article:has-text("Operações Cloud")'),
  },
  emergencyBanner: {
    testIds: ['emergency-banner', 'audio-alert-indicator'],
    role: () => ['alert'],
    fallback: (root) => root.locator('[role="alert"]'),
  },
  alertFeedList: {
    testIds: ['alert-feed-list', 'alert-feed'],
    role: () => ['list', { name: /Feed de Alertas|Alertas/i }],
    fallback: (root) =>
      root.locator('[data-testid="panel-dashboard"] ul, [data-testid="panel-dashboard"] [role="list"]'),
  },
  alertCard: {
    testIds: ['alert-card'],
    fallback: (root) => root.locator('[data-alert-id], article.alert-card'),
  },
  alertTriageReport: {
    testIds: ['alert-triage-report', 'alert-ai-report'],
    fallback: (root) => root.locator('.alert-triage-report, .alert-laudo'),
  },
  alertAiSource: {
    testIds: ['alert-ai-source'],
    fallback: (root) => root.getByText(/FALLBACK_LOCAL|GEMINI/),
  },
  btnConfirmRescue: {
    testIds: ['btn-confirm-rescue', 'confirm-rescue-btn'],
    role: () => ['button', { name: /Confirmar Socorro/i }],
    fallback: (root) => root.locator('button:has-text("Confirmar Socorro")'),
  },
  btnFalsePositive: {
    testIds: ['btn-false-positive', 'false-positive-btn'],
    role: () => ['button', { name: /Falso Positivo/i }],
    fallback: (root) => root.locator('button:has-text("Falso Positivo")'),
  },
  chartWeeklyMobility: {
    testIds: ['chart-weekly-mobility', 'chart-weekly-evolution'],
    fallback: (root) => root.locator('canvas[aria-label*="Evolução Semanal"]'),
  },
  chartHourlyVulnerability: {
    testIds: ['chart-hourly-vulnerability'],
    fallback: (root) => root.locator('canvas[aria-label*="Mapa Horário"]'),
  },
  btnOpenConfig: {
    testIds: ['btn-open-config', 'open-config-btn'],
    role: () => ['button', { name: /Configurar Cloud|Configuração/i }],
    fallback: (root) => root.locator('button:has-text("Configurar")'),
  },
  configModal: {
    testIds: ['config-modal'],
    role: () => ['dialog'],
    fallback: (root) => root.locator('[role="dialog"]'),
  },
  inputFirebaseConfig: {
    testIds: ['input-firebase-config', 'firebase-config-input'],
    role: () => ['textbox', { name: /Firebase Config/i }],
    fallback: (root) => root.locator('textarea'),
  },
  inputGeminiApiKey: {
    testIds: ['input-gemini-api-key', 'gemini-key-input'],
    role: () => ['textbox', { name: /Gemini API Key/i }],
    fallback: (root) => root.locator('input[name*="gemini" i], input[placeholder*="AIza" i]'),
  },
  btnSaveConfig: {
    testIds: ['btn-save-config', 'save-config-btn'],
    role: () => ['button', { name: /^Salvar/i }],
    fallback: (root) => root.locator('button:has-text("Salvar")'),
  },
  btnClearConfig: {
    testIds: ['btn-clear-config', 'reset-config-btn'],
    role: () => ['button', { name: /Usar Modo Local|Limpar|Resetar/i }],
    fallback: (root) => root.locator('button:has-text("Usar Modo Local"), button:has-text("Limpar")'),
  },
  btnCloseConfig: {
    testIds: ['btn-close-config', 'close-config-btn'],
    role: () => ['button', { name: /Fechar|Cancelar/i }],
    fallback: (root) => root.locator('button:has-text("Fechar"), button:has-text("Cancelar")'),
  },
  configValidationError: {
    testIds: ['config-validation-error', 'config-error-msg'],
    fallback: (root) => root.locator('[data-testid="config-modal"] [role="alert"]'),
  },
};

export function getControl(root, key) {
  const spec = LOCATOR_SPECS[key];
  if (!spec) {
    throw new Error(`Unknown locator key: ${key}`);
  }

  const testIdSelector = spec.testIds.map((id) => `[data-testid="${id}"]`).join(', ');
  let loc = root.locator(testIdSelector);

  if (spec.role) {
    const [roleName, roleOpts] = spec.role();
    loc = loc.or(root.getByRole(roleName, roleOpts));
  }

  if (spec.fallback) {
    loc = loc.or(spec.fallback(root));
  }

  return loc.first();
}

export function getAllAlertCards(page) {
  return page.locator('[data-testid="alert-card"], [data-alert-id], article.alert-card');
}

export async function findControl(root, key) {
  const spec = LOCATOR_SPECS[key];
  if (!spec) {
    throw new Error(`Unknown locator key: ${key}`);
  }

  // Level 1: data-testid
  for (const id of spec.testIds) {
    const candidate = root.locator(`[data-testid="${id}"]`);
    if ((await candidate.count()) > 0) {
      return candidate.first();
    }
  }

  // Level 2: ARIA role + accessible name
  if (spec.role) {
    const [roleName, roleOpts] = spec.role();
    const roleCandidate = root.getByRole(roleName, roleOpts);
    if ((await roleCandidate.count()) > 0) {
      return roleCandidate.first();
    }
  }

  // Level 3: Visible PT-BR text / CSS fallback
  return spec.fallback(root).first();
}

export function extractFirstNumber(text) {
  if (text == null) return NaN;
  const match = String(text).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

export async function readPostureState(page) {
  const badge = await findControl(page, 'postureStateBadge');
  const dataState = await badge.getAttribute('data-state').catch(() => null);
  if (dataState) return dataState.trim();
  const txt = (await badge.innerText()).trim();
  const match = txt.match(/EM_PE|DESEQUILIBRIO|QUEDA_DETECTADA|ALERTA_CRITICO/);
  return match ? match[0] : txt;
}

export async function readTelemetry(page) {
  const state = await readPostureState(page);
  const angleText = await (await findControl(page, 'hudTrunkAngle')).innerText();
  const velText = await (await findControl(page, 'hudVerticalVelocity')).innerText();
  const immobText = await (await findControl(page, 'hudImmobilityTimer')).innerText();
  return {
    state,
    angleText,
    velText,
    immobText,
    trunkAngleDeg: extractFirstNumber(angleText),
    verticalVelocity: extractFirstNumber(velText),
    immobilitySec: extractFirstNumber(immobText),
  };
}

export async function readCloudOpsStats(page) {
  const cloudEl = await findControl(page, 'kpiCloudOps');
  const text = await cloudEl.innerText();
  const attrReads = await cloudEl.getAttribute('data-reads').catch(() => null);
  const attrWrites = await cloudEl.getAttribute('data-writes').catch(() => null);
  const attrTotal = await cloudEl.getAttribute('data-total').catch(() => null);

  if (attrReads !== null && attrWrites !== null) {
    const reads = Number(attrReads);
    const writes = Number(attrWrites);
    const total = attrTotal !== null ? Number(attrTotal) : reads + writes;
    return { reads, writes, total, rawText: text };
  }

  const readsMatch = text.match(/(?:reads?|leituras?)\s*[:=]?\s*(\d+)/i);
  const writesMatch = text.match(/(?:writes?|escritas?|grava[çc][õo]es?)\s*[:=]?\s*(\d+)/i);
  const totalMatch = text.match(/(?:total)\s*[:=]?\s*(\d+)/i);

  const reads = readsMatch ? Number(readsMatch[1]) : 0;
  const writes = writesMatch ? Number(writesMatch[1]) : 0;
  const total = totalMatch ? Number(totalMatch[1]) : reads + writes;
  return { reads, writes, total, rawText: text };
}

export async function readDashboardKpis(page) {
  const slaText = await getControl(page, 'kpiSlaStatus').innerText();
  const riskEl = getControl(page, 'kpiRiskScore');
  const riskAttr = await riskEl.getAttribute('data-value').catch(() => null);
  const riskText = await riskEl.innerText();
  const riskScore = riskAttr !== null ? Number(riskAttr) : extractFirstNumber(riskText);

  const imbEl = getControl(page, 'kpiWeeklyImbalances');
  const imbAttr = await imbEl.getAttribute('data-value').catch(() => null);
  const imbText = await imbEl.innerText();
  const weeklyImbalances = imbAttr !== null ? Number(imbAttr) : extractFirstNumber(imbText);

  const cloudOps = await readCloudOpsStats(page);

  return {
    slaText,
    riskScore,
    weeklyImbalances,
    cloudOps,
  };
}

export async function waitForAppReady(page) {
  await getControl(page, 'appShell').waitFor({ state: 'visible', timeout: 10000 });
  await getControl(page, 'panelMonitor').waitFor({ state: 'visible', timeout: 10000 });
  await getControl(page, 'panelDashboard').waitFor({ state: 'visible', timeout: 10000 });
  await getControl(page, 'postureStateBadge').waitFor({ state: 'visible', timeout: 10000 });
}

export async function sampleCanvasRenderStats(canvasLocator) {
  return canvasLocator.evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) {
      return { width: canvas.width, height: canvas.height, rectW: rect.width, rectH: rect.height, uniqueColors: 0 };
    }
    const sampleW = Math.min(canvas.width, 200);
    const sampleH = Math.min(canvas.height, 200);
    const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
    const seen = new Set();
    for (let i = 0; i < data.length; i += 16) {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      if (seen.size >= 8) break;
    }
    return {
      width: canvas.width,
      height: canvas.height,
      rectW: rect.width,
      rectH: rect.height,
      uniqueColors: seen.size,
    };
  });
}

