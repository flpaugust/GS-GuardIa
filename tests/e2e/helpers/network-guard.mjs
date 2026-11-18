import assert from 'node:assert/strict';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function isLocalUrl(urlString) {
  try {
    const u = new URL(urlString);
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') {
      return true;
    }
    return LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export function attachPageGuards(page, { verbose = false } = {}) {
  const appErrors = [];
  const cdnWarnings = [];
  const localHttpErrors = [];

  page.on('pageerror', (err) => {
    const msg = err?.stack || err?.message || String(err);
    appErrors.push(msg);
    if (verbose) console.error(`[pageerror] ${msg}`);
  });

  page.on('requestfailed', (req) => {
    const url = req.url();
    const reason = req.failure()?.errorText || 'failed';
    if (isLocalUrl(url)) {
      localHttpErrors.push(`Local requestfailed ${req.method()} ${url}: ${reason}`);
    } else {
      cdnWarnings.push(`External CDN requestfailed ${url}: ${reason}`);
      if (verbose) console.warn(`[cdn-warning] ${url}: ${reason}`);
    }
  });

  page.on('response', (res) => {
    const url = res.url();
    if (res.status() >= 400) {
      if (isLocalUrl(url)) {
        localHttpErrors.push(`Local HTTP ${res.status()} ${url}`);
      } else {
        cdnWarnings.push(`External HTTP ${res.status()} ${url}`);
      }
    }
  });

  return {
    appErrors,
    cdnWarnings,
    localHttpErrors,
    assertClean({ allowLocalHttpErrors = false } = {}) {
      assert.deepEqual(appErrors, [], `Unexpected uncaught pageerror(s): ${appErrors.join(' | ')}`);
      if (!allowLocalHttpErrors) {
        assert.deepEqual(
          localHttpErrors,
          [],
          `Unexpected local HTTP error(s): ${localHttpErrors.join(' | ')}`,
        );
      }
    },
  };
}

export async function blockExternalOrigins(page, { allowPatterns = [] } = {}) {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (isLocalUrl(url)) {
      await route.continue();
      return;
    }
    for (const pat of allowPatterns) {
      if (pat instanceof RegExp ? pat.test(url) : url.includes(pat)) {
        await route.continue();
        return;
      }
    }
    await route.abort('internetdisconnected');
  });
}

export function attachLgpdAuditor(page) {
  const violations = [];
  const externalRequests = [];

  const IMAGE_VIDEO_MIME_RE = /^(image|video)\//i;
  const DATA_MEDIA_URI_RE = /data:(image|video)\//i;
  const SUSPICIOUS_KEY_RE = /"(?:frameData|rawVideo|imageBase64|inlineData|pixelBuffer)"\s*:/i;

  page.on('request', (req) => {
    const url = req.url();
    const method = req.method().toUpperCase();
    const headers = req.headers();
    const contentType = headers['content-type'] || '';
    const postData = req.postData() || '';
    const buf = req.postDataBuffer();
    const byteLen = buf ? buf.length : Buffer.byteLength(postData, 'utf8');

    if (!isLocalUrl(url)) {
      externalRequests.push({ url, method, contentType, byteLen, postData });
    }

    if (method !== 'GET' && method !== 'HEAD') {
      if (IMAGE_VIDEO_MIME_RE.test(contentType)) {
        violations.push(`Forbidden media Content-Type (${contentType}) to ${url}`);
      }
      if (DATA_MEDIA_URI_RE.test(postData) || DATA_MEDIA_URI_RE.test(url)) {
        violations.push(`Forbidden data:image/video URI transmitted to ${url}`);
      }
      if (SUSPICIOUS_KEY_RE.test(postData)) {
        violations.push(`Forbidden raw media field transmitted to ${url}`);
      }
      if (byteLen > 50 * 1024) {
        violations.push(`Suspicious large outbound payload (${byteLen} bytes) to ${url}`);
      }
    }
  });

  return {
    violations,
    externalRequests,
    assertNoRawMediaSent() {
      assert.deepEqual(
        violations,
        [],
        `LGPD privacy violation(s) detected: ${violations.join(' | ')}`,
      );
    },
  };
}

export async function mockGeminiApi(page, mode = 'success', customText = null) {
  const capturedRequests = [];
  const pattern = /generativelanguage\.googleapis\.com/i;

  const handler = async (route) => {
    const req = route.request();
    const postData = req.postData() || '';
    capturedRequests.push({
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
      postData,
    });

    if (mode === 'abort') {
      await route.abort('failed');
      return;
    }
    if (mode === 'error500') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 500, message: 'Internal Gemini error' } }),
      });
      return;
    }
    if (mode === 'rate429') {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 429, message: 'Quota exceeded' } }),
      });
      return;
    }

    const triageText =
      customText ||
      'Laudo Gemini: Queda crítica com imobilidade prolongada detectada. Acionar cuidador imediatamente e verificar consciência.';

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: triageText }],
            },
          },
        ],
      }),
    });
  };

  await page.route(pattern, handler);

  return {
    capturedRequests,
    async restore() {
      await page.unroute(pattern, handler);
    },
  };
}
