import { type Environment, ServerErrorCodes, type Transaction } from '@mockoon/commons';
import { MockoonServer } from '@mockoon/commons-server';
import { EventEmitter } from 'node:events';
import { certificatePaths, showCertificates } from '../core/certs.js';
import type { Recording, RequestLog, RuntimeState, RuntimeStatus } from '../core/view.js';
import type { ProjectDocument } from '../store/document.js';
import { type RuntimeEnvironment, type RuntimeOverrides, buildRuntimeEnvironment } from './environment.js';
import { captureTransaction } from '../core/recording.js';
import { invalid } from '../core/errors.js';
import { maskHeaders, maskQuery } from './masking.js';
import { FrontServer } from './front.js';
import type { Server as HttpServer } from 'node:http';

export type { RequestLog, RuntimeState, RuntimeStatus } from '../core/view.js';

export interface RuntimeOptions {
  /** Folder used by the engine to resolve relative file bodies. */
  environmentDirectory: string;
  maxLogs?: number;
}

const MAX_LOGGED_BODY = 10_000;
const ENV_VARS_PREFIX = 'MOCKBREW_';

const ERROR_MESSAGES: Partial<Record<ServerErrorCodes, (port: number, host: string) => string>> = {
  [ServerErrorCodes.PORT_ALREADY_USED]: (port) => `Port ${port} is already in use. Stop the other process or choose another port.`,
  [ServerErrorCodes.PORT_INVALID]: (port) => `Port ${port} is not valid or requires elevated privileges.`,
  [ServerErrorCodes.HOSTNAME_UNAVAILABLE]: (_p, host) => `The address ${host} is not available on this machine.`,
  [ServerErrorCodes.HOSTNAME_UNKNOWN]: (_p, host) => `The host name ${host} cannot be resolved.`,
};

function truncate(text: string): string {
  return text.length > MAX_LOGGED_BODY ? `${text.slice(0, MAX_LOGGED_BODY)}... (truncated)` : text;
}

function stringifyBody(body: unknown): string | undefined {
  if (body === undefined || body === null || body === '') return undefined;
  return truncate(typeof body === 'string' ? body : JSON.stringify(body));
}

/** Runs the Mockoon engine for a project and keeps a bounded, masked request log. */
export class MockRuntime extends EventEmitter {
  private server: MockoonServer | undefined;
  private front: FrontServer | undefined;
  private enginePort = 0;
  private current: RuntimeEnvironment | undefined;
  private state: RuntimeState = 'stopped';
  private error: string | undefined;
  private startedAt: string | undefined;
  private lastHost = '127.0.0.1';
  private lastPort = 0;
  private nextLogId = 1;
  private logBodies = false;
  private readonly entries: RequestLog[] = [];
  private recording = false;
  private nextRecordingId = 1;
  private readonly recordings: Recording[] = [];
  private readonly maxLogs: number;

  constructor(private readonly options: RuntimeOptions) {
    super();
    this.maxLogs = options.maxLogs ?? 1000;
  }

  status(): RuntimeStatus {
    return {
      state: this.state,
      host: this.lastHost,
      port: this.lastPort,
      ...(this.state === 'running' ? { url: `${this.current?.environment.tlsOptions.enabled ? 'https' : 'http'}://${this.lastHost === '0.0.0.0' ? 'localhost' : this.lastHost}:${this.lastPort}` } : {}),
      ...(this.error ? { error: this.error } : {}),
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
      routeCount: this.current?.routeCount ?? 0,
    };
  }

  logs(afterId = 0): RequestLog[] {
    return this.entries.filter((e) => e.id > afterId);
  }

  startRecording(): void {
    if (this.state !== 'running' || !this.current?.environment.proxyMode || !this.current.environment.proxyHost) throw invalid('Start the server with proxy enabled before recording.');
    this.recording = true;
  }

  stopRecording(): void { this.recording = false; }

  listRecordings(): { recording: boolean; recordings: Recording[] } {
    return { recording: this.recording, recordings: structuredClone(this.recordings) };
  }

  clearLogs(): void {
    this.entries.length = 0;
  }

  private setState(state: RuntimeState, error?: string): void {
    this.state = state;
    this.error = error;
    this.emit('status', this.status());
  }

  private createServer(environment: Environment): MockoonServer {
    const server = new MockoonServer(environment, {
      environmentDirectory: this.options.environmentDirectory,
      disabledRoutes: [],
      enableAdminApi: false,
      disableTls: !environment.tlsOptions.enabled,
      // Zero makes the engine retain every transaction (slice(-0)); keep only one.
      maxTransactionLogs: 1,
      envVarsPrefix: ENV_VARS_PREFIX,
    });
    server.on('transaction-complete', (transaction) => this.record(transaction));
    return server;
  }

  private withTls(runtime: RuntimeEnvironment, document: ProjectDocument): RuntimeEnvironment {
    const enabled = document.studio.settings.https.enabled;
    const p = certificatePaths(this.options.environmentDirectory);
    if (enabled && !showCertificates(this.options.environmentDirectory).exists) throw new Error('Create project certificates before starting HTTPS.');
    runtime.environment.tlsOptions = { enabled, type: 'CERT', pfxPath: '', certPath: enabled ? p.cert : '', keyPath: enabled ? p.key : '', caPath: '', passphrase: '' };
    return runtime;
  }

  async start(document: ProjectDocument, overrides: RuntimeOverrides = {}): Promise<RuntimeStatus> {
    if (this.server) throw new Error('The mock server is already running.');
    const runtimeEnv = this.withTls(buildRuntimeEnvironment(document, overrides), document);
    this.logBodies = document.studio.settings.logBodies;
    await this.launch(runtimeEnv);
    return this.status();
  }

  private engineEnvironment(environment: Environment): Environment {
    return { ...environment, hostname: '127.0.0.1', port: this.enginePort };
  }

  private async launch(runtimeEnv: RuntimeEnvironment): Promise<void> {
    const { environment } = runtimeEnv;
    this.current = runtimeEnv;
    this.lastHost = environment.hostname;
    this.lastPort = environment.port;
    this.setState('starting');
    this.enginePort = 0;
    const server = this.createServer(this.engineEnvironment(environment));
    let started = false;
    server.on('error', (code, original) => {
      if (started) this.emit('server-error', { code, message: `${code}${original ? `: ${original.message}` : ''}` });
    });
    try {
      const tls = environment.tlsOptions.enabled ? { cert: environment.tlsOptions.certPath, key: environment.tlsOptions.keyPath } : undefined;
      const front = new FrontServer({ host: environment.hostname, port: environment.port, enginePort: 0, tls, onError: (error) => this.emit('server-error', { code: 'FRONT_ERROR', message: error.message }) });
      this.front = front;
      // Reserve the public port first so the OS cannot assign it to the engine.
      await front.listen();
      await new Promise<void>((resolve, reject) => {
        const onError = (code: ServerErrorCodes, original: Error | null) => reject(original ?? new Error(code));
        server.once('error', onError);
        server.once('started', () => { server.off('error', onError); resolve(); });
        server.start();
      });
      started = true;
      this.server = server;
      // The engine does not expose its listener address; read the OS-assigned port from its server.
      const listener = (server as unknown as { serverInstance: HttpServer }).serverInstance;
      const address = listener.address();
      if (!address || typeof address === 'string') throw new Error('Engine listener has no TCP address.');
      this.enginePort = address.port;
      // Listener settings no longer control the bound socket; retain the public values for engine behavior.
      server.updateEnvironment(environment);
      front.setEnginePort(this.enginePort);
      this.startedAt = new Date().toISOString();
      this.setState('running');
    } catch (error) {
      await this.stopServer();
      const code = (error as NodeJS.ErrnoException).code;
      const mapped = code === 'EADDRINUSE' ? ServerErrorCodes.PORT_ALREADY_USED : code === 'EACCES' || code === 'ERR_SOCKET_BAD_PORT' ? ServerErrorCodes.PORT_INVALID : code === 'EADDRNOTAVAIL' ? ServerErrorCodes.HOSTNAME_UNAVAILABLE : code === 'ENOTFOUND' ? ServerErrorCodes.HOSTNAME_UNKNOWN : undefined;
      const message = (mapped && ERROR_MESSAGES[mapped]?.(environment.port, environment.hostname)) || (error as Error).message;
      this.setState('error', message);
      throw new Error(message);
    }
  }

  /** Applies a changed project to the running server without restarting it (unless host or port changed). */
  async update(document: ProjectDocument, overrides: RuntimeOverrides = {}): Promise<void> {
    if (!this.server) return;
    const next = this.withTls(buildRuntimeEnvironment(document, overrides), document);
    if (!next.environment.proxyMode || !next.environment.proxyHost) this.recording = false;
    this.logBodies = document.studio.settings.logBodies;
    const { environment } = next;
    if (environment.port !== this.lastPort || environment.hostname !== this.lastHost || environment.tlsOptions.enabled !== this.current?.environment.tlsOptions.enabled) {
      await this.stopServer();
      try {
        await this.launch(next);
      } catch {
        // launch() already recorded the error state
      }
      return;
    }
    this.current = next;
    this.server.updateEnvironment(environment);
    this.emit('status', this.status());
  }

  async resetRequestCounters(): Promise<void> {
    if (!this.server || !this.current) return;
    // Engine requestNumbers belongs to the server instance; updateEnvironment does not reset it.
    const current = this.current;
    await this.stopServer();
    await this.launch(current);
  }

  private async stopServer(): Promise<void> {
    const front = this.front;
    this.front = undefined;
    await front?.close();
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => {
      server.once('stopped', () => resolve());
      server.stop();
    });
    this.enginePort = 0;
  }

  async stop(): Promise<void> {
    await this.stopServer();
    this.server = undefined;
    this.startedAt = undefined;
    this.recording = false;
    this.setState('stopped');
  }

  private record(transaction: Transaction): void {
    const current = this.current;
    const proxied = transaction.proxied === true;
    // The engine's transaction-complete event carries the proxied response body and headers.
    if (proxied && this.recording) {
      this.recordings.push(captureTransaction(transaction, this.nextRecordingId++));
      if (this.recordings.length > 500) this.recordings.shift();
    }
    const matched = !proxied && !current?.catchAllIds.has(transaction.routeUUID);
    const entry: RequestLog = {
      id: this.nextLogId++,
      timestamp: new Date(transaction.timestampMs).toISOString(),
      method: transaction.request.method.toUpperCase(),
      path: transaction.request.urlPath ?? '',
      query: maskQuery(transaction.request.query),
      status: transaction.response.statusCode,
      matched,
      proxied,
      requestHeaders: maskHeaders(transaction.request.headers),
      responseHeaders: maskHeaders(transaction.response.headers),
    };
    if (matched) {
      entry.endpointId = transaction.routeUUID;
      entry.scenario = current?.scenarioNames.get(transaction.routeResponseUUID);
      entry.scenarioReason = current?.scenarioReasons.get(transaction.routeResponseUUID);
      if (current?.profileName) entry.profile = current.profileName;
      const route = current?.environment.routes.find((r) => r.uuid === transaction.routeUUID);
      const selected = route?.responses.find((r) => r.uuid === transaction.routeResponseUUID);
      if (entry.scenarioReason === 'rule' && selected?.default) {
        // The transaction exposes the chosen UUID, not whether its own rules matched.
        delete entry.scenarioReason;
      }
    }
    if (this.logBodies) {
      entry.requestBody = stringifyBody(transaction.request.body);
      entry.responseBody = stringifyBody(transaction.response.body);
    }
    this.entries.push(entry);
    if (this.entries.length > this.maxLogs) this.entries.splice(0, this.entries.length - this.maxLogs);
    this.emit('log', entry);
  }
}
