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

test('T4-01: Real-Time Fall Emergency & Rescue SLA Workflow (Real Wall Clock < 10s)', async () => {
  const { context, page } = await openIsolatedPage(browser);
  const guards = attachPageGuards(page, { verbose: VERBOSE });
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const startMs = Date.now();
    await getControl(page, 'btnSimFall').click();

    await page.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-testid="alert-card"], [data-alert-id]');
        const badge = document.querySelector('[data-testid="posture-state-badge"]');
        const state = badge?.getAttribute('data-state') || badge?.textContent || '';
        return cards.length >= 1 && /ALERTA_CRITICO/.test(state);
      },
      { timeout: 10000 },
    );

    const elapsedMs = Date.now() - startMs;
    assert.ok(elapsedMs >= 4500 && elapsedMs < 10000, `Fall SLA out of bounds: ${elapsedMs}ms`);
    assert.equal(await getControl(page, 'emergencyBanner').isVisible(), true);
    assert.ok((await getControl(page, 'alertTriageReport').innerText()).trim().length >= 20);

    await getControl(page, 'btnConfirmRescue').click();
    await page.waitForTimeout(150);
    assert.equal(await getAllAlertCards(page).first().getAttribute('data-alert-status'), 'SOCORRIDO');
    assert.equal(await getControl(page, 'emergencyBanner').isVisible(), false);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    assert.equal(await getAllAlertCards(page).first().getAttribute('data-alert-status'), 'SOCORRIDO');
    guards.assertClean();
  } finally {
    await context.close();
  }
});

test('T4-02: False Positive Recovery & Calibration Workflow', async () => {
  const { context, page } = await openIsolatedPage(browser);
  const guards = attachPageGuards(page, { verbose: VERBOSE });
  const clockCtrl = await installControlledClock(page);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await clockCtrl.pauseNow();
    await clockCtrl.runFor(200);

    await getControl(page, 'btnSimFall').click();
    await clockCtrl.runFor(5400);
    const tel = await readTelemetry(page);
    assert.equal(tel.state, 'ALERTA_CRITICO');
    assert.ok(Number.isFinite(tel.trunkAngleDeg) && Number.isFinite(tel.verticalVelocity));

    await getControl(page, 'btnFalsePositive').click();
    await clockCtrl.runFor(200);
    assert.equal(await getAllAlertCards(page).first().getAttribute('data-alert-status'), 'FALSO_POSITIVO');
    assert.equal(await getControl(page, 'emergencyBanner').isVisible(), false);

    // Caregiver calibrates slider stricter after false positive
    const slider = getControl(page, 'sensitivitySlider');
    await slider.fill('25');
    await slider.dispatchEvent('input');
    await getControl(page, 'btnSimNormal').click();
    await clockCtrl.runFor(300);
    assert.equal(await readPostureState(page), 'EM_PE');

    await clockCtrl.resume();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    assert.equal(await getAllAlertCards(page).first().getAttribute('data-alert-status'), 'FALSO_POSITIVO');
    guards.assertClean();
  } finally {
    await context.close();
  }
});

test('T4-03: Offline-First 7-Day Preventive Risk Analysis (UBS / Rural Clinic, All CDNs Blocked)', async () => {
  const { context, page } = await openIsolatedPage(browser);
  const guards = attachPageGuards(page, { verbose: VERBOSE });
  await blockExternalOrigins(page);
  const clockCtrl = await installControlledClock(page);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await clockCtrl.pauseNow();
    await clockCtrl.runFor(200);

    const initialKpis = await readDashboardKpis(page);
    assert.ok(initialKpis.riskScore >= 0 && initialKpis.riskScore <= 100);
    assert.ok((await sampleCanvasRenderStats(getControl(page, 'chartWeeklyMobility'))).uniqueColors >= 2);
    assert.ok((await sampleCanvasRenderStats(getControl(page, 'chartHourlyVulnerability'))).uniqueColors >= 2);

    await getControl(page, 'btnSimImbalance').click();
    await clockCtrl.runFor(2000);
    await clockCtrl.runInChunks(61000, 2000);

    const updatedKpis = await readDashboardKpis(page);
    assert.equal(updatedKpis.weeklyImbalances, initialKpis.weeklyImbalances + 1);
    assert.ok(updatedKpis.cloudOps.writes >= initialKpis.cloudOps.writes + 2);
    guards.assertClean();
  } finally {
    await context.close();
  }
});

test('T4-04: LGPD Privacy-First Continuous Monitoring & Spark Quota Guard', async () => {
  const { context, page } = await openIsolatedPage(browser);
  const guards = attachPageGuards(page, { verbose: VERBOSE });
  const lgpd = attachLgpdAuditor(page);
  const clockCtrl = await installControlledClock(page);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await clockCtrl.pauseNow();
    await clockCtrl.runFor(200);

    const toggle = getControl(page, 'privacyToggle');
    if (!(await toggle.isChecked())) await toggle.click();

    const beforeOps = await readCloudOpsStats(page);
    await getControl(page, 'btnSimNormal').click();
    await clockCtrl.runInChunks(10000, 1000);

    const afterOps = await readCloudOpsStats(page);
    assert.equal(afterOps.writes, beforeOps.writes, 'Continuous normal monitoring must not trigger writes');
    lgpd.assertNoRawMediaSent();
    guards.assertClean();
  } finally {
    await context.close();
  }
});

test('T4-05: Multi-Tab Caregiver Remote Monitoring Console (Resident Tab + Caregiver Tab)', async () => {
  const { context, page: residentTab } = await openIsolatedPage(browser);
  const guardsRes = attachPageGuards(residentTab, { verbose: VERBOSE });
  const clockRes = await installControlledClock(residentTab);
  try {
    await residentTab.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(residentTab);
    await clockRes.pauseNow();
    await clockRes.runFor(200);

    const caregiverTab = await context.newPage();
    const guardsCare = attachPageGuards(caregiverTab, { verbose: VERBOSE });
    await caregiverTab.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(caregiverTab);

    const toggle = getControl(residentTab, 'privacyToggle');
    if (!(await toggle.isChecked())) await toggle.click();

    await getControl(residentTab, 'btnSimFall').click();
    await clockRes.runFor(5500);

    await caregiverTab.waitForFunction(
      () => document.querySelectorAll('[data-testid="alert-card"], [data-alert-id]').length >= 1,
      { timeout: 5000 },
    );
    assert.equal(await getControl(caregiverTab, 'emergencyBanner').isVisible(), true);
    assert.ok((await getControl(caregiverTab, 'alertTriageReport').innerText()).trim().length >= 20);

    await getControl(caregiverTab, 'btnConfirmRescue').click();
    await clockRes.runFor(300);

    assert.equal(await getAllAlertCards(residentTab).first().getAttribute('data-alert-status'), 'SOCORRIDO');
    assert.equal(await getControl(residentTab, 'emergencyBanner').isVisible(), false);
    guardsRes.assertClean();
    guardsCare.assertClean();
  } finally {
    await context.close();
  }
});

test('T4-06: ILPI Clinic Configuration & Corrupted LocalStorage Disaster Recovery', async () => {
  const { context, page } = await openIsolatedPage(browser);
  const guards = attachPageGuards(page, { verbose: VERBOSE });
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // 1. Malformed config safely rejected
    await getControl(page, 'btnOpenConfig').click();
    await getControl(page, 'inputFirebaseConfig').fill('{bad json');
    await getControl(page, 'btnSaveConfig').click();
    assert.equal(await getControl(page, 'configValidationError').isVisible(), true);

    // 2. Valid-shaped config persisted
    await getControl(page, 'inputFirebaseConfig').fill(
      JSON.stringify({ apiKey: 'ilpi-key', projectId: 'ilpi-clinic' }),
    );
    await getControl(page, 'inputGeminiApiKey').fill('ilpi-gemini');
    await getControl(page, 'btnSaveConfig').click();
    assert.match(await getControl(page, 'connectionBadge').innerText(), /Cloud Firestore/i);

    // 3. Disaster corruption of all LocalStorage keys -> graceful recovery on reload
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        localStorage.setItem(k, '<<<CORRUPTED_STORAGE>>>');
      }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    const kpis = await readDashboardKpis(page);
    assert.ok(Number.isInteger(kpis.riskScore) && kpis.riskScore >= 0 && kpis.riskScore <= 100);
    guards.assertClean();
  } finally {
    await context.close();
  }
});

test('T4-07: Rapid Sequential Incidents & 15s Debounce Cooldown Workflow', async () => {
  const { context, page } = await openIsolatedPage(browser);
  const guards = attachPageGuards(page, { verbose: VERBOSE });
  const clockCtrl = await installControlledClock(page);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await clockCtrl.pauseNow();
    await clockCtrl.runFor(200);

    // 1. Desequilíbrio -> recovers
    await getControl(page, 'btnSimImbalance').click();
    await clockCtrl.runFor(2000);
    assert.equal(await readPostureState(page), 'EM_PE');
    assert.equal(await getAllAlertCards(page).count(), 1);

    // 2. First Queda Crítica -> registered (#2 total, #1 fall)
    await getControl(page, 'btnSimFall').click();
    await clockCtrl.runFor(5400);
    assert.equal(await getAllAlertCards(page).count(), 2);

    // 3. Immediate second Queda Crítica within 15s -> debounced (count stays 2)
    await getControl(page, 'btnSimNormal').click();
    await clockCtrl.runFor(300);
    await getControl(page, 'btnSimFall').click();
    await clockCtrl.runFor(5400);
    assert.equal(await getAllAlertCards(page).count(), 2, 'Duplicate fall within 15s must be debounced');

    // 4. Advance past 15s cooldown -> third Queda Crítica IS registered (#3 total)
    await getControl(page, 'btnSimNormal').click();
    await clockCtrl.runInChunks(16000, 1000);
    await getControl(page, 'btnSimFall').click();
    await clockCtrl.runFor(5400);
    assert.equal(await getAllAlertCards(page).count(), 3, 'Fall after 16s cooldown must register');
    guards.assertClean();
  } finally {
    await context.close();
  }
});
