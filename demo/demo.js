import { renderInsights, renderOverlay, textSummary } from './perception.js';

const $ = id => document.getElementById(id);
let image, objectURL, worker, controller, result, generation = 0, view = 'overview', resultEngine;
const isMirage = () => $('engine').value === 'mirage';
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function resetResult() {
  result = null; $('copy').disabled = true; $('save').disabled = true;
  $('text').value = ''; $('insights').replaceChildren(); $('overlay').replaceChildren();
  $('details').textContent = 'Only the selected engine loads. Its memory is released after each run.';
}
function choose(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (controller) return;
  image = file;
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = URL.createObjectURL(file);
  $('preview').src = objectURL; $('image-stage').hidden = false; $('placeholder').hidden = true;
  $('run').disabled = false; resetResult(); status(file.name || 'Pasted image');
}
function render() {
  const visual = isMirage() && view !== 'text' && view !== 'json';
  $('insights').hidden = !visual; $('text').hidden = visual;
  if (!result) return;
  if (!isMirage()) { $('text').value = result.data.text; return; }
  const data = result.data;
  $('text').value = view === 'json' ? JSON.stringify(data, null, 2) : (data.text || []).map(line => line.string || '').join('\n');
  renderInsights($('insights'), data, view);
  renderOverlay($('overlay'), data, view);
  $('overlay').toggleAttribute('hidden', !$('show-overlay').checked);
}
function configure() {
  $('mirage-options').hidden = !isMirage(); $('backend-field').hidden = isMirage();
  $('overlay-field').hidden = !isMirage(); $('result-tabs').hidden = !isMirage();
  $('run').textContent = isMirage() ? 'Analyze' : 'Recognize';
  $('output-title').textContent = isMirage() ? 'Perception' : 'Text'; render();
}
function busy(value) {
  for (const element of document.querySelectorAll('.toolbar input, .toolbar select, #mirage-options input, #mirage-options select, #schema')) element.disabled = value;
  $('run').disabled = value || !image; $('cancel').disabled = !value;
  $('drop').classList.toggle('scanning', value);
}
function options() {
  for (const input of document.querySelectorAll('#advanced input')) if (!input.reportValidity()) throw Error('Check the detection settings.');
  const out = { conf: +$('confidence').value, text_conf: +$('text-confidence').value, max_objects: +$('max-objects').value,
    max_text_lines: +$('max-lines').value, max_tokens: +$('max-tokens').value, mask_format: $('mask-format').value, nms: $('nms').checked };
  if ($('task').value === 'extract') {
    out.form = JSON.parse($('schema').value);
    if (!out.form || typeof out.form !== 'object' || Array.isArray(out.form) || !Object.keys(out.form).length) throw Error('Enter a nonempty JSON object for the form.');
  } else {
    out.sections = [...$('sections').querySelectorAll('input:checked')].map(input => input.value);
    if (!out.sections.length) throw Error('Choose at least one section.');
  }
  return out;
}
$('file').onchange = () => choose($('file').files[0]);
document.addEventListener('paste', event => { const file = event.clipboardData?.files[0]; if (file) { event.preventDefault(); choose(file); } });
$('drop').ondragover = event => event.preventDefault();
$('drop').ondrop = event => { event.preventDefault(); choose(event.dataTransfer.files[0]); };
$('engine').onchange = () => { resetResult(); configure(); status(isMirage() ? 'Mirage · image understanding and structured decisions, on CPU.' : 'Paddle · multilingual text recognition.'); };
$('backend').onchange = () => { resetResult(); status('Runtime changed. Ready for the next scan.'); };
$('task').onchange = () => { $('form-field').hidden = $('task').value !== 'extract'; $('sections').hidden = !$('form-field').hidden; };
$('preset').onchange = () => {
  const presets = { sign: { sign: { enum: ['stop', 'yield', 'speed limit'] } }, scene: { setting: { enum: ['indoor', 'outdoor'] }, people: { type: 'integer', minimum: 0, maximum: 50 } } };
  if (presets[$('preset').value]) $('schema').value = JSON.stringify(presets[$('preset').value], null, 2);
};
$('schema').oninput = () => { $('preset').value = 'custom'; };
$('show-overlay').onchange = render;
for (const tab of $('result-tabs').querySelectorAll('button')) tab.onclick = () => {
  view = tab.dataset.view;
  for (const item of $('result-tabs').querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === tab));
  render();
};
$('run').onclick = async () => {
  let settings;
  try { if (isMirage()) settings = options(); } catch (error) { status(error.message, true); return; }
  const token = ++generation;
  const operation = new AbortController(); controller = operation; resetResult(); busy(true);
  const logger = message => { if (generation === token) status(message.status); };
  let scanWorker;
  try {
    resultEngine = $('engine').value;
    if (isMirage()) {
      const { describe } = await import('./mirage.js');
      operation.signal.throwIfAborted();
      const next = await describe(image, { signal: operation.signal, logger, options: settings, language: $('language').value, keywords: $('keywords').value });
      if (generation !== token) return;
      result = next;
      $('details').textContent = `${next.runtime} · ${(next.totalMs / 1000).toFixed(2)} s · model released`;
      status('Image analyzed. Scores are model estimates, including abstentions.');
    } else {
      const { createWorker } = await import('./ppocr.js');
      operation.signal.throwIfAborted();
      scanWorker = await createWorker('eng', undefined, { backend: $('backend').value, signal: operation.signal, logger });
      worker = scanWorker;
      operation.signal.throwIfAborted();
      const next = await scanWorker.recognize(image, { signal: operation.signal });
      if (generation !== token) return;
      result = next;
      const { metrics, runtime, items } = result.data;
      status(items.length ? `Recognized ${items.length} text regions` : 'No text detected');
      $('details').textContent = `${runtime.detProvider} detection · ${runtime.recProvider} recognition · ${(metrics.totalMs / 1000).toFixed(2)} s · ${Math.round(result.data.confidence)}% mean model score · model released`;
    }
    render(); $('copy').disabled = false; $('save').disabled = false;
  } catch (error) { if (generation === token) status(error.message, true); }
  finally {
    await scanWorker?.terminate();
    if (worker === scanWorker) worker = null;
    if (controller === operation) { controller = null; busy(false); }
  }
};
$('cancel').onclick = async () => { generation++; controller?.abort(); await worker?.terminate(); worker = null; status('Cancelled · model released'); };
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(isMirage() && !$('insights').hidden ? textSummary(result.data, view) : $('text').value); status('Copied'); }
  catch (error) { status(error.message, true); }
};
$('save').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `${resultEngine}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener('pagehide', () => { generation++; controller?.abort(); worker?.terminate(); if (objectURL) URL.revokeObjectURL(objectURL); });
configure();
