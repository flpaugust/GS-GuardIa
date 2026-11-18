import { BIOMECHANICS_THRESHOLDS, RISK_SCORE_WEIGHTS } from '../../config/thresholds.js';

const ZERO = 0;
const ISO_DATE_LENGTH = 10;

function toNonNegativeFinite(rawValue, fallback = ZERO) {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue < ZERO) {
    return fallback;
  }
  return rawValue;
}

function normalizeIsoTimestamp(rawValue, fallbackIso) {
  if (rawValue === undefined || rawValue === null) {
    return fallbackIso;
  }
  if (typeof rawValue === 'object' && typeof rawValue.toDate === 'function') {
    const converted = rawValue.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime())
      ? converted.toISOString()
      : fallbackIso;
  }
  if (rawValue instanceof Date) {
    return !Number.isNaN(rawValue.getTime()) ? rawValue.toISOString() : fallbackIso;
  }
  if (typeof rawValue === 'number' || typeof rawValue === 'string') {
    const parsed = new Date(rawValue);
    return !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : fallbackIso;
  }
  return fallbackIso;
}

/**
 * Pure domain entity modeling daily aggregated mobility telemetry (`metricas_mobilidade` schema)
 * and deterministic Preventive Risk Score calculation in [0, 100].
 */
export class DailyMetrics {
  /**
   * @param {object} [data={}]
   */
  constructor(data = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('DailyMetrics constructor expects a non-null plain object');
    }

    this.id = data.id !== undefined && data.id !== null ? String(data.id) : null;

    this.idoso_id =
      typeof data.idoso_id === 'string' && data.idoso_id.trim().length > ZERO
        ? data.idoso_id.trim()
        : BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID;

    this.data =
      typeof data.data === 'string' && data.data.trim().length > ZERO
        ? data.data.trim()
        : new Date().toISOString().slice(ZERO, ISO_DATE_LENGTH);

    this.tempo_ativo_min = toNonNegativeFinite(data.tempo_ativo_min, ZERO);
    this.tempo_sentado_min = toNonNegativeFinite(data.tempo_sentado_min, ZERO);
    this.qtd_desequilibrios = Math.trunc(toNonNegativeFinite(data.qtd_desequilibrios, ZERO));
    this.qtd_quedas = Math.trunc(toNonNegativeFinite(data.qtd_quedas, ZERO));
    this.velocidade_marcha_media = toNonNegativeFinite(data.velocidade_marcha_media, ZERO);
    this.atualizado_em = normalizeIsoTimestamp(data.atualizado_em, new Date().toISOString());

    this.score_risco_preventivo =
      data.score_risco_preventivo === undefined || data.score_risco_preventivo === null
        ? this.calculatePreventiveRiskScore()
        : Math.min(
            RISK_SCORE_WEIGHTS.MAX_SCORE,
            Math.max(
              RISK_SCORE_WEIGHTS.MIN_SCORE,
              Math.round(toNonNegativeFinite(data.score_risco_preventivo, ZERO))
            )
          );

    Object.freeze(this);
  }

  /**
   * Computes deterministic preventive fall-risk score in [0, 100].
   * Protected against zero division when active and seated minutes are both 0.
   * @returns {number}
   */
  calculatePreventiveRiskScore() {
    const totalMinutes = this.tempo_ativo_min + this.tempo_sentado_min;
    const denominator = Math.max(totalMinutes, RISK_SCORE_WEIGHTS.MIN_TOTAL_MINUTES);
    const sedentaryPoints =
      (this.tempo_sentado_min / denominator) * RISK_SCORE_WEIGHTS.SEDENTARY_MAX_POINTS;

    const imbalancePoints = Math.min(
      this.qtd_desequilibrios * RISK_SCORE_WEIGHTS.IMBALANCE_POINT_VALUE,
      RISK_SCORE_WEIGHTS.IMBALANCE_MAX_POINTS
    );

    const fallPoints = Math.min(
      this.qtd_quedas * RISK_SCORE_WEIGHTS.FALL_POINT_VALUE,
      RISK_SCORE_WEIGHTS.FALL_MAX_POINTS
    );

    let gaitPoints = ZERO;
    if (
      this.velocidade_marcha_media > RISK_SCORE_WEIGHTS.MIN_GAIT_SPEED &&
      RISK_SCORE_WEIGHTS.LOW_GAIT_SPEED_THRESHOLD > RISK_SCORE_WEIGHTS.MIN_GAIT_SPEED &&
      this.velocidade_marcha_media < RISK_SCORE_WEIGHTS.LOW_GAIT_SPEED_THRESHOLD
    ) {
      const declineRatio =
        (RISK_SCORE_WEIGHTS.LOW_GAIT_SPEED_THRESHOLD - this.velocidade_marcha_media) /
        RISK_SCORE_WEIGHTS.LOW_GAIT_SPEED_THRESHOLD;
      gaitPoints = declineRatio * RISK_SCORE_WEIGHTS.LOW_GAIT_MAX_POINTS;
    }

    const rawScore = sedentaryPoints + imbalancePoints + fallPoints + gaitPoints;
    const rounded = Math.round(rawScore);

    return Math.min(
      RISK_SCORE_WEIGHTS.MAX_SCORE,
      Math.max(RISK_SCORE_WEIGHTS.MIN_SCORE, rounded)
    );
  }

  toJSON() {
    return {
      id: this.id,
      idoso_id: this.idoso_id,
      data: this.data,
      tempo_ativo_min: this.tempo_ativo_min,
      tempo_sentado_min: this.tempo_sentado_min,
      qtd_desequilibrios: this.qtd_desequilibrios,
      qtd_quedas: this.qtd_quedas,
      velocidade_marcha_media: this.velocidade_marcha_media,
      score_risco_preventivo: this.score_risco_preventivo,
      atualizado_em: this.atualizado_em,
    };
  }

  static fromJSON(data) {
    return new DailyMetrics(data);
  }
}
