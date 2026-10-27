import { build } from 'vite';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { root, models, prepareModels } from './assets.mjs';

await prepareModels();
const ort = fileURLToPath(new URL('node_modules/onnxruntime-web/dist/ort.all.min.mjs', root));
const opencv = fileURLToPath(new URL('node_modules/@techstark/opencv-js/dist/opencv.js', root));
await build({
  configFile: false,
  root: fileURLToPath(root),
  base: './',
  resolve: { alias: [
    { find: /^onnxruntime-web$/, replacement: ort },
    { find: /^@techstark\/opencv-js$/, replacement: opencv }
  ] },
  worker: {
    format: 'es',
    plugins: () => [{
      name: 'local-ort',
      resolveId(id) {
        if (id === 'onnxruntime-web') return ort;
        if (id === '@techstark/opencv-js') return opencv;
      }
    }]
  },
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'es2022',
    lib: { entry: fileURLToPath(new URL('src/index.js', root)), formats: ['es'], fileName: () => 'ppocr.js' }
  }
});
for (const folder of ['runtime', 'models', 'credits']) await mkdir(new URL(`dist/${folder}/`, root), { recursive: true });
for (const variant of ['', '.jsep']) {
  for (const ext of ['mjs', 'wasm']) {
    const name = `ort-wasm-simd-threaded${variant}.${ext}`;
    await cp(new URL(`node_modules/onnxruntime-web/dist/${name}`, root), new URL(`dist/runtime/${name}`, root));
  }
}
for (const model of Object.values(models.small)) await cp(new URL(`.cache/models/${model.name}.tar`, root), new URL(`dist/models/${model.name}.tar`, root));
await cp(new URL('demo/', root), new URL('dist/', root), { recursive: true });
await cp(new URL('README.md', root), new URL('dist/README.md', root));
await cp(new URL('RESEARCH.md', root), new URL('dist/RESEARCH.md', root));
await cp(new URL('src/index.d.ts', root), new URL('dist/ppocr.d.ts', root));
await cp(new URL('LICENSE', root), new URL('dist/LICENSE', root));
await cp(new URL('models.json', root), new URL('dist/models.json', root));
for (const [pkg, name] of [
  ['@techstark/opencv-js', 'OpenCV.txt'], ['js-yaml', 'js-yaml.txt']
]) {
  const base = new URL(`node_modules/${pkg}/`, root);
  let credit;
  for (const filename of ['LICENSE', 'LICENSE.txt', 'License.txt']) {
    credit = await readFile(new URL(filename, base)).catch(() => null);
    if (credit) break;
  }
  if (!credit) throw Error(`Missing credit for ${pkg}`);
  await writeFile(new URL(`dist/credits/${name}`, root), credit);
}
await cp(new URL('credits/PaddleOCR.txt', root), new URL('dist/credits/PaddleOCR.txt', root));
await cp(new URL('credits/turtle-ppocr.txt', root), new URL('dist/credits/turtle-ppocr.txt', root));
await cp(new URL('credits/ONNX-Runtime.txt', root), new URL('dist/credits/ONNX-Runtime.txt', root));
await cp(new URL('credits/Clipper.txt', root), new URL('dist/credits/Clipper.txt', root));
await cp(new URL('credits/JSBN.txt', root), new URL('dist/credits/JSBN.txt', root));
await writeFile(new URL('dist/build.json', root), JSON.stringify({
  sdk: '@paddleocr/paddleocr-js@0.4.2', ort: 'onnxruntime-web@1.30.0', models: models.small,
  defaultBackend: 'wasm', defaultThreads: 1
}, null, 2) + '\n');
console.log('Built dist/: self-hosted PP-OCRv6 small. No OCR server or runtime CDN.');
if (process.argv.includes('--serve')) await import('./serve.mjs');
