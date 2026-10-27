export const defaults = Object.freeze({
  textDetLimitSideLen: 320, textDetLimitType: 'min', textDetMaxSideLimit: 4000,
  textDetThresh: 0.3, textDetBoxThresh: 0.5, textDetUnclipRatio: 1.6, textRecScoreThresh: 0.5
});

export function parameters(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(defaults, key)) throw Error(`Unsupported OCR parameter: ${key}. Tesseract PSM/OEM/whitelist settings are not Paddle settings.`);
    if (key === 'textDetLimitType') {
      if (!['min', 'max'].includes(value)) throw Error(`${key} must be min or max.`);
    } else if (typeof value !== 'number' || !Number.isFinite(value) ||
      (key.endsWith('Thresh') ? value < 0 || value > 1 : value <= 0) ||
      (key.includes('Side') && value > 8192) || (key === 'textDetUnclipRatio' && value > 10)) {
      throw Error(`Invalid OCR parameter: ${key}`);
    }
    result[key] = value;
  }
  return result;
}

export function runtimeOptions(options = {}, isolated = false) {
  const backend = options.backend ?? 'wasm';
  if (!['wasm', 'webgpu', 'auto'].includes(backend)) throw Error('backend must be wasm, webgpu, or auto.');
  const threads = options.numThreads ?? 1;
  if (!Number.isInteger(threads) || threads < 1 || threads > 8) throw Error('numThreads must be an integer from 1 to 8.');
  if (threads > 1 && !isolated) throw Error('Threaded WASM requires cross-origin isolation (COOP/COEP). Use numThreads: 1 on ordinary static hosting.');
  return { backend, numThreads: threads, simd: true, proxy: false };
}
