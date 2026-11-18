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
import {
  attachPageGuards,
  attachLgpdAuditor,
  blockExternalOrigins,
  mockGeminiApi,
} from './helpers/network-guard.mjs';
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

async function withPage(fn, { clock = false, blockCdn = false } = {}) {
  const { context, page } = await openIsolatedPage(browser);
  const guards = attachPageGuards(page, { verbose: VERBOSE });
  const lgpd = attachLgpdAuditor(page);
  if (blockCdn) await blockExternalOrigins(page);
  let clockCtrl = null;
  if (clock) clockCtrl = await installControlledClock(page);
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

test('T3-01: Queda Crítica -> Canvas HUD -> ALERTA_CRITICO -> AI Fallback -> LocalStorage -> Feed & KPIs', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      const beforeOps = await readCloudOpsStats(page);
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(400);
      assert.equal(await readPostureState(page), 'QUEDA_DETECTADA');

      await clockCtrl.runFor(5100);
      const tel = await readTelemetry(page);
      assert.equal(tel.state, 'ALERTA_CRITICO');
      assert.ok(tel.immobilitySec >= 5.0);

      assert.equal(await getAllAlertCards(page).count(), 1);
      assert.match(await getControl(page, 'alertAiSource').innerText(), /FALLBACK_LOCAL/i);
      assert.equal(await getControl(page, 'emergencyBanner').isVisible(), true);
      const afterOps = await readCloudOpsStats(page);
      assert.ok(afterOps.writes > beforeOps.writes);
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T3-02: Desequilíbrio -> FSM -> LocalStorage -> Weekly Imbalances KPI -> Hourly Vulnerability Chart', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      const beforeKpis = await readDashboardKpis(page);
      await getControl(page, 'btnSimImbalance').click();
      await clockCtrl.runFor(400);
      assert.equal(await readPostureState(page), 'DESEQUILIBRIO');

      await clockCtrl.runFor(2000);
      assert.equal(await readPostureState(page), 'EM_PE');
      const afterKpis = await readDashboardKpis(page);
      assert.equal(afterKpis.weeklyImbalances, beforeKpis.weeklyImbalances + 1);
      const chartStats = await sampleCanvasRenderStats(getControl(page, 'chartHourlyVulnerability'));
      assert.ok(chartStats.uniqueColors >= 2);
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T3-03: Confirmar Socorro + LocalStorage persistence + SLA KPI + Page Reload retention', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5400);
      await getControl(page, 'btnConfirmRescue').click();
      await clockCtrl.runFor(200);

      const slaBeforeReload = await getControl(page, 'kpiSlaStatus').innerText();
      assert.doesNotMatch(slaBeforeReload, /EMERG[ÊE]NCIA PENDENTE/i);

      await clockCtrl.resume();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      assert.equal(await getAllAlertCards(page).first().getAttribute('data-alert-status'), 'SOCORRIDO');
      assert.equal(await getControl(page, 'emergencyBanner').isVisible(), false);
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T3-04: Falso Positivo + LocalStorage persistence + SLA KPI + Page Reload retention', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5400);
      await getControl(page, 'btnFalsePositive').click();
      await clockCtrl.runFor(200);

      assert.equal(await getControl(page, 'emergencyBanner').isVisible(), false);
      await clockCtrl.resume();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForAppReady(page);
      assert.equal(await getAllAlertCards(page).first().getAttribute('data-alert-status'), 'FALSO_POSITIVO');
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T3-05: Quick Config Modal (firebaseConfig + geminiApiKey) + Mode Badge + Reload retention', async () => {
  await withPage(async ({ page, guards }) => {
    await getControl(page, 'btnOpenConfig').click();
    await getControl(page, 'inputFirebaseConfig').fill(
      JSON.stringify({ apiKey: 'pair-fb-key', projectId: 'guardiao-pair' }),
    );
    await getControl(page, 'inputGeminiApiKey').fill('pair-gemini-key');
    await getControl(page, 'btnSaveConfig').click();
    assert.match(await getControl(page, 'connectionBadge').innerText(), /Cloud Firestore/i);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    assert.match(await getControl(page, 'connectionBadge').innerText(), /Cloud Firestore/i);
    guards.assertClean();
  });
});

test('T3-06: Quick Config (geminiApiKey) + Mocked Gemini API 200 vs 500 fallback -> Alert Source & Metadata Audit', async () => {
  await withPage(
    async ({ page, guards, lgpd, clockCtrl }) => {
      const mock200 = await mockGeminiApi(page, 'success', 'Laudo Gemini 200: Risco alto confirmado.');
      await getControl(page, 'btnOpenConfig').click();
      await getControl(page, 'inputGeminiApiKey').fill('valid-mock-gemini-key');
      await getControl(page, 'btnSaveConfig').click();

      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5600);
      assert.ok(mock200.capturedRequests.length >= 1, 'Expected Gemini API POST request');
      lgpd.assertNoRawMediaSent();
      assert.match(await getAllAlertCards(page).first().locator('[data-testid="alert-ai-source"]').innerText(), /GEMINI/i);

      await mock200.restore();
      await mockGeminiApi(page, 'error500');
      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runInChunks(16000, 1000);
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5600);

      assert.equal(await getAllAlertCards(page).count(), 2);
      assert.match(
        await getAllAlertCards(page).first().locator('[data-testid="alert-ai-source"]').innerText(),
        /FALLBACK_LOCAL/i,
      );
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T3-07: Cross-Tab BroadcastChannel Sync: Tab A Queda Crítica -> Tab B live Dashboard Feed & KPI update', async () => {
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
    assert.equal(await getControl(tabB, 'emergencyBanner').isVisible(), true);
  } finally {
    await context.close();
  }
});

test('T3-08: Cross-Tab BroadcastChannel Sync: Tab B Confirmar Socorro -> Tab A resolved status & SLA sync', async () => {
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
    assert.equal(await getControl(tabA, 'emergencyBanner').isVisible(), false);
  } finally {
    await context.close();
  }
});

test('T3-09: Sensitivity Slider extreme low vs high threshold alters Simulator fall classification', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      const slider = getControl(page, 'sensitivitySlider');
      const minVal = await slider.getAttribute('min');
      await slider.fill(String(minVal));
      await slider.dispatchEvent('input');
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5400);
      assert.notEqual(await readPostureState(page), 'ALERTA_CRITICO');

      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runFor(300);
      const maxVal = await slider.getAttribute('max');
      await slider.fill(String(maxVal));
      await slider.dispatchEvent('input');
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5400);
      assert.equal(await readPostureState(page), 'ALERTA_CRITICO');
    },
    { clock: true },
  );
});

test('T3-10: LGPD Privacy Mode ON + Queda Crítica -> skeleton-only canvas + full alert pipeline + zero media leak', async () => {
  await withPage(
    async ({ page, guards, lgpd, clockCtrl }) => {
      const toggle = getControl(page, 'privacyToggle');
      if (!(await toggle.isChecked())) await toggle.click();

      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(5500);

      const videoHidden = await getControl(page, 'monitorVideo').evaluate((el) => {
        const cs = getComputedStyle(el);
        return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
      });
      assert.equal(videoHidden, true);
      assert.equal(await getAllAlertCards(page).count(), 1);
      lgpd.assertNoRawMediaSent();
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T3-11: Interrupted Fall (Queda Crítica -> Postura Normal at 2.5s) + Cloud Ops KPI -> zero alert writes', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      const beforeOps = await readCloudOpsStats(page);
      await getControl(page, 'btnSimFall').click();
      await clockCtrl.runFor(2500);
      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runFor(3500);

      assert.equal(await getAllAlertCards(page).count(), 0);
      assert.equal((await readCloudOpsStats(page)).writes, beforeOps.writes);
    },
    { clock: true },
  );
});

test('T3-12: Continuous 30 FPS Postura Normal monitoring (5s) + Cloud Ops KPI -> zero per-frame writes', async () => {
  await withPage(
    async ({ page, clockCtrl }) => {
      const beforeOps = await readCloudOpsStats(page);
      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runInChunks(5000, 500);
      const afterOps = await readCloudOpsStats(page);
      assert.equal(afterOps.writes, beforeOps.writes, '30 FPS normal monitoring must never write per frame');
    },
    { clock: true },
  );
});

test('T3-13: Periodic 60s Metrics Consolidation + DailyMetrics Risk Score KPI + Weekly Evolution Chart update', async () => {
  await withPage(
    async ({ page, guards, clockCtrl }) => {
      const beforeOps = await readCloudOpsStats(page);
      await getControl(page, 'btnSimNormal').click();
      await clockCtrl.runInChunks(61000, 2000);

      const afterOps = await readCloudOpsStats(page);
      assert.ok(afterOps.writes > beforeOps.writes, 'Expected 60s periodic metrics flush write');
      const kpis = await readDashboardKpis(page);
      assert.ok(Number.isInteger(kpis.riskScore) && kpis.riskScore >= 0 && kpis.riskScore <= 100);
      const stats = await sampleCanvasRenderStats(getControl(page, 'chartWeeklyMobility'));
      assert.ok(stats.uniqueColors >= 2);
      guards.assertClean();
    },
    { clock: true },
  );
});

test('T3-14: Camera Permission Denied + Offline External CDNs + Queda Crítica -> full emergency pipeline completes', async () => {
  const denyBrowser = await launchBrowser({ cameraMode: 'deny' });
  const { context, page } = await openIsolatedPage(denyBrowser);
  const guards = attachPageGuards(page, { verbose: VERBOSE });
  await blockExternalOrigins(page);
  const clockCtrl = await installControlledClock(page);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await clockCtrl.pauseNow();
    await clockCtrl.runFor(200);

    await getControl(page, 'btnStartCamera').click();
    await page.waitForFunction(
      () => /negada|indispon[íi]vel|simulador/i.test(
        document.querySelector('[data-testid="camera-status-msg"]')?.textContent || '',
      ),
      { timeout: 5000 },
    );
    assert.match(await getControl(page, 'cameraStatusMsg').innerText(), /negada|indispon[íi]vel|simulador/i);

    await getControl(page, 'btnSimFall').click();
    await clockCtrl.runFor(5500);
    assert.equal(await readPostureState(page), 'ALERTA_CRITICO');
    assert.equal(await getAllAlertCards(page).count(), 1);
    assert.match(await getControl(page, 'alertAiSource').innerText(), /FALLBACK_LOCAL/i);
    guards.assertClean();
  } finally {
    await context.close();
    await denyBrowser.close();
  }
});
