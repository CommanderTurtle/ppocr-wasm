import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 8198);
const base = process.env.OCR_BASE || '/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw Error('OCR_BASE must be / or a slash-delimited directory path such as /tools/ocr/.');
const server = Bun.serve({ hostname: '127.0.0.1', port, async fetch(request) {
  let path;
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(base)) return new Response('Not found', { status: 404 });
  try { path = resolve(root, '.' + decodeURIComponent('/' + pathname.slice(base.length))); }
  catch { return new Response('Bad path', { status: 400 }); }
  if (path !== resolve(root) && !path.startsWith(root)) return new Response('Not found', { status: 404 });
  const file = Bun.file(path === resolve(root) ? resolve(root, 'index.html') : path);
  if (!await file.exists()) return new Response('Not found', { status: 404 });
  const evalPolicy = /[/\\]worker-[^/\\]+\.js$/.test(path) ? " 'unsafe-eval'" : '';
  return new Response(file, { headers: {
    'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${evalPolicy}; worker-src 'self' blob:; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; object-src 'none'; base-uri 'none'`,
    ...(process.env.OCR_ISOLATED === '1' ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {})
  } });
} });
console.log(`Local: http://127.0.0.1:${server.port}${base}`);
