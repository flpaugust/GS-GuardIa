import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { launchBrowser, openIsolatedPage } from './helpers/playwright-loader.mjs';
import { getBaseUrlFromEnv } from './helpers/server-manager.mjs';
import {
  getControl,
  getAllAlertCards,
  readPostureState,
  readTelemetry,
  readCloudOpsStats,
  readDashboardKpis,
  waitForAppReady,
  sampleCanvasRenderStats,
} from './helpers/locators.mjs';
import { attachPageGuards, blockExternalOrigins, mockGeminiApi } from './helpers/network-guard.mjs';
import { installControlledClock } from './helpers/clock-helpers.mjs';

const BASE_URL = getBaseUrlFromEnv();
const VERBOSE = process.env.E2E_VERBOSE === 'true';

let browser;

before(async () => {
  browser = await launchBrowser({ cameraMode: 'allow' });
});

after(async () => {
  if (browser) await browser.close();
});

async function withPage(fn, { clock = false, beforeGoto, blockCdn = false } = {}) {
  const { context, page } = await openIsolatedPage(browser);
  const guards = attachPageGuards(page, { verbose: VERBOSE });
  if (blockCdn) {
    await blockExternalOrigins(page);
  }
  if (beforeGoto) {
    await beforeGoto(page, context);
  }
  let clockCtrl = null;
  if (clock) {
    clockCtrl = await installControlledClock(page);
  }
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    if (clockCtrl) {
      await clockCtrl.pauseNow();
      await clockCtrl.runFor(200);
    }
    return await fn({ context, page, guards, clockCtrl });
  } finally {
    await context.close();
  }
}

function rawHttpRequest(baseUrlStr, rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrlStr);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: rawPath, method },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ============================================================================
// Server Boundaries (E2E-F1 — 5 tests)
// ============================================================================
test('T2-F1-01: Nonexistent path /nonexistent-file.js returns HTTP 404', async () => {
  const res = await fetch(`${BASE_URL}/nonexistent-file.js`);
  assert.equal(res.status, 404);
});

test('T2-F1-02: Directory traversal attempts (/../package.json and encoded) are blocked with 403 or 404', async () => {
  const r1 = await rawHttpRequest(BASE_URL, '/../package.json');
  const r2 = await rawHttpRequest(BASE_URL, '/..%2f..%2fWindows/win.ini');
  assert.ok([403, 404].includes(r1.status), `Expected 403/404 for traversal, got ${r1.status}`);
  assert.ok([403, 404].includes(r2.status), `Expected 403/404 for encoded traversal, got ${r2.status}`);
});

test('T2-F1-03: Query string /index.html?v=123 resolves cleanly to HTTP 200 text/html', async () => {
  const res = await fetch(`${BASE_URL}/index.html?v=123`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/html/i);
});

test('T2-F1-04: Unknown extension /foo.xyz returns 404 without crashing server', async () => {
  const res = await fetch(`${BASE_URL}/foo.xyz`);
  assert.equal(res.status, 404);
  const health = await fetch(`${BASE_URL}/`);
  assert.equal(health.status, 200);
});

test('T2-F1-05: Unsupported HTTP methods (POST /index.html, DELETE /) return 4xx/501 and server stays healthy', async () => {
  const postRes = await fetch(`${BASE_URL}/index.html`, { method: 'POST', body: '{}' });
  const delRes = await fetch(`${BASE_URL}/`, { method: 'DELETE' });
  assert.ok([400, 404, 405, 501].includes(postRes.status), `Unexpected POST status: ${postRes.status}`);
  assert.ok([400, 404, 405, 501].includes(delRes.status), `Unexpected DELETE status: ${delRes.status}`);
  assert.equal((await fetch(`${BASE_URL}/`)).status, 200);
});

// ============================================================================
// Privacy, Camera & Vision Boundaries (E2E-F3 — 5 tests)
// ============================================================================
test('T2-F3-01: Denied camera permission surfaces friendly inline status and keeps Simulator functional', async () => {
  const denyBrowser = await launchBrowser({ cameraMode: 'deny' });
  const { context, page } = await openIsolatedPage(denyBrowser);
  const guards = attachPageGuards(page, { verbose: VERBOSE });
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    await getControl(page, 'btnStartCamera').click();
    await page.waitForFunction(
      () => /negada|indispon[íi]vel|permiss[ãa]o|simulador/i.test(
        document.querySelector('[data-testid="camera-status-msg"]')?.textContent || '',
      ),
      { timeout: 5000 },
    );
    const statusText = await getControl(page, 'cameraStatusMsg').innerText();
    assert.match(statusText, /negada|indispon[íi]vel|permiss[ãa]o|simulador/i);

    await getControl(page, 'btnSimNormal').click();
    assert.equal(await readPostureState(page), 'EM_PE');
    guards.assertClean();
  } finally {
    await context.close();
    await denyBrowser.close();
  }
});

test('T2-F3-02: Missing navigator.mediaDevices degrades gracefully without throwing uncaught error', async () => {
  await withPage(
    async ({ page, guards }) => {
      await getControl(page, 'btnStartCamera').click();
      const statusText = await getControl(page, 'cameraStatusMsg').innerText();
      assert.match(statusText, /indispon[íi]vel|simulador|c[âa]mera/i);
      guards.assertClean();
    },
    {
      beforeGoto: async (page) => {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
        });
      },
    },
  );
});

test('T2-F3-03: Starting fake/blank camera stream does not produce false-positive critical fall alerts', async () => {
  await withPage(async ({ page, guards, clockCtrl }) => {
    await getControl(page, 'btnStartCamera').click();
    await clockCtrl.runFor(2500);
    assert.equal(await getAllAlertCards(page).count(), 0);
    assert.equal(await readPostureState(page), 'EM_PE');
    guards.assertClean();
  }, { clock: true });
});

test('T2-F3-04: Toggling Privacy Mode 10x rapidly keeps skeleton canvas and telemetry HUD intact', async () => {
  await withPage(async ({ page, guards }) => {
    const toggle = getControl(page, 'privacyToggle');
    for (let i = 0; i < 10; i++) {
      await toggle.click();
    }
    const stats = await sampleCanvasRenderStats(getControl(page, 'monitorCanvas'));
    assert.ok(stats.uniqueColors >= 2);
    const tel = await readTelemetry(page);
    assert.ok(Number.isFinite(tel.trunkAngleDeg));
    guards.assertClean();
  });
});

test('T2-F3-05: Stopping camera or switching to Simulator runs cleanly without errors', async () => {
  await withPage(async ({ page, guards }) => {
    await getControl(page, 'btnStartCamera').click();
    await getControl(page, 'btnStopCamera').click();
    await getControl(page, 'btnSimNormal').click();
    assert.equal(await readPostureState(page), 'EM_PE');
    guards.assertClean();
  });
});

// ============================================================================
// Simulator & State Machine Boundaries (E2E-F4 — 6 tests)
// ============================================================================
test('T2-F4-01: Sustained Postura Normal across 200+ RAF ticks produces zero alerts and zero writes', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      const beforeOps = await readCloudOpsStats(page);
      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runInChunks(4000, 500);
      assert.equal(await readPostureState(page), 'EM_PE');
      assert.equal(await getAllAlertCards(page).count(), 0);
      const afterOps = await readCloudOpsStats(page);
      assert.equal(afterOps.writes, beforeOps.writes);
    },
    { clock: true },
  );
});

test('T2-F4-02: Aborting Queda Crítica at 2.5s (< 5s) via Postura Normal resets timer and emits zero critical alerts', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(2500);
      assert.equal(await readPostureState(page), 'QUEDA_DETECTADA');

      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runFor(3500);
      const tel = await readTelemetry(page);
      assert.equal(tel.state, 'EM_PE');
      assert.equal(tel.immobilitySec, 0);
      assert.equal(await getAllAlertCards(page).count(), 0);
    },
    { clock: true },
  );
});

test('T2-F4-03: Desequilíbrio recovers automatically within < 3000ms without escalating to ALERTA_CRITICO', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimImbalance').click();
      await clockCtrl.runFor(300);
      assert.equal(await readPostureState(page), 'DESEQUILIBRIO');

      await clockCtrl.runFor(2800);
      assert.equal(await readPostureState(page), 'EM_PE');
      const cards = getAllAlertCards(page);
      assert.equal(await cards.count(), 1);
      assert.equal(await cards.first().getAttribute('data-alert-type'), 'DESEQUILIBRIO');
    },
    { clock: true },
  );
});

test('T2-F4-04: Duplicate Queda Crítica within 15s debounce window does not create duplicate alert card', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5400);
      assert.equal(await getAllAlertCards(page).count(), 1);

      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runFor(300);
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5400);
      assert.equal(await getAllAlertCards(page).count(), 1, 'Second fall inside 15s must be debounced');
    },
    { clock: true },
  );
});

test('T2-F4-05: Zero-delta (dt=0) and large background-resume time jump never produce NaN or Infinity in HUD', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      const t0 = await page.evaluate(() => Date.now());
      await clockCtrl.setFixedTime(t0);
      await clockCtrl.runFor(16);
      await clockCtrl.setFixedTime(t0 + 120000);
      await clockCtrl.runFor(200);

      const tel = await readTelemetry(page);
      assert.ok(Number.isFinite(tel.trunkAngleDeg), `NaN/Inf angle: ${tel.angleText}`);
      assert.ok(Number.isFinite(tel.verticalVelocity), `NaN/Inf velocity: ${tel.velText}`);
      assert.ok(Number.isFinite(tel.immobilitySec), `NaN/Inf immobility: ${tel.immobText}`);
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T2-F4-06: Stopping monitoring mid-fall resets loop cleanly with zero uncaught errors', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(1500);
      await getControl(page, 'btnStopCamera').click();
      await clockCtrl.runFor(500);
      assert.equal(await readPostureState(page), 'EM_PE');
      assert.equal(await getAllAlertCards(page).count(), 0);
      guards.assertClean();
    },
    { clock: true },
  );
});

// ============================================================================
// Sensitivity Slider Boundaries (E2E-F5 — 5 tests)
// ============================================================================
test('T2-F5-01: Setting sensitivity slider to exact min boundary updates UI without NaN/error', async () => {
  await withPage(async ({ page, guards }) => {
    const slider = getControl(page, 'sensitivitySlider');
    const min = await slider.getAttribute('min');
    await slider.fill(String(min));
    await slider.dispatchEvent('input');
    const valText = await getControl(page, 'sensitivityValue').innerText();
    assert.ok(valText.includes(String(min)) && !/NaN/i.test(valText));
    guards.assertClean();
  });
});

test('T2-F5-02: Setting sensitivity slider to exact max boundary updates UI without NaN/error', async () => {
  await withPage(async ({ page, guards }) => {
    const slider = getControl(page, 'sensitivitySlider');
    const max = await slider.getAttribute('max');
    await slider.fill(String(max));
    await slider.dispatchEvent('input');
    const valText = await getControl(page, 'sensitivityValue').innerText();
    assert.ok(valText.includes(String(max)) && !/NaN/i.test(valText));
    guards.assertClean();
  });
});

test('T2-F5-03: Out-of-range slider inputs (-999 and 9999) are clamped safely to [min, max]', async () => {
  await withPage(async ({ page, guards }) => {
    const slider = getControl(page, 'sensitivitySlider');
    const min = Number(await slider.getAttribute('min'));
    const max = Number(await slider.getAttribute('max'));

    await slider.evaluate((el) => {
      el.value = '-999';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const lowNum = Number(await slider.inputValue());
    assert.ok(lowNum >= min && lowNum <= max, `Out-of-range low value not clamped: ${lowNum}`);

    await slider.evaluate((el) => {
      el.value = '9999';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const highNum = Number(await slider.inputValue());
    assert.ok(highNum >= min && highNum <= max, `Out-of-range high value not clamped: ${highNum}`);
    guards.assertClean();
  });
});

test('T2-F5-04: Rapidly scrubbing sensitivity slider during active simulation produces zero errors', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await getControl(page, 'btnSimNormal').click();
      const slider = getControl(page, 'sensitivitySlider');
      for (const v of ['20', '35', '50', '25', '45']) {
        await slider.fill(v);
        await slider.dispatchEvent('input');
        await clockCtrl.runFor(60);
      }
      assert.equal(await readPostureState(page), 'EM_PE');
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T2-F5-05: Returning sensitivity slider to default keeps Postura Normal stable in EM_PE', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      const slider = getControl(page, 'sensitivitySlider');
      await slider.fill('20');
      await slider.dispatchEvent('input');
      await slider.fill('35');
      await slider.dispatchEvent('input');
      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runFor(500);
      assert.equal(await readPostureState(page), 'EM_PE');
    },
    { clock: true },
  );
});

// ============================================================================
// Alert Feed & AI Fallback Boundaries (E2E-F7 — 5 tests)
// ============================================================================
test('T2-F7-01: Missing geminiApiKey immediately emits FALLBACK_LOCAL clinical triage report', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      assert.match(await getControl(page, 'alertAiSource').innerText(), /FALLBACK_LOCAL/i);
      const report = (await getControl(page, 'alertTriageReport').innerText()).trim();
      assert.ok(report.length >= 20);
    },
    { clock: true },
  );
});

test('T2-F7-02: Configured geminiApiKey with HTTP 500 response falls back immediately to FALLBACK_LOCAL', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await mockGeminiApi(page, 'error500');
      await getControl(page, 'btnOpenConfig').click();
      await getControl(page, 'inputGeminiApiKey').fill('dummy-key-for-500');
      await getControl(page, 'btnSaveConfig').click();

      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5600);
      assert.match(await getControl(page, 'alertAiSource').innerText(), /FALLBACK_LOCAL/i);
      assert.ok((await getControl(page, 'alertTriageReport').innerText()).trim().length >= 20);
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T2-F7-03: Configured geminiApiKey with network abort falls back cleanly without unhandled rejection', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await mockGeminiApi(page, 'abort');
      await getControl(page, 'btnOpenConfig').click();
      await getControl(page, 'inputGeminiApiKey').fill('dummy-key-for-abort');
      await getControl(page, 'btnSaveConfig').click();

      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5600);
      assert.match(await getControl(page, 'alertAiSource').innerText(), /FALLBACK_LOCAL/i);
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T2-F7-04: Double-clicking Confirmar Socorro is idempotent and does not corrupt status or Cloud Ops', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);

      const btn = getControl(page, 'btnConfirmRescue');
      await btn.click();
      const writesAfterFirst = (await readCloudOpsStats(page)).writes;
      await btn.click({ force: true });
      await clockCtrl.runFor(200);

      assert.equal(await getAllAlertCards(page).first().getAttribute('data-alert-status'), 'SOCORRIDO');
      assert.equal((await readCloudOpsStats(page)).writes, writesAfterFirst);
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T2-F7-05: Emergency Web Audio alarm does not throw uncaught pageerror when triggered without prior media unlock', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      assert.equal(await getControl(page, 'emergencyBanner').isVisible(), true);
      guards.assertClean();
    },
    { clock: true },
  );
});

// ============================================================================
// Charts & CDN Offline Boundaries (E2E-F8 / E2E-F6 — 5 tests)
// ============================================================================
test('T2-F8-01: Blocking all external CDNs allows full app boot and rendering with zero fatal errors', async () => {
  await withPage(
    async ({ page, guards }) => {
      assert.equal(await getControl(page, 'chartWeeklyMobility').isVisible(), true);
      assert.equal(await getControl(page, 'chartHourlyVulnerability').isVisible(), true);
      guards.assertClean();
    },
    { blockCdn: true },
  );
});

test('T2-F8-02: Empty alerts list displays empty feed cleanly without breaking Hourly Vulnerability chart', async () => {
  await withPage(async ({ page, guards }) => {
    assert.equal(await getAllAlertCards(page).count(), 0);
    const stats = await sampleCanvasRenderStats(getControl(page, 'chartHourlyVulnerability'));
    assert.ok(stats.width > 100 && stats.height > 80);
    guards.assertClean();
  });
});

test('T2-F8-03: High-volume 25-alert history renders cleanly without layout breakage or crash', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      await clockCtrl.resume();

      const expanded = await page.evaluate(() => {
        for (const k of Object.keys(localStorage)) {
          try {
            const parsed = JSON.parse(localStorage.getItem(k));
            if (Array.isArray(parsed) && parsed.length === 1 && parsed[0].tipo === 'QUEDA_CRITICA') {
              const template = parsed[0];
              const list = [];
              for (let i = 0; i < 25; i++) {
                list.push({
                  ...template,
                  id: `bulk_alert_${i}`,
                  timestamp: new Date(Date.now() - i * 3600000).toISOString(),
                  status_atendimento: i === 0 ? 'PENDENTE' : 'SOCORRIDO',
                });
              }
              localStorage.setItem(k, JSON.stringify(list));
              return true;
            }
          } catch {
            // continue
          }
        }
        return false;
      });
      assert.equal(expanded, true, 'Could not locate persisted alert array in LocalStorage');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      assert.equal(await getAllAlertCards(page).count(), 25);
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T2-F8-04: Viewport resize (1280x800 -> 768x1024 -> 1440x900) preserves visible charts without errors', async () => {
  await withPage(async ({ page, guards }) => {
    for (const vp of [
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(100);
      assert.equal(await getControl(page, 'chartWeeklyMobility').isVisible(), true);
      assert.equal(await getControl(page, 'chartHourlyVulnerability').isVisible(), true);
    }
    guards.assertClean();
  });
});

test('T2-F8-05: Zero active+sitting minutes edge metric yields valid [0, 100] Risk Score (never NaN)', async () => {
  await withPage(async ({ page, guards }) => {
    const updated = await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        try {
          const parsed = JSON.parse(localStorage.getItem(k));
          if (Array.isArray(parsed) && parsed.length > 0 && 'tempo_ativo_min' in parsed[0]) {
            const zeroed = parsed.map((m) => ({
              ...m,
              tempo_ativo_min: 0,
              tempo_sentado_min: 0,
              qtd_desequilibrios: 0,
              qtd_quedas: 0,
              velocidade_marcha_media: 0,
            }));
            localStorage.setItem(k, JSON.stringify(zeroed));
            return true;
          }
        } catch {
          // continue
        }
      }
      return false;
    });
    assert.equal(updated, true, 'Could not locate metrics array in LocalStorage');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    const kpis = await readDashboardKpis(page);
    assert.ok(Number.isInteger(kpis.riskScore) && kpis.riskScore >= 0 && kpis.riskScore <= 100);
    guards.assertClean();
  });
});

// ============================================================================
// LocalStorage & Sync Boundaries (E2E-F9 — 5 tests)
// ============================================================================
test('T2-F9-01: Clearing localStorage completely auto-recovers 7-day seeded metrics on reload', async () => {
  await withPage(async ({ page, guards }) => {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    const kpis = await readDashboardKpis(page);
    assert.ok(Number.isInteger(kpis.riskScore) && kpis.riskScore >= 0 && kpis.riskScore <= 100);
    guards.assertClean();
  });
});

test('T2-F9-02: Corrupted JSON across LocalStorage keys recovers gracefully on reload without blank screen', async () => {
  await withPage(async ({ page, guards }) => {
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        localStorage.setItem(k, '{corrupt_json_not_valid');
      }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    const kpis = await readDashboardKpis(page);
    assert.ok(Number.isInteger(kpis.riskScore) && kpis.riskScore >= 0 && kpis.riskScore <= 100);
    guards.assertClean();
  });
});

test('T2-F9-03: QuotaExceededError thrown by localStorage.setItem is caught without freezing simulation loop', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await page.evaluate(() => {
        Storage.prototype.setItem = () => {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        };
      });
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      assert.equal(await readPostureState(page), 'ALERTA_CRITICO');
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T2-F9-04: Malformed or foreign payload posted to BroadcastChannel is ignored safely', async () => {
  await withPage(
    async ({ page, guards }) => {
      await page.evaluate(() => {
        const names = [...(window.__observedBcNames || [])];
        for (const chName of names) {
          const ch = new BroadcastChannel(chName);
          ch.postMessage(null);
          ch.postMessage('corrupt-string');
          ch.postMessage({ foreign: true, payload: { bad: 1 } });
          ch.close();
        }
      });
      await page.waitForTimeout(150);
      assert.equal(await getControl(page, 'panelDashboard').isVisible(), true);
      guards.assertClean();
    },
    {
      beforeGoto: async (page) => {
        await page.addInitScript(() => {
          const NativeBC = window.BroadcastChannel;
          window.__observedBcNames = [];
          if (NativeBC) {
            window.BroadcastChannel = class extends NativeBC {
              constructor(name) {
                super(name);
                window.__observedBcNames.push(name);
              }
            };
          }
        });
      },
    },
  );
});

test('T2-F9-05: Rapid sequential writes preserve valid JSON across all LocalStorage entries', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimImbalance').click();
      await clockCtrl.runFor(1600);
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5400);
      await getControl(page, 'btnConfirmRescue').click();
      await clockCtrl.runFor(200);

      const allValid = await page.evaluate(() => {
        for (const k of Object.keys(localStorage)) {
          JSON.parse(localStorage.getItem(k));
        }
        return true;
      });
      assert.equal(allValid, true);
    },
    { clock: true },
  );
});

// ============================================================================
// Quick Config Modal Boundaries (E2E-F10 — 5 tests)
// ============================================================================
test('T2-F10-01: Submitting empty Quick Config Modal keeps Modo Fallback Local without error', async () => {
  await withPage(async ({ page, guards }) => {
    await getControl(page, 'btnOpenConfig').click();
    await getControl(page, 'inputFirebaseConfig').fill('');
    await getControl(page, 'inputGeminiApiKey').fill('');
    await getControl(page, 'btnSaveConfig').click();
    assert.equal(await getControl(page, 'configModal').isVisible(), false);
    assert.match(await getControl(page, 'connectionBadge').innerText(), /Modo Fallback Local/i);
    guards.assertClean();
  });
});

test('T2-F10-02: Entering malformed JSON in Firebase Config shows validation error and keeps modal open', async () => {
  await withPage(async ({ page, guards }) => {
    await getControl(page, 'btnOpenConfig').click();
    await getControl(page, 'inputFirebaseConfig').fill('{ invalid json');
    await getControl(page, 'btnSaveConfig').click();

    assert.equal(await getControl(page, 'configModal').isVisible(), true);
    assert.equal(await getControl(page, 'configValidationError').isVisible(), true);
    assert.match(await getControl(page, 'connectionBadge').innerText(), /Modo Fallback Local/i);
    guards.assertClean();
  });
});

test('T2-F10-03: Entering Firebase JSON missing apiKey/projectId shows validation error or stays fallback', async () => {
  await withPage(async ({ page, guards }) => {
    await getControl(page, 'btnOpenConfig').click();
    await getControl(page, 'inputFirebaseConfig').fill(JSON.stringify({ foo: 'bar' }));
    await getControl(page, 'btnSaveConfig').click();
    const errVisible = await getControl(page, 'configValidationError').isVisible();
    const badgeText = await getControl(page, 'connectionBadge').innerText();
    assert.ok(errVisible || /Modo Fallback Local/i.test(badgeText));
    guards.assertClean();
  });
});

test('T2-F10-04: Saving Gemini API Key alone without Firebase keeps Modo Fallback Local', async () => {
  await withPage(async ({ page }) => {
    await getControl(page, 'btnOpenConfig').click();
    await getControl(page, 'inputFirebaseConfig').fill('');
    await getControl(page, 'inputGeminiApiKey').fill('only-gemini-key');
    await getControl(page, 'btnSaveConfig').click();
    assert.equal(await getControl(page, 'configModal').isVisible(), false);
    assert.match(await getControl(page, 'connectionBadge').innerText(), /Modo Fallback Local/i);
  });
});

test('T2-F10-05: Closing modal via Fechar discards unsaved edits', async () => {
  await withPage(async ({ page }) => {
    await getControl(page, 'btnOpenConfig').click();
    await getControl(page, 'inputGeminiApiKey').fill('unsaved-temp-key');
    await getControl(page, 'btnCloseConfig').click();
    assert.equal(await getControl(page, 'configModal').isVisible(), false);

    await getControl(page, 'btnOpenConfig').click();
    assert.equal(await getControl(page, 'inputGeminiApiKey').inputValue(), '');
  });
});
