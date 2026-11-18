import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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
import { attachPageGuards, attachLgpdAuditor } from './helpers/network-guard.mjs';
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

async function withPage(fn, { clock = false, viewport } = {}) {
  const { context, page } = await openIsolatedPage(browser, { viewport });
  const guards = attachPageGuards(page, { verbose: VERBOSE });
  const lgpd = attachLgpdAuditor(page);
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
    return await fn({ context, page, guards, lgpd, clockCtrl });
  } finally {
    await context.close();
  }
}

// ============================================================================
// E2E-F1: HTTP Server (5 tests)
// ============================================================================
test('T1-F1-01: GET / returns HTTP 200 with text/html GuardIão document', async () => {
  const res = await fetch(`${BASE_URL}/`);
  assert.equal(res.status, 200);
  const ct = res.headers.get('content-type') || '';
  assert.match(ct, /text\/html/i);
  const body = await res.text();
  assert.match(body, /GuardI[aã]o/i);
});

test('T1-F1-02: GET /styles.css returns HTTP 200 with text/css', async () => {
  const res = await fetch(`${BASE_URL}/styles.css`);
  assert.equal(res.status, 200);
  const ct = res.headers.get('content-type') || '';
  assert.match(ct, /text\/css/i);
  const body = await res.text();
  assert.ok(body.trim().length > 20, 'styles.css should not be empty');
});

test('T1-F1-03: GET /src/main.js and /src/config/thresholds.js return HTTP 200 JavaScript MIME', async () => {
  for (const assetPath of ['/src/main.js', '/src/config/thresholds.js']) {
    const res = await fetch(`${BASE_URL}${assetPath}`);
    assert.equal(res.status, 200, `${assetPath} should return 200`);
    const ct = res.headers.get('content-type') || '';
    assert.match(ct, /(application|text)\/javascript/i, `${assetPath} MIME mismatch: ${ct}`);
    const body = await res.text();
    assert.ok(body.trim().length > 10);
  }
});

test('T1-F1-04: GET /package.json returns HTTP 200 valid JSON with application/json MIME', async () => {
  const res = await fetch(`${BASE_URL}/package.json`);
  assert.equal(res.status, 200);
  const ct = res.headers.get('content-type') || '';
  assert.match(ct, /application\/json/i);
  const parsed = await res.json();
  assert.equal(parsed.type, 'module');
});

test('T1-F1-05: Served HTML and config JS files contain zero hardcoded API secrets', async () => {
  const paths = ['/', '/src/config/env.js', '/src/config/env.example.js', '/src/config/thresholds.js'];
  for (const p of paths) {
    const res = await fetch(`${BASE_URL}${p}`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.doesNotMatch(body, /AIza[0-9A-Za-z_-]{20,}/, `Hardcoded Google API key found in ${p}`);
    assert.doesNotMatch(body, /BEGIN PRIVATE KEY/, `Private key found in ${p}`);
    assert.doesNotMatch(body, /apiKey\s*:\s*["'][A-Za-z0-9_-]{12,}["']/, `Hardcoded apiKey literal in ${p}`);
  }
});

// ============================================================================
// E2E-F2: Dual-Panel UI & Layout (5 tests)
// ============================================================================
test('T1-F2-01: App boots with zero uncaught pageerror exceptions and zero local 4xx/5xx responses', async () => {
  await withPage(async ({ guards }) => {
    guards.assertClean();
  });
});

test('T1-F2-02: Dual panels (Estação Edge and Dashboard Preventivo) render side-by-side at 1280x800', async () => {
  await withPage(async ({ page, guards }) => {
    const monitorBox = await getControl(page, 'panelMonitor').boundingBox();
    const dashBox = await getControl(page, 'panelDashboard').boundingBox();
    assert.ok(monitorBox && monitorBox.width > 300, 'panel-monitor boundingBox invalid');
    assert.ok(dashBox && dashBox.width > 300, 'panel-dashboard boundingBox invalid');
    assert.ok(
      dashBox.x >= monitorBox.x + monitorBox.width - 20 || Math.abs(dashBox.y - monitorBox.y) < 40,
      `Expected side-by-side layout on 1280px desktop; got monitor=${JSON.stringify(monitorBox)}, dash=${JSON.stringify(dashBox)}`,
    );
    guards.assertClean();
  });
});

test('T1-F2-03: Dark assistive theme renders dark background with legible light text', async () => {
  await withPage(async ({ page }) => {
    const theme = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      const parseRgb = (str) => (str.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
      const bg = parseRgb(style.backgroundColor);
      const fg = parseRgb(style.color);
      const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      return { bgLum: lum(bg), fgLum: lum(fg) };
    });
    assert.ok(theme.bgLum < 80, `Expected dark background luminance < 80, got ${theme.bgLum}`);
    assert.ok(theme.fgLum > 140, `Expected light foreground luminance > 140, got ${theme.fgLum}`);
  });
});

test('T1-F2-04: Connection mode badge renders Modo Fallback Local on fresh boot', async () => {
  await withPage(async ({ page }) => {
    const badge = getControl(page, 'connectionBadge');
    const text = (await badge.innerText()).trim();
    assert.match(text, /Modo Fallback Local/i);
  });
});

test('T1-F2-05: Responsive mobile viewport (390x844) stacks without horizontal overflow', async () => {
  await withPage(
    async ({ page, guards }) => {
      const overflow = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      assert.ok(
        overflow.scrollW <= overflow.clientW + 2,
        `Horizontal overflow at 390px: scrollWidth=${overflow.scrollW}, clientWidth=${overflow.clientW}`,
      );
      await getControl(page, 'panelMonitor').isVisible();
      await getControl(page, 'panelDashboard').isVisible();
      guards.assertClean();
    },
    { viewport: { width: 390, height: 844 } },
  );
});

// ============================================================================
// E2E-F3: LGPD Privacy Mode & Skeleton Canvas (5 tests)
// ============================================================================
test('T1-F3-01: Skeleton canvas renders with positive dimensions (>= 300x200)', async () => {
  await withPage(async ({ page }) => {
    const canvas = getControl(page, 'monitorCanvas');
    assert.equal(await canvas.isVisible(), true);
    const stats = await sampleCanvasRenderStats(canvas);
    assert.ok(stats.width >= 300 && stats.height >= 200, `Canvas too small: ${JSON.stringify(stats)}`);
    assert.ok(stats.uniqueColors >= 2, 'Skeleton canvas appears blank');
  });
});

test('T1-F3-02: Privacy Mode toggle is interactive and switches checked state', async () => {
  await withPage(async ({ page }) => {
    const toggle = getControl(page, 'privacyToggle');
    const initial = await toggle.isChecked();
    await toggle.click();
    assert.equal(await toggle.isChecked(), !initial);
    await toggle.click();
    assert.equal(await toggle.isChecked(), initial);
  });
});

test('T1-F3-03: Privacy Mode hides raw video element while keeping skeleton canvas visible and drawn', async () => {
  await withPage(async ({ page }) => {
    const toggle = getControl(page, 'privacyToggle');
    if (!(await toggle.isChecked())) {
      await toggle.click();
    }
    const video = getControl(page, 'monitorVideo');
    const videoHidden = await video.evaluate((el) => {
      const cs = getComputedStyle(el);
      return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
    });
    assert.equal(videoHidden, true, 'Raw <video> must be visually hidden/masked in LGPD Privacy Mode');

    const canvas = getControl(page, 'monitorCanvas');
    assert.equal(await canvas.isVisible(), true);
    const stats = await sampleCanvasRenderStats(canvas);
    assert.ok(stats.uniqueColors >= 2, 'Skeleton canvas must continue rendering in Privacy Mode');
  });
});

test('T1-F3-04: Telemetry HUD displays EM_PE initially and finite numeric angle, velocity, and immobility', async () => {
  await withPage(async ({ page }) => {
    const tel = await readTelemetry(page);
    assert.equal(tel.state, 'EM_PE');
    assert.ok(Number.isFinite(tel.trunkAngleDeg), `Invalid trunk angle: ${tel.angleText}`);
    assert.ok(Number.isFinite(tel.verticalVelocity), `Invalid velocity: ${tel.velText}`);
    assert.ok(Number.isFinite(tel.immobilitySec) && tel.immobilitySec >= 0, `Invalid immobility: ${tel.immobText}`);
  });
});

test('T1-F3-05: LGPD network audit confirms zero raw video/image frames transmitted during monitoring', async () => {
  await withPage(
    async ({ page, lgpd, clockCtrl }) => {
      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runFor(1000);
      await getControl(page, 'btnSimImbalance').click();
      await clockCtrl.runFor(1000);
      lgpd.assertNoRawMediaSent();
    },
    { clock: true },
  );
});

// ============================================================================
// E2E-F4: Biomechanical Simulator (5 tests)
// ============================================================================
test('T1-F4-01: All 3 simulator buttons (Postura Normal, Desequilíbrio, Queda Crítica) are visible and enabled', async () => {
  await withPage(async ({ page }) => {
    for (const key of ['btnSimNormal', 'btnSimImbalance', 'btnSimFall']) {
      const btn = getControl(page, key);
      assert.equal(await btn.isVisible(), true, `${key} should be visible`);
      assert.equal(await btn.isEnabled(), true, `${key} should be enabled`);
    }
  });
});

test('T1-F4-02: Postura Normal maintains EM_PE with upright trunk angle and zero alerts', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runFor(1500);
      const tel = await readTelemetry(page);
      assert.equal(tel.state, 'EM_PE');
      assert.ok(tel.trunkAngleDeg >= 65 && tel.trunkAngleDeg <= 90, `Unexpected upright angle: ${tel.trunkAngleDeg}`);
      assert.equal(await getAllAlertCards(page).count(), 0);
    },
    { clock: true },
  );
});

test('T1-F4-03: Desequilíbrio transitions to DESEQUILIBRIO and emits imbalance alert without ALERTA_CRITICO', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimImbalance').click();
      await clockCtrl.runFor(300);
      assert.equal(await readPostureState(page), 'DESEQUILIBRIO');

      await clockCtrl.runFor(2000);
      assert.equal(await readPostureState(page), 'EM_PE');
      const count = await getAllAlertCards(page).count();
      assert.ok(count >= 1, 'Expected DESEQUILIBRIO alert card');
      const firstType = await getAllAlertCards(page).first().getAttribute('data-alert-type');
      assert.equal(firstType, 'DESEQUILIBRIO');
    },
    { clock: true },
  );
});

test('T1-F4-04: Queda Crítica transitions QUEDA_DETECTADA -> >=5s immobility -> ALERTA_CRITICO', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(400);
      assert.equal(await readPostureState(page), 'QUEDA_DETECTADA');

      await clockCtrl.runFor(5200);
      const tel = await readTelemetry(page);
      assert.equal(tel.state, 'ALERTA_CRITICO');
      assert.ok(tel.immobilitySec >= 5.0, `Expected >= 5.0s immobility, got ${tel.immobilitySec}`);
    },
    { clock: true },
  );
});

test('T1-F4-05: Switching back to Postura Normal after fall restores EM_PE state', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5400);
      assert.equal(await readPostureState(page), 'ALERTA_CRITICO');

      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runFor(300);
      assert.equal(await readPostureState(page), 'EM_PE');
    },
    { clock: true },
  );
});

// ============================================================================
// E2E-F5: Sensitivity Slider (5 tests)
// ============================================================================
test('T1-F5-01: Sensitivity slider is visible, enabled, and has valid min < max', async () => {
  await withPage(async ({ page }) => {
    const slider = getControl(page, 'sensitivitySlider');
    assert.equal(await slider.isVisible(), true);
    assert.equal(await slider.isEnabled(), true);
    const min = Number(await slider.getAttribute('min'));
    const max = Number(await slider.getAttribute('max'));
    assert.ok(Number.isFinite(min) && Number.isFinite(max) && min < max);
  });
});

test('T1-F5-02: Changing sensitivity slider updates displayed sensitivity value immediately', async () => {
  await withPage(async ({ page }) => {
    const slider = getControl(page, 'sensitivitySlider');
    await slider.fill('25');
    await slider.dispatchEvent('input');
    const txt = await getControl(page, 'sensitivityValue').innerText();
    assert.match(txt, /25/);
  });
});

test('T1-F5-03: Sensitivity slider supports keyboard ArrowRight / ArrowLeft interaction', async () => {
  await withPage(async ({ page }) => {
    const slider = getControl(page, 'sensitivitySlider');
    const beforeVal = Number(await slider.inputValue());
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    const afterRight = Number(await slider.inputValue());
    assert.ok(afterRight > beforeVal, `Expected ArrowRight to increase ${beforeVal}, got ${afterRight}`);
    await page.keyboard.press('ArrowLeft');
    const afterLeft = Number(await slider.inputValue());
    assert.equal(afterLeft, beforeVal);
  });
});

test('T1-F5-04: Adjusting sensitivity during active simulation does not interrupt RAF or cause errors', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runFor(300);
      const slider = getControl(page, 'sensitivitySlider');
      await slider.fill('40');
      await slider.dispatchEvent('input');
      await clockCtrl.runFor(500);
      assert.equal(await readPostureState(page), 'EM_PE');
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T1-F5-05: Strict low fall-angle threshold prevents fall escalation across subsequent simulator run', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      const slider = getControl(page, 'sensitivitySlider');
      const minVal = await slider.getAttribute('min');
      await slider.fill(String(minVal));
      await slider.dispatchEvent('input');
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      const state = await readPostureState(page);
      assert.notEqual(state, 'ALERTA_CRITICO', 'Strict minimum fall angle threshold should prevent ALERTA_CRITICO');
    },
    { clock: true },
  );
});

// ============================================================================
// E2E-F6: Dashboard 4 KPIs (5 tests)
// ============================================================================
test('T1-F6-01: All 4 Dashboard KPIs are visible on initial load', async () => {
  await withPage(async ({ page }) => {
    for (const key of ['kpiSlaStatus', 'kpiRiskScore', 'kpiWeeklyImbalances', 'kpiCloudOps']) {
      assert.equal(await getControl(page, key).isVisible(), true, `${key} should be visible`);
    }
  });
});

test('T1-F6-02: Preventive Risk Score displays valid integer in [0, 100] from 7-day seed', async () => {
  await withPage(async ({ page }) => {
    const kpis = await readDashboardKpis(page);
    assert.ok(Number.isInteger(kpis.riskScore), `Risk score not integer: ${kpis.riskScore}`);
    assert.ok(kpis.riskScore >= 0 && kpis.riskScore <= 100, `Out of range: ${kpis.riskScore}`);
  });
});

test('T1-F6-03: Weekly Imbalances displays non-negative seed and increments after Desequilíbrio', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      const before = (await readDashboardKpis(page)).weeklyImbalances;
      assert.ok(Number.isInteger(before) && before >= 0);
      await getControl(page, 'btnSimImbalance').click();
      await clockCtrl.runFor(500);
      const after = (await readDashboardKpis(page)).weeklyImbalances;
      assert.equal(after, before + 1);
    },
    { clock: true },
  );
});

test('T1-F6-04: Session Cloud Ops increments writes when alert persists', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      const before = await readCloudOpsStats(page);
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      const after = await readCloudOpsStats(page);
      assert.ok(after.writes > before.writes, `Expected writes to increment: ${before.writes} -> ${after.writes}`);
      assert.ok(after.total >= after.reads + after.writes);
    },
    { clock: true },
  );
});

test('T1-F6-05: SLA / Status KPI reflects emergency on critical alert and updates on resolution', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      const emergencyText = await getControl(page, 'kpiSlaStatus').innerText();
      assert.match(emergencyText, /EMERG[ÊE]NCIA|CR[ÍI]TIC|PENDENTE/i);

      await getControl(page, 'btnConfirmRescue').click();
      await clockCtrl.runFor(200);
      const resolvedText = await getControl(page, 'kpiSlaStatus').innerText();
      assert.doesNotMatch(resolvedText, /EMERG[ÊE]NCIA PENDENTE/i);
    },
    { clock: true },
  );
});

// ============================================================================
// E2E-F7: Alert Feed, AI/Fallback Report & Triage Actions (5 tests)
// ============================================================================
test('T1-F7-01: Critical fall appends new alert card at top of feed (newest-first)', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimImbalance').click();
      await clockCtrl.runFor(2000);
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);

      const cards = getAllAlertCards(page);
      assert.equal(await cards.count(), 2);
      assert.equal(await cards.nth(0).getAttribute('data-alert-type'), 'QUEDA_CRITICA');
      assert.equal(await cards.nth(1).getAttribute('data-alert-type'), 'DESEQUILIBRIO');
    },
    { clock: true },
  );
});

test('T1-F7-02: Alert card renders non-empty Portuguese clinical triage report', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      const reportText = (await getControl(page, 'alertTriageReport').innerText()).trim();
      assert.ok(reportText.length >= 20, `Triage report too short: "${reportText}"`);
    },
    { clock: true },
  );
});

test('T1-F7-03: Alert card shows FALLBACK_LOCAL source and triggers visible emergency banner', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      const sourceText = await getControl(page, 'alertAiSource').innerText();
      assert.match(sourceText, /FALLBACK_LOCAL/i);
      assert.equal(await getControl(page, 'emergencyBanner').isVisible(), true);
    },
    { clock: true },
  );
});

test('T1-F7-04: Clicking Confirmar Socorro updates alert status to SOCORRIDO', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      await getControl(page, 'btnConfirmRescue').click();
      await clockCtrl.runFor(200);
      const card = getAllAlertCards(page).first();
      assert.equal(await card.getAttribute('data-alert-status'), 'SOCORRIDO');
    },
    { clock: true },
  );
});

test('T1-F7-05: Clicking Falso Positivo updates alert status to FALSO_POSITIVO and clears emergency banner', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      await getControl(page, 'btnFalsePositive').click();
      await clockCtrl.runFor(200);
      const card = getAllAlertCards(page).first();
      assert.equal(await card.getAttribute('data-alert-status'), 'FALSO_POSITIVO');
      assert.equal(await getControl(page, 'emergencyBanner').isVisible(), false);
    },
    { clock: true },
  );
});

// ============================================================================
// E2E-F8: 2 Interactive Chart.js Charts (5 tests)
// ============================================================================
test('T1-F8-01: Both Chart.js canvases render with positive bounding box dimensions', async () => {
  await withPage(async ({ page }) => {
    for (const key of ['chartWeeklyMobility', 'chartHourlyVulnerability']) {
      const canvas = getControl(page, key);
      assert.equal(await canvas.isVisible(), true);
      const box = await canvas.boundingBox();
      assert.ok(box && box.width > 150 && box.height > 80, `${key} box invalid: ${JSON.stringify(box)}`);
    }
  });
});

test('T1-F8-02: Weekly Mobility vs. Risk Score chart renders non-blank graphical data', async () => {
  await withPage(async ({ page }) => {
    const stats = await sampleCanvasRenderStats(getControl(page, 'chartWeeklyMobility'));
    assert.ok(stats.uniqueColors >= 2, 'Weekly chart canvas appears blank');
  });
});

test('T1-F8-03: Hourly Vulnerability chart renders non-blank graphical data', async () => {
  await withPage(async ({ page }) => {
    const stats = await sampleCanvasRenderStats(getControl(page, 'chartHourlyVulnerability'));
    assert.ok(stats.uniqueColors >= 2, 'Hourly chart canvas appears blank');
  });
});

test('T1-F8-04: Triggering Desequilíbrio dynamically updates dashboard without page reload', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      const beforeKpis = await readDashboardKpis(page);
      await getControl(page, 'btnSimImbalance').click();
      await clockCtrl.runFor(500);
      const afterKpis = await readDashboardKpis(page);
      assert.equal(afterKpis.weeklyImbalances, beforeKpis.weeklyImbalances + 1);
      const stats = await sampleCanvasRenderStats(getControl(page, 'chartHourlyVulnerability'));
      assert.ok(stats.uniqueColors >= 2);
    },
    { clock: true },
  );
});

test('T1-F8-05: Hovering mouse over chart canvases triggers interaction without uncaught errors', async () => {
  await withPage(async ({ page, guards }) => {
    for (const key of ['chartWeeklyMobility', 'chartHourlyVulnerability']) {
      const box = await getControl(page, key).boundingBox();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    }
    guards.assertClean();
  });
});

// ============================================================================
// E2E-F9: LocalStorage 7-Day Seed & BroadcastChannel Sync (5 tests)
// ============================================================================
test('T1-F9-01: Fresh browser context auto-populates 7-day baseline history in LocalStorage', async () => {
  await withPage(async ({ page }) => {
    const storageInfo = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      let hasSevenDaySeries = false;
      for (const k of keys) {
        try {
          const parsed = JSON.parse(localStorage.getItem(k));
          if (Array.isArray(parsed) && parsed.length === 7) hasSevenDaySeries = true;
        } catch {
          // ignore
        }
      }
      return { keyCount: keys.length, hasSevenDaySeries };
    });
    assert.ok(storageInfo.keyCount >= 1, 'Expected LocalStorage keys to be populated');
    assert.equal(storageInfo.hasSevenDaySeries, true, 'Expected 7-day seeded array in LocalStorage');
  });
});

test('T1-F9-02: Persisted alerts survive full page.reload()', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      const idBefore = await getAllAlertCards(page).first().getAttribute('data-alert-id');

      await clockCtrl.resume();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      assert.equal(await getAllAlertCards(page).count(), 1);
      assert.equal(await getAllAlertCards(page).first().getAttribute('data-alert-id'), idBefore);
    },
    { clock: true },
  );
});

test('T1-F9-03: Resolved alert status (SOCORRIDO) survives full page.reload()', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);
      await getControl(page, 'btnConfirmRescue').click();
      await clockCtrl.runFor(200);

      await clockCtrl.resume();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      assert.equal(await getAllAlertCards(page).first().getAttribute('data-alert-status'), 'SOCORRIDO');
    },
    { clock: true },
  );
});

test('T1-F9-04: BroadcastChannel syncs newly created alerts to a second open tab without reload', async () => {
  const { context, page: tabA } = await openIsolatedPage(browser);
  const guardsA = attachPageGuards(tabA, { verbose: VERBOSE });
  const clockA = await installControlledClock(tabA);
  try {
    await tabA.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(tabA);
    await clockA.pauseNow();
    await clockA.runFor(200);

    const tabB = await context.newPage();
    const guardsB = attachPageGuards(tabB, { verbose: VERBOSE });
    await tabB.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(tabB);

    await getControl(tabA, 'btnSimFall').click();
    await clockA.runFor(5500);

    await tabB.waitForFunction(
      () => document.querySelectorAll('[data-testid="alert-card"], [data-alert-id]').length >= 1,
      { timeout: 5000 },
    );
    assert.equal(await getAllAlertCards(tabB).count(), 1);
    guardsA.assertClean();
    guardsB.assertClean();
  } finally {
    await context.close();
  }
});

test('T1-F9-05: BroadcastChannel syncs Confirmar Socorro resolution across tabs in real time', async () => {
  const { context, page: tabA } = await openIsolatedPage(browser);
  const clockA = await installControlledClock(tabA);
  try {
    await tabA.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(tabA);
    await clockA.pauseNow();
    await clockA.runFor(200);

    const tabB = await context.newPage();
    await tabB.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(tabB);

    await getControl(tabA, 'btnSimFall').click();
    await clockA.runFor(5500);
    await tabB.waitForFunction(
      () => document.querySelectorAll('[data-testid="alert-card"], [data-alert-id]').length >= 1,
      { timeout: 5000 },
    );

    await getControl(tabB, 'btnConfirmRescue').click();
    await clockA.runFor(300);

    assert.equal(await getAllAlertCards(tabA).first().getAttribute('data-alert-status'), 'SOCORRIDO');
    assert.equal(await getAllAlertCards(tabB).first().getAttribute('data-alert-status'), 'SOCORRIDO');
  } finally {
    await context.close();
  }
});

// ============================================================================
// E2E-F10: Quick Config Modal (5 tests)
// ============================================================================
test('T1-F10-01: Clicking Configurar Cloud / IA opens Quick Config Modal dialog', async () => {
  await withPage(async ({ page }) => {
    await getControl(page, 'btnOpenConfig').click();
    assert.equal(await getControl(page, 'configModal').isVisible(), true);
  });
});

test('T1-F10-02: Quick Config Modal displays Firebase Config, Gemini API Key, Save, Clear, and Close controls', async () => {
  await withPage(async ({ page }) => {
    await getControl(page, 'btnOpenConfig').click();
    for (const key of ['inputFirebaseConfig', 'inputGeminiApiKey', 'btnSaveConfig', 'btnClearConfig', 'btnCloseConfig']) {
      assert.equal(await getControl(page, key).isVisible(), true, `${key} should be visible inside modal`);
    }
  });
});

test('T1-F10-03: Saving valid-shaped Firebase JSON and Gemini key persists and updates mode badge', async () => {
  await withPage(async ({ page }) => {
    await getControl(page, 'btnOpenConfig').click();
    await getControl(page, 'inputFirebaseConfig').fill(
      JSON.stringify({ apiKey: 'test-firebase-key', projectId: 'guardiao-demo' }),
    );
    await getControl(page, 'inputGeminiApiKey').fill('test-gemini-key');
    await getControl(page, 'btnSaveConfig').click();

    assert.equal(await getControl(page, 'configModal').isVisible(), false);
    const badgeText = await getControl(page, 'connectionBadge').innerText();
    assert.match(badgeText, /Cloud Firestore/i);
  });
});

test('T1-F10-04: Saved Quick Config survives full page.reload()', async () => {
  await withPage(async ({ page }) => {
    await getControl(page, 'btnOpenConfig').click();
    await getControl(page, 'inputFirebaseConfig').fill(
      JSON.stringify({ apiKey: 'test-firebase-key', projectId: 'guardiao-demo' }),
    );
    await getControl(page, 'inputGeminiApiKey').fill('test-gemini-key');
    await getControl(page, 'btnSaveConfig').click();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    assert.match(await getControl(page, 'connectionBadge').innerText(), /Cloud Firestore/i);

    await getControl(page, 'btnOpenConfig').click();
    assert.equal(await getControl(page, 'inputGeminiApiKey').inputValue(), 'test-gemini-key');
  });
});

test('T1-F10-05: Clearing configuration restores Modo Fallback Local', async () => {
  await withPage(async ({ page }) => {
    await getControl(page, 'btnOpenConfig').click();
    await getControl(page, 'inputFirebaseConfig').fill(
      JSON.stringify({ apiKey: 'test-firebase-key', projectId: 'guardiao-demo' }),
    );
    await getControl(page, 'btnSaveConfig').click();
    assert.match(await getControl(page, 'connectionBadge').innerText(), /Cloud Firestore/i);

    await getControl(page, 'btnOpenConfig').click();
    await getControl(page, 'btnClearConfig').click();
    assert.match(await getControl(page, 'connectionBadge').innerText(), /Modo Fallback Local/i);
  });
});
