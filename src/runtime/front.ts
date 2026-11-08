import http, { type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { readFileSync } from 'node:fs';
import { type Readable, Transform } from 'node:stream';

function headerPairs(raw: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([raw[i]!, raw[i + 1]!]);
  return pairs;
}

export interface FrontResponse {
  status: number;
  headers?: OutgoingHttpHeaders;
  body?: string | Buffer;
  /** Streamed instead of `body`; destroyed when the client goes away. */
  stream?: Readable;
}

/** Observes the request body while it is forwarded unchanged. */
export interface RequestTap {
  chunk(data: Buffer): void;
  end(): void;
}

export interface FrontContext {
  request: IncomingMessage;
  /** Scratch space shared by the hooks of one request. */
  state: Record<string, unknown>;
  /**
   * Reads up to `limit` bytes of the request body. The bytes are still forwarded to the engine: a body that
   * fits is replayed from memory, a longer one is replayed followed by the unread rest of the stream.
   */
  readBody(limit: number): Promise<{ body: Buffer; complete: boolean }>;
  /** Set by onRequest to watch the body while it streams to the engine. */
  tap?: RequestTap;
  /** Extra header fields for the request to the engine (never sent to the client). */
  upstreamHeaders: [string, string][];
  upstreamMethod?: string;
}

export interface BufferedEngineResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** Hooks are optional. Responses are buffered up to the configured limit. */
export interface FrontHooks {
  /** Bytes the response may have to be buffered for onResponse; 0 streams it untouched. Defaults to the global limit. */
  bufferLimit?(ctx: FrontContext, headers: IncomingHttpHeaders): number;
  /** Called when a response wanted for buffering exceeds the limit. */
  onBypass?(ctx: FrontContext, headers: IncomingHttpHeaders, reason: 'too-large'): void;
  onRequest?(ctx: FrontContext): FrontResponse | undefined | Promise<FrontResponse | undefined>;
  onResponse?(ctx: FrontContext, response: BufferedEngineResponse): FrontResponse | undefined | Promise<FrontResponse | undefined>;
}

export interface FrontOptions {
  host: string;
  port: number;
  enginePort: number;
  tls?: { cert: string; key: string };
  hooks?: FrontHooks;
  maxBufferedResponseBytes?: number;
  /** Response header the engine adds for the hooks; removed before anything reaches the client. */
  privateResponseHeader?: string;
  /** Request header only the front layer may set; copies sent by clients are removed. */
  privateRequestHeader?: string;
  onError?: (error: Error) => void;
}

function withoutHeader(raw: string[], name: string | undefined): string[] {
  if (!name) return raw;
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) if (raw[i]!.toLowerCase() !== name) out.push(raw[i]!, raw[i + 1]!);
  return out;
}

export class FrontServer {
  private readonly server: http.Server | https.Server;
  private readonly sockets = new Set<Socket>();
  private readonly agent: http.Agent | https.Agent;
  private readonly transport: typeof http | typeof https;
  private enginePort: number;

  constructor(private readonly options: FrontOptions) {
    this.enginePort = options.enginePort;
    this.transport = options.tls ? https : http;
    this.agent = options.tls ? new https.Agent({ keepAlive: true, rejectUnauthorized: false }) : new http.Agent({ keepAlive: true });
    const handler: http.RequestListener = (req, res) => { void this.handle(req, res); };
    this.server = options.tls
      ? https.createServer({ cert: readFileSync(options.tls.cert), key: readFileSync(options.tls.key) }, handler)
      : http.createServer(handler);
    this.server.setTimeout(3600000);
    this.server.on('error', (error) => { if (this.server.listening) this.options.onError?.(error); });
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    this.server.on('upgrade', (req, socket, head) => {
      const upstream = this.transport.request({ host: '127.0.0.1', port: this.enginePort, method: req.method, path: req.url, headers: req.rawHeaders, agent: false, ...(options.tls ? { rejectUnauthorized: false } : {}) });
      upstream.on('upgrade', (response, target, upstreamHead) => {
        socket.write(`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n${response.rawHeaders.reduce((s, value, i) => s + (i % 2 ? `${value}\r\n` : `${value}: `), '')}\r\n`);
        if (upstreamHead.length) socket.write(upstreamHead);
        if (head.length) target.write(head);
        socket.pipe(target).pipe(socket);
        socket.on('error', () => target.destroy());
        target.on('error', () => socket.destroy());
      });
      upstream.on('response', (response) => {
        socket.write(`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n${response.rawHeaders.reduce((s, value, i) => s + (i % 2 ? `${value}\r\n` : `${value}: `), '')}\r\n`);
        response.on('error', () => socket.destroy());
        response.pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => upstream.destroy());
      upstream.end();
    });
  }

  setEnginePort(port: number): void { this.enginePort = port; }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once('error', onError);
      this.server.listen(this.options.port, this.options.host, () => {
        this.server.off('error', onError);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.agent.destroy();
    const closed = this.server.listening ? new Promise<void>((resolve) => this.server.close(() => resolve())) : Promise.resolve();
    for (const socket of this.sockets) socket.destroy();
    await closed;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ctx = this.createContext(req);
    if (!this.enginePort) { req.resume(); res.writeHead(503); res.end(); return; }
    try {
      const early = await this.options.hooks?.onRequest?.(ctx);
      if (res.destroyed) return;
      if (early) {
        req.resume();
        this.send(res, early);
        return;
      }
      // Forward the original header fields, including duplicates, without inventing forwarding headers.
      const privateRequest = this.options.privateRequestHeader?.toLowerCase();
      const headers = [...withoutHeader(req.rawHeaders, privateRequest), ...ctx.upstreamHeaders.flat()];
      const upstream = this.transport.request({ host: '127.0.0.1', port: this.enginePort, method: ctx.upstreamMethod ?? req.method, path: req.url, headers, agent: this.agent, ...(this.options.tls ? { rejectUnauthorized: false } : {}) });
      upstream.on('response', (response) => { void this.forwardResponse(ctx, response, res); });
      upstream.on('error', () => { if (!res.headersSent && !res.destroyed) { res.writeHead(502); res.end(); } else res.destroy(); });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
      const consumed = this.consumed.get(ctx);
      if (consumed?.complete) {
        ctx.tap?.chunk(consumed.prefix);
        ctx.tap?.end();
        if (req.rawTrailers.length) upstream.addTrailers(headerPairs(req.rawTrailers));
        upstream.end(consumed.prefix);
        return;
      }
      req.on('end', () => { if (req.rawTrailers.length) upstream.addTrailers(headerPairs(req.rawTrailers)); });
      if (consumed) {
        ctx.tap?.chunk(consumed.prefix);
        upstream.write(consumed.prefix);
      }
      const tap = ctx.tap;
      if (tap) {
        const watcher = new Transform({
          transform(chunk: Buffer, _encoding, callback) { tap.chunk(chunk); callback(null, chunk); },
          flush(callback) { tap.end(); callback(); },
        });
        req.on('error', () => watcher.destroy());
        req.pipe(watcher).pipe(upstream);
      } else req.pipe(upstream);
    } catch {
      if (!res.headersSent && !res.destroyed) { res.writeHead(500); res.end(); } else res.destroy();
    }
  }

  private async forwardResponse(ctx: FrontContext, response: IncomingMessage, res: ServerResponse): Promise<void> {
    const hooks = this.options.hooks;
    const rawHeaders = withoutHeader(response.rawHeaders, this.options.privateResponseHeader?.toLowerCase());
    const length = response.headers['content-length'];
    const size = length !== undefined && /^\d+$/.test(length) ? Number(length) : NaN;
    const limit = hooks?.onResponse ? (hooks.bufferLimit ? hooks.bufferLimit(ctx, response.headers) : this.options.maxBufferedResponseBytes ?? 1024 * 1024) : 0;
    if (hooks?.onResponse && limit > 0 && (!Number.isSafeInteger(size) || size <= limit)) {
      try {
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of response) {
          const bytes = Buffer.from(chunk as Buffer);
          total += bytes.length;
          chunks.push(bytes);
          if (total > limit) {
            hooks.onBypass?.(ctx, response.headers, 'too-large');
            res.writeHead(response.statusCode ?? 502, response.statusMessage, rawHeaders);
            for (const buffered of chunks) if (!res.write(buffered)) await new Promise<void>((resolve) => res.once('drain', resolve));
            for await (const rest of response) if (!res.write(rest)) await new Promise<void>((resolve) => res.once('drain', resolve));
            if (response.rawTrailers.length) res.addTrailers(headerPairs(response.rawTrailers));
            res.end();
            return;
          }
        }
        const body = Buffer.concat(chunks);
        const replacement = await hooks.onResponse(ctx, { status: response.statusCode ?? 502, headers: response.headers, body });
        if (res.destroyed) { replacement?.stream?.destroy(); return; }
        if (replacement) { this.send(res, replacement); return; }
        res.writeHead(response.statusCode ?? 502, response.statusMessage, rawHeaders);
        res.end(body);
      } catch { res.destroy(); }
      return;
    }
    if (hooks?.onResponse && limit > 0 && Number.isSafeInteger(size) && size > limit) hooks.onBypass?.(ctx, response.headers, 'too-large');
    res.writeHead(response.statusCode ?? 502, response.statusMessage, rawHeaders);
    response.on('error', () => res.destroy());
    response.on('end', () => { if (response.rawTrailers.length) res.addTrailers(headerPairs(response.rawTrailers)); });
    response.pipe(res);
  }

  private send(res: ServerResponse, response: FrontResponse): void {
    const headers = { ...response.headers };
    const hidden = this.options.privateResponseHeader?.toLowerCase();
    if (hidden) for (const name of Object.keys(headers)) if (name.toLowerCase() === hidden) delete headers[name];
    res.writeHead(response.status, headers);
    const stream = response.stream;
    if (!stream) { res.end(response.body); return; }
    if (res.req.method === 'HEAD') { stream.destroy(); res.end(); return; }
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  private readonly consumed = new WeakMap<FrontContext, { prefix: Buffer; complete: boolean }>();

  private createContext(request: IncomingMessage): FrontContext {
    const ctx: FrontContext = {
      request,
      state: {},
      upstreamHeaders: [],
      readBody: (limit) => this.readBody(ctx, limit),
    };
    return ctx;
  }

  private readBody(ctx: FrontContext, limit: number): Promise<{ body: Buffer; complete: boolean }> {
    const previous = this.consumed.get(ctx);
    if (previous) return Promise.resolve({ body: previous.prefix, complete: previous.complete });
    const req = ctx.request;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const detach = () => { req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('close', onClose); };
      const finish = (complete: boolean) => {
        detach();
        const prefix = Buffer.concat(chunks);
        this.consumed.set(ctx, { prefix, complete });
        resolve({ body: prefix, complete });
      };
      const onData = (chunk: Buffer) => {
        chunks.push(chunk);
        total += chunk.length;
        if (total > limit) { req.pause(); finish(false); }
      };
      const onEnd = () => finish(true);
      const onError = (error: Error) => { detach(); reject(error); };
      const onClose = () => { if (!req.complete) onError(new Error('Request aborted')); };
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
      req.on('close', onClose);
    });
  }
}
