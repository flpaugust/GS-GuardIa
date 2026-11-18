/**
 * Preventive analytics charts.
 * Uses Chart.js (lazy-loaded from CDN) when available and a native Canvas 2D renderer
 * as an offline fallback, so the dashboard never goes blank without internet.
 */

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/+esm';

const HOUR_BUCKETS = Object.freeze([
  { label: '00h-04h', start: 0, end: 4, baseWeight: 0.26 },
  { label: '04h-08h', start: 4, end: 8, baseWeight: 0.22 },
  { label: '08h-12h', start: 8, end: 12, baseWeight: 0.12 },
  { label: '12h-16h', start: 12, end: 16, baseWeight: 0.14 },
  { label: '16h-20h', start: 16, end: 20, baseWeight: 0.11 },
  { label: '20h-24h', start: 20, end: 24, baseWeight: 0.15 },
]);

const COLORS = Object.freeze({
  BG: '#0f172a',
  GRID: 'rgba(148, 163, 184, 0.18)',
  AXIS_TEXT: '#cbd5e1',
  ACTIVE_BAR: '#22d3ee',
  RISK_LINE: '#f59e0b',
  RISK_POINT: '#ef4444',
  BASE_BAR: '#6366f1',
  EVENT_BAR: '#f43f5e',
});

const LAYOUT = Object.freeze({
  PAD_LEFT: 44,
  PAD_RIGHT: 44,
  PAD_TOP: 28,
  PAD_BOTTOM: 34,
  GRID_LINES: 4,
  BAR_RATIO: 0.6,
  FONT: '11px system-ui, sans-serif',
  MAX_SCORE: 100,
});

const WEEKDAY_FORMAT = { weekday: 'short', day: '2-digit', timeZone: 'UTC' };

function formatDayLabel(isoDate) {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? String(isoDate)
    : parsed.toLocaleDateString('pt-BR', WEEKDAY_FORMAT);
}

/**
 * Pure aggregation: weekly imbalance totals distributed by a typical geriatric hourly
 * profile plus the exact hour of each registered alert.
 */
export function buildHourlyVulnerability(alertsList = [], metricsList = []) {
  const weeklyImbalances = metricsList.reduce((sum, m) => sum + (m.qtd_desequilibrios || 0), 0);
  const base = HOUR_BUCKETS.map((b) => Math.round(weeklyImbalances * b.baseWeight * 10) / 10);
  const events = HOUR_BUCKETS.map(() => 0);
  for (const alert of alertsList) {
    const hour = new Date(alert.timestamp).getHours();
    const idx = HOUR_BUCKETS.findIndex((b) => hour >= b.start && hour < b.end);
    if (idx >= 0) {
      events[idx] += 1;
    }
  }
  return { labels: HOUR_BUCKETS.map((b) => b.label), base, events };
}

export class ChartsRenderer {
  /**
   * @param {{ weeklyCanvas: HTMLCanvasElement, hourlyCanvas: HTMLCanvasElement, logger?: object }} deps
   */
  constructor({ weeklyCanvas, hourlyCanvas, logger = console }) {
    this._weeklyCanvas = weeklyCanvas;
    this._hourlyCanvas = hourlyCanvas;
    this._logger = logger;
    this._ChartCtor = null;
    this._weeklyChart = null;
    this._hourlyChart = null;
    this._lastWeekly = [];
    this._lastHourly = { alerts: [], metrics: [] };
  }

  /** Lazily tries to load Chart.js; keeps the native renderer if offline. */
  async loadChartLibrary() {
    try {
      const mod = await import(CHART_JS_CDN);
      const Chart = mod.Chart ?? mod.default;
      if (mod.registerables) {
        Chart.register(...mod.registerables);
      }
      this._ChartCtor = Chart;
      this.renderWeeklyMobility(this._lastWeekly);
      this.renderHourlyVulnerability(this._lastHourly.alerts, this._lastHourly.metrics);
      return true;
    } catch (error) {
      this._logger?.warn?.('[ChartsRenderer] Chart.js indisponível, usando renderer nativo:', error?.message || error);
      return false;
    }
  }

  get engine() {
    return this._ChartCtor ? 'Chart.js' : 'Canvas nativo';
  }

  renderWeeklyMobility(metricsList = []) {
    this._lastWeekly = metricsList;
    const labels = metricsList.map((m) => formatDayLabel(m.data));
    const active = metricsList.map((m) => Math.round(m.tempo_ativo_min));
    const risk = metricsList.map((m) => m.score_risco_preventivo);

    if (this._ChartCtor) {
      this._renderWeeklyWithChartJs(labels, active, risk);
      return;
    }
    this._drawNativeCombo(this._weeklyCanvas, {
      labels,
      bars: [{ values: active, color: COLORS.ACTIVE_BAR, label: 'Mobilidade ativa (min)' }],
      line: { values: risk, color: COLORS.RISK_LINE, label: 'Score de risco (0-100)', max: LAYOUT.MAX_SCORE },
    });
  }

  renderHourlyVulnerability(alertsList = [], metricsList = []) {
    this._lastHourly = { alerts: alertsList, metrics: metricsList };
    const { labels, base, events } = buildHourlyVulnerability(alertsList, metricsList);

    if (this._ChartCtor) {
      this._renderHourlyWithChartJs(labels, base, events);
      return;
    }
    this._drawNativeCombo(this._hourlyCanvas, {
      labels,
      bars: [
        { values: base, color: COLORS.BASE_BAR, label: 'Perfil semanal' },
        { values: events, color: COLORS.EVENT_BAR, label: 'Alertas registrados' },
      ],
      line: null,
    });
  }

  _chartCommonOptions() {
    return {
      responsive: false,
      animation: false,
      devicePixelRatio: 1,
      plugins: { legend: { labels: { color: COLORS.AXIS_TEXT } } },
      scales: {
        x: { ticks: { color: COLORS.AXIS_TEXT }, grid: { color: COLORS.GRID } },
        y: { ticks: { color: COLORS.AXIS_TEXT }, grid: { color: COLORS.GRID }, beginAtZero: true },
      },
    };
  }

  _renderWeeklyWithChartJs(labels, active, risk) {
    if (this._weeklyChart) {
      this._weeklyChart.data.labels = labels;
      this._weeklyChart.data.datasets[0].data = active;
      this._weeklyChart.data.datasets[1].data = risk;
      this._weeklyChart.update('none');
      return;
    }
    const options = this._chartCommonOptions();
    options.scales.y1 = {
      position: 'right',
      min: 0,
      max: LAYOUT.MAX_SCORE,
      ticks: { color: COLORS.RISK_LINE },
      grid: { drawOnChartArea: false },
    };
    this._weeklyChart = new this._ChartCtor(this._weeklyCanvas, {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Mobilidade ativa (min)', data: active, backgroundColor: COLORS.ACTIVE_BAR },
          {
            type: 'line', label: 'Score de risco (0-100)', data: risk, yAxisID: 'y1',
            borderColor: COLORS.RISK_LINE, backgroundColor: COLORS.RISK_POINT, tension: 0.3,
          },
        ],
      },
      options,
    });
  }

  _renderHourlyWithChartJs(labels, base, events) {
    if (this._hourlyChart) {
      this._hourlyChart.data.labels = labels;
      this._hourlyChart.data.datasets[0].data = base;
      this._hourlyChart.data.datasets[1].data = events;
      this._hourlyChart.update('none');
      return;
    }
    this._hourlyChart = new this._ChartCtor(this._hourlyCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Perfil semanal', data: base, backgroundColor: COLORS.BASE_BAR },
          { label: 'Alertas registrados', data: events, backgroundColor: COLORS.EVENT_BAR },
        ],
      },
      options: this._chartCommonOptions(),
    });
  }

  _drawNativeCombo(canvas, { labels, bars, line }) {
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) {
      return;
    }
    const { width, height } = canvas;
    const { PAD_LEFT, PAD_RIGHT, PAD_TOP, PAD_BOTTOM, GRID_LINES } = LAYOUT;
    const plotW = width - PAD_LEFT - PAD_RIGHT;
    const plotH = height - PAD_TOP - PAD_BOTTOM;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, width, height);
    ctx.font = LAYOUT.FONT;

    const barMax = Math.max(1, ...bars.flatMap((b) => b.values));
    ctx.strokeStyle = COLORS.GRID;
    ctx.fillStyle = COLORS.AXIS_TEXT;
    for (let i = 0; i <= GRID_LINES; i += 1) {
      const y = PAD_TOP + (plotH * i) / GRID_LINES;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(width - PAD_RIGHT, y);
      ctx.stroke();
      const value = Math.round(barMax * (1 - i / GRID_LINES));
      ctx.fillText(String(value), 6, y + 4);
    }

    const count = Math.max(1, labels.length);
    const slotW = plotW / count;
    const groupW = slotW * LAYOUT.BAR_RATIO;
    const singleW = groupW / bars.length;

    labels.forEach((label, idx) => {
      const slotX = PAD_LEFT + idx * slotW;
      bars.forEach((series, sIdx) => {
        const value = series.values[idx] || 0;
        const h = (value / barMax) * plotH;
        ctx.fillStyle = series.color;
        ctx.fillRect(slotX + (slotW - groupW) / 2 + sIdx * singleW, PAD_TOP + plotH - h, singleW - 2, h);
      });
      ctx.fillStyle = COLORS.AXIS_TEXT;
      ctx.fillText(label, slotX + 4, height - 12);
    });

    if (line) {
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      line.values.forEach((value, idx) => {
        const x = PAD_LEFT + idx * slotW + slotW / 2;
        const y = PAD_TOP + plotH - (value / line.max) * plotH;
        if (idx === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      ctx.fillStyle = COLORS.RISK_POINT;
      line.values.forEach((value, idx) => {
        const x = PAD_LEFT + idx * slotW + slotW / 2;
        const y = PAD_TOP + plotH - (value / line.max) * plotH;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.lineWidth = 1;
    }

    let legendX = PAD_LEFT;
    for (const item of [...bars, ...(line ? [line] : [])]) {
      ctx.fillStyle = item.color;
      ctx.fillRect(legendX, 8, 10, 10);
      ctx.fillStyle = COLORS.AXIS_TEXT;
      ctx.fillText(item.label, legendX + 14, 17);
      legendX += ctx.measureText(item.label).width + 34;
    }
  }
}
