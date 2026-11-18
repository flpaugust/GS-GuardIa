// Hybrid Real-Time & Playwright page.clock RAF-preserving utilities

export async function installControlledClock(page) {
  await page.clock.install();
  await page.clock.resume();

  return {
    async pauseNow() {
      for (let attempt = 0; attempt < 3; attempt++) {
        const now = await page.evaluate(() => Date.now());
        try {
          await page.clock.pauseAt(now + 150 * (attempt + 1));
          return;
        } catch (err) {
          if (attempt === 2 || !/past/i.test(String(err?.message))) {
            throw err;
          }
        }
      }
    },
    async runFor(ms) {
      await page.clock.runFor(ms);
    },
    async runInChunks(totalMs, chunkMs = 500) {
      let remaining = totalMs;
      while (remaining > 0) {
        const step = Math.min(chunkMs, remaining);
        await page.clock.runFor(step);
        remaining -= step;
      }
    },
    async resume() {
      await page.clock.resume();
    },
    async setFixedTime(ms) {
      await page.clock.setFixedTime(ms);
    },
  };
}

export async function waitRealTime(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
