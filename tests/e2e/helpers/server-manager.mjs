import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');

export function getBaseUrlFromEnv() {
  return process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
}

export async function waitForHttpReady(baseUrl, { timeoutMs = 15000, earlyExitCheck } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  const target = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  while (Date.now() < deadline) {
    if (earlyExitCheck) {
      const exitInfo = earlyExitCheck();
      if (exitInfo) {
        throw new Error(
          `Server exited prematurely (code=${exitInfo.code}, signal=${exitInfo.signal}): ${exitInfo.stderr}`,
        );
      }
    }
    try {
      const res = await fetch(target);
      if (res.status >= 200 && res.status < 400) {
        return;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${target} (${lastError?.message || 'unknown'})`);
}

export async function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, host);
  });
}

function terminateChildTree(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.killed) {
      resolve();
      return;
    }

    const done = () => resolve();
    child.once('exit', done);

    try {
      child.kill('SIGTERM');
    } catch {
      // Ignore
    }

    setTimeout(() => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      if (process.platform === 'win32' && child.pid) {
        try {
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
          });
        } catch {
          // Ignore
        }
      } else {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore
        }
      }
      resolve();
    }, 1500);
  });
}

export async function startTargetServer({
  baseUrl,
  port,
  selfTest = false,
  verbose = false,
} = {}) {
  if (baseUrl) {
    const normalized = baseUrl.replace(/\/+$/, '');
    await waitForHttpReady(normalized, { timeoutMs: 10000 });
    return {
      baseUrl: normalized,
      mode: 'external',
      close: async () => {},
    };
  }

  if (selfTest) {
    const { startMockServer } = await import('../fixtures/mock-server.mjs');
    const mock = await startMockServer({ port: port ?? 0 });
    await waitForHttpReady(mock.baseUrl, { timeoutMs: 5000 });
    return {
      baseUrl: mock.baseUrl,
      port: mock.port,
      mode: 'mock',
      close: mock.close,
    };
  }

  const targetPort = port ?? 3000;
  const serverScript = path.join(WORKSPACE_ROOT, 'server.js');
  const child = spawn(process.execPath, [serverScript], {
    cwd: WORKSPACE_ROOT,
    env: { ...process.env, PORT: String(targetPort), GUARDIAO_DISABLE_DOTENV: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  let stdoutBuf = '';
  let exitInfo = null;

  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    stdoutBuf += text;
    if (verbose) process.stdout.write(`[server] ${text}`);
  });
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuf += text;
    if (verbose) process.stderr.write(`[server:err] ${text}`);
  });
  child.on('exit', (code, signal) => {
    exitInfo = { code, signal, stderr: stderrBuf || stdoutBuf };
  });

  const cleanupHooks = [];
  const close = async () => {
    for (const unreg of cleanupHooks) unreg();
    await terminateChildTree(child);
  };

  const onSig = () => {
    terminateChildTree(child).finally(() => process.exit(1));
  };
  process.once('SIGINT', onSig);
  process.once('SIGTERM', onSig);
  cleanupHooks.push(() => {
    process.removeListener('SIGINT', onSig);
    process.removeListener('SIGTERM', onSig);
  });

  const resolvedUrl = `http://127.0.0.1:${targetPort}`;
  try {
    await waitForHttpReady(resolvedUrl, {
      timeoutMs: 15000,
      earlyExitCheck: () => exitInfo,
    });
  } catch (err) {
    await close();
    throw err;
  }

  return {
    baseUrl: resolvedUrl,
    port: targetPort,
    mode: 'real',
    close,
  };
}
