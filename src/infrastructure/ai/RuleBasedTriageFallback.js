import { BIOMECHANICS_THRESHOLDS } from '../../config/thresholds.js';
import {
  AI_SOURCES,
  ALERT_SEVERITIES,
  ALERT_TYPES,
} from '../../domain/entities/MobilityAlert.js';
import { TriageAIService } from '../../domain/repositories/TriageAIService.js';

const ANGLE_DECIMALS = 1;
const VELOCITY_DECIMALS = 2;
const SECONDS_DECIMALS = BIOMECHANICS_THRESHOLDS.SECONDS_PRECISION_DECIMALS;
const MS_PER_SECOND = BIOMECHANICS_THRESHOLDS.MS_PER_SECOND;
const IMMOBILITY_CRITICAL_ESCALATION_SEC = 15;
const FREQUENT_IMBALANCE_THRESHOLD = 3;
const SEVERE_IMBALANCE_ANGLE_DEG = BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG;
const MAX_SAFE_STRING_LEN = 64;
const ZERO = 0;

export const VALID_SEVERITIES = Object.freeze(Object.values(ALERT_SEVERITIES));

const SEVERITY_ALIAS_MAP = Object.freeze({
  BAIXA: ALERT_SEVERITIES.BAIXA,
  LOW: ALERT_SEVERITIES.BAIXA,
  LEVE: ALERT_SEVERITIES.BAIXA,
  MEDIA: ALERT_SEVERITIES.MEDIA,
  MODERADA: ALERT_SEVERITIES.MEDIA,
  MEDIUM: ALERT_SEVERITIES.MEDIA,
  MODERATE: ALERT_SEVERITIES.MEDIA,
  ALTA: ALERT_SEVERITIES.ALTA,
  HIGH: ALERT_SEVERITIES.ALTA,
  GRAVE: ALERT_SEVERITIES.ALTA,
  CRITICA: ALERT_SEVERITIES.CRITICA,
  CRITICAL: ALERT_SEVERITIES.CRITICA,
  EMERGENCIA: ALERT_SEVERITIES.CRITICA,
  URGENTE: ALERT_SEVERITIES.CRITICA,
});

/**
 * Normalizes any raw severity token into one of the four canonical MobilityAlert severities.
 * @param {unknown} rawSeverity
 * @param {string} [fallbackSeverity=ALERT_SEVERITIES.MEDIA]
 * @returns {string}
 */
export function normalizeSeverity(rawSeverity, fallbackSeverity = ALERT_SEVERITIES.MEDIA) {
  const safeFallback = VALID_SEVERITIES.includes(fallbackSeverity)
    ? fallbackSeverity
    : ALERT_SEVERITIES.MEDIA;

  if (typeof rawSeverity !== 'string') {
    return safeFallback;
  }

  const normalized = rawSeverity
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return SEVERITY_ALIAS_MAP[normalized] ?? safeFallback;
}

/**
 * Parses a finite numeric value from numbers or non-empty numeric strings; returns null otherwise.
 * @param {unknown} value
 * @returns {number|null}
 */
export function toFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function roundToDecimals(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sanitizeSafeToken(rawValue, fallback, { uppercase = false } = {}) {
  if (typeof rawValue !== 'string') {
    return fallback;
  }
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed.length > MAX_SAFE_STRING_LEN || /^data:/i.test(trimmed)) {
    return fallback;
  }
  return uppercase ? trimmed.toUpperCase() : trimmed;
}

function sanitizeTimestamp(rawTimestamp, rawTimestampMs) {
  const candidate = rawTimestamp ?? rawTimestampMs;
  if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
    return candidate.toISOString();
  }
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  if (typeof candidate === 'string' && candidate.trim()) {
    const parsed = new Date(candidate.trim());
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function resolveImmobilitySeconds(ctx) {
  const directSec = toFiniteNumber(ctx.tempo_imovel_seg ?? ctx.tempoImovelSeg);
  if (directSec !== null) {
    return roundToDecimals(Math.max(ZERO, directSec), SECONDS_DECIMALS);
  }
  const durationMs = toFiniteNumber(ctx.immobilityDurationMs);
  if (durationMs !== null) {
    return roundToDecimals(Math.max(ZERO, durationMs / MS_PER_SECOND), SECONDS_DECIMALS);
  }
  return null;
}

function resolveRecentImbalances(ctx) {
  const rawCount = toFiniteNumber(
    ctx.recentImbalancesCount ?? ctx.qtd_desequilibrios ?? ctx.historicoDesequilibrios
  );
  if (rawCount === null) {
    return null;
  }
  return Math.max(ZERO, Math.trunc(rawCount));
}

/**
 * Extracts strictly allowlisted LGPD-safe metadata from an alert/FSM event context.
 * Drops raw media, images, videos, canvas blobs, and 33-point landmark arrays.
 * @param {unknown} eventContext
 * @returns {{
 *   tipo: string,
 *   idosoId: string,
 *   anguloTroncoGraus: number|null,
 *   velocidadeVertical: number|null,
 *   tempoImovelSeg: number|null,
 *   desequilibriosRecentes: number|null,
 *   timestamp: string,
 *   severidadeInformada: unknown
 * }}
 */
export function sanitizeEventMetadata(eventContext = {}) {
  const ctx =
    eventContext && typeof eventContext === 'object' && !Array.isArray(eventContext)
      ? eventContext
      : {};

  const rawAngle = toFiniteNumber(ctx.angulo_tronco_graus ?? ctx.trunkAngleDeg);
  const rawVelocity = toFiniteNumber(ctx.velocidade_vertical ?? ctx.verticalVelocity);

  return {
    tipo: sanitizeSafeToken(ctx.tipo, 'EVENTO_DESCONHECIDO', { uppercase: true }),
    idosoId: sanitizeSafeToken(
      ctx.idoso_id ?? ctx.patientId,
      BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID
    ),
    anguloTroncoGraus: rawAngle !== null ? roundToDecimals(rawAngle, ANGLE_DECIMALS) : null,
    velocidadeVertical:
      rawVelocity !== null ? roundToDecimals(rawVelocity, VELOCITY_DECIMALS) : null,
    tempoImovelSeg: resolveImmobilitySeconds(ctx),
    desequilibriosRecentes: resolveRecentImbalances(ctx),
    timestamp: sanitizeTimestamp(ctx.timestamp, ctx.timestampMs),
    severidadeInformada: ctx.severidade,
  };
}

function buildMetricFragments(meta) {
  const fragments = [];
  if (meta.anguloTroncoGraus !== null) {
    fragments.push(`inclinação do tronco de ${meta.anguloTroncoGraus.toFixed(ANGLE_DECIMALS)}°`);
  }
  if (meta.velocidadeVertical !== null) {
    fragments.push(`velocidade vertical de ${meta.velocidadeVertical.toFixed(VELOCITY_DECIMALS)} u/s`);
  }
  if (meta.tempoImovelSeg !== null) {
    fragments.push(`imobilidade por ${meta.tempoImovelSeg.toFixed(SECONDS_DECIMALS)}s`);
  }
  return fragments;
}

function formatMetricClause(fragments) {
  return fragments.length > ZERO ? ` (${fragments.join(', ')})` : '';
}

function buildCriticalFallReport(meta, metricClause) {
  return {
    severidade: ALERT_SEVERITIES.CRITICA,
    acaoRecomendada:
      'Realizar contato telefônico imediato com o idoso; caso não responda, acionar cuidador próximo ou serviço de emergência (SAMU 192) para verificação presencial.',
    laudo: `Alerta Crítico: queda brusca detectada com permanência no solo${metricClause}. Recomenda-se contato telefônico imediato e verificação presencial.`,
  };
}

function buildImbalanceReport(meta, metricClause) {
  const isSevere =
    (meta.desequilibriosRecentes !== null &&
      meta.desequilibriosRecentes >= FREQUENT_IMBALANCE_THRESHOLD) ||
    (meta.anguloTroncoGraus !== null && meta.anguloTroncoGraus < SEVERE_IMBALANCE_ANGLE_DEG);

  const recentNote =
    meta.desequilibriosRecentes !== null && meta.desequilibriosRecentes >= 1
      ? ` Histórico recente registra ${meta.desequilibriosRecentes} episódio(s) de desequilíbrio.`
      : '';

  return {
    severidade: isSevere ? ALERT_SEVERITIES.ALTA : ALERT_SEVERITIES.MEDIA,
    acaoRecomendada:
      'Contatar o idoso para verificar tontura ou perda de equilíbrio, orientar apoio em superfície segura e monitorar possíveis recorrências.',
    laudo: `Alerta de Desequilíbrio: instabilidade postural súbita detectada${metricClause}.${recentNote} Recomenda-se checagem rápida com o idoso e observação preventiva.`,
  };
}

function buildImmobilityReport(meta, metricClause) {
  const isCritical =
    meta.tempoImovelSeg !== null && meta.tempoImovelSeg >= IMMOBILITY_CRITICAL_ESCALATION_SEC;

  return {
    severidade: isCritical ? ALERT_SEVERITIES.CRITICA : ALERT_SEVERITIES.ALTA,
    acaoRecomendada:
      'Tentar contato por voz ou telefone imediatamente para confirmar consciência e mobilidade; sem resposta, realizar verificação presencial urgente.',
    laudo: `Alerta de Imobilidade Prolongada: ausência significativa de movimentação detectada${metricClause}. Recomenda-se verificar consciência e segurança do idoso.`,
  };
}

function buildGenericReport(meta, metricClause) {
  const defaultSeverity =
    meta.tempoImovelSeg !== null && meta.tempoImovelSeg >= IMMOBILITY_CRITICAL_ESCALATION_SEC
      ? ALERT_SEVERITIES.ALTA
      : ALERT_SEVERITIES.BAIXA;

  return {
    severidade: normalizeSeverity(meta.severidadeInformada, defaultSeverity),
    acaoRecomendada:
      'Acompanhar os indicadores no painel preventivo e confirmar o bem-estar do idoso na próxima verificação.',
    laudo: `Registro Preventivo de Mobilidade: evento postural monitorado localmente${metricClause}. Nenhuma anomalia crítica confirmada sem verificação adicional.`,
  };
}

/**
 * Deterministic local rule-based fallback implementing TriageAIService.
 * Guarantees immediate PT-BR caregiver triage without network or API dependencies.
 */
export class RuleBasedTriageFallback extends TriageAIService {
  /**
   * @param {object} [eventContext={}]
   * @returns {Promise<{ laudo: string, severidade: string, acaoRecomendada: string, fonte: 'FALLBACK_LOCAL' }>}
   */
  async generateTriageReport(eventContext = {}) {
    const meta = sanitizeEventMetadata(eventContext);
    const metricClause = formatMetricClause(buildMetricFragments(meta));

    let report;
    if (meta.tipo === ALERT_TYPES.QUEDA_CRITICA) {
      report = buildCriticalFallReport(meta, metricClause);
    } else if (meta.tipo === ALERT_TYPES.DESEQUILIBRIO) {
      report = buildImbalanceReport(meta, metricClause);
    } else if (meta.tipo === ALERT_TYPES.IMOBILIDADE_PROLONGADA) {
      report = buildImmobilityReport(meta, metricClause);
    } else {
      report = buildGenericReport(meta, metricClause);
    }

    return {
      ...report,
      fonte: AI_SOURCES.FALLBACK_LOCAL,
    };
  }
}
