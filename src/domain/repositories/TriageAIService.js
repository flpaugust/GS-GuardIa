import { NotImplementedError } from './AlertRepository.js';

export { NotImplementedError };

/**
 * Abstract contract for AI-based emergency triage report generation.
 * Pure domain contract with zero external or runtime environment dependencies.
 */
export class TriageAIService {
  /**
   * Generates a caregiver-readable triage report from structured biomechanical event metadata.
   * @param {object} _eventContext
   * @returns {Promise<{ laudo: string, severidade: string, acaoRecomendada: string, fonte: 'GEMINI' | 'FALLBACK_LOCAL' }>}
   */
  async generateTriageReport(_eventContext) {
    throw new NotImplementedError('generateTriageReport', this.constructor.name);
  }
}
