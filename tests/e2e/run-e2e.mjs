import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { startTargetServer } from './helpers/server-manager.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TIER_FILES = {
  1: path.join(__dirname, 'tier1-features.e2e.mjs'),
  2: path.join(__dirname, 'tier2-boundaries.e2e.mjs'),
  3: path.join(__dirname, 'tier3-combinations.e2e.mjs'),
  4: path.join(__dirname, 'tier4-workflows.e2e.mjs'),
};

function parseCliArgs(argv) {
  const opts = {
    tiers: new Set(),
    all: false,
    baseUrl: undefined,
    port: undefined,
    selfTest: false,
    headed: false,
    verbose: false,
    grep: undefined,
  };

  for (const arg of argv) {
    if (arg === '--all') {
      opts.all = true;
    } else if (arg === '--self-test' || arg === '--mock') {
      opts.selfTest = true;
    } else if (arg === '--headed') {
      opts.headed = true;
    } else if (arg === '--verbose') {
      opts.verbose = true;
    } else if (arg.startsWith('--tier=')) {
      const val = arg.slice('--tier='.length);
      for (const part of val.split(',')) {
        const num = Number(part.trim());
        if (![1, 2, 3, 4].includes(num)) {
          throw new Error(`Invalid tier "${part}" in ${arg}. Allowed: 1, 2, 3, 4.`);
        }
        opts.tiers.add(num);
      }
    } else if (arg.startsWith('--base-url=')) {
      opts.baseUrl = arg.slice('--base-url='.length);
    } else if (arg.startsWith('--port=')) {
      const p = Number(arg.slice('--port='.length));
      if (!Number.isInteger(p) || p < 0 || p > 65535) {
        throw new Error(`Invalid port in ${arg}`);
      }
      opts.port = p;
    } else if (arg.startsWith('--grep=')) {
      opts.grep = arg.slice('--grep='.length);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`GuardIão E2E Runner
Usage: node tests/e2e/run-e2e.mjs [options]
  --all                 Run all 4 tiers (default if --tier omitted)
  --tier=1[,2,3,4]      Run specific tier(s)
  --base-url=<url>      Use an already-running server
  --port=<n>            Override server port (default 3000 real, 0 mock)
  --self-test | --mock  Run against ephemeral fixture mock server
  --headed              Launch browser with UI visible
  --verbose             Verbose server/browser logging
  --grep=<regex>        Filter tests matching regex`);
      process.exit(0);
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  if (opts.all || opts.tiers.size === 0) {
    opts.tiers = new Set([1, 2, 3, 4]);
  }
  return opts;
}

async function runSingleTier(tierNum, filePath, testNamePatterns) {
  return new Promise((resolve, reject) => {
    const counts = { tier: tierNum, passed: 0, failed: 0, skipped: 0, total: 0 };
    const stream = run({
      files: [filePath],
      testNamePatterns,
      concurrency: false,
      timeout: 180000,
    });

    stream.on('test:pass', (data) => {
      if (data.nesting === 0) {
        if (data.skip) {
          counts.skipped++;
        } else {
          counts.passed++;
        }
        counts.total++;
      }
    });

    stream.on('test:fail', (data) => {
      if (data.nesting === 0) {
        counts.failed++;
        counts.total++;
      }
    });

    stream.on('error', reject);

    const formatted = stream.compose(spec);
    formatted.pipe(process.stdout, { end: false });
    stream.on('end', () => resolve(counts));
  });
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const selectedTiers = [...opts.tiers].sort((a, b) => a - b);
  const testNamePatterns = opts.grep ? [new RegExp(opts.grep, 'i')] : undefined;

  const server = await startTargetServer({
    baseUrl: opts.baseUrl,
    port: opts.port,
    selfTest: opts.selfTest,
    verbose: opts.verbose,
  });

  process.env.E2E_BASE_URL = server.baseUrl;
  process.env.E2E_MODE = server.mode;
  process.env.E2E_HEADLESS = opts.headed ? 'false' : 'true';
  process.env.E2E_VERBOSE = opts.verbose ? 'true' : 'false';

  console.log(`\n[E2E] Mode=${server.mode} | BaseURL=${server.baseUrl} | Tiers=${selectedTiers.join(',')}\n`);

  const summary = [];
  let hasFailures = false;

  try {
    for (const tierNum of selectedTiers) {
      console.log(`\n=== Running Tier ${tierNum} (${path.basename(TIER_FILES[tierNum])}) ===`);
      const res = await runSingleTier(tierNum, TIER_FILES[tierNum], testNamePatterns);
      summary.push(res);
      if (res.failed > 0) hasFailures = true;
    }
  } finally {
    await server.close();
  }

  console.log('\n=== GuardIão E2E Summary ===');
  let grandTotal = 0;
  let grandPassed = 0;
  let grandFailed = 0;
  let grandSkipped = 0;
  for (const row of summary) {
    grandTotal += row.total;
    grandPassed += row.passed;
    grandFailed += row.failed;
    grandSkipped += row.skipped;
    console.log(
      `Tier ${row.tier}: total=${row.total}, passed=${row.passed}, failed=${row.failed}, skipped=${row.skipped}`,
    );
  }
  console.log(
    `TOTAL : total=${grandTotal}, passed=${grandPassed}, failed=${grandFailed}, skipped=${grandSkipped}`,
  );

  process.exit(hasFailures || grandTotal === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[E2E Runner Fatal]', err);
  process.exit(1);
});
