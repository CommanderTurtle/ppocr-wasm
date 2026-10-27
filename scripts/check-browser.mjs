import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const url = process.env.OCR_URL || 'http://127.0.0.1:8198/';
const backend = process.env.OCR_BACKEND || (process.env.OCR_GPU === '1' ? 'auto' : 'wasm');
const browser = await chromium.launch({ channel: process.env.OCR_BROWSER || 'msedge', headless: true,
  args: process.env.OCR_GPU === '1' ? [] : ['--disable-gpu'] });
try {
  const page = await browser.newPage();
  const requests = [], errors = [];
  page.on('request', r => requests.push({ method: r.method(), url: r.url() }));
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
  await page.goto(url);
  console.log('Page loaded; initializing real PP-OCRv6 models.');
  const result = await page.evaluate(async ({ backend, threads }) => {
    const { createWorker } = await import('./ppocr.js');
    const phases = [];
    const worker = await createWorker('eng', undefined, { backend, numThreads: threads, logger: m => phases.push(m) });
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 240;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 240);
    ctx.fillStyle = '#111'; ctx.font = '32px Arial';
    ctx.fillText('PADDLE OCR 2026', 30, 55);
    ctx.fillText('Static. Local. No server.', 30, 115);
    ctx.fillText('Alpha 12345', 30, 175);
    const output = await worker.recognize(canvas);
    const fromDataURL = await worker.recognize(canvas.toDataURL());
    const fromImageData = await worker.recognize(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const second = await worker.recognize(canvas, { rectangle: { left: 10, top: 5, width: 850, height: 210 } });
    const blank = document.createElement('canvas'); blank.width = 400; blank.height = 120;
    const b = blank.getContext('2d'); b.fillStyle = '#fff'; b.fillRect(0, 0, 400, 120);
    const empty = await worker.recognize(blank);
    const summary = worker.getInitializationSummary();
    let invalidParameters;
    try { await worker.setParameters({ tessedit_pageseg_mode: 6 }); } catch (e) { invalidParameters = e.message; }
    await worker.terminate();
    let termination;
    try { await worker.recognize(canvas); } catch (e) { termination = e.message; }
    const controller = new AbortController();
    const initializing = createWorker({ signal: controller.signal });
    controller.abort();
    let initAbort;
    try { await initializing; } catch (e) { initAbort = e.name; }
    const adapter = await navigator.gpu?.requestAdapter();
    const adapterInfo = adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
      device: adapter.info.device, description: adapter.info.description } : null;
    return { output, fromDataURL, fromImageData, cropped: second, empty, summary, phases, termination, initAbort, invalidParameters, adapterInfo };
  }, { backend, threads: Number(process.env.OCR_THREADS || 1) });
  console.log(JSON.stringify({ text: result.output.data.text, runtime: result.output.data.runtime,
    metrics: result.output.data.metrics, initializationMs: result.summary.elapsedMs }, null, 2));
  assert.match(result.output.data.text, /PADDLE OCR 2026/);
  assert.match(result.output.data.text, /Static\. Local\. No server\./);
  assert.match(result.output.data.text, /Alpha 12345/);
  assert.equal(result.fromDataURL.data.text, result.output.data.text);
  assert.equal(result.fromImageData.data.text, result.output.data.text);
  assert.match(result.cropped.data.text, /Alpha 12345/);
  assert.equal(result.empty.data.text, '');
  assert.match(result.termination, /terminated/);
  assert.equal(result.initAbort, 'AbortError');
  assert.match(result.invalidParameters, /Unsupported OCR parameter/);
  if (backend === 'wasm' || process.env.OCR_GPU !== '1') {
    assert.equal(result.summary.detProvider, 'wasm');
    assert.equal(result.summary.recProvider, 'wasm');
  }
  assert.ok(requests.every(r => r.method === 'GET' && new URL(r.url).origin === new URL(url).origin), 'Requests must stay on the static origin, with no uploads.');
  assert.deepEqual(errors, []);
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL(`../artifacts/browser-${backend}.json`, import.meta.url), JSON.stringify({ result, requests, errors }, null, 2));
  if (process.env.OCR_FIXTURE) {
    await page.locator('#file').setInputFiles(process.env.OCR_FIXTURE);
    await page.locator('#run').click();
    await page.waitForFunction(() => !document.getElementById('save').disabled, null, { timeout: 120000 });
    console.log('Demo fixture:', (await page.locator('#text').inputValue()).slice(0, 400));
    await page.screenshot({ path: fileURLToPath(new URL('../artifacts/demo.png', import.meta.url)), fullPage: true });
  }
  console.log(`Passed: real OCR, crop, blank image, warm reuse, termination, local-only requests (${requests.length}).`);
} finally { await browser.close(); }
