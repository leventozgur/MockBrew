import { type Environment, ServerErrorCodes, type Transaction } from '@mockoon/commons';
import { MockoonServer } from '@mockoon/commons-server';
import { EventEmitter } from 'node:events';
import type { RequestLog, RuntimeState, RuntimeStatus } from '../core/view.js';
import type { ProjectDocument } from '../store/document.js';
import { type RuntimeEnvironment, type RuntimeOverrides, buildRuntimeEnvironment } from './environment.js';
import { maskHeaders, maskQuery } from './masking.js';

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
  private current: RuntimeEnvironment | undefined;
  private state: RuntimeState = 'stopped';
  private error: string | undefined;
  private startedAt: string | undefined;
  private lastHost = '127.0.0.1';
  private lastPort = 0;
  private nextLogId = 1;
  private logBodies = false;
  private readonly entries: RequestLog[] = [];
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
      ...(this.state === 'running' ? { url: `http://${this.lastHost === '0.0.0.0' ? 'localhost' : this.lastHost}:${this.lastPort}` } : {}),
      ...(this.error ? { error: this.error } : {}),
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
      routeCount: this.current?.routeCount ?? 0,
    };
  }

  logs(afterId = 0): RequestLog[] {
    return this.entries.filter((e) => e.id > afterId);
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
      disableTls: true,
      maxTransactionLogs: 0,
      envVarsPrefix: ENV_VARS_PREFIX,
    });
    server.on('transaction-complete', (transaction) => this.record(transaction));
    return server;
  }

  async start(document: ProjectDocument, overrides: RuntimeOverrides = {}): Promise<RuntimeStatus> {
    if (this.server) throw new Error('The mock server is already running.');
    const runtimeEnv = buildRuntimeEnvironment(document, overrides);
    this.logBodies = document.studio.settings.logBodies;
    await this.launch(runtimeEnv);
    return this.status();
  }

  private launch(runtimeEnv: RuntimeEnvironment): Promise<void> {
    const { environment } = runtimeEnv;
    this.current = runtimeEnv;
    this.lastHost = environment.hostname;
    this.lastPort = environment.port;
    this.setState('starting');
    const server = this.createServer(environment);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      server.on('error', (code, original) => {
        const friendly = ERROR_MESSAGES[code]?.(environment.port, environment.hostname);
        const message = friendly ?? `${code}${original ? `: ${original.message}` : ''}`;
        if (!settled) {
          settled = true;
          this.server = undefined;
          this.setState('error', message);
          reject(new Error(message));
          return;
        }
        this.emit('server-error', { code, message });
      });
      server.once('started', () => {
        settled = true;
        this.server = server;
        this.startedAt = new Date().toISOString();
        this.setState('running');
        resolve();
      });
      server.once('stopped', () => {
        if (this.server === server) this.server = undefined;
      });
      server.start();
    });
  }

  /** Applies a changed project to the running server without restarting it (unless host or port changed). */
  async update(document: ProjectDocument, overrides: RuntimeOverrides = {}): Promise<void> {
    if (!this.server) return;
    const next = buildRuntimeEnvironment(document, overrides);
    this.logBodies = document.studio.settings.logBodies;
    const { environment } = next;
    if (environment.port !== this.lastPort || environment.hostname !== this.lastHost) {
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

  private stopServer(): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();
    return new Promise<void>((resolve) => {
      server.once('stopped', () => resolve());
      server.stop();
    });
  }

  async stop(): Promise<void> {
    await this.stopServer();
    this.server = undefined;
    this.startedAt = undefined;
    this.setState('stopped');
  }

  private record(transaction: Transaction): void {
    const current = this.current;
    const proxied = transaction.proxied === true;
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
