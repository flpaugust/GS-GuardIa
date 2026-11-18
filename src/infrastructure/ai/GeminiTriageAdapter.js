import { getGeminiApiKey, normalizeGeminiApiKey } from '../../config/env.js';
import { AI_SOURCES, ALERT_SEVERITIES } from '../../domain/entities/MobilityAlert.js';
import { TriageAIService } from '../../domain/repositories/TriageAIService.js';
import {
  RuleBasedTriageFallback,
  normalizeSeverity,
  sanitizeEventMetadata,
} from './RuleBasedTriageFallback.js';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const DEFAULT_TIMEOUT_MS = 6000;
const GEMINI_TEMPERATURE = 0.2;
const GEMINI_MAX_OUTPUT_TOKENS = 300;
const MIN_PLAIN_TEXT_REPORT_LENGTH = 10;
const ZERO = 0;

function inferSeverityFromPlainText(text, fallbackSeverity) {
  const normalized = text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (/\b(CRITIC[AO]?|EMERGENCIA|SAMU|URGENTE)\b/.test(normalized)) {
    return ALERT_SEVERITIES.CRITICA;
  }
  if (/\b(RISCO ALTO|SEVERIDADE ALTA|ALTA|GRAVE)\b/.test(normalized)) {
    return ALERT_SEVERITIES.ALTA;
  }
  if (/\b(MODERAD[AO]|MEDIA)\b/.test(normalized)) {
    return ALERT_SEVERITIES.MEDIA;
  }
  if (/\b(BAIX[AO]|LEVE)\b/.test(normalized)) {
    return ALERT_SEVERITIES.BAIXA;
  }
  return fallbackSeverity;
}

function buildGeminiPayload(sanitizedMeta) {
  const metadataSummary = {
    tipo: sanitizedMeta.tipo,
    idoso_id: sanitizedMeta.idosoId,
    angulo_tronco_graus: sanitizedMeta.anguloTroncoGraus,
    velocidade_vertical: sanitizedMeta.velocidadeVertical,
    tempo_imovel_seg: sanitizedMeta.tempoImovelSeg,
    desequilibrios_recentes: sanitizedMeta.desequilibriosRecentes,
    horario: sanitizedMeta.timestamp,
  };

  const prompt = [
    'Você é um assistente de triagem geriátrica preventiva do sistema GuardIão.',
    'Com base exclusivamente nos metadados biomecânicos abaixo (sem imagens ou vídeo), gere um laudo curto em Português do Brasil para familiares e cuidadores.',
    'Responda em JSON estrito no formato {"laudo": string, "severidade": "BAIXA"|"MEDIA"|"ALTA"|"CRITICA", "acaoRecomendada": string}.',
    `Metadados: ${JSON.stringify(metadataSummary)}`,
  ].join('\n');

  return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: GEMINI_TEMPERATURE,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
    },
  };
}

function parseJsonObjectFromText(unfencedText) {
  try {
    return JSON.parse(unfencedText);
  } catch (parseError) {
    const startIdx = unfencedText.indexOf('{');
    const endIdx = unfencedText.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      return JSON.parse(unfencedText.slice(startIdx, endIdx + 1));
    }
    throw parseError;
  }
}

/**
 * Google Gemini Flash REST adapter implementing TriageAIService with LGPD metadata
 * sanitization and immediate degradation to RuleBasedTriageFallback on any failure.
 */
export class GeminiTriageAdapter extends TriageAIService {
  /**
   * @param {object} [options={}]
   */
  constructor({
    apiKey = undefined,
    apiKeyProvider = () => getGeminiApiKey(),
    fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
    fallbackService = new RuleBasedTriageFallback(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    model = DEFAULT_GEMINI_MODEL,
    baseUrl = DEFAULT_GEMINI_BASE_URL,
    logger = console,
  } = {}) {
    super();
    this._staticApiKey = typeof apiKey === 'string' ? apiKey : undefined;
    this._apiKeyProvider = typeof apiKeyProvider === 'function' ? apiKeyProvider : () => '';
    this._fetchFn = typeof fetchFn === 'function' ? fetchFn : null;
    this._fallbackService = fallbackService;
    this._timeoutMs =
      typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > ZERO
        ? timeoutMs
        : DEFAULT_TIMEOUT_MS;
    this._model = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_GEMINI_MODEL;
    this._baseUrl =
      typeof baseUrl === 'string' && baseUrl.trim()
        ? baseUrl.trim().replace(/\/+$/, '')
        : DEFAULT_GEMINI_BASE_URL;
    this._logger = logger;
  }

  _resolveApiKey() {
    if (typeof this._staticApiKey === 'string') {
      return normalizeGeminiApiKey(this._staticApiKey);
    }
    try {
      return normalizeGeminiApiKey(this._apiKeyProvider());
    } catch (error) {
      this._logger?.warn?.('[GeminiTriageAdapter] Failed to read API key:', error?.message || error);
      return '';
    }
  }

  _parseGeminiResponse(responseJson, fallbackBaseline) {
    const parts = responseJson?.candidates?.[ZERO]?.content?.parts;
    if (!Array.isArray(parts)) {
      throw new Error('Malformed Gemini candidates structure');
    }

    const rawText = parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();

    if (!rawText) {
      throw new Error('Empty Gemini candidate text');
    }

    const unfenced = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const isJsonShaped =
      unfenced.startsWith('{') || unfenced.startsWith('[') || rawText.startsWith('```');

    if (isJsonShaped) {
      const parsed = parseJsonObjectFromText(unfenced);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Gemini JSON payload is not an object');
      }
      const laudoText =
        typeof parsed.laudo === 'string' && parsed.laudo.trim()
          ? parsed.laudo.trim()
          : '';
      if (!laudoText) {
        throw new Error('Gemini JSON missing required laudo field');
      }
      return {
        laudo: laudoText,
        severidade: normalizeSeverity(parsed.severidade, fallbackBaseline.severidade),
        acaoRecomendada:
          typeof parsed.acaoRecomendada === 'string' && parsed.acaoRecomendada.trim()
            ? parsed.acaoRecomendada.trim()
            : fallbackBaseline.acaoRecomendada,
        fonte: AI_SOURCES.GEMINI,
      };
    }

    if (rawText.length < MIN_PLAIN_TEXT_REPORT_LENGTH) {
      throw new Error('Gemini plain-text report too short');
    }

    return {
      laudo: rawText,
      severidade: inferSeverityFromPlainText(rawText, fallbackBaseline.severidade),
      acaoRecomendada: fallbackBaseline.acaoRecomendada,
      fonte: AI_SOURCES.GEMINI,
    };
  }

  /**
   * Generates a caregiver triage report from LGPD-sanitized event metadata.
   * @param {object} [eventContext={}]
   * @returns {Promise<{ laudo: string, severidade: string, acaoRecomendada: string, fonte: 'GEMINI' | 'FALLBACK_LOCAL' }>}
   */
  async generateTriageReport(eventContext = {}) {
    const sanitizedMeta = sanitizeEventMetadata(eventContext);
    const apiKey = this._resolveApiKey();

    if (!apiKey || typeof this._fetchFn !== 'function') {
      return this._fallbackService.generateTriageReport(sanitizedMeta);
    }

    const url = `${this._baseUrl}/models/${encodeURIComponent(this._model)}:generateContent`;
    const payload = buildGeminiPayload(sanitizedMeta);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(
          () => controller.abort(new Error(`Gemini timeout after ${this._timeoutMs}ms`)),
          this._timeoutMs
        )
      : null;

    try {
      const response = await this._fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(payload),
        ...(controller ? { signal: controller.signal } : {}),
      });

      if (!response || !response.ok) {
        throw new Error(`Gemini HTTP ${response?.status ?? 'UNKNOWN'}`);
      }

      const responseJson = await response.json();
      const fallbackBaseline = await this._fallbackService.generateTriageReport(sanitizedMeta);
      return this._parseGeminiResponse(responseJson, fallbackBaseline);
    } catch (error) {
      this._logger?.warn?.(
        '[GeminiTriageAdapter] Falling back to local rules:',
        error?.message || error
      );
      return this._fallbackService.generateTriageReport(sanitizedMeta);
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }
}
