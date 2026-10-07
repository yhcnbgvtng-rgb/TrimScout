// Read and write the crawler's big JSON data files without ever building one giant string.
//
// Why: V8 refuses to build a string longer than ~512 MB ("Invalid string length"). The per-state data files the
// crawl keeps (data/inventory/<ST>.json, data/snapshots/<ST>.json, data/enriched_cache/<ST>.json, the day's
// daily_changes file) used to be written with JSON.stringify(wholeThing, null, 2) and read with
// JSON.parse(await fs.readFile(...)) — one string holding the entire file, and pretty-printed on top, which makes
// it 2-3x bigger than the data. A large state's shard (TX, FL, ...) can cross the limit, and the brand's run then
// dies inside the merge/persist step instead of finishing.
//
// What this does instead:
//   write  — walks the top-level array/object and writes ONE ELEMENT AT A TIME (compact JSON, one element per line),
//            into a temp file that is renamed over the target only when complete. The biggest string ever built is
//            one record (plus a ~1 MB write buffer). The rename also means a reader (the inventory sync reads every
//            *.json in data/inventory) or a crash/kill sees either the old complete file or the new complete file,
//            never a truncated one. Temp files end in ".tmp-<pid>-<ts>", NOT ".json", so the sync never picks one up.
//   read   — small files take the old fast path (JSON.parse of the whole text, same result as before). Files above
//            STREAM_ABOVE_BYTES are parsed by splitting the top-level array/object into elements and parsing each one,
//            so no string larger than one element exists. Old pretty-printed files and new compact files both read fine.
//
// Layout of what is written is still a top-level JSON array (inventory, snapshots' records) or object (snapshot,
// cache, daily_changes) — the same shapes as before — so every existing reader, including the box's inventory-sync
// (scripts/box/inventory-sync.mjs streamTopLevelObjects, which walks top-level objects of the array), keeps working
// with no change. Nothing to migrate: the first write of each file converts it to the compact layout.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

export const STREAM_ABOVE_BYTES = 64 * 1024 * 1024; // below this the plain readFile + JSON.parse path is used
const WRITE_CHUNK_CHARS = 1 << 20; // flush the write buffer at about 1 MB

const isPlainContainer = (v) => v !== null && typeof v === 'object' && !(v instanceof Date) && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

function stringifyElement(value, context) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    err.message = `${err.message} (while writing ${context})`;
    throw err;
  }
}

/**
 * Write `value` to `filePath` as compact JSON, element by element, atomically.
 * Arrays and plain objects are streamed; anything else is written as one JSON.stringify.
 * @returns {Promise<{bytes: number}>}
 */
export async function writeJsonLarge(filePath, value, { chunkChars = WRITE_CHUNK_CHARS } = {}) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const handle = await fsp.open(tmpPath, 'w');
  let bytes = 0;
  let buf = '';
  const flush = async () => {
    if (!buf) return;
    const { bytesWritten } = await handle.write(buf);
    bytes += bytesWritten;
    buf = '';
  };
  const push = async (s) => {
    buf += s;
    if (buf.length >= chunkChars) await flush();
  };
  try {
    if (Array.isArray(value)) {
      await push('[');
      for (let i = 0; i < value.length; i++) {
        const s = stringifyElement(value[i], `${filePath}[${i}]`);
        await push((i === 0 ? '\n' : ',\n') + (s === undefined ? 'null' : s));
      }
      await push(value.length ? '\n]\n' : ']\n');
    } else if (isPlainContainer(value)) {
      await push('{');
      let first = true;
      for (const key of Object.keys(value)) {
        const s = stringifyElement(value[key], `${filePath}[${JSON.stringify(key)}]`);
        if (s === undefined) continue; // same as JSON.stringify: undefined/function values are omitted
        await push((first ? '\n' : ',\n') + JSON.stringify(key) + ':' + s);
        first = false;
      }
      await push(first ? '}\n' : '\n}\n');
    } else {
      await push((stringifyElement(value, filePath) ?? 'null') + '\n');
    }
    await flush();
    await handle.sync();
    await handle.close();
    await fsp.rename(tmpPath, filePath);
    return { bytes };
  } catch (err) {
    try { await handle.close(); } catch { /* already closed */ }
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

// Splits a JSON text, arriving as string chunks, into its top-level container's elements without holding more than
// one element at a time. Calls onElement(text) for each. Returns 'array' | 'object' | 'scalar'.
function createTopLevelSplitter(onElement) {
  let kind = null; // 'array' | 'object' | 'scalar'
  let depth = 0;
  let inStr = false;
  let esc = false;
  let cur = '';
  let done = false;
  const emit = () => {
    const t = cur.trim();
    cur = '';
    if (t) onElement(t);
  };
  return {
    feed(chunk) {
      let seg = 0; // start of the not-yet-copied part of this chunk
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk.charCodeAt(i);
        if (kind === null) {
          if (ch === 0x20 || ch === 0x0a || ch === 0x0d || ch === 0x09 || ch === 0xfeff) { seg = i + 1; continue; }
          kind = ch === 0x5b ? 'array' : ch === 0x7b ? 'object' : 'scalar';
          if (kind === 'scalar') { seg = i; } else { seg = i + 1; }
          continue;
        }
        if (kind === 'scalar') continue; // accumulated at the end of the chunk
        if (done) continue;
        if (inStr) {
          if (esc) esc = false;
          else if (ch === 0x5c) esc = true;
          else if (ch === 0x22) inStr = false;
          continue;
        }
        if (ch === 0x22) { inStr = true; continue; }
        if (ch === 0x7b || ch === 0x5b) { depth++; continue; }
        if (ch === 0x7d || ch === 0x5d) {
          if (depth === 0) { // the closing bracket of the top-level container
            cur += chunk.slice(seg, i);
            emit();
            done = true;
            seg = i + 1;
            continue;
          }
          depth--;
          continue;
        }
        if (ch === 0x2c && depth === 0) { // a comma between top-level elements
          cur += chunk.slice(seg, i);
          emit();
          seg = i + 1;
        }
      }
      if (!done && kind !== null) cur += chunk.slice(seg);
    },
    finish() {
      if (kind === 'scalar') { emit(); return kind; }
      if (kind === null) throw new Error('empty JSON file');
      if (!done) throw new Error(`unterminated JSON ${kind} (file is truncated or corrupt)`);
      return kind;
    },
  };
}

async function readJsonStreaming(filePath, { chunkBytes }) {
  const elements = [];
  const splitter = createTopLevelSplitter((t) => elements.push(t));
  const decoder = new StringDecoder('utf8');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: chunkBytes });
    stream.on('data', (buf) => { try { splitter.feed(decoder.write(buf)); } catch (e) { stream.destroy(e); } });
    stream.on('end', () => { try { splitter.feed(decoder.end()); resolve(); } catch (e) { reject(e); } });
    stream.on('error', reject);
  });
  const kind = splitter.finish();
  // Elements were collected as text above only because each is small; parse them now, one at a time, releasing the
  // text as we go so the peak is the parsed data plus one element, never the whole file as a string.
  if (kind === 'array') {
    const out = new Array(elements.length);
    for (let i = 0; i < elements.length; i++) { out[i] = JSON.parse(elements[i]); elements[i] = null; }
    return out;
  }
  if (kind === 'object') {
    const out = {};
    for (let i = 0; i < elements.length; i++) {
      const entry = JSON.parse(`{${elements[i]}}`);
      elements[i] = null;
      for (const k of Object.keys(entry)) Object.defineProperty(out, k, { value: entry[k], enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return JSON.parse(elements[0]);
}

/**
 * Read a JSON file. Same result as JSON.parse(await fs.readFile(path, 'utf-8')), but files above `streamAboveBytes`
 * are parsed element by element so the file never has to fit in one V8 string. Throws like readFile/JSON.parse do
 * (ENOENT, SyntaxError) so existing try/catch fallbacks keep working.
 */
export async function readJsonLarge(filePath, { streamAboveBytes = STREAM_ABOVE_BYTES, chunkBytes = 1 << 20 } = {}) {
  const { size } = await fsp.stat(filePath);
  if (size <= streamAboveBytes) return JSON.parse(await fsp.readFile(filePath, 'utf-8'));
  return readJsonStreaming(filePath, { chunkBytes });
}
