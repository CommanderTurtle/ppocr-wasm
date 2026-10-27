import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const root = new URL('../', import.meta.url);
export const models = JSON.parse(await readFile(new URL('models.json', root), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function prepareModels() {
  await mkdir(new URL('.cache/models/', root), { recursive: true });
  for (const model of Object.values(models.small)) {
    const path = new URL(`.cache/models/${model.name}.tar`, root);
    const cached = await readFile(path).catch(() => null);
    if (cached && hash(cached) === model.sha256) continue;
    console.log(`Downloading ${model.name}`);
    const response = await fetch(model.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw Error(`${model.name}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== model.sha256) throw Error(`${model.name}: SHA-256 mismatch. The pinned model was not replaced.`);
    await writeFile(path, bytes);
  }
}

if (import.meta.main) await prepareModels();
