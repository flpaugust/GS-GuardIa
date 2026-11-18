import { BIOMECHANICS_THRESHOLDS } from '../config/thresholds.js';
import {
  AI_SOURCES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  MobilityAlert,
} from '../domain/entities/MobilityAlert.js';

const ZERO = BIOMECHANICS_THRESHOLDS.DEFAULT_Z_COORD;
const MS_PER_SECOND = BIOMECHANICS_THRESHOLDS.MS_PER_SECOND;
const SECONDS_PRECISION_DECIMALS = BIOMECHANICS_THRESHOLDS.SECONDS_PRECISION_DECIMALS;

const VALID_ALERT_TYPES = new Set(Object.values(ALERT_TYPES));
const VALID_ALERT_SEVERITIES = new Set(Object.values(ALERT_SEVERITIES));
const VALID_ALERT_STATUSES = new Set(Object.values(ALERT_STATUSES));
const VALID_AI_SOURCES = new Set(Object.values(AI_SOURCES));

const DEFAULT_SEVERITY_BY_TYPE = Object.freeze({
  [ALERT_TYPES.QUEDA_CRITICA]: ALERT_SEVERITIES.CRITICA,
  [ALERT_TYPES.IMOBILIDADE_PROLONGADA]: ALERT_SEVERITIES.ALTA,
  [ALERT_TYPES.DESEQUILIBRIO]: ALERT_SEVERITIES.MEDIA,
});

export const REGISTER_ALERT_RESULTS = Object.freeze({
  REGISTERED: 'REGISTERED',
  DEGRADED_AI_FALLBACK: 'DEGRADED_AI_FALLBACK',
  DEBOUNCED: 'DEBOUNCED',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
});

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeIsoTimestamp(rawTimestamp, fallbackMs) {
  if (typeof rawTimestamp === 'string' && rawTimestamp.trim().length > ZERO) {
    const parsed = new Date(rawTimestamp.trim());
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  if (rawTimestamp instanceof Date && !Number.isNaN(rawTimestamp.getTime())) {
    return rawTimestamp.toISOString();
  }
  if (isFiniteNumber(rawTimestamp)) {
    const d = new Date(rawTimestamp);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
  }
  return new Date(fallbackMs).toISOString();
}

function buildFallbackTriageReport(alert) {
  const angleText = Number(alert.angulo_tronco_graus).toFixed(SECONDS_PRECISION_DECIMALS);
  const immobilityText = Number(alert.tempo_imovel_seg).toFixed(SECONDS_PRECISION_DECIMALS);

  if (alert.tipo === ALERT_TYPES.QUEDA_CRITICA) {
    return {
      laudo: `Alerta Critico: Queda detectada com inclinacao de ${angleText}° e imobilidade de ${immobilityText}s. Contato imediato e verificacao presencial recomendados.`,
      severidade: alert.severidade,
      fonte: AI_SOURCES.FALLBACK_LOCAL,
    };
  }
  if (alert.tipo === ALERT_TYPES.IMOBILIDADE_PROLONGADA) {
    return {
      laudo: `Atencao: Imobilidade prolongada detectada por ${immobilityText}s (angulo ${angleText}°). Verificar bem-estar do paciente.`,
      severidade: alert.severidade,
      fonte: AI_SOURCES.FALLBACK_LOCAL,
    };
  }
  return {
    laudo: `Aviso Preventivo: Desequilibrio postural detectado (inclinacao ${angleText}°, velocidade vertical ${Number(alert.velocidade_vertical).toFixed(SECONDS_PRECISION_DECIMALS)}). Monitorar estabilidade.`,
    severidade: alert.severidade,
    fonte: AI_SOURCES.FALLBACK_LOCAL,
  };
}

/**
 * Asynchronous, non-blocking emergency alert registration use case.
 * Enforces per-tipo debounce, critical escalation bypass, in-flight re-entrancy locking,
 * AI triage sanitization with deterministic fallback, and non-throwing RAF resilience.
 */
export class RegisterEmergencyAlertUseCase {
  /**
   * @param {object} dependencies
   * @param {object} dependencies.alertRepository
   * @param {object|null} [dependencies.triageAIService=null]
   * @param {string} [dependencies.patientId=BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID]
   * @param {number} [dependencies.debounceMs=BIOMECHANICS_THRESHOLDS.ALERT_DEBOUNCE_MS]
   * @param {(() => number)|null} [dependencies.clock=null]
   * @param {object} [dependencies.logger=console]
   */
  constructor(dependencies = {}) {
    const safeDeps = isPlainObject(dependencies) ? dependencies : {};
    const {
      alertRepository,
      triageAIService = null,
      patientId = BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID,
      debounceMs = BIOMECHANICS_THRESHOLDS.ALERT_DEBOUNCE_MS,
      clock = null,
      logger = console,
    } = safeDeps;

    if (!alertRepository || typeof alertRepository.saveAlert !== 'function') {
      throw new TypeError(
        'RegisterEmergencyAlertUseCase requires an alertRepository with a saveAlert() method'
      );
    }

    this._alertRepository = alertRepository;
    this._triageAIService =
      triageAIService && typeof triageAIService.generateTriageReport === 'function'
        ? triageAIService
        : null;
    this._patientId =
      typeof patientId === 'string' && patientId.trim().length > ZERO
        ? patientId.trim()
        : BIOMECHANICS_THRESHOLDS.DEFAULT_PATIENT_ID;
    this._debounceMs =
      isFiniteNumber(debounceMs) && debounceMs >= ZERO
        ? debounceMs
        : BIOMECHANICS_THRESHOLDS.ALERT_DEBOUNCE_MS;
    this._hasCustomClock = typeof clock === 'function';
    this._clock = this._hasCustomClock ? clock : () => Date.now();
    this._logger = logger;

    this._lastAcceptedByType = new Map();
    this._lastSeverityByType = new Map();
    this._inFlightTypes = new Set();
  }

  /**
   * Registers an emergency alert if valid and outside per-tipo debounce cooldown.
   * Never throws or returns a rejected Promise.
   * @param {object|null} transitionEvent
   * @param {object|number} [optionsOrNowMs={}]
   * @returns {Promise<{ status: string, registered: boolean, debounced: boolean, degraded: boolean, alert: object|null, error: string|null, reason?: string }>}
   */
  async execute(transitionEvent, optionsOrNowMs = {}) {
    let reservedTipo = null;

    try {
      if (!isPlainObject(transitionEvent) || !VALID_ALERT_TYPES.has(transitionEvent.tipo)) {
        return {
          status: REGISTER_ALERT_RESULTS.SKIPPED,
          registered: false,
          debounced: false,
          degraded: false,
          reason: 'INVALID_EVENT',
          alert: null,
          error: null,
        };
      }

      const tipo = transitionEvent.tipo;
      const nowMs = this._resolveNowMs(transitionEvent, optionsOrNowMs);
      const baseSeverity = VALID_ALERT_SEVERITIES.has(transitionEvent.severidade)
        ? transitionEvent.severidade
        : DEFAULT_SEVERITY_BY_TYPE[tipo];

      if (this._inFlightTypes.has(tipo)) {
        return {
          status: REGISTER_ALERT_RESULTS.DEBOUNCED,
          registered: false,
          debounced: true,
          degraded: false,
          reason: 'IN_FLIGHT',
          alert: null,
          error: null,
        };
      }

      if (this._isDebouncedInternal(tipo, nowMs, baseSeverity)) {
        return {
          status: REGISTER_ALERT_RESULTS.DEBOUNCED,
          registered: false,
          debounced: true,
          degraded: false,
          reason: 'DEBOUNCE_WINDOW',
          alert: null,
          error: null,
        };
      }

      // Reserve synchronously before any await so concurrent 30 FPS calls cannot race
      this._inFlightTypes.add(tipo);
      this._lastAcceptedByType.set(tipo, nowMs);
      this._lastSeverityByType.set(tipo, baseSeverity);
      reservedTipo = tipo;

      const baseAlert = this._buildBaseAlert(transitionEvent, optionsOrNowMs, nowMs, baseSeverity);
      const eventContext = this._buildEventContext(baseAlert, transitionEvent, nowMs);

      const { report, degradedAI, aiError } = await this._obtainSanitizedTriageReport(
        baseAlert,
        eventContext
      );

      const enrichedAlert = baseAlert.withTriageReport(report);

      try {
        const savedRecord = await this._alertRepository.saveAlert(enrichedAlert);
        return {
          status: degradedAI
            ? REGISTER_ALERT_RESULTS.DEGRADED_AI_FALLBACK
            : REGISTER_ALERT_RESULTS.REGISTERED,
          registered: true,
          debounced: false,
          degraded: degradedAI,
          alert: savedRecord ?? enrichedAlert,
          error: aiError,
        };
      } catch (repoError) {
        const errorMessage = repoError?.message || String(repoError);
        this._log(
          'error',
          `[RegisterEmergencyAlertUseCase] AlertRepository.saveAlert failed for ${tipo}:`,
          errorMessage
        );
        return {
          status: REGISTER_ALERT_RESULTS.FAILED,
          registered: false,
          debounced: false,
          degraded: true,
          alert: enrichedAlert,
          error: errorMessage,
        };
      }
    } catch (unexpectedError) {
      const errorMessage = unexpectedError?.message || String(unexpectedError);
      this._log(
        'error',
        '[RegisterEmergencyAlertUseCase] Unexpected execution failure:',
        errorMessage
      );
      return {
        status: REGISTER_ALERT_RESULTS.FAILED,
        registered: false,
        debounced: false,
        degraded: true,
        alert: null,
        error: errorMessage,
      };
    } finally {
      if (reservedTipo !== null) {
        this._inFlightTypes.delete(reservedTipo);
      }
    }
  }

  /**
   * Checks whether the given alert type is currently debounced at nowMs.
   * @param {string} tipo
   * @param {number} [nowMs=this._clock()]
   * @param {string|null} [severidade=null]
   * @returns {boolean}
   */
  isDebounced(tipo, nowMs = this._clock(), severidade = null) {
    if (!VALID_ALERT_TYPES.has(tipo)) {
      return false;
    }
    if (this._inFlightTypes.has(tipo)) {
      return true;
    }
    const resolvedNowMs = isFiniteNumber(nowMs) ? nowMs : Date.now();
    const resolvedSeverity = VALID_ALERT_SEVERITIES.has(severidade)
      ? severidade
      : DEFAULT_SEVERITY_BY_TYPE[tipo];
    return this._isDebouncedInternal(tipo, resolvedNowMs, resolvedSeverity);
  }

  /**
   * Resets debounce cooldown tracking for a specific alert type or all types.
   * @param {string|null} [tipo=null]
   */
  reset(tipo = null) {
    if (typeof tipo === 'string' && VALID_ALERT_TYPES.has(tipo)) {
      this._lastAcceptedByType.delete(tipo);
      this._lastSeverityByType.delete(tipo);
      return;
    }
    this._lastAcceptedByType.clear();
    this._lastSeverityByType.clear();
  }

  /**
   * @private
   */
  _isDebouncedInternal(tipo, nowMs, candidateSeverity) {
    const lastSentMs = this._lastAcceptedByType.get(tipo);
    if (lastSentMs === undefined) {
      return false;
    }
    // Backward clock jump / simulator restart resets cooldown cleanly
    if (nowMs < lastSentMs) {
      return false;
    }
    // Critical escalation bypasses prior non-critical cooldown
    if (
      candidateSeverity === ALERT_SEVERITIES.CRITICA &&
      this._lastSeverityByType.get(tipo) !== ALERT_SEVERITIES.CRITICA
    ) {
      return false;
    }
    return nowMs - lastSentMs < this._debounceMs;
  }

  /**
   * @private
   */
  _resolveNowMs(transitionEvent, optionsOrNowMs) {
    if (isFiniteNumber(optionsOrNowMs)) {
      return optionsOrNowMs;
    }
    if (isPlainObject(optionsOrNowMs) && isFiniteNumber(optionsOrNowMs.nowMs)) {
      return optionsOrNowMs.nowMs;
    }
    if (this._hasCustomClock) {
      const clocked = this._clock();
      if (isFiniteNumber(clocked)) {
        return clocked;
      }
    }
    if (isFiniteNumber(transitionEvent.timestampMs)) {
      return transitionEvent.timestampMs;
    }
    if (typeof transitionEvent.timestamp === 'string') {
      const parsed = Date.parse(transitionEvent.timestamp);
      if (isFiniteNumber(parsed)) {
        return parsed;
      }
    }
    const fallbackClocked = this._clock();
    return isFiniteNumber(fallbackClocked) ? fallbackClocked : Date.now();
  }

  /**
   * @private
   */
  _buildBaseAlert(transitionEvent, optionsOrNowMs, nowMs, baseSeverity) {
    const optionPatientId =
      isPlainObject(optionsOrNowMs) &&
      typeof optionsOrNowMs.patientId === 'string' &&
      optionsOrNowMs.patientId.trim().length > ZERO
        ? optionsOrNowMs.patientId.trim()
        : null;

    const eventPatientId =
      typeof transitionEvent.idoso_id === 'string' && transitionEvent.idoso_id.trim().length > ZERO
        ? transitionEvent.idoso_id.trim()
        : null;

    const resolvedPatientId = optionPatientId ?? eventPatientId ?? this._patientId;

    const rawAngle = transitionEvent.angulo_tronco_graus ?? transitionEvent.trunkAngleDeg;
    const rawVelocity = transitionEvent.velocidade_vertical ?? transitionEvent.verticalVelocity;
    const rawImmobilitySec = transitionEvent.tempo_imovel_seg ?? transitionEvent.tempoImovelSeg;

    let tempoImovelSeg = ZERO;
    if (isFiniteNumber(rawImmobilitySec) && rawImmobilitySec >= ZERO) {
      tempoImovelSeg = rawImmobilitySec;
    } else if (
      isFiniteNumber(transitionEvent.immobilityDurationMs) &&
      transitionEvent.immobilityDurationMs >= ZERO
    ) {
      tempoImovelSeg = Number(
        (transitionEvent.immobilityDurationMs / MS_PER_SECOND).toFixed(SECONDS_PRECISION_DECIMALS)
      );
    }

    const rawTimestamp =
      transitionEvent.timestamp !== undefined && transitionEvent.timestamp !== null
        ? transitionEvent.timestamp
        : transitionEvent.timestampMs;

    const statusAtendimento = VALID_ALERT_STATUSES.has(transitionEvent.status_atendimento)
      ? transitionEvent.status_atendimento
      : ALERT_STATUSES.PENDENTE;

    return new MobilityAlert({
      idoso_id: resolvedPatientId,
      tipo: transitionEvent.tipo,
      timestamp: normalizeIsoTimestamp(rawTimestamp, nowMs),
      angulo_tronco_graus: isFiniteNumber(rawAngle) ? rawAngle : ZERO,
      velocidade_vertical: isFiniteNumber(rawVelocity) ? rawVelocity : ZERO,
      tempo_imovel_seg: tempoImovelSeg,
      severidade: baseSeverity,
      status_atendimento: statusAtendimento,
      fonte_ia: AI_SOURCES.FALLBACK_LOCAL,
    });
  }

  /**
   * @private
   */
  _buildEventContext(baseAlert, transitionEvent, nowMs) {
    return {
      idoso_id: baseAlert.idoso_id,
      tipo: baseAlert.tipo,
      severidade: baseAlert.severidade,
      fromState: typeof transitionEvent.fromState === 'string' ? transitionEvent.fromState : null,
      toState: typeof transitionEvent.toState === 'string' ? transitionEvent.toState : null,
      angulo_tronco_graus: baseAlert.angulo_tronco_graus,
      velocidade_vertical: baseAlert.velocidade_vertical,
      tempo_imovel_seg: baseAlert.tempo_imovel_seg,
      trunkAngleDeg: baseAlert.angulo_tronco_graus,
      verticalVelocity: baseAlert.velocidade_vertical,
      immobilityDurationMs: isFiniteNumber(transitionEvent.immobilityDurationMs)
        ? Math.max(ZERO, transitionEvent.immobilityDurationMs)
        : Math.round(baseAlert.tempo_imovel_seg * MS_PER_SECOND),
      tempoImovelSeg: baseAlert.tempo_imovel_seg,
      timestampMs: isFiniteNumber(transitionEvent.timestampMs) ? transitionEvent.timestampMs : nowMs,
      timestamp: baseAlert.timestamp,
    };
  }

  /**
   * @private
   */
  async _obtainSanitizedTriageReport(baseAlert, eventContext) {
    const fallback = buildFallbackTriageReport(baseAlert);

    if (!this._triageAIService) {
      return { report: fallback, degradedAI: true, aiError: null };
    }

    let rawReport = null;
    let aiErrorMsg = null;
    let degradedAI = false;

    try {
      rawReport = await this._triageAIService.generateTriageReport(eventContext);
    } catch (error) {
      degradedAI = true;
      aiErrorMsg = error?.message || String(error);
      this._log(
        'warn',
        `[RegisterEmergencyAlertUseCase] TriageAIService failed for ${baseAlert.tipo}; using local fallback:`,
        aiErrorMsg
      );
      return { report: fallback, degradedAI, aiError: aiErrorMsg };
    }

    if (!isPlainObject(rawReport)) {
      return { report: fallback, degradedAI: true, aiError: null };
    }

    const rawSeverity =
      typeof rawReport.severidade === 'string' ? rawReport.severidade.trim().toUpperCase() : '';
    const hasValidSeverity = VALID_ALERT_SEVERITIES.has(rawSeverity);
    const sanitizedSeverity = hasValidSeverity ? rawSeverity : baseAlert.severidade;
    if (rawReport.severidade !== undefined && rawReport.severidade !== null && !hasValidSeverity) {
      degradedAI = true;
    }

    const rawSource =
      typeof rawReport.fonte === 'string' ? rawReport.fonte.trim().toUpperCase() : '';
    const hasValidSource = VALID_AI_SOURCES.has(rawSource);
    if (rawReport.fonte !== undefined && rawReport.fonte !== null && !hasValidSource) {
      degradedAI = true;
    }

    const candidateLaudo =
      typeof rawReport.laudo === 'string' && rawReport.laudo.trim().length > ZERO
        ? rawReport.laudo.trim()
        : typeof rawReport.laudo_ia === 'string' && rawReport.laudo_ia.trim().length > ZERO
          ? rawReport.laudo_ia.trim()
          : '';

    const candidateAction =
      typeof rawReport.acaoRecomendada === 'string' && rawReport.acaoRecomendada.trim().length > ZERO
        ? rawReport.acaoRecomendada.trim()
        : '';

    let sanitizedLaudo = candidateLaudo;
    let sanitizedSource = hasValidSource ? rawSource : AI_SOURCES.FALLBACK_LOCAL;

    if (!sanitizedLaudo) {
      degradedAI = true;
      sanitizedSource = AI_SOURCES.FALLBACK_LOCAL;
      sanitizedLaudo = candidateAction
        ? `${fallback.laudo} Acao recomendada: ${candidateAction}`
        : fallback.laudo;
    }

    if (!hasValidSource) {
      degradedAI = true;
      sanitizedSource = AI_SOURCES.FALLBACK_LOCAL;
    }

    return {
      report: {
        laudo: sanitizedLaudo,
        severidade: sanitizedSeverity,
        fonte: sanitizedSource,
      },
      degradedAI,
      aiError: aiErrorMsg,
    };
  }

  /**
   * @private
   */
  _log(level, ...args) {
    if (this._logger && typeof this._logger[level] === 'function') {
      this._logger[level](...args);
    }
  }
}
