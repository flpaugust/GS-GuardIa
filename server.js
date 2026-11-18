import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 3000;
const MIN_PORT = 0;
const MAX_PORT = 65535;
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_ERROR = 500;
const SHUTDOWN_FORCE_TIMEOUT_MS = 3000;
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);
const INDEX_FILE = 'index.html';
const ENV_ENDPOINT = '/api/env';
const DEFAULT_PATIENT_ID = 'paciente_01';
const DEFAULT_MIME_TYPE = 'application/octet-stream';
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
});

/**
 * Parses a port value honoring `0` (ephemeral port) while defaulting invalid values to 3000.
 * @param {string|number|undefined} rawPort
 * @returns {number}
 */
export function parsePort(rawPort = process.env.PORT) {
  if (rawPort === undefined || rawPort === null) {
    return DEFAULT_PORT;
  }
  const trimmed = String(rawPort).trim();
  if (!trimmed) {
    return DEFAULT_PORT;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    return DEFAULT_PORT;
  }
  return parsed;
}

/**
 * Resolves a request URL safely inside `rootDir`, rejecting traversal, dotfiles,
 * null bytes, malformed escapes, and Windows UNC leading double-slashes with HTTP 403.
 * @param {string} rootDir
 * @param {string} requestUrl
 * @returns {{ ok: true, filePath: string } | { ok: false, statusCode: number, reason: string }}
 */
export function resolveSafePath(rootDir, requestUrl) {
  const resolvedRoot = path.resolve(rootDir);
  const rawPath = typeof requestUrl === 'string' ? requestUrl.split(/[?#]/, 1)[0] : '/';

  if (!rawPath || rawPath.includes('\0') || /%00/i.test(rawPath)) {
    return { ok: false, statusCode: HTTP_FORBIDDEN, reason: 'Null byte rejected' };
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch (error) {
    return { ok: false, statusCode: HTTP_FORBIDDEN, reason: `Malformed URI: ${error.message}` };
  }

  if (decodedPath.includes('\0')) {
    return { ok: false, statusCode: HTTP_FORBIDDEN, reason: 'Decoded null byte rejected' };
  }

  const slashNormalized = decodedPath.replace(/\\/g, '/');
  if (slashNormalized.startsWith('//')) {
    return { ok: false, statusCode: HTTP_FORBIDDEN, reason: 'Leading double-slash rejected' };
  }

  const segments = slashNormalized.split('/').filter((segment) => segment.length > 0);
  const hasForbiddenSegment = segments.some(
    (segment) => segment === '..' || segment.startsWith('.')
  );
  if (hasForbiddenSegment) {
    return { ok: false, statusCode: HTTP_FORBIDDEN, reason: 'Forbidden path segment' };
  }

  const relativePath = slashNormalized.replace(/^\/+/, '') || INDEX_FILE;
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relativeCheck = path.relative(resolvedRoot, resolvedPath);

  if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
    return { ok: false, statusCode: HTTP_FORBIDDEN, reason: 'Path escaped root directory' };
  }

  return { ok: true, filePath: resolvedPath };
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parses `.env` key=value lines without external dependencies.
 * @param {string} rawText
 * @returns {Record<string, string>}
 */
export function parseDotEnv(rawText) {
  const entries = {};
  if (typeof rawText !== 'string' || !rawText) {
    return entries;
  }

  for (const rawLine of rawText.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const line = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    const rawVal = line.slice(eqIndex + 1);
    if (key) {
      entries[key] = stripQuotes(rawVal);
    }
  }
  return entries;
}

/**
 * Loads Firebase and Gemini public client configuration from `.env` (or process.env).
 * Disabled when `GUARDIAO_DISABLE_DOTENV=true` so tests stay isolated from local keys.
 * @param {string} rootDir
 * @returns {Promise<{ firebaseConfig: Record<string, string>|null, geminiApiKey: string, patientId: string }>}
 */
export async function loadDotEnvConfig(rootDir) {
  if (process.env.GUARDIAO_DISABLE_DOTENV === 'true') {
    return { firebaseConfig: null, geminiApiKey: '', patientId: DEFAULT_PATIENT_ID };
  }

  let fileVars = {};
  try {
    const rawEnv = await fs.readFile(path.join(path.resolve(rootDir), '.env'), 'utf8');
    fileVars = parseDotEnv(rawEnv);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const readVar = (name) => {
    const val = fileVars[name] ?? process.env[name] ?? '';
    return typeof val === 'string' ? val.trim() : '';
  };

  const apiKey = readVar('FIREBASE_API_KEY');
  const projectId = readVar('FIREBASE_PROJECT_ID');
  const firebaseConfig =
    apiKey && projectId
      ? {
          apiKey,
          authDomain: readVar('FIREBASE_AUTH_DOMAIN'),
          projectId,
          storageBucket: readVar('FIREBASE_STORAGE_BUCKET'),
          messagingSenderId: readVar('FIREBASE_MESSAGING_SENDER_ID'),
          appId: readVar('FIREBASE_APP_ID'),
          ...(readVar('FIREBASE_MEASUREMENT_ID')
            ? { measurementId: readVar('FIREBASE_MEASUREMENT_ID') }
            : {}),
        }
      : null;

  return {
    firebaseConfig,
    geminiApiKey: readVar('GEMINI_API_KEY'),
    patientId: readVar('PATIENT_ID') || DEFAULT_PATIENT_ID,
  };
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? DEFAULT_MIME_TYPE;
}

function writeResponse(res, statusCode, headers, body = null) {
  res.writeHead(statusCode, headers);
  if (body === null) {
    res.end();
    return;
  }
  res.end(body);
}

function sendErrorResponse(res, statusCode, message, isHead, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
    ...extraHeaders,
  };
  writeResponse(res, statusCode, headers, isHead ? null : message);
}

async function handleStaticRequest(req, res, rootDir, logger) {
  const method = (req.method || 'GET').toUpperCase();
  const isHead = method === 'HEAD';

  if (!ALLOWED_METHODS.has(method)) {
    sendErrorResponse(res, HTTP_METHOD_NOT_ALLOWED, 'Method Not Allowed', false, {
      Allow: 'GET, HEAD',
    });
    return;
  }

  const cleanUrlPath = typeof req.url === 'string' ? req.url.split(/[?#]/, 1)[0] : '/';
  if (cleanUrlPath === ENV_ENDPOINT) {
    try {
      const envPayload = await loadDotEnvConfig(rootDir);
      const serialized = Buffer.from(JSON.stringify(envPayload), 'utf8');
      writeResponse(
        res,
        HTTP_OK,
        {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': serialized.length,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
        isHead ? null : serialized
      );
    } catch (error) {
      logger?.error?.('[server] Failed to load .env configuration:', error);
      sendErrorResponse(res, HTTP_INTERNAL_ERROR, 'Internal Server Error', isHead);
    }
    return;
  }

  const resolved = resolveSafePath(rootDir, req.url || '/');
  if (!resolved.ok) {
    sendErrorResponse(res, resolved.statusCode, 'Forbidden', isHead);
    return;
  }

  try {
    const stats = await fs.stat(resolved.filePath);
    if (!stats.isFile()) {
      sendErrorResponse(res, HTTP_NOT_FOUND, 'Not Found', isHead);
      return;
    }

    const content = isHead ? null : await fs.readFile(resolved.filePath);
    writeResponse(
      res,
      HTTP_OK,
      {
        'Content-Type': getMimeType(resolved.filePath),
        'Content-Length': stats.size,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      },
      content
    );
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      sendErrorResponse(res, HTTP_NOT_FOUND, 'Not Found', isHead);
      return;
    }
    logger?.error?.('[server] Failed to serve static file:', error);
    sendErrorResponse(res, HTTP_INTERNAL_ERROR, 'Internal Server Error', isHead);
  }
}

/**
 * Creates a native Node.js static HTTP server without starting the listener.
 * @param {{ rootDir?: string, logger?: Console }} [options]
 * @returns {http.Server}
 */
export function createStaticServer({ rootDir = MODULE_DIR, logger = console } = {}) {
  const resolvedRoot = path.resolve(rootDir);
  return http.createServer((req, res) => {
    void handleStaticRequest(req, res, resolvedRoot, logger);
  });
}

function attachShutdownHandlers(server, logger) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger?.info?.(`[server] Received ${signal}, closing HTTP server...`);

    const forceTimer = setTimeout(() => {
      server.closeAllConnections?.();
      process.exit(0);
    }, SHUTDOWN_FORCE_TIMEOUT_MS);
    forceTimer.unref();

    server.closeAllConnections?.();
    server.close((error) => {
      clearTimeout(forceTimer);
      if (error) {
        logger?.error?.('[server] Error during shutdown:', error);
        process.exit(1);
        return;
      }
      process.exit(0);
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Starts the GuardIão static HTTP server and optionally attaches SIGINT/SIGTERM cleanup.
 * @param {{ rootDir?: string, port?: number|string, host?: string, logger?: Console, registerSignals?: boolean }} [options]
 * @returns {Promise<{ server: http.Server, port: number, close: () => Promise<void> }>}
 */
export function startServer({
  rootDir = MODULE_DIR,
  port = undefined,
  host = undefined,
  logger = console,
  registerSignals = true,
} = {}) {
  const targetPort = port !== undefined ? parsePort(port) : parsePort(process.env.PORT);
  const server = createStaticServer({ rootDir, logger });

  if (registerSignals) {
    attachShutdownHandlers(server, logger);
  }

  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : targetPort;
      logger?.info?.(`[GuardIão] Static server listening at http://localhost:${boundPort}`);
      resolve({
        server,
        port: boundPort,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.closeAllConnections?.();
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    };

    server.once('error', onError);
    server.once('listening', onListening);
    if (host) {
      server.listen(targetPort, host);
    } else {
      server.listen(targetPort);
    }
  });
}

function isMainModule() {
  if (!process.argv[1]) {
    return false;
  }
  return (
    path.resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
    path.resolve(process.argv[1]).toLowerCase()
  );
}

if (isMainModule()) {
  startServer().catch((error) => {
    console.error('[GuardIão] Failed to start HTTP server:', error);
    process.exit(1);
  });
}
