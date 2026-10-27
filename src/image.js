export function decodeDataURL(value) {
  const comma = value.indexOf(',');
  if (comma < 5 || value.length > 48 * 1024 * 1024) throw Error('Invalid or oversized data URL.');
  const header = value.slice(5, comma), body = value.slice(comma + 1);
  let bytes;
  if (/;base64$/i.test(header)) {
    const binary = atob(decodeURIComponent(body));
    bytes = new Uint8Array(binary.length);
    for (let n = 0; n < binary.length; n++) bytes[n] = binary.charCodeAt(n);
  } else {
    bytes = new Uint8Array(body.length);
    let size = 0;
    for (let n = 0; n < body.length; n++) {
      if (body[n] === '%') {
        const hex = body.slice(n + 1, n + 3);
        if (!/^[0-9a-f]{2}$/i.test(hex)) throw Error('Invalid data URL escape.');
        bytes[size++] = parseInt(hex, 16); n += 2;
      } else bytes[size++] = body.charCodeAt(n);
    }
    bytes = bytes.subarray(0, size);
  }
  if (bytes.length > 32 * 1024 * 1024) throw Error('Image input exceeds 32 MiB.');
  return new Blob([bytes], { type: header.split(';')[0] || 'application/octet-stream' });
}

export async function pixelsFrom(input, options = {}) {
  const { signal, rectangle, maxPixels = 16000000 } = options;
  signal?.throwIfAborted();
  if (typeof input === 'string' || input instanceof URL) {
    const url = new URL(String(input), document.baseURI);
    if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) throw Error('Unsupported image URL protocol.');
    if (url.protocol === 'data:') input = decodeDataURL(url.href);
    else {
      const response = await fetch(url, { signal, credentials: 'omit' });
      if (!response.ok) throw Error(`Image request failed: HTTP ${response.status}`);
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 32 * 1024 * 1024) throw Error('Image input exceeds 32 MiB.');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      input = new Blob(chunks, { type: response.headers.get('Content-Type') || '' });
    }
  }
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) input = new Blob([input]);
  if (input instanceof Blob && input.size > 32 * 1024 * 1024) throw Error('Image input exceeds 32 MiB.');
  if (input instanceof HTMLImageElement) await input.decode();
  const bitmap = await createImageBitmap(input);
  try {
    signal?.throwIfAborted();
    const r = rectangle ?? { left: 0, top: 0, width: bitmap.width, height: bitmap.height };
    if (![r.left, r.top, r.width, r.height].every(Number.isInteger) || r.left < 0 || r.top < 0 ||
      r.width < 1 || r.height < 1 || r.left + r.width > bitmap.width || r.top + r.height > bitmap.height) throw Error('Image rectangle is outside the source image.');
    if (!Number.isInteger(maxPixels) || maxPixels < 1 || maxPixels > 64000000 || r.width * r.height > maxPixels) throw Error('Image exceeds the pixel limit. Crop it or raise maxPixels explicitly (maximum 64 million).');
    const canvas = document.createElement('canvas');
    canvas.width = r.width; canvas.height = r.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height);
    ctx.drawImage(bitmap, r.left, r.top, r.width, r.height, 0, 0, r.width, r.height);
    const pixels = ctx.getImageData(0, 0, r.width, r.height).data.buffer;
    return { pixels, width: r.width, height: r.height, offset: { x: r.left, y: r.top },
      image: { width: bitmap.width, height: bitmap.height } };
  } finally { bitmap.close(); }
}
