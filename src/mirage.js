import { pixelsFrom } from './image.js';

// A fresh worker owns the native process-global model, scratch heap and image.
// Termination is also cancellation: synchronous WASM cannot handle an abort message.
export async function describe(input, { signal, logger, options = {}, language = 'en', keywords = '', timeoutMs = 180000 } = {}) {
  signal?.throwIfAborted();
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) throw Error('timeoutMs must be at least 1000.');
  if (new TextEncoder().encode(JSON.stringify(options)).length > 32768 || String(keywords).length > 2000) throw Error('The Mirage options or keyword hints are too large.');
  return new Promise((resolve, reject) => {
    let settled = false, worker;
    const preparation = new AbortController();
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      preparation.abort(); worker?.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(Error('Mirage timed out. Its worker was released.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    (async () => {
      try {
        signal?.throwIfAborted();
        const image = await pixelsFrom(input, { signal: preparation.signal });
        if (settled) return;
        worker = new Worker(new URL('./runtime/cactus/mirage-worker.js', import.meta.url));
        worker.onmessage = ({ data }) => {
          if (data.status) { try { logger?.(data); } catch {} return; }
          finish(data.error ? Error(data.error) : null, data.result);
        };
        worker.onerror = event => { event.preventDefault(); finish(Error(event.message || 'Mirage worker failed to load.')); };
        worker.onmessageerror = () => finish(Error('Could not read the Mirage worker response.'));
        worker.postMessage({ pixels: image.pixels, width: image.width, height: image.height, options, language, keywords,
          model: new URL('./models/mirage.cact', import.meta.url).href }, [image.pixels]);
      } catch (error) { finish(error); }
    })();
  });
}
