import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { restoreEvent } from './compatibility.mjs';

// Transforms complete SSE events. Never assumes a network chunk equals a line or JSON value.
export function createEventTranslator(plan, { maxEventBytes = 1024 * 1024, onEvent, onDone } = {}) {
  if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes < 1) throw new Error('invalid_event_limit');
  if ((onEvent !== undefined && typeof onEvent !== 'function') ||
      (onDone !== undefined && typeof onDone !== 'function')) throw new Error('invalid_event_observer');
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let atStart = true;
  let lines = [];
  let eventBytes = 0;
  function append(decoded) {
    if (atStart && decoded.length) {
      atStart = false;
      if (decoded.startsWith('\uFEFF')) decoded = decoded.slice(1);
    }
    pending += decoded;
  }
  function event(stream) {
    const data = lines.filter(line => line.startsWith('data:') || line === 'data').map(line => {
      const value = line === 'data' ? '' : line.slice(5);
      return value.startsWith(' ') ? value.slice(1) : value;
    });
    if (data.length && data.join('\n') !== '[DONE]') {
      let value;
      try { value = JSON.parse(data.join('\n')); }
      catch { throw new Error('invalid_sse_json'); }
      const restored = restoreEvent(value, plan);
      onEvent?.(restored);
      const encoded = 'data: ' + JSON.stringify(restored);
      let written = false;
      lines = lines.flatMap(line => {
        if (!line.startsWith('data:') && line !== 'data') return [line];
        if (written) return [];
        written = true;
        return [encoded];
      });
    } else if (data.length) onDone?.();
    stream.push(lines.join('\n') + '\n\n');
    lines = [];
    eventBytes = 0;
  }
  function line(value, stream) {
    eventBytes += Buffer.byteLength(value) + 1;
    if (eventBytes > maxEventBytes) throw new Error('sse_event_too_large');
    if (value === '') event(stream);
    else lines.push(value);
  }
  function consume(stream, final = false) {
    while (true) {
      const index = pending.search(/[\r\n]/);
      if (index < 0) break;
      if (!final && pending[index] === '\r' && index === pending.length - 1) break;
      const count = pending[index] === '\r' && pending[index + 1] === '\n' ? 2 : 1;
      const value = pending.slice(0, index);
      pending = pending.slice(index + count);
      line(value, stream);
    }
    if (eventBytes + Buffer.byteLength(pending) > maxEventBytes) throw new Error('sse_event_too_large');
  }
  return new Transform({
    transform(chunk, encoding, callback) {
      try { append(decoder.write(chunk)); consume(this); callback(); }
      catch (error) { callback(error); }
    },
    flush(callback) {
      try {
        append(decoder.end());
        consume(this, true);
        // Discard an incomplete final event, matching SSE dispatch-at-blank-line behavior.
        callback();
      } catch (error) { callback(error); }
    },
  });
}
