/**
 * Renders the anonymous 33-landmark skeleton (Privacy-by-Design / LGPD) on a <canvas>.
 * Never persists or transmits pixels: it only draws normalized geometric coordinates.
 */

const POSE_CONNECTIONS = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
]);

const STATE_COLORS = Object.freeze({
  EM_PE: '#22d3ee',
  DESEQUILIBRIO: '#fbbf24',
  QUEDA_DETECTADA: '#fb923c',
  ALERTA_CRITICO: '#ef4444',
});

const STATE_LABELS = Object.freeze({
  EM_PE: 'Postura estável',
  DESEQUILIBRIO: 'Desequilíbrio detectado',
  QUEDA_DETECTADA: 'Queda detectada — aguardando imobilidade',
  ALERTA_CRITICO: 'ALERTA CRÍTICO',
});

const RENDER_CONFIG = Object.freeze({
  BACKGROUND: '#060b18',
  BACKGROUND_TRANSPARENT_OVERLAY: 'rgba(6, 11, 24, 0.25)',
  GRID_COLOR: 'rgba(56, 189, 248, 0.12)',
  GRID_STEP_PX: 40,
  HUD_BG: 'rgba(15, 23, 42, 0.85)',
  HUD_TEXT: '#e2e8f0',
  HUD_MUTED: '#94a3b8',
  LINE_WIDTH: 4,
  POINT_RADIUS: 5,
  MIN_VISIBILITY: 0.5,
  HUD_X: 12,
  HUD_Y: 12,
  HUD_W: 320,
  HUD_H: 54,
  FONT: '600 14px system-ui, sans-serif',
  FONT_SMALL: '12px system-ui, sans-serif',
});

function isDrawable(landmark) {
  return (
    landmark &&
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y) &&
    (landmark.visibility === undefined || landmark.visibility >= RENDER_CONFIG.MIN_VISIBILITY)
  );
}

export class SkeletonCanvasRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx = canvas?.getContext?.('2d') ?? null;
    this._privacyMode = true;
  }

  setPrivacyMode(enabled) {
    this._privacyMode = Boolean(enabled);
  }

  /**
   * @param {Array<object>|null} landmarks
   * @param {{ state?: string, sourceLabel?: string }} [info]
   */
  render(landmarks, { state = 'EM_PE', sourceLabel = 'Simulador' } = {}) {
    if (!this._ctx) {
      return;
    }
    const { width, height } = this._canvas;
    this._drawBackground(width, height);
    if (Array.isArray(landmarks) && landmarks.length > 0) {
      this._drawSkeleton(landmarks, width, height, STATE_COLORS[state] ?? STATE_COLORS.EM_PE);
    }
    this._drawHud(state, sourceLabel);
  }

  _drawBackground(width, height) {
    const ctx = this._ctx;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this._privacyMode
      ? RENDER_CONFIG.BACKGROUND
      : RENDER_CONFIG.BACKGROUND_TRANSPARENT_OVERLAY;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = RENDER_CONFIG.GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += RENDER_CONFIG.GRID_STEP_PX) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += RENDER_CONFIG.GRID_STEP_PX) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }

  _drawSkeleton(landmarks, width, height, color) {
    const ctx = this._ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = RENDER_CONFIG.LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of POSE_CONNECTIONS) {
      const pa = landmarks[a];
      const pb = landmarks[b];
      if (isDrawable(pa) && isDrawable(pb)) {
        ctx.moveTo(pa.x * width, pa.y * height);
        ctx.lineTo(pb.x * width, pb.y * height);
      }
    }
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    for (const lm of landmarks) {
      if (isDrawable(lm)) {
        ctx.beginPath();
        ctx.arc(lm.x * width, lm.y * height, RENDER_CONFIG.POINT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawHud(state, sourceLabel) {
    const ctx = this._ctx;
    const { HUD_X, HUD_Y, HUD_W, HUD_H } = RENDER_CONFIG;
    ctx.fillStyle = RENDER_CONFIG.HUD_BG;
    ctx.fillRect(HUD_X, HUD_Y, HUD_W, HUD_H);
    ctx.fillStyle = STATE_COLORS[state] ?? STATE_COLORS.EM_PE;
    ctx.fillRect(HUD_X, HUD_Y, 6, HUD_H);

    ctx.font = RENDER_CONFIG.FONT;
    ctx.fillStyle = RENDER_CONFIG.HUD_TEXT;
    ctx.fillText(STATE_LABELS[state] ?? state, HUD_X + 16, HUD_Y + 22);
    ctx.font = RENDER_CONFIG.FONT_SMALL;
    ctx.fillStyle = RENDER_CONFIG.HUD_MUTED;
    const privacyText = this._privacyMode ? 'LGPD: só esqueleto' : 'Vídeo local visível';
    ctx.fillText(`${sourceLabel} • ${privacyText}`, HUD_X + 16, HUD_Y + 42);
  }
}
