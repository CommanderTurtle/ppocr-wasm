import { test, expect } from 'bun:test';
import { asciiPunctuation, formatResult } from '../src/layout.js';
import { defaults, parameters, runtimeOptions } from '../src/options.js';
import { decodeDataURL } from '../src/image.js';

const box = (text, x, y, width = text.length * 10, score = 0.9) => ({
  text, score, poly: [[x, y], [x + width, y], [x + width, y + 10], [x, y + 10]]
});
const result = items => ({ items, image: { width: 600, height: 200 }, metrics: {}, runtime: { detProvider: 'wasm', recProvider: 'wasm' } });

test('data URLs decode locally without fetch or loosening connect-src', async () => {
  const png = decodeDataURL('data:image/png;base64,iVBORw==');
  expect(png.type).toBe('image/png');
  expect(Array.from(new Uint8Array(await png.arrayBuffer()))).toEqual([137, 80, 78, 71]);
  const binary = decodeDataURL('data:application/octet-stream,%00%ffA');
  expect(Array.from(new Uint8Array(await binary.arrayBuffer()))).toEqual([0, 255, 65]);
  expect(() => decodeDataURL('data:image/png;base64')).toThrow();
  expect(() => decodeDataURL('data:image/png,%zz')).toThrow();
});

test('CPU and a single WASM thread are the defaults', () => {
  expect(runtimeOptions()).toEqual({ backend: 'wasm', numThreads: 1, simd: true, proxy: false });
  expect(defaults.textDetLimitSideLen).toBe(320);
  expect(defaults.textDetLimitType).toBe('min');
  expect(defaults.textDetUnclipRatio).toBe(1.6);
});

test('GPU and threaded modes are deliberate opt-ins', () => {
  expect(runtimeOptions({ backend: 'auto' }).backend).toBe('auto');
  expect(() => runtimeOptions({ numThreads: 4 })).toThrow(/isolation/);
  expect(runtimeOptions({ numThreads: 4 }, true).numThreads).toBe(4);
  for (const value of [0, -1, 1.5, 9, '2']) expect(() => runtimeOptions({ numThreads: value }, true)).toThrow();
  expect(() => runtimeOptions({ backend: 'cuda' })).toThrow();
});

test('Paddle parameters validate rather than silently accepting Tesseract flags', () => {
  expect(parameters({ textRecScoreThresh: 0, textDetLimitSideLen: 320 })).toEqual({ textRecScoreThresh: 0, textDetLimitSideLen: 320 });
  for (const input of [{ tessedit_pageseg_mode: 3 }, { constructor: 1 }, { textDetThresh: NaN },
    { textRecScoreThresh: -0.1 }, { textDetLimitType: 'portrait' }, { textDetLimitSideLen: 100000 }])
    expect(() => parameters(input)).toThrow();
});

test('Latin full-width punctuation folds but CJK punctuation remains intentional', () => {
  expect(asciiPunctuation('name：value（2026）')).toBe('name:value(2026)');
  expect(asciiPunctuation('日本語：１２３')).toBe('日本語：１２３');
  expect(asciiPunctuation('name：value', false)).toBe('name：value');
});

test('screen layout preserves indentation, column gaps and paragraphs', () => {
  const data = formatResult(result([box('tail', 0, 50), box('ef', 70, 0), box('body', 20, 15), box('abcd', 0, 0)])).data;
  expect(data.text).toBe('abcd   ef\n  body\n\ntail\n');
  expect(data.lines.length).toBe(3);
  expect(data.lines[0].items.length).toBe(2);
});

test('cropped geometry maps back to the original image without fabricating word boxes', () => {
  const data = formatResult(result([box('hello world', 2, 3)]), {}, { x: 30, y: 40 }).data;
  expect(data.lines[0].bbox).toEqual({ x0: 32, y0: 43, x1: 142, y1: 53 });
  expect(data.items[0].polygon[0]).toEqual([32, 43]);
  expect(data.words).toEqual([]);
  expect(data.lines[0].words).toEqual([]);
  expect(data.geometryLevel).toBe('line');
  expect(data.image).toEqual({ width: 600, height: 200 });
});

test('empty pages produce an empty string, not a successful-looking placeholder', () => {
  const data = formatResult(result([])).data;
  expect(data.text).toBe(''); expect(data.confidence).toBe(0);
  expect(data.lines).toEqual([]); expect(data.blocks).toEqual([]);
});

test('confidence is bounded, weighted by recognized text length, and not renamed accuracy', () => {
  const data = formatResult(result([box('a', 0, 0, 10, 1.1), box('bbb', 0, 20, 30, 0.6)])).data;
  expect(data.confidence).toBeCloseTo(70);
  expect(data.accuracy).toBeUndefined();
});
