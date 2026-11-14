/* global createCactus, importScripts */
importScripts('./cactus.js');

// Keep the pinned Emscripten glue unmodified; the binary has no inference service.
const status = text => self.postMessage({ status: text });
async function bytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Mirage asset: HTTP ${response.status} (${url})`);
  return new Uint8Array(await response.arrayBuffer());
}

function parseResult(raw) {
  // Some upstream scores are non-finite. Preserve strings verbatim and expose
  // those scores as null, never as fabricated certainty or corrupted text.
  const safe = raw.replace(/"(?:[^"\\]|\\.)*"|(?<![\w])-?(?:nan|inf|Infinity|NaN)(?![\w])/g,
    token => token.startsWith('"') ? token : 'null');
  return JSON.parse(safe);
}

self.onmessage = async ({ data }) => {
  let engine;
  const allocated = [];
  try {
    status('Loading Mirage · CPU / WASM');
    engine = await createCactus({ wasmBinary: await bytes(new URL('./cactus.wasm', self.location.href)) });
    const allocate = size => {
      const ptr = engine._malloc(size);
      if (!ptr) throw Error('Not enough browser memory for Mirage.');
      allocated.push(ptr); return ptr;
    };
    let weights = await bytes(data.model);
    const archive = allocate(weights.byteLength);
    engine.HEAPU8.set(weights, archive);
    // wasm32 pointers are numbers; the C uint64_t archive length is a BigInt.
    const loaded = engine._cactus_load(archive, BigInt(weights.byteLength));
    engine._free(archive); allocated.pop(); weights = null;
    if (loaded < 0) throw Error(engine.UTF8ToString(engine._cactus_last_error()));
    if (!(engine._cactus_models() & 4)) throw Error('The selected archive is not a Mirage model.');
    engine._cactus_set_threads(1);
    const { width, height } = data;
    const rgba = new Uint8Array(data.pixels);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || rgba.length !== width * height * 4) throw Error('Invalid image dimensions.');
    const rgb = allocate(width * height * 3);
    for (let s = 0, d = rgb; s < rgba.length; s += 4) {
      engine.HEAPU8[d++] = rgba[s]; engine.HEAPU8[d++] = rgba[s + 1]; engine.HEAPU8[d++] = rgba[s + 2];
    }
    const capacity = 16 * 1024 * 1024, output = allocate(capacity);
    status('Reading image · Mirage');
    const start = performance.now();
    const count = engine.ccall('cactus_describe', 'number',
      ['number', 'number', 'number', 'string', 'string', 'string', 'number', 'number'],
      [rgb, width, height, JSON.stringify(data.options), data.language || null, data.keywords || null, output, capacity]);
    if (count < 0) throw Error(engine.UTF8ToString(engine._cactus_last_error()));
    if (count >= capacity) throw Error('Mirage output exceeded its buffer. Reduce the requested regions.');
    const result = parseResult(engine.UTF8ToString(output, capacity));
    self.postMessage({ result: { data: result, image: { width, height }, runtime: 'Cactus 4.1.0 · WASM', totalMs: performance.now() - start } });
  } catch (error) { self.postMessage({ error: error.message || String(error) }); }
  finally { if (engine) for (const ptr of allocated) engine._free(ptr); self.close(); }
};
