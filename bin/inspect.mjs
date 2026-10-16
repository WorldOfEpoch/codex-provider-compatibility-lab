import { open } from 'node:fs/promises';
import { inspectRequest } from '../src/compatibility.mjs';

const maxBytes = 8 * 1024 * 1024;
let handle;
try {
  if (process.argv.length !== 3) throw new Error('usage');
  handle = await open(process.argv[2], 'r');
  const info = await handle.stat();
  if (!info.isFile() || info.size > maxBytes) throw new Error('size');
  const buffer = Buffer.alloc(maxBytes + 1);
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  if (length > maxBytes) throw new Error('size');
  const input = JSON.parse(buffer.subarray(0, length).toString('utf8').replace(/^\uFEFF/, ''));
  const result = inspectRequest(input);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.history.issues.length || !result.toolPlan.supported) process.exitCode = 1;
} catch {
  // Parser messages can contain fragments of a private prompt or filename.
  process.stderr.write('Inspection failed. Supply one JSON request file no larger than 8 MiB.\n');
  process.exitCode = 2;
} finally {
  await handle?.close();
}
