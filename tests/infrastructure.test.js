import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BIOMECHANICS_THRESHOLDS,
  TOTAL_POSE_LANDMARKS,
} from '../src/config/thresholds.js';
import { DailyMetrics } from '../src/domain/entities/DailyMetrics.js';
import {
  AI_SOURCES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  MobilityAlert,
} from '../src/domain/entities/MobilityAlert.js';
import { PoseFrame } from '../src/domain/entities/PoseFrame.js';
import { AlertRepository } from '../src/domain/repositories/AlertRepository.js';
import { TriageAIService } from '../src/domain/repositories/TriageAIService.js';
import { BiomechanicsCalculator } from '../src/domain/services/BiomechanicsCalculator.js';
import {
  POSTURE_STATES,
  PostureStateMachine,
} from '../src/domain/services/PostureStateMachine.js';
import { createStaticServer, parsePort } from '../server.js';
import { GeminiTriageAdapter } from '../src/infrastructure/ai/GeminiTriageAdapter.js';
import { RuleBasedTriageFallback } from '../src/infrastructure/ai/RuleBasedTriageFallback.js';
import { FirestoreRepository } from '../src/infrastructure/persistence/FirestoreRepository.js';
import {
  ALERTS_STORAGE_KEY,
  LocalStorageRepository,
  METRICS_STORAGE_KEY,
} from '../src/infrastructure/persistence/LocalStorageRepository.js';
import { RepositoryFactory } from '../src/infrastructure/persistence/RepositoryFactory.js';
import {
  BiomechanicalScenarioSimulator,
  MediaPipePoseAdapter,
  SIMULATION_SCENARIOS,
} from '../src/infrastructure/vision/MediaPipePoseAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

const SILENT_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function rawHttpRequest(port, requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function startTempServer(rootDir) {
  const server = createStaticServer({ rootDir, logger: SILENT_LOGGER });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => {
      map.set(key, String(val));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

function createMockBroadcastBus() {
  const channelsByName = new Map();
  const factory = (name) => {
    if (!channelsByName.has(name)) {
      channelsByName.set(name, new Set());
    }
    const peers = channelsByName.get(name);
    const channel = {
      name,
      onmessage: null,
      postMessage(data) {
        for (const peer of peers) {
          if (peer !== channel && typeof peer.onmessage === 'function') {
            peer.onmessage({ data });
          }
        }
      },
      close() {
        peers.delete(channel);
      },
    };
    peers.add(channel);
    return channel;
  };
  return { factory, channelsByName };
}

function createMockFirestoreSdk() {
  const store = {
    alertas: new Map(),
    metricas_mobilidade: new Map(),
  };
  const listeners = {
    alertas: new Set(),
    metricas_mobilidade: new Set(),
  };
  const apps = [];
  let autoIdCounter = 1;
  const SENTINEL = { __serverTimestamp: true };

  function materializeTimestamps(payload) {
    const out = { ...payload };
    const nowIso = new Date().toISOString();
    for (const [k, v] of Object.entries(out)) {
      if (v === SENTINEL) {
        out[k] = { toDate: () => new Date(nowIso) };
      }
    }
    return out;
  }

  function emitCollection(colName) {
    const colMap = store[colName];
    for (const sub of listeners[colName]) {
      const matchingDocs = [];
      for (const [id, data] of colMap.entries()) {
        if (!sub.idosoId || data.idoso_id === sub.idosoId) {
          matchingDocs.push({ id, data: () => ({ ...data }) });
        }
      }
      sub.onNext({ docs: matchingDocs });
    }
  }

  const appSdk = {
    getApps: () => apps,
    initializeApp: (config, name) => {
      const app = { name, options: config };
      apps.push(app);
      return app;
    },
  };

  const firestoreSdk = {
    SENTINEL,
    getFirestore: (app) => ({ app }),
    serverTimestamp: () => SENTINEL,
    collection: (_db, name) => ({ kind: 'collection', name }),
    doc: (_db, colName, id) => ({ kind: 'doc', colName, id }),
    where: (field, op, value) => ({ kind: 'where', field, op, value }),
    query: (colRef, ...constraints) => ({ kind: 'query', colName: colRef.name, constraints }),
    addDoc: async (colRef, payload) => {
      const id = `fs_${autoIdCounter++}`;
      const stored = materializeTimestamps(payload);
      store[colRef.name].set(id, { ...stored, id });
      emitCollection(colRef.name);
      return { id };
    },
    setDoc: async (docRef, payload, options = {}) => {
      const prev = options.merge ? store[docRef.colName].get(docRef.id) || {} : {};
      const stored = materializeTimestamps(payload);
      store[docRef.colName].set(docRef.id, { ...prev, ...stored, id: docRef.id });
      emitCollection(docRef.colName);
    },
    updateDoc: async (docRef, payload) => {
      const prev = store[docRef.colName].get(docRef.id) || {};
      const stored = materializeTimestamps(payload);
      store[docRef.colName].set(docRef.id, { ...prev, ...stored });
      emitCollection(docRef.colName);
    },
    onSnapshot: (queryObj, onNext) => {
      const whereConstraint = queryObj.constraints.find((c) => c.kind === 'where');
      const sub = { idosoId: whereConstraint?.value ?? null, onNext };
      listeners[queryObj.colName].add(sub);
      emitCollection(queryObj.colName);
      return () => {
        listeners[queryObj.colName].delete(sub);
      };
    },
  };

  return { appSdk, firestoreSdk, store };
}

function runSimulatorThroughPipeline(scenarioName, { dtMs = 33.3, totalDurationMs = 6200, thresholds = {} } = {}) {
  const simulator = new BiomechanicalScenarioSimulator();
  const machine = new PostureStateMachine(thresholds);
  const startMs = 10000;
  simulator.startScenario(scenarioName, startMs);

  let previousCoM = null;
  let previousTimestampMs = null;
  const statesSeen = [];
  const events = [];

  for (let elapsed = 0; elapsed <= totalDurationMs; elapsed += dtMs) {
    const ts = startMs + elapsed;
    const frame = simulator.samplePoseFrame(ts);
    assert.ok(frame instanceof PoseFrame);
    assert.equal(frame.landmarks.length, TOTAL_POSE_LANDMARKS);
    assert.equal(frame.isCompletePose(), true);
    assert.equal(frame.hasRequiredLandmarks(), true);

    const torso = frame.getTorsoLandmarks();
    const shoulderMid = BiomechanicsCalculator.calculateMidpoint(torso.leftShoulder, torso.rightShoulder);
    const hipMid = BiomechanicsCalculator.calculateMidpoint(torso.leftHip, torso.rightHip);
    const centerOfMass = BiomechanicsCalculator.calculateCenterOfMass(frame.landmarks);
    const trunkAngleDeg = BiomechanicsCalculator.calculateTrunkAngleDegrees(shoulderMid, hipMid);
    const verticalVelocity =
      previousCoM !== null && previousTimestampMs !== null
        ? BiomechanicsCalculator.calculateVerticalVelocity(
            previousCoM.y,
            centerOfMass.y,
            frame.timestampMs - previousTimestampMs
          )
        : 0;

    const result = machine.evaluate({
      valid: true,
      trunkAngleDeg,
      verticalVelocity,
      centerOfMass,
      timestampMs: frame.timestampMs,
    });

    statesSeen.push(result.state);
    if (result.transitionEvent) {
      events.push(result.transitionEvent);
    }

    previousCoM = centerOfMass;
    previousTimestampMs = frame.timestampMs;
  }

  return { statesSeen, events, finalState: machine.state };
}

describe('1. server.js (Native Node.js HTTP Static Server)', () => {
  it('honors PORT=0 and defaults invalid/empty ports to 3000', () => {
    assert.equal(parsePort('0'), 0);
    assert.equal(parsePort(0), 0);
    assert.equal(parsePort('3005'), 3005);
    assert.equal(parsePort(undefined), 3000);
    assert.equal(parsePort(''), 3000);
    assert.equal(parsePort('not-a-port'), 3000);
  });

  it('serves static MIME types, strips query/hash, enforces security headers and traversal 403/404', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guardiao-srv-'));
    try {
      await fs.writeFile(path.join(tempDir, 'index.html'), '<h1>GuardIão</h1>', 'utf8');
      await fs.writeFile(path.join(tempDir, 'app.js'), 'export const x = 1;', 'utf8');
      await fs.writeFile(path.join(tempDir, 'mod.mjs'), 'export const y = 2;', 'utf8');
      await fs.writeFile(path.join(tempDir, 'styles.css'), 'body { color: #fff; }', 'utf8');
      await fs.writeFile(path.join(tempDir, 'data.json'), '{"ok":true}', 'utf8');
      await fs.writeFile(path.join(tempDir, '.env'), 'SECRET=123', 'utf8');
      await fs.mkdir(path.join(tempDir, 'subdir'));

      const { port, close } = await startTempServer(tempDir);
      try {
        const rootRes = await rawHttpRequest(port, '/');
        assert.equal(rootRes.statusCode, 200);
        assert.equal(rootRes.headers['content-type'], 'text/html; charset=utf-8');
        assert.equal(rootRes.headers['x-content-type-options'], 'nosniff');
        assert.equal(rootRes.headers['cache-control'], 'no-cache');
        assert.match(rootRes.body, /GuardIão/);

        const jsRes = await rawHttpRequest(port, '/app.js?v=123#section');
        assert.equal(jsRes.statusCode, 200);
        assert.equal(jsRes.headers['content-type'], 'application/javascript; charset=utf-8');

        const mjsRes = await rawHttpRequest(port, '/mod.mjs');
        assert.equal(mjsRes.statusCode, 200);
        assert.equal(mjsRes.headers['content-type'], 'application/javascript; charset=utf-8');

        const cssRes = await rawHttpRequest(port, '/styles.css');
        assert.equal(cssRes.statusCode, 200);
        assert.equal(cssRes.headers['content-type'], 'text/css; charset=utf-8');

        const jsonRes = await rawHttpRequest(port, '/data.json');
        assert.equal(jsonRes.statusCode, 200);
        assert.equal(jsonRes.headers['content-type'], 'application/json; charset=utf-8');

        const headRes = await rawHttpRequest(port, '/data.json', 'HEAD');
        assert.equal(headRes.statusCode, 200);
        assert.equal(headRes.body, '');

        const postRes = await rawHttpRequest(port, '/data.json', 'POST');
        assert.equal(postRes.statusCode, 405);
        assert.equal(postRes.headers.allow, 'GET, HEAD');

        const missingRes = await rawHttpRequest(port, '/does-not-exist.js');
        assert.equal(missingRes.statusCode, 404);

        const dirRes = await rawHttpRequest(port, '/subdir');
        assert.equal(dirRes.statusCode, 404);

        for (const attackPath of [
          '/../package.json',
          '/%2e%2e/package.json',
          '/..%5cpackage.json',
          '/.env',
          '//evil.com/x',
          '/%00',
          '/%ZZ',
        ]) {
          const res = await rawHttpRequest(port, attackPath);
          assert.equal(res.statusCode, 403, `Expected 403 for ${attackPath}, got ${res.statusCode}`);
        }
      } finally {
        await close();
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('spawns node server.js subprocess cleanly and serves real workspace files', async () => {
    const child = spawn(process.execPath, [path.join(WORKSPACE_ROOT, 'server.js')], {
      cwd: WORKSPACE_ROOT,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const boundPort = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => reject(new Error(`Server start timeout. stderr=${stderr}`)), 5000);
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
        const match = stdout.match(/localhost:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Server exited prematurely (${code}): ${stderr}`));
      });
    });

    try {
      const thresholdsRes = await rawHttpRequest(boundPort, '/src/config/thresholds.js');
      assert.equal(thresholdsRes.statusCode, 200);
      assert.equal(thresholdsRes.headers['content-type'], 'application/javascript; charset=utf-8');
      assert.match(thresholdsRes.body, /BIOMECHANICS_THRESHOLDS/);

      const pkgRes = await rawHttpRequest(boundPort, '/package.json');
      assert.equal(pkgRes.statusCode, 200);
      assert.equal(pkgRes.headers['content-type'], 'application/json; charset=utf-8');

      const traversalRes = await rawHttpRequest(boundPort, '/../package.json');
      assert.equal(traversalRes.statusCode, 403);
    } finally {
      const exitPromise = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exitPromise;
    }
  });
});

describe('2. RuleBasedTriageFallback', () => {
  it('extends TriageAIService and produces valid PT-BR reports for all event types', async () => {
    const fallback = new RuleBasedTriageFallback();
    assert.ok(fallback instanceof TriageAIService);

    const fallReport = await fallback.generateTriageReport({
      tipo: ALERT_TYPES.QUEDA_CRITICA,
      trunkAngleDeg: 14.2,
      verticalVelocity: 1.45,
      immobilityDurationMs: 5500,
    });
    assert.equal(fallReport.severidade, ALERT_SEVERITIES.CRITICA);
    assert.equal(fallReport.fonte, AI_SOURCES.FALLBACK_LOCAL);
    assert.match(fallReport.laudo, /14\.2°/);
    assert.match(fallReport.laudo, /5\.5s/);
    assert.ok(fallReport.acaoRecomendada.length >= 10);

    const imbalanceReport = await fallback.generateTriageReport({
      tipo: ALERT_TYPES.DESEQUILIBRIO,
      angulo_tronco_graus: 48.0,
      velocidade_vertical: 0.31,
      recentImbalancesCount: 1,
    });
    assert.equal(imbalanceReport.severidade, ALERT_SEVERITIES.MEDIA);
    assert.equal(imbalanceReport.fonte, AI_SOURCES.FALLBACK_LOCAL);

    const escalatedImbalance = await fallback.generateTriageReport({
      tipo: ALERT_TYPES.DESEQUILIBRIO,
      angulo_tronco_graus: 30.0,
      qtd_desequilibrios: 4,
    });
    assert.equal(escalatedImbalance.severidade, ALERT_SEVERITIES.ALTA);

    const immobilityEscalated = await fallback.generateTriageReport({
      tipo: ALERT_TYPES.IMOBILIDADE_PROLONGADA,
      tempo_imovel_seg: 18,
    });
    assert.equal(immobilityEscalated.severidade, ALERT_SEVERITIES.CRITICA);
  });

  it('guards NaN, Infinity, negative numbers, and empty/unknown inputs without throwing', async () => {
    const fallback = new RuleBasedTriageFallback();
    for (const weirdInput of [
      undefined,
      null,
      'invalid',
      [],
      {
        tipo: '',
        trunkAngleDeg: Number.NaN,
        verticalVelocity: Number.POSITIVE_INFINITY,
        tempoImovelSeg: -20,
        severidade: 'invalid',
      },
    ]) {
      const report = await fallback.generateTriageReport(weirdInput);
      assert.ok(Object.values(ALERT_SEVERITIES).includes(report.severidade));
      assert.equal(report.fonte, AI_SOURCES.FALLBACK_LOCAL);
      assert.doesNotMatch(report.laudo, /\b(NaN|Infinity|undefined|null)\b/);
    }
  });
});

describe('3. GeminiTriageAdapter', () => {
  it('degrades immediately to FALLBACK_LOCAL with zero fetch calls when key is missing or placeholder', async () => {
    let fetchCalls = 0;
    const adapter = new GeminiTriageAdapter({
      apiKeyProvider: () => 'YOUR_GEMINI_API_KEY',
      fetchFn: async () => {
        fetchCalls += 1;
        throw new Error('Should not be called');
      },
      logger: SILENT_LOGGER,
    });
    assert.ok(adapter instanceof TriageAIService);

    const result = await adapter.generateTriageReport({
      tipo: ALERT_TYPES.QUEDA_CRITICA,
      trunkAngleDeg: 15,
    });
    assert.equal(fetchCalls, 0);
    assert.equal(result.fonte, AI_SOURCES.FALLBACK_LOCAL);
    assert.equal(result.severidade, ALERT_SEVERITIES.CRITICA);
  });

  it('enforces LGPD metadata allowlist, x-goog-api-key header, dynamic key lookup, and parses JSON/fenced/plain-text', async () => {
    let dynamicKey = '';
    const capturedRequests = [];
    let mockResponseText = JSON.stringify({
      laudo: 'Queda confirmada com imobilidade. Acionar cuidador.',
      severidade: 'crítica',
      acaoRecomendada: 'Ligar para o paciente imediatamente.',
    });

    const adapter = new GeminiTriageAdapter({
      apiKeyProvider: () => dynamicKey,
      fetchFn: async (url, init) => {
        capturedRequests.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: mockResponseText }] } }],
          }),
        };
      },
      logger: SILENT_LOGGER,
    });

    // Initially empty key -> fallback
    const first = await adapter.generateTriageReport({ tipo: ALERT_TYPES.DESEQUILIBRIO });
    assert.equal(first.fonte, AI_SOURCES.FALLBACK_LOCAL);
    assert.equal(capturedRequests.length, 0);

    // Update key at runtime without re-instantiating adapter
    dynamicKey = 'AIzaSyTestRuntimeKey12345';
    const jsonRes = await adapter.generateTriageReport({
      tipo: ALERT_TYPES.QUEDA_CRITICA,
      trunkAngleDeg: 16.5,
      landmarks: new Array(33).fill({ x: 0.5, y: 0.5, z: 0, visibility: 1 }),
      rawVideo: 'data:video/webm;base64,AAAA',
      imageBase64: 'BBBB',
      frameData: 'CCCC',
      inlineData: { data: 'DDDD' },
      pixelBuffer: [1, 2, 3],
    });

    assert.equal(jsonRes.fonte, AI_SOURCES.GEMINI);
    assert.equal(jsonRes.severidade, ALERT_SEVERITIES.CRITICA);
    assert.equal(capturedRequests.length, 1);

    const req = capturedRequests[0];
    assert.equal(req.url.includes(dynamicKey), false);
    assert.equal(req.init.headers['x-goog-api-key'], dynamicKey);
    for (const forbidden of ['landmarks', 'rawVideo', 'imageBase64', 'frameData', 'inlineData', 'pixelBuffer', 'data:video']) {
      assert.equal(req.init.body.includes(forbidden), false, `LGPD leak detected: ${forbidden}`);
    }

    // Markdown fenced JSON
    mockResponseText = '```json\n{"laudo":"Instabilidade detectada em pé.","severidade":"moderada"}\n```';
    const fencedRes = await adapter.generateTriageReport({ tipo: ALERT_TYPES.DESEQUILIBRIO });
    assert.equal(fencedRes.fonte, AI_SOURCES.GEMINI);
    assert.equal(fencedRes.severidade, ALERT_SEVERITIES.MEDIA);

    // Plain-text Gemini response (E2E mockGeminiApi format)
    mockResponseText = 'Laudo Gemini 200: Risco alto confirmado para o paciente.';
    const plainRes = await adapter.generateTriageReport({ tipo: ALERT_TYPES.QUEDA_CRITICA });
    assert.equal(plainRes.fonte, AI_SOURCES.GEMINI);
    assert.equal(plainRes.severidade, ALERT_SEVERITIES.ALTA);

    // Compatibility with MobilityAlert.withTriageReport()
    const baseAlert = new MobilityAlert({ tipo: ALERT_TYPES.QUEDA_CRITICA });
    const enriched = baseAlert.withTriageReport(plainRes);
    assert.equal(enriched.fonte_ia, AI_SOURCES.GEMINI);
    assert.equal(enriched.laudo_ia, mockResponseText);
  });

  it('degrades to FALLBACK_LOCAL on HTTP errors, malformed JSON, empty candidates, network failure, and timeout', async () => {
    const scenarios = [
      async () => ({ ok: false, status: 500, json: async () => ({}) }),
      async () => ({ ok: false, status: 429, json: async () => ({}) }),
      async () => ({ ok: true, status: 200, json: async () => ({ candidates: [] }) }),
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: '{ "laudo": ' }] } }] }),
      }),
      async () => {
        throw new Error('Network offline');
      },
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason || new Error('Aborted')));
        }),
    ];

    for (const fetchFn of scenarios) {
      const adapter = new GeminiTriageAdapter({
        apiKey: 'AIzaTestKey',
        timeoutMs: 25,
        fetchFn,
        logger: SILENT_LOGGER,
      });
      const res = await adapter.generateTriageReport({ tipo: ALERT_TYPES.QUEDA_CRITICA });
      assert.equal(res.fonte, AI_SOURCES.FALLBACK_LOCAL);
      assert.equal(res.severidade, ALERT_SEVERITIES.CRITICA);
    }
  });
});

describe('4. LocalStorageRepository', () => {
  it('seeds empty alerts [] and 7-day metrics array, supports CRUD/sorting and stats', async () => {
    const storage = createMemoryStorage();
    const repo = new LocalStorageRepository({ storage, logger: SILENT_LOGGER });
    assert.ok(repo instanceof AlertRepository);

    const rawAlerts = JSON.parse(storage.getItem(ALERTS_STORAGE_KEY));
    const rawMetrics = JSON.parse(storage.getItem(METRICS_STORAGE_KEY));
    assert.deepEqual(rawAlerts, []);
    assert.equal(Array.isArray(rawMetrics), true);
    assert.equal(rawMetrics.length, 7);

    let lastAlerts = null;
    const unsubAlerts = repo.subscribeToAlerts((list) => {
      lastAlerts = list;
    });
    assert.deepEqual(lastAlerts, []);

    const older = await repo.saveAlert({
      tipo: ALERT_TYPES.DESEQUILIBRIO,
      timestamp: '2026-11-17T10:00:00.000Z',
    });
    const newer = await repo.saveAlert({
      tipo: ALERT_TYPES.QUEDA_CRITICA,
      timestamp: '2026-11-17T12:00:00.000Z',
    });
    assert.equal(lastAlerts.length, 2);
    assert.equal(lastAlerts[0].id, newer.id);
    assert.equal(lastAlerts[1].id, older.id);

    const updated = await repo.updateAlertStatus(newer.id, ALERT_STATUSES.SOCORRIDO);
    assert.equal(updated.status_atendimento, ALERT_STATUSES.SOCORRIDO);
    assert.ok(updated.atendido_em);

    const todayStr = rawMetrics[6].data;
    await repo.upsertDailyMetrics({
      data: todayStr,
      tempo_ativo_min: 200,
      tempo_sentado_min: 300,
      qtd_desequilibrios: 5,
      qtd_quedas: 1,
      velocidade_marcha_media: 0.78,
    });

    let lastMetrics = null;
    const unsubMetrics = repo.subscribeToDailyMetrics((list) => {
      lastMetrics = list;
    });
    assert.equal(lastMetrics.length, 7);
    assert.equal(lastMetrics[6].data, todayStr);
    assert.equal(lastMetrics[6].qtd_quedas, 1);

    const stats = repo.getCloudOpsStats();
    assert.equal(stats.mode, 'LOCAL_STORAGE');
    assert.equal(stats.reads, 2);
    assert.equal(stats.writes, 4);
    assert.equal(stats.total, 6);

    unsubAlerts();
    unsubMetrics();
    repo.close();
  });

  it('recovers from corrupt JSON, survives QuotaExceededError, and handles BroadcastChannel safely', async () => {
    const storage = createMemoryStorage({
      [ALERTS_STORAGE_KEY]: '{corrupt_json_not_valid',
      [METRICS_STORAGE_KEY]: '{corrupt_json_not_valid',
    });
    const bus = createMockBroadcastBus();

    const tabA = new LocalStorageRepository({
      storage,
      broadcastChannelFactory: bus.factory,
      logger: SILENT_LOGGER,
    });
    const tabB = new LocalStorageRepository({
      storage,
      broadcastChannelFactory: bus.factory,
      logger: SILENT_LOGGER,
    });

    let tabBAlerts = [];
    const unsubB = tabB.subscribeToAlerts((list) => {
      tabBAlerts = list;
    });

    await tabA.saveAlert({ tipo: ALERT_TYPES.QUEDA_CRITICA });
    assert.equal(tabBAlerts.length, 1);
    assert.equal(tabBAlerts[0].tipo, ALERT_TYPES.QUEDA_CRITICA);

    // Inject malformed BroadcastChannel payloads directly into peers
    const peers = bus.channelsByName.get('guardiao_sync_channel');
    for (const peer of peers) {
      peer.onmessage?.({ data: null });
      peer.onmessage?.({ data: 'corrupt-string' });
      peer.onmessage?.({ data: { foreign: true, payload: { bad: 1 } } });
    }
    assert.equal(tabBAlerts.length, 1);

    // Simulate QuotaExceededError on setItem
    const quotaStorage = {
      getItem: (key) => storage.getItem(key),
      setItem: () => {
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      },
    };
    const quotaRepo = new LocalStorageRepository({ storage: quotaStorage, logger: SILENT_LOGGER });
    const savedInMem = await quotaRepo.saveAlert({ tipo: ALERT_TYPES.DESEQUILIBRIO });
    assert.equal(savedInMem.tipo, ALERT_TYPES.DESEQUILIBRIO);

    unsubB();
    tabA.close();
    tabB.close();
    quotaRepo.close();
  });
});

describe('5. FirestoreRepository (Mocked SDK)', () => {
  it('isolates serverTimestamp() strictly to write payloads and sorts/slices snapshots in JS', async () => {
    const mockSdk = createMockFirestoreSdk();
    const repo = new FirestoreRepository({
      firebaseConfig: {
        apiKey: 'AIzaKey',
        authDomain: 'guardiao.firebaseapp.com',
        projectId: 'guardiao-test',
        appId: '1:123:web:abc',
      },
      sdk: mockSdk,
      logger: SILENT_LOGGER,
    });
    assert.ok(repo instanceof AlertRepository);

    let snapshotAlerts = [];
    const unsubAlerts = repo.subscribeToAlerts((list) => {
      snapshotAlerts = list;
    });

    const saved = await repo.saveAlert({
      tipo: ALERT_TYPES.QUEDA_CRITICA,
      angulo_tronco_graus: 14,
      velocidade_vertical: 1.5,
      tempo_imovel_seg: 6,
    });
    assert.ok(saved instanceof MobilityAlert);
    assert.ok(typeof saved.timestamp === 'string');

    // Verify serverTimestamp() sentinel was written to Firestore store
    const storedDoc = mockSdk.store.alertas.get(saved.id);
    assert.ok(storedDoc.timestamp && typeof storedDoc.timestamp.toDate === 'function');

    await repo.updateAlertStatus(saved.id, ALERT_STATUSES.SOCORRIDO);
    assert.equal(snapshotAlerts.length, 1);
    assert.equal(snapshotAlerts[0].status_atendimento, ALERT_STATUSES.SOCORRIDO);

    // Write 8 days of metrics and verify subscription slices to latest 7 ascending
    for (let day = 1; day <= 8; day += 1) {
      await repo.upsertDailyMetrics({
        data: `2026-11-0${day}`,
        tempo_ativo_min: 100 + day,
        tempo_sentado_min: 300,
      });
    }

    let snapshotMetrics = [];
    const unsubMetrics = repo.subscribeToDailyMetrics((list) => {
      snapshotMetrics = list;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(snapshotMetrics.length, 7);
    assert.equal(snapshotMetrics[0].data, '2026-11-02');
    assert.equal(snapshotMetrics[6].data, '2026-11-08');
    assert.ok(snapshotMetrics[0] instanceof DailyMetrics);

    const stats = repo.getCloudOpsStats();
    assert.equal(stats.mode, 'FIRESTORE');
    assert.ok(stats.writes >= 10);
    assert.ok(stats.reads >= 2);
    assert.equal(stats.total, stats.reads + stats.writes);

    unsubAlerts();
    unsubMetrics();
  });
});

describe('6. RepositoryFactory', () => {
  it('selects LocalStorageRepository when config is missing/invalid or Firestore init fails, and FirestoreRepository when valid', async () => {
    const storage = createMemoryStorage();

    const missingRepo = await RepositoryFactory.create({ storage, logger: SILENT_LOGGER });
    assert.ok(missingRepo instanceof LocalStorageRepository);
    missingRepo.close();

    const validConfig = {
      apiKey: 'AIzaValidKey',
      authDomain: 'guardiao.firebaseapp.com',
      projectId: 'guardiao-prod',
      appId: '1:999:web:xyz',
    };
    const mockSdk = createMockFirestoreSdk();
    const cloudRepo = await RepositoryFactory.create({
      firebaseConfig: validConfig,
      firestoreOptions: { sdk: mockSdk },
      logger: SILENT_LOGGER,
    });
    assert.ok(cloudRepo instanceof FirestoreRepository);

    let fallbackReason = null;
    const degradedRepo = await RepositoryFactory.create({
      firebaseConfig: validConfig,
      storage,
      firestoreOptions: {
        sdkLoader: async () => {
          throw new Error('CDN unreachable');
        },
      },
      onFallback: (err) => {
        fallbackReason = err;
      },
      logger: SILENT_LOGGER,
    });
    assert.ok(degradedRepo instanceof LocalStorageRepository);
    assert.match(fallbackReason.message, /CDN unreachable/);
    degradedRepo.close();
  });
});

describe('7. MediaPipePoseAdapter & BiomechanicalScenarioSimulator', () => {
  it('supports GPU->CPU fallback, offline degradation, and monotonic detectPose timestamps', async () => {
    const createCalls = [];
    const detectCalls = [];
    const mockLandmarks = new Array(TOTAL_POSE_LANDMARKS).fill(null).map(() => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 0.95,
    }));

    const cpuFallbackAdapter = new MediaPipePoseAdapter({
      visionLoader: async () => ({
        FilesetResolver: { forVisionTasks: async () => ({ wasm: true }) },
        PoseLandmarker: {
          createFromOptions: async (_fileset, opts) => {
            createCalls.push(opts.baseOptions.delegate);
            if (opts.baseOptions.delegate === 'GPU') {
              throw new Error('WebGL unavailable');
            }
            return {
              detectForVideo: (_video, ts) => {
                detectCalls.push(ts);
                return { landmarks: [mockLandmarks] };
              },
              close: () => {},
            };
          },
        },
      }),
      logger: SILENT_LOGGER,
    });

    const initRes = await cpuFallbackAdapter.initialize();
    assert.equal(initRes.ok, true);
    assert.equal(initRes.delegate, 'CPU');
    assert.deepEqual(createCalls, ['GPU', 'CPU']);

    assert.equal(cpuFallbackAdapter.detectPose({ readyState: 1, videoWidth: 640 }, 100), null);

    const validVideo = { readyState: 2, videoWidth: 640 };
    const f1 = cpuFallbackAdapter.detectPose(validVideo, 100);
    const f2 = cpuFallbackAdapter.detectPose(validVideo, 100); // non-monotonic clamped to 101
    assert.ok(f1 instanceof PoseFrame);
    assert.equal(f1.timestampMs, 100);
    assert.equal(f2.timestampMs, 101);
    assert.deepEqual(detectCalls, [100, 101]);
    cpuFallbackAdapter.close();

    // Offline / CDN blocked degradation
    const offlineAdapter = new MediaPipePoseAdapter({
      visionLoader: async () => {
        throw new Error('Offline CDN failure');
      },
      logger: SILENT_LOGGER,
    });
    const failRes = await offlineAdapter.initialize();
    assert.equal(failRes.ok, false);
    assert.equal(offlineAdapter.isReady, false);
    assert.match(offlineAdapter.lastError.message, /Offline CDN failure/);
  });

  it('drives PoseFrame -> BiomechanicsCalculator -> PostureStateMachine accurately for all 3 scenarios across FPS & sensitivity bounds', () => {
    const fpsIntervals = [16.7, 33.3, 66.7, 100];
    const fallAngleThresholds = [
      BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG + BIOMECHANICS_THRESHOLDS.SENSITIVITY_ANGLE_OFFSET_MIN_DEG,
      BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG,
      BIOMECHANICS_THRESHOLDS.TRUNK_FALL_ANGLE_DEG + BIOMECHANICS_THRESHOLDS.SENSITIVITY_ANGLE_OFFSET_MAX_DEG,
    ];

    for (const dtMs of fpsIntervals) {
      for (const fallAngle of fallAngleThresholds) {
        const normalRun = runSimulatorThroughPipeline(SIMULATION_SCENARIOS.NORMAL, {
          dtMs,
          totalDurationMs: 3000,
          thresholds: { TRUNK_FALL_ANGLE_DEG: fallAngle },
        });
        assert.equal(normalRun.events.length, 0);
        assert.equal(normalRun.finalState, POSTURE_STATES.EM_PE);

        const imbalanceRun = runSimulatorThroughPipeline(SIMULATION_SCENARIOS.DESEQUILIBRIO, {
          dtMs,
          totalDurationMs: 2800,
          thresholds: { TRUNK_FALL_ANGLE_DEG: fallAngle },
        });
        assert.equal(imbalanceRun.events.length, 1);
        assert.equal(imbalanceRun.events[0].tipo, ALERT_TYPES.DESEQUILIBRIO);
        assert.equal(imbalanceRun.finalState, POSTURE_STATES.EM_PE);

        const fallRun = runSimulatorThroughPipeline(SIMULATION_SCENARIOS.QUEDA_CRITICA, {
          dtMs,
          totalDurationMs: 6500,
          thresholds: { TRUNK_FALL_ANGLE_DEG: fallAngle },
        });
        assert.ok(fallRun.statesSeen.includes(POSTURE_STATES.QUEDA_DETECTADA));
        assert.equal(fallRun.finalState, POSTURE_STATES.ALERTA_CRITICO);
        assert.equal(fallRun.events.length, 1);
        assert.equal(fallRun.events[0].tipo, ALERT_TYPES.QUEDA_CRITICA);
        assert.equal(fallRun.events[0].severidade, ALERT_SEVERITIES.CRITICA);
      }
    }
  });
});
