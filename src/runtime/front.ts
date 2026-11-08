import http, { type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { readFileSync } from 'node:fs';

function headerPairs(raw: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([raw[i]!, raw[i + 1]!]);
  return pairs;
}

export interface FrontResponse {
  status: number;
  headers?: OutgoingHttpHeaders;
  body?: string | Buffer;
}

export interface FrontContext {
  request: IncomingMessage;
}

export interface BufferedEngineResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** Hooks are optional. Response hooks run only on content-length responses within the limit;
 * chunked, streaming and oversized responses pass through without buffering. */
export interface FrontHooks {
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
  onError?: (error: Error) => void;
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
    const ctx = { request: req };
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
      const headers = req.rawHeaders;
      const upstream = this.transport.request({ host: '127.0.0.1', port: this.enginePort, method: req.method, path: req.url, headers, agent: this.agent, ...(this.options.tls ? { rejectUnauthorized: false } : {}) });
      upstream.on('response', (response) => { void this.forwardResponse(ctx, response, res); });
      upstream.on('error', () => { if (!res.headersSent && !res.destroyed) { res.writeHead(502); res.end(); } else res.destroy(); });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
      req.on('end', () => { if (req.rawTrailers.length) upstream.addTrailers(headerPairs(req.rawTrailers)); });
      req.pipe(upstream);
    } catch {
      if (!res.headersSent && !res.destroyed) { res.writeHead(500); res.end(); } else res.destroy();
    }
  }

  private async forwardResponse(ctx: FrontContext, response: IncomingMessage, res: ServerResponse): Promise<void> {
    const length = response.headers['content-length'];
    const size = length !== undefined && /^\d+$/.test(length) ? Number(length) : NaN;
    if (this.options.hooks?.onResponse && Number.isSafeInteger(size) && size <= (this.options.maxBufferedResponseBytes ?? 1024 * 1024)) {
      try {
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of response) {
          const bytes = Buffer.from(chunk as Buffer);
          total += bytes.length;
          if (total > size) throw new Error('Invalid response length');
          chunks.push(bytes);
        }
        const body = Buffer.concat(chunks);
        const replacement = await this.options.hooks.onResponse(ctx, { status: response.statusCode ?? 502, headers: response.headers, body });
        if (res.destroyed) return;
        if (replacement) { this.send(res, replacement); return; }
        res.writeHead(response.statusCode ?? 502, response.statusMessage, response.rawHeaders);
        res.end(body);
      } catch { res.destroy(); }
      return;
    }
    res.writeHead(response.statusCode ?? 502, response.statusMessage, response.rawHeaders);
    response.on('error', () => res.destroy());
    response.on('end', () => { if (response.rawTrailers.length) res.addTrailers(headerPairs(response.rawTrailers)); });
    response.pipe(res);
  }

  private send(res: ServerResponse, response: FrontResponse): void {
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  }
}
