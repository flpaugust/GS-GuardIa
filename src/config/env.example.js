/**
 * Versioned secret-free template for GuardIão cloud & AI credentials.
 * Never commit real API keys or private credentials in source files.
 * Users configure runtime credentials via the UI Quick Config Modal (persisted in localStorage)
 * or via saveEnvConfig() in src/config/env.js.
 */
export const ENV_TEMPLATE = Object.freeze({
  firebaseConfig: Object.freeze({
    apiKey: '',        // e.g. Firebase Web SDK apiKey from Firebase Console
    authDomain: '',    // e.g. "<project-id>.firebaseapp.com"
    projectId: '',     // e.g. "<project-id>"
    storageBucket: '', // e.g. "<project-id>.appspot.com"
    messagingSenderId: '',
    appId: '',
  }),
  geminiApiKey: '',    // Optional Google AI Studio Free Tier key (Gemini Flash)
  patientId: 'paciente_01',
});

export default ENV_TEMPLATE;
