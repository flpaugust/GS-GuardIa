import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const DEFAULT_PLAYWRIGHT_CORE_PATH =
  'C:\\Users\\Oliv\\Desktop\\carreira-git\\career-ops\\node_modules\\playwright-core\\index.mjs';

const SYSTEM_EXECUTABLE_CANDIDATES = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  'C:\\Users\\Oliv\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

let cachedPlaywright = null;

function resolveOverrideEntry(overridePath) {
  const trimmed = overridePath.trim();
  if (trimmed.endsWith('.mjs') || trimmed.endsWith('.js')) {
    return trimmed;
  }
  const mjsCandidate = path.join(trimmed, 'index.mjs');
  if (fs.existsSync(mjsCandidate)) return mjsCandidate;
  return path.join(trimmed, 'index.js');
}

export async function loadPlaywright() {
  if (cachedPlaywright) return cachedPlaywright;

  const require = createRequire(import.meta.url);
  for (const pkgName of ['playwright', 'playwright-core']) {
    try {
      const mod = require(pkgName);
      if (mod?.chromium) {
        cachedPlaywright = mod;
        return cachedPlaywright;
      }
    } catch {
      // Fall through to env override / known cache path
    }
  }

  const candidates = [];
  if (process.env.PLAYWRIGHT_CORE_PATH) {
    candidates.push(resolveOverrideEntry(process.env.PLAYWRIGHT_CORE_PATH));
  }
  candidates.push(DEFAULT_PLAYWRIGHT_CORE_PATH);

  for (const entryPath of candidates) {
    if (!fs.existsSync(entryPath)) continue;
    const mod = await import(pathToFileURL(entryPath).href);
    if (mod?.chromium) {
      cachedPlaywright = mod;
      return cachedPlaywright;
    }
  }

  throw new Error(
    `Unable to load playwright-core. Checked standard node_modules, PLAYWRIGHT_CORE_PATH, and ${DEFAULT_PLAYWRIGHT_CORE_PATH}`,
  );
}

export function resolveBrowserExecutable(chromium) {
  try {
    const defaultExe = chromium.executablePath();
    if (defaultExe && fs.existsSync(defaultExe)) {
      return defaultExe;
    }
  } catch {
    // Try system candidates below
  }

  for (const candidate of SYSTEM_EXECUTABLE_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function isHeadlessMode(headedOption) {
  if (typeof headedOption === 'boolean') return !headedOption;
  const envVal = process.env.E2E_HEADLESS;
  if (envVal === 'false' || envVal === '0') return false;
  return true;
}

export async function launchBrowser({
  cameraMode = 'allow',
  headed,
  extraArgs = [],
} = {}) {
  const { chromium } = await loadPlaywright();
  const headless = isHeadlessMode(headed);

  // 'allow': fake UI + fake media stream
  // 'deny': fake device + deny-permission-prompts, explicitly WITHOUT --use-fake-ui-for-media-stream
  const cameraArgs =
    cameraMode === 'deny'
      ? ['--use-fake-device-for-media-stream', '--deny-permission-prompts']
      : ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

  const args = [
    ...cameraArgs,
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
    ...extraArgs,
  ];

  const candidates = [undefined];
  const resolved = resolveBrowserExecutable(chromium);
  if (resolved) candidates.unshift(resolved);
  for (const sysExe of SYSTEM_EXECUTABLE_CANDIDATES) {
    if (fs.existsSync(sysExe) && !candidates.includes(sysExe)) {
      candidates.push(sysExe);
    }
  }

  let lastErr;
  for (const executablePath of candidates) {
    try {
      const launchOptions = { headless, args };
      if (executablePath) launchOptions.executablePath = executablePath;
      return await chromium.launch(launchOptions);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Failed to launch Chromium/Chrome/Edge browser');
}

export async function openIsolatedPage(
  browser,
  { viewport = { width: 1280, height: 800 }, permissions } = {},
) {
  const contextOptions = { viewport };
  if (permissions) {
    contextOptions.permissions = permissions;
  }
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  return { context, page };
}
