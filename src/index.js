import { defaults, parameters, runtimeOptions } from './options.js';
import { pixelsFrom } from './image.js';
import { formatResult } from './layout.js';

export async function createWorker(languages = 'eng', oem, options = {}) {
  if (languages && typeof languages === 'object' && !Array.isArray(languages)) {
    options = languages; languages = 'eng';
  } else if (oem && typeof oem === 'object') options = oem;
  else if (oem !== undefined && oem !== 1) throw Error('Tesseract OEM selection is not supported by PaddleOCR. Omit the OEM argument.');
  const labels = Array.isArray(languages) ? languages : String(languages).split('+');
  if (!labels.length || labels.some(label => !['eng', 'en', 'multi'].includes(label))) throw Error('This bundle uses the multilingual PP-OCRv6 small model. Use eng or multi; Tesseract traineddata packs are not supported.');
  for (const key of ['corePath', 'langPath', 'tessedit_pageseg_mode'])
    if (key in options) throw Error(`${key} is a Tesseract setting. Supply runtimePath/modelPath or Paddle parameters instead.`);
  const runtime = runtimeOptions(options, globalThis.crossOriginIsolated === true);
  options.signal?.throwIfAborted();
  const base = import.meta.url;
  const directory = (value, fallback) => new URL(value ? String(value).replace(/\/?$/, '/') : fallback, base).href;
  const modelPath = directory(options.modelPath, 'models/');
  const runtimePath = directory(options.runtimePath, 'runtime/');
  const timeoutMs = options.timeoutMs ?? 120000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) throw Error('timeoutMs must be at least 1000.');
  const log = message => { try { options.logger?.(message); } catch {} };
  let settings = { ...defaults, ...parameters(options.parameters) }, terminated = false, sequence = 0;
  const worker = options.workerPath ? new Worker(new URL(options.workerPath, base), { type: 'module' })
    : new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  function close(error = Error('OCR worker was terminated.')) {
    if (terminated) return;
    terminated = true; worker.terminate();
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
    pending.clear();
  }
  function request(operation, payload, transfer = []) {
    if (terminated) return Promise.reject(Error('OCR worker was terminated. Create a new worker.'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => close(Error('OCR timed out. The worker was stopped.')), timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, operation, payload }, transfer); }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id); clearTimeout(p.timer);
    data.error ? p.reject(Object.assign(Error(data.error.message), { name: data.error.name })) : p.resolve(data.result);
  };
  worker.onerror = event => { event.preventDefault(); close(Error(event.message || 'OCR worker failed to load. Check the complete dist and CSP.')); };
  worker.onmessageerror = () => close(Error('Could not read the OCR worker response.'));
  log({ status: 'loading OCR engine', progress: 0 });
  let summary;
  const abortInit = () => close(options.signal.reason ?? new DOMException('Aborted', 'AbortError'));
  options.signal?.addEventListener('abort', abortInit, { once: true });
  try {
    options.signal?.throwIfAborted();
    summary = await request('init', {
      runtime, runtimePath, parameters: settings,
      detection: new URL('PP-OCRv6_small_det.tar', modelPath).href,
      recognition: new URL('PP-OCRv6_small_rec.tar', modelPath).href
    });
    log({ status: 'initialized API', progress: 1 });
    options.signal?.throwIfAborted();
  } catch (error) { close(error); throw error; }
  finally { options.signal?.removeEventListener('abort', abortInit); }
  return {
    async recognize(input, opts = {}, output = { text: true }) {
      if (terminated) throw Error('OCR worker was terminated. Create a new worker.');
      for (const key of Object.keys(opts)) if (!['rectangle', 'signal', 'maxPixels', 'parameters', 'asciiPunctuation'].includes(key)) throw Error(`Unsupported recognize option: ${key}`);
      for (const [key, enabled] of Object.entries(output)) if (enabled && !['text', 'blocks'].includes(key)) throw Error(`Unsupported output: ${key}. Only text and line-level blocks are available.`);
      const signal = opts.signal;
      const abort = () => close(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true });
      try {
        const image = await pixelsFrom(input, opts);
        log({ status: 'recognizing text', progress: 0 });
        const raw = await request('recognize', {
          pixels: image.pixels, width: image.width, height: image.height,
          parameters: { ...settings, ...parameters(opts.parameters) }
        }, [image.pixels]);
        const result = formatResult({ ...raw, image: image.image }, opts, image.offset);
        log({ status: 'recognizing text', progress: 1 });
        return result;
      } finally { signal?.removeEventListener('abort', abort); }
    },
    async setParameters(value) {
      if (terminated) throw Error('OCR worker was terminated. Create a new worker.');
      settings = { ...settings, ...parameters(value) }; return { ...settings };
    },
    getInitializationSummary() { return summary; },
    async terminate() { close(); }
  };
}

export async function recognize(input, languages = 'eng', options = {}) {
  const worker = await createWorker(languages, undefined, options);
  try { return await worker.recognize(input); }
  finally { await worker.terminate(); }
}

export default { createWorker, recognize };
