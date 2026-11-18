import { BIOMECHANICS_THRESHOLDS } from '../../config/thresholds.js';

const ZERO = 0;

export const ALERT_TYPES = Object.freeze({
  QUEDA_CRITICA: 'QUEDA_CRITICA',
  DESEQUILIBRIO: 'DESEQUILIBRIO',
  IMOBILIDADE_PROLONGADA: 'IMOBILIDADE_PROLONGADA',
});

export const ALERT_STATUSES = Object.freeze({
  PENDENTE: 'PENDENTE',
  EM_VERIFICACAO: 'EM_VERIFICACAO',
  SOCORRIDO: 'SOCORRIDO',
  FALSO_POSITIVO: 'FALSO_POSITIVO',
});

export const ALERT_SEVERITIES = Object.freeze({
  BAIXA: 'BAIXA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  CRITICA: 'CRITICA',
});

export const AI_SOURCES = Object.freeze({
  GEMINI: 'GEMINI',
  FALLBACK_LOCAL: 'FALLBACK_LOCAL',
});

const DEFAULT_SEVERITY_BY_TYPE = Object.freeze({
  [ALERT_TYPES.QUEDA_CRITICA]: ALERT_SEVERITIES.CRITICA,
  [ALERT_TYPES.IMOBILIDADE_PROLONGADA]: ALERT_SEVERITIES.ALTA,
  [ALERT_TYPES.DESEQUILIBRIO]: ALERT_SEVERITIES.MEDIA,
});

function validateEnum(value, enumObj, fieldName) {
  const allowed = Object.values(enumObj);
  if (!allowed.includes(value)) {
    throw new Error(`Invalid alert ${fieldName}: ${String(value)}`);
  }
  return value;
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
    if (Number.isNaN(rawValue.getTime())) {
      throw new Error('Invalid Date timestamp');
    }
    return rawValue.toISOString();
  }
  if (typeof rawValue === 'number') {
    const d = new Date(rawValue);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid numeric timestamp: ${rawValue}`);
    }
    return d.toISOString();
  }
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return fallbackIso;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid ISO timestamp string: ${rawValue}`);
    }
    return parsed.toISOString();
  }
  throw new Error(`Unsupported timestamp type: ${typeof rawValue}`);
}

function validateFiniteNumber(rawValue, defaultValue, fieldName, { nonNegative = false } = {}) {
  if (rawValue === undefined || rawValue === null) {
    return defaultValue;
  }
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    throw new Error(`Invalid finite number for ${fieldName}: ${String(rawValue)}`);
  }
  if (nonNegative && rawValue < ZERO) {
    throw new Error(`Negative value not allowed for ${fieldName}: ${rawValue}`);
  }
  return rawValue;
}

/**
 * Pure domain entity modeling mobility & emergency alerts (`alertas` collection schema).
 */
export class MobilityAlert {
  /**
   * @param {object} data
   */
  constructor(data = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError('MobilityAlert constructor expects a non-null plain object');
    }

    this.id = data.id !== undefined && data.id !== null ? String(data.id) : null;

    if (data.idoso_id === undefined || data.idoso_id === null) {
      this.idoso_id = BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID;
    } else if (typeof data.idoso_id === 'string' && data.idoso_id.trim().length > ZERO) {
      this.idoso_id = data.idoso_id.trim();
    } else {
      throw new Error('Invalid alert idoso_id: expected a non-empty string');
    }

    this.tipo = validateEnum(data.tipo, ALERT_TYPES, 'tipo');
    const resolvedTimestamp = data.timestamp ?? data.timestampMs;
    this.timestamp = normalizeIsoTimestamp(resolvedTimestamp, new Date().toISOString());

    const resolvedAngle = data.angulo_tronco_graus ?? data.trunkAngleDeg;
    const resolvedVelocity = data.velocidade_vertical ?? data.verticalVelocity;
    const resolvedImmobilitySec = data.tempo_imovel_seg ?? data.tempoImovelSeg;

    this.angulo_tronco_graus = validateFiniteNumber(
      resolvedAngle,
      ZERO,
      'angulo_tronco_graus'
    );
    this.velocidade_vertical = validateFiniteNumber(
      resolvedVelocity,
      ZERO,
      'velocidade_vertical'
    );
    this.tempo_imovel_seg = validateFiniteNumber(
      resolvedImmobilitySec,
      ZERO,
      'tempo_imovel_seg',
      { nonNegative: true }
    );

    this.laudo_ia = typeof data.laudo_ia === 'string' ? data.laudo_ia : '';

    this.severidade =
      data.severidade === undefined || data.severidade === null
        ? DEFAULT_SEVERITY_BY_TYPE[this.tipo]
        : validateEnum(data.severidade, ALERT_SEVERITIES, 'severidade');

    this.status_atendimento =
      data.status_atendimento === undefined || data.status_atendimento === null
        ? ALERT_STATUSES.PENDENTE
        : validateEnum(data.status_atendimento, ALERT_STATUSES, 'status_atendimento');

    this.atendido_em =
      data.atendido_em === undefined || data.atendido_em === null
        ? null
        : normalizeIsoTimestamp(data.atendido_em, null);

    this.fonte_ia =
      data.fonte_ia === undefined || data.fonte_ia === null
        ? null
        : validateEnum(data.fonte_ia, AI_SOURCES, 'fonte_ia');

    Object.freeze(this);
  }

  isCritical() {
    return (
      this.tipo === ALERT_TYPES.QUEDA_CRITICA ||
      this.severidade === ALERT_SEVERITIES.CRITICA
    );
  }

  isPending() {
    return this.status_atendimento === ALERT_STATUSES.PENDENTE;
  }

  isResolved() {
    return (
      this.status_atendimento === ALERT_STATUSES.SOCORRIDO ||
      this.status_atendimento === ALERT_STATUSES.FALSO_POSITIVO
    );
  }

  /**
   * Returns a new MobilityAlert instance with updated status and resolution timestamp.
   * @param {string} newStatus
   * @param {string|Date|number|null} [atendidoEm=new Date().toISOString()]
   * @returns {MobilityAlert}
   */
  withStatus(newStatus, atendidoEm = new Date().toISOString()) {
    validateEnum(newStatus, ALERT_STATUSES, 'status_atendimento');
    const nextAtendidoEm =
      newStatus === ALERT_STATUSES.PENDENTE
        ? null
        : normalizeIsoTimestamp(atendidoEm, new Date().toISOString());

    return new MobilityAlert({
      ...this.toJSON(),
      status_atendimento: newStatus,
      atendido_em: nextAtendidoEm,
    });
  }

  /**
   * Returns a new MobilityAlert instance enriched with an AI triage report.
   * @param {{ laudo?: string, severidade?: string, fonte?: string }} report
   * @returns {MobilityAlert}
   */
  withTriageReport(report = {}) {
    const safeReport =
      report && typeof report === 'object' && !Array.isArray(report) ? report : {};
    const { laudo, severidade, fonte } = safeReport;
    return new MobilityAlert({
      ...this.toJSON(),
      laudo_ia: typeof laudo === 'string' ? laudo : this.laudo_ia,
      severidade: severidade !== undefined && severidade !== null ? severidade : this.severidade,
      fonte_ia: fonte !== undefined && fonte !== null ? fonte : this.fonte_ia,
    });
  }

  toJSON() {
    return {
      id: this.id,
      idoso_id: this.idoso_id,
      tipo: this.tipo,
      timestamp: this.timestamp,
      angulo_tronco_graus: this.angulo_tronco_graus,
      velocidade_vertical: this.velocidade_vertical,
      tempo_imovel_seg: this.tempo_imovel_seg,
      laudo_ia: this.laudo_ia,
      severidade: this.severidade,
      status_atendimento: this.status_atendimento,
      atendido_em: this.atendido_em,
      fonte_ia: this.fonte_ia,
    };
  }

  static fromJSON(data) {
    return new MobilityAlert(data);
  }
}
