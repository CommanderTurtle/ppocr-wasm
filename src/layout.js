const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const length = text => Array.from(text).length;
const rounded = value => {
  const low = Math.floor(value);
  return value - low === 0.5 ? low + (low % 2) : Math.round(value);
};

export function asciiPunctuation(text, enabled = true) {
  return !enabled || /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text)
    ? text : text.replace(/[\uff01-\uff5e\u3000]/gu, char => char.normalize('NFKC'));
}

export function formatResult(result, options = {}, offset = { x: 0, y: 0 }) {
  const items = result.items.filter(item => item.text.trim()).map(item => {
    const polygon = item.poly.map(([x, y]) => [x + offset.x, y + offset.y]);
    const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
    const bbox = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    return { text: asciiPunctuation(item.text, options.asciiPunctuation !== false),
      confidence: Math.max(0, Math.min(100, item.score * 100)), polygon, bbox,
      cy: (bbox.y0 + bbox.y1) / 2, height: bbox.y1 - bbox.y0 };
  }).sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const item of items) {
    const row = rows.at(-1);
    const cy = row && row.reduce((sum, i) => sum + i.cy, 0) / row.length;
    const height = row && row.reduce((sum, i) => sum + i.height, 0) / row.length;
    if (row && Math.abs(item.cy - cy) < 0.5 * Math.min(height, item.height)) row.push(item);
    else rows.push([item]);
  }
  const widths = items.filter(i => length(i.text) > 1).map(i => (i.bbox.x1 - i.bbox.x0) / length(i.text));
  const cw = Math.max(0.1, widths.length ? median(widths) : 10);
  const left = items.length ? Math.min(...items.map(i => i.bbox.x0)) : 0;
  const lineHeight = items.length ? median(items.map(i => i.height)) : 0;
  const lines = [], textLines = [];
  let bottom;
  for (const row of rows) {
    row.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const bbox = { x0: Math.min(...row.map(i => i.bbox.x0)), y0: Math.min(...row.map(i => i.bbox.y0)),
      x1: Math.max(...row.map(i => i.bbox.x1)), y1: Math.max(...row.map(i => i.bbox.y1)) };
    if (bottom !== undefined && bbox.y0 - bottom > 0.9 * lineHeight) textLines.push('');
    bottom = bbox.y1;
    let text = ' '.repeat(Math.min(1000, Math.max(0, rounded((row[0].bbox.x0 - left) / cw)))) + row[0].text;
    for (let n = 1; n < row.length; n++) {
      const gap = rounded((row[n].bbox.x0 - row[n - 1].bbox.x1) / cw);
      text += ' '.repeat(Math.min(1000, Math.max(1, gap >= 3 ? gap : 1))) + row[n].text;
    }
    text = text.trimEnd();
    const count = row.reduce((sum, i) => sum + length(i.text), 0);
    const confidence = row.reduce((sum, i) => sum + i.confidence * length(i.text), 0) / count;
    lines.push({ text, confidence, bbox, items: row, words: [] });
    textLines.push(text);
  }
  const count = items.reduce((sum, i) => sum + length(i.text), 0);
  return { data: {
    text: textLines.length ? textLines.join('\n') + '\n' : '',
    confidence: count ? items.reduce((sum, i) => sum + i.confidence * length(i.text), 0) / count : 0,
    lines, words: [], blocks: lines.length ? [{ paragraphs: [{ lines }] }] : [],
    items, image: result.image, metrics: result.metrics, runtime: result.runtime,
    engine: 'PP-OCRv6', geometryLevel: 'line'
  } };
}
