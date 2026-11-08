import type { MultipartLog, MultipartPartLog } from '../core/view.js';

const MAX_PARTS = 200;
const MAX_PART_HEADER_BYTES = 16 * 1024;
const MAX_TEXT = 200;

/** Reads the boundary of a multipart/form-data Content-Type value, if any. */
export function multipartBoundary(contentType: string | undefined): string | undefined {
  if (!contentType || !/^\s*multipart\/form-data\s*(;|$)/i.test(contentType)) return undefined;
  const match = /;\s*boundary=(?:"([^"]{1,200})"|([^\s;"]{1,200}))/i.exec(contentType);
  return match?.[1] ?? match?.[2];
}

function clip(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_TEXT);
}

function parameter(header: string, name: string): string | undefined {
  const match = new RegExp(`[;\\s]${name}=(?:"((?:[^"\\\\]|\\\\.)*)"|([^;\\s]*))`, 'i').exec(header);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? undefined : value.replace(/\\(.)/g, '$1');
}

type State = 'delimiter' | 'after' | 'headers' | 'done';

/**
 * Streaming multipart/form-data inspector. It sees each chunk once, keeps at most one delimiter's worth
 * of bytes plus one part header block, and records only names, file names, content types and sizes.
 * Part contents are counted and discarded; nothing is stored or logged.
 */
export class MultipartInspector {
  private readonly delimiter: Buffer;
  private state: State = 'delimiter';
  private buffer: Buffer = Buffer.from('\r\n');
  private current: MultipartPartLog | undefined;
  private readonly parts: MultipartPartLog[] = [];
  private total = 0;
  private truncated = false;

  constructor(boundary: string, private readonly maxBytes = 50 * 1024 * 1024) {
    this.delimiter = Buffer.from(`\r\n--${boundary}`);
  }

  write(chunk: Buffer): void {
    if (this.state === 'done') return;
    this.total += chunk.length;
    if (this.total > this.maxBytes) { this.stop(true); return; }
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    this.scan();
  }

  private stop(truncated: boolean): void {
    if (truncated) this.truncated = true;
    this.state = 'done';
    this.buffer = Buffer.alloc(0);
  }

  private scan(): void {
    for (;;) {
      if (this.state === 'delimiter') {
        const at = this.buffer.indexOf(this.delimiter);
        if (at < 0) {
          const keep = Math.min(this.buffer.length, this.delimiter.length - 1);
          if (this.current) this.current.size += this.buffer.length - keep;
          this.buffer = this.buffer.subarray(this.buffer.length - keep);
          return;
        }
        if (this.current) this.current.size += at;
        this.current = undefined;
        this.buffer = this.buffer.subarray(at + this.delimiter.length);
        this.state = 'after';
      } else if (this.state === 'after') {
        if (this.buffer.length < 2) return;
        if (this.buffer[0] === 0x2d && this.buffer[1] === 0x2d) { this.stop(false); return; }
        // Skip transport padding up to the line break.
        const eol = this.buffer.indexOf('\r\n');
        if (eol < 0) { if (this.buffer.length > 1024) this.stop(true); return; }
        this.buffer = this.buffer.subarray(eol + 2);
        this.state = 'headers';
      } else if (this.state === 'headers') {
        let end: number;
        let skip: number;
        if (this.buffer.length >= 2 && this.buffer[0] === 0x0d && this.buffer[1] === 0x0a) { end = 0; skip = 2; }
        else {
          end = this.buffer.indexOf('\r\n\r\n');
          skip = 4;
        }
        if (end < 0) { if (this.buffer.length > MAX_PART_HEADER_BYTES) this.stop(true); return; }
        const block = this.buffer.subarray(0, end).toString('latin1');
        this.buffer = this.buffer.subarray(end + skip);
        if (this.parts.length >= MAX_PARTS) { this.stop(true); return; }
        this.current = this.describe(block);
        this.parts.push(this.current);
        this.state = 'delimiter';
      } else return;
    }
  }

  private describe(block: string): MultipartPartLog {
    const part: MultipartPartLog = { size: 0 };
    for (const line of block.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (name === 'content-disposition') {
        const field = clip(parameter(value, 'name'));
        const file = clip(parameter(value, 'filename'));
        if (field !== undefined) part.name = field;
        if (file !== undefined) part.fileName = file;
      } else if (name === 'content-type') part.contentType = clip(value);
    }
    return part;
  }

  end(): MultipartLog {
    if (this.state !== 'done' && this.current) this.current.size += this.buffer.length;
    return { parts: this.parts.map((p) => ({ ...p })), totalBytes: this.total, ...(this.truncated ? { truncated: true } : {}) };
  }
}
