const colors = ['#a2e7ce', '#b6b1ff', '#ffc685', '#7ccfff', '#ffaec9', '#c6e78a'];
const compact = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const score = value => typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function card(parent, title, text) { const el = node('article', undefined, 'insight'); el.append(node('h3', title), node('pre', text)); parent.append(el); return el; }

export function textSummary(data, view) {
  if (view === 'overview') return Object.entries(data).map(([name, content]) => `${name}\n${compact(content)}`).join('\n\n');
  return compact(data[view] ?? []);
}

export function renderInsights(parent, data, view) {
  parent.replaceChildren();
  if (view === 'overview') {
    if (data.scene) card(parent, 'Scene', compact(data.scene));
    const counts = node('div', undefined, 'counts');
    for (const [label, key] of [['objects', 'objects'], ['text regions', 'text'], ['relations', 'relations']]) {
      const item = node('div'); item.append(node('strong', String(data[key]?.length || 0)), node('span', label)); counts.append(item);
    }
    parent.append(counts);
    for (const key of ['reasoning', 'events', 'regions']) if (data[key] && (!Array.isArray(data[key]) || data[key].length)) card(parent, key, compact(data[key]));
    if (data.form) renderForms(parent, data.form);
    if (!data.scene && !data.reasoning) card(parent, 'Explore', 'Choose Objects, Text or Relations for individual results. JSON preserves the complete model response.');
  } else if (view === 'objects') {
    (data.objects || []).forEach((object, index) => {
      const el = card(parent, `${object.name || object.id || 'Object'} · ${score(object.score)}`, compact(Object.fromEntries(Object.entries(object).filter(([key]) => !['mask', 'name', 'score'].includes(key)))));
      el.dataset.region = String(index); el.tabIndex = 0;
      const highlight = active => { for (const mark of document.querySelectorAll('#overlay [data-region]')) mark.classList.toggle('highlight', active && mark.dataset.region === String(index)); };
      el.onpointerenter = () => highlight(true); el.onpointerleave = () => highlight(false); el.onfocus = () => highlight(true); el.onblur = () => highlight(false);
    });
  } else if (view === 'form') renderForms(parent, data.form || {});
  else if (view === 'relations') {
    const names = new Map((data.objects || []).map(object => [object.id, object.name || object.id]));
    for (const relation of data.relations || []) {
      const record = typeof relation === 'object' && relation ? Object.fromEntries(Object.entries(relation).map(([key, value]) => [key, ['subject', 'object', 'source', 'target'].includes(key) ? (names.get(value) || value) : value])) : relation;
      card(parent, 'Relation', compact(record));
    }
  }
  if (!parent.childElementCount) card(parent, 'No results', 'This section was empty or was not requested.');
}
function renderForms(parent, form) {
  for (const [name, entry] of Object.entries(form)) {
    const el = card(parent, name, entry && typeof entry === 'object' ? compact(entry.value ?? 'Abstained') : compact(entry));
    if (!entry || typeof entry !== 'object') continue;
    for (const [choice, probability] of Object.entries(entry.probabilities || {}).sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1))) {
      const row = node('div', undefined, 'probability');
      row.append(node('span', choice), node('span', score(probability)));
      const meter = node('progress'); meter.max = 1; meter.value = typeof probability === 'number' && Number.isFinite(probability) ? Math.max(0, Math.min(1, probability)) : 0; meter.setAttribute('aria-label', `${choice}: ${score(probability)}`);
      row.append(meter); el.append(row);
    }
    if (!entry.probabilities) el.append(node('pre', compact(entry)));
  }
}

function svg(tag, attributes) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value)); return el;
}
export function renderOverlay(parent, data, view) {
  parent.replaceChildren();
  const objects = view === 'text' ? [] : data.objects || [];
  const lines = ['overview', 'text'].includes(view) ? data.text || [] : [];
  const regions = [...objects.map((object, index) => ({ ...object, index })), ...lines.map(line => ({ ...line, name: line.string, index: -1 }))];
  for (const object of regions) {
    const color = object.index < 0 ? '#ffc685' : colors[object.index % colors.length];
    const group = svg('g', { 'data-region': object.index, stroke: color, 'stroke-width': 2, fill: 'none' });
    if (Array.isArray(object.mask)) {
      const rings = typeof object.mask[0] === 'number' ? [object.mask] : object.mask;
      for (const ring of rings) if (Array.isArray(ring) && ring.length >= 6 && ring.length % 2 === 0 && ring.every(Number.isFinite)) {
        group.append(svg('polygon', { points: ring.map((value, i) => `${value}${i % 2 ? ' ' : ','}`).join(''), fill: color, 'fill-opacity': 0.16, 'vector-effect': 'non-scaling-stroke' }));
      }
    }
    if (Array.isArray(object.bbox) && object.bbox.length === 4 && object.bbox.every(Number.isFinite)) {
      const [left, top, right, bottom] = object.bbox;
      if (right > left && bottom > top) group.append(svg('rect', { x: left, y: top, width: right - left, height: bottom - top, 'vector-effect': 'non-scaling-stroke' }));
    }
    const title = svg('title', {}); title.textContent = `${object.name || 'Region'} · ${score(object.score)}`; group.append(title); parent.append(group);
  }
}
