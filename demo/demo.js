import { createWorker } from './ppocr.js';

const $ = id => document.getElementById(id);
let image, objectURL, worker, controller, result, generation = 0;
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function choose(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (controller) return;
  image = file;
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = URL.createObjectURL(file);
  $('preview').src = objectURL; $('preview').hidden = false; $('placeholder').hidden = true;
  $('run').disabled = false; result = null; $('copy').disabled = true; $('save').disabled = true;
  $('text').value = ''; status(file.name || 'Pasted image');
}
$('file').onchange = () => choose($('file').files[0]);
document.addEventListener('paste', event => { const file = event.clipboardData?.files[0]; if (file) { event.preventDefault(); choose(file); } });
$('drop').ondragover = event => event.preventDefault();
$('drop').ondrop = event => { event.preventDefault(); choose(event.dataTransfer.files[0]); };
$('backend').onchange = async () => { generation++; await worker?.terminate(); worker = null; status('Runtime changed. The next recognition loads fresh sessions.'); };
$('run').onclick = async () => {
  const token = ++generation;
  controller = new AbortController();
  $('run').disabled = true; $('file').disabled = true; $('backend').disabled = true; $('cancel').disabled = false;
  try {
    if (!worker) worker = await createWorker('eng', undefined, { backend: $('backend').value, signal: controller.signal,
      logger: message => { if (generation === token) status(message.status); } });
    if (token !== generation) { await worker.terminate(); worker = null; return; }
    result = await worker.recognize(image, { signal: controller.signal });
    $('text').value = result.data.text;
    $('copy').disabled = !result.data.text; $('save').disabled = false;
    const { metrics, runtime, items } = result.data;
    status(items.length ? `Recognized ${items.length} text regions` : 'No text detected');
    $('details').textContent = `${runtime.detProvider} detection · ${runtime.recProvider} recognition · ${(metrics.totalMs / 1000).toFixed(2)} s · ${Math.round(result.data.confidence)}% mean model score`;
  } catch (error) {
    if (generation === token) status(error.message, true);
    await worker?.terminate(); worker = null;
  } finally {
    controller = null; $('run').disabled = !image; $('file').disabled = false; $('backend').disabled = false; $('cancel').disabled = true;
  }
};
$('cancel').onclick = async () => { generation++; controller?.abort(); await worker?.terminate(); worker = null; status('Cancelled'); };
$('copy').onclick = async () => { try { await navigator.clipboard.writeText($('text').value); status('Copied'); } catch (error) { status(error.message, true); } };
$('save').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'ocr.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
