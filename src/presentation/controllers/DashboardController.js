import { ALERT_STATUSES, ALERT_TYPES } from '../../domain/entities/MobilityAlert.js';

/**
 * Presentation controller for the "Dashboard Preventivo" panel (Pillar 4 — Data Analytics).
 * Listens to repository real-time subscriptions (Firestore onSnapshot or LocalStorage +
 * BroadcastChannel) and renders KPIs, alert feed, triage actions, charts and the config modal.
 */

const EMERGENCY_TYPES = new Set([ALERT_TYPES.QUEDA_CRITICA, ALERT_TYPES.IMOBILIDADE_PROLONGADA]);

const TYPE_LABELS = Object.freeze({
  [ALERT_TYPES.QUEDA_CRITICA]: 'Queda Crítica',
  [ALERT_TYPES.DESEQUILIBRIO]: 'Desequilíbrio (quase-queda)',
  [ALERT_TYPES.IMOBILIDADE_PROLONGADA]: 'Imobilidade Prolongada',
});

const STATUS_LABELS = Object.freeze({
  [ALERT_STATUSES.PENDENTE]: 'Pendente',
  [ALERT_STATUSES.EM_VERIFICACAO]: 'Em verificação',
  [ALERT_STATUSES.SOCORRIDO]: 'Socorrido',
  [ALERT_STATUSES.FALSO_POSITIVO]: 'Falso positivo',
});

const MODE_LABELS = Object.freeze({
  LOCAL: 'Modo Fallback Local',
  CONNECTING: 'Cloud Firestore — conectando…',
  FIRESTORE: 'Cloud Firestore Real-Time',
  FIRESTORE_FAILED: 'Modo Fallback Local (Firestore indisponível)',
});

const ALARM_CONFIG = Object.freeze({ FREQUENCY_HZ: 880, DURATION_S: 0.6, GAIN: 0.08 });
const MS_PER_SECOND = 1000;
const TIME_FORMAT = { hour: '2-digit', minute: '2-digit', second: '2-digit' };

function createEl(tag, { className, text, attrs } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attrs ?? {})) {
    node.setAttribute(key, value);
  }
  return node;
}

function formatTime(isoString) {
  const parsed = new Date(isoString);
  return Number.isNaN(parsed.getTime()) ? '--:--' : parsed.toLocaleTimeString('pt-BR', TIME_FORMAT);
}

export class DashboardController {
  /**
   * @param {object} deps
   */
  constructor({
    elements,
    repository,
    chartsRenderer,
    getLiveTodayMetrics,
    envService,
    onConfigChanged = () => {},
    patientId,
    logger = console,
  }) {
    this._el = elements;
    this._repo = repository;
    this._charts = chartsRenderer;
    this._getLiveTodayMetrics = getLiveTodayMetrics;
    this._env = envService;
    this._onConfigChanged = onConfigChanged;
    this._patientId = patientId;
    this._logger = logger;

    this._alerts = [];
    this._persistedMetrics = [];
    this._inFlightStatus = new Set();
    this._knownAlertIds = null;
    this._lastLiveKey = '';
    this._audioCtx = null;
  }

  init() {
    this._repo.subscribeToAlerts((alerts) => this._handleAlerts(alerts), this._patientId);
    this._repo.subscribeToDailyMetrics((metrics) => this._handleMetrics(metrics), this._patientId);
    this._el.alertFeedList.addEventListener('click', (event) => this._handleFeedClick(event));
    this._bindConfigModal();
    this.refreshLiveKpis(true);
  }

  /** Called by the monitor on every processed frame (cheap DOM diffing only). */
  refreshLiveKpis(force = false) {
    const today = this._getLiveTodayMetrics();
    const weekly = this._buildWeeklySeries(today);
    const weeklyImbalances = weekly.reduce((sum, m) => sum + m.qtd_desequilibrios, 0);
    const riskScore = today.score_risco_preventivo;

    this._setKpiValue(this._el.kpiRiskScoreValue, this._el.kpiRiskScore, riskScore, `${riskScore}`);
    this._el.kpiRiskScoreHint.textContent = this._riskHint(riskScore);
    this._setKpiValue(
      this._el.kpiWeeklyImbalancesValue,
      this._el.kpiWeeklyImbalances,
      weeklyImbalances,
      `${weeklyImbalances}`
    );
    this._renderCloudOps();

    const liveKey = `${today.qtd_desequilibrios}|${today.qtd_quedas}|${riskScore}`;
    if (force || liveKey !== this._lastLiveKey) {
      this._lastLiveKey = liveKey;
      this._charts.renderWeeklyMobility(weekly);
      this._charts.renderHourlyVulnerability(this._alerts, weekly);
    }
  }

  setConnectionMode(modeKey) {
    const label = MODE_LABELS[modeKey] ?? MODE_LABELS.LOCAL;
    this._el.connectionBadge.textContent = label;
    this._el.connectionBadge.dataset.mode = modeKey;
  }

  /** Re-subscription after a backend switch is handled by SwitchableRepository. */
  refreshAll() {
    this.refreshLiveKpis(true);
  }

  _handleAlerts(alerts) {
    this._alerts = Array.isArray(alerts) ? alerts : [];
    this._renderFeed();
    this._renderEmergencyState();
    this._renderCloudOps();
    this._charts.renderHourlyVulnerability(this._alerts, this._buildWeeklySeries(this._getLiveTodayMetrics()));
  }

  _handleMetrics(metrics) {
    this._persistedMetrics = Array.isArray(metrics) ? metrics : [];
    this.refreshLiveKpis(true);
  }

  _buildWeeklySeries(today) {
    const others = this._persistedMetrics.filter((m) => m.data !== today.data);
    return [...others, today].sort((a, b) => String(a.data).localeCompare(String(b.data))).slice(-7);
  }

  _riskHint(score) {
    if (score >= 60) return 'Risco alto — revisar ambiente e medicação.';
    if (score >= 35) return 'Risco moderado — acompanhar tendência.';
    return 'Risco baixo — manter rotina ativa.';
  }

  _setKpiValue(valueEl, cardEl, numeric, text) {
    if (valueEl.textContent !== text) {
      valueEl.textContent = text;
    }
    cardEl.dataset.value = String(numeric);
  }

  _renderCloudOps() {
    const stats = this._repo.getCloudOpsStats();
    const card = this._el.kpiCloudOps;
    card.dataset.reads = String(stats.reads);
    card.dataset.writes = String(stats.writes);
    card.dataset.total = String(stats.total);
    const text = `Leituras: ${stats.reads} | Escritas: ${stats.writes} | Total: ${stats.total}`;
    if (this._el.kpiCloudOpsValue.textContent !== text) {
      this._el.kpiCloudOpsValue.textContent = text;
    }
  }

  _pendingEmergencies() {
    return this._alerts.filter(
      (a) => EMERGENCY_TYPES.has(a.tipo) && a.status_atendimento === ALERT_STATUSES.PENDENTE
    );
  }

  _renderEmergencyState() {
    const pending = this._pendingEmergencies();
    const banner = this._el.emergencyBanner;

    if (pending.length > 0) {
      const latest = pending[0];
      banner.hidden = false;
      this._el.emergencyBannerText.textContent =
        `${TYPE_LABELS[latest.tipo]} às ${formatTime(latest.timestamp)} — ${latest.laudo_ia || 'verificar imediatamente.'}`;
      this._el.kpiSlaStatusValue.textContent = 'EMERGÊNCIA PENDENTE';
      this._el.kpiSlaStatusHint.textContent = 'Acionar socorro e confirmar no feed.';
      this._el.kpiSlaStatus.dataset.status = 'EMERGENCIA';
    } else {
      banner.hidden = true;
      this._el.kpiSlaStatusValue.textContent = 'Monitoramento normal';
      this._el.kpiSlaStatusHint.textContent = this._slaSummary();
      this._el.kpiSlaStatus.dataset.status = 'NORMAL';
    }

    const currentIds = new Set(this._alerts.map((a) => a.id));
    if (this._knownAlertIds !== null && pending.some((a) => !this._knownAlertIds.has(a.id))) {
      this._playAlarm();
    }
    this._knownAlertIds = currentIds;
  }

  _slaSummary() {
    const resolved = this._alerts.filter(
      (a) => a.status_atendimento === ALERT_STATUSES.SOCORRIDO && a.atendido_em
    );
    if (resolved.length === 0) {
      return 'Nenhum socorro registrado ainda.';
    }
    const totalMs = resolved.reduce(
      (sum, a) => sum + Math.max(0, Date.parse(a.atendido_em) - Date.parse(a.timestamp)),
      0
    );
    const avgSec = totalMs / resolved.length / MS_PER_SECOND;
    return `Tempo médio até socorro: ${avgSec.toFixed(1)} s (${resolved.length} atendimento(s)).`;
  }

  _renderFeed() {
    const list = this._el.alertFeedList;
    list.replaceChildren();
    this._el.alertFeedEmpty.hidden = this._alerts.length > 0;

    for (const alert of this._alerts) {
      const isPending = alert.status_atendimento === ALERT_STATUSES.PENDENTE;
      const item = createEl('li', {
        className: `alert-card severity-${String(alert.severidade).toLowerCase()} status-${String(alert.status_atendimento).toLowerCase()}`,
        attrs: {
          'data-testid': 'alert-card',
          'data-alert-id': alert.id,
          'data-alert-type': alert.tipo,
          'data-alert-status': alert.status_atendimento,
        },
      });

      const header = createEl('div', { className: 'alert-card__header' });
      header.append(
        createEl('strong', { text: TYPE_LABELS[alert.tipo] ?? alert.tipo }),
        createEl('span', { className: 'alert-card__time', text: formatTime(alert.timestamp) })
      );

      const meta = createEl('div', { className: 'alert-card__meta' });
      meta.append(
        createEl('span', { className: 'chip', text: `Severidade: ${alert.severidade}` }),
        createEl('span', { className: 'chip', text: `Status: ${STATUS_LABELS[alert.status_atendimento] ?? alert.status_atendimento}` }),
        createEl('span', { className: 'chip', text: `θ ${Number(alert.angulo_tronco_graus).toFixed(1)}° • ${Number(alert.tempo_imovel_seg).toFixed(1)} s imóvel` }),
        createEl('span', { className: 'chip chip--ai', text: alert.fonte_ia, attrs: { 'data-testid': 'alert-ai-source' } })
      );

      const report = createEl('p', {
        className: 'alert-card__report',
        text: alert.laudo_ia || 'Laudo indisponível.',
        attrs: { 'data-testid': 'alert-triage-report' },
      });

      const actions = createEl('div', { className: 'alert-card__actions' });
      const confirmBtn = createEl('button', {
        className: 'btn btn--success',
        text: 'Confirmar Socorro',
        attrs: { type: 'button', 'data-testid': 'btn-confirm-rescue', 'data-action': ALERT_STATUSES.SOCORRIDO },
      });
      const falseBtn = createEl('button', {
        className: 'btn btn--ghost',
        text: 'Falso Positivo',
        attrs: { type: 'button', 'data-testid': 'btn-false-positive', 'data-action': ALERT_STATUSES.FALSO_POSITIVO },
      });
      confirmBtn.disabled = !isPending;
      falseBtn.disabled = !isPending;
      actions.append(confirmBtn, falseBtn);

      item.append(header, meta, report, actions);
      list.append(item);
    }
  }

  async _handleFeedClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) {
      return;
    }
    const card = button.closest('[data-alert-id]');
    const alertId = card?.dataset.alertId;
    const alert = this._alerts.find((a) => a.id === alertId);
    if (!alert || alert.status_atendimento !== ALERT_STATUSES.PENDENTE || this._inFlightStatus.has(alertId)) {
      return;
    }

    this._inFlightStatus.add(alertId);
    card.querySelectorAll('button[data-action]').forEach((b) => {
      b.disabled = true;
    });
    try {
      await this._repo.updateAlertStatus(alertId, button.dataset.action, new Date().toISOString());
    } catch (error) {
      this._logger?.error?.('[DashboardController] Falha ao atualizar status do alerta:', error);
    } finally {
      this._inFlightStatus.delete(alertId);
    }
  }

  _playAlarm() {
    try {
      const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioCtx) return;
      this._audioCtx = this._audioCtx ?? new AudioCtx();
      const ctx = this._audioCtx;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = ALARM_CONFIG.FREQUENCY_HZ;
      gain.gain.value = ALARM_CONFIG.GAIN;
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + ALARM_CONFIG.DURATION_S);
    } catch (error) {
      this._logger?.warn?.('[DashboardController] Alarme sonoro indisponível:', error?.message || error);
    }
  }

  // ---------------------------------------------------------------- Config modal

  _bindConfigModal() {
    const el = this._el;
    el.btnOpenConfig.addEventListener('click', () => this._openConfig());
    el.btnCloseConfig.addEventListener('click', () => this._closeConfig());
    el.btnSaveConfig.addEventListener('click', () => this._saveConfig());
    el.btnClearConfig.addEventListener('click', () => this._clearConfig());
    el.configModal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this._closeConfig();
    });
  }

  _openConfig() {
    const current = this._env.loadEnvConfig();
    this._el.inputFirebaseConfig.value = current.firebaseConfig
      ? JSON.stringify(current.firebaseConfig, null, 2)
      : '';
    this._el.inputGeminiApiKey.value = current.geminiApiKey;
    this._showConfigError('');
    this._el.configModal.hidden = false;
    this._el.inputFirebaseConfig.focus();
  }

  _closeConfig() {
    this._el.configModal.hidden = true;
    this._showConfigError('');
  }

  _showConfigError(message) {
    this._el.configValidationError.textContent = message;
    this._el.configValidationError.hidden = !message;
  }

  _saveConfig() {
    const rawFirebase = this._el.inputFirebaseConfig.value.trim();
    const geminiApiKey = this._el.inputGeminiApiKey.value;

    if (rawFirebase) {
      try {
        JSON.parse(rawFirebase);
      } catch {
        this._showConfigError('JSON inválido: cole o objeto firebaseConfig completo do Firebase Console.');
        return;
      }
    }

    const result = this._env.saveEnvConfig({
      firebaseConfig: rawFirebase || null,
      geminiApiKey,
    });
    if (!result.ok) {
      this._showConfigError(
        result.error?.includes('firebaseConfig')
          ? 'firebaseConfig incompleto: os campos apiKey e projectId são obrigatórios.'
          : result.error || 'Não foi possível salvar a configuração.'
      );
      return;
    }

    this._closeConfig();
    this._onConfigChanged(result.config);
  }

  _clearConfig() {
    const result = this._env.clearEnvConfig();
    this._closeConfig();
    this._onConfigChanged(result.config);
  }
}
