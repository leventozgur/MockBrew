import { createHash } from 'node:crypto';
import type { ModelService } from '../core/model-service.js';
import { StudioError, invalid } from '../core/errors.js';
import type { AiPreview, AiResult, AiStatus, BuiltSchema, ModelInput } from '../core/view.js';
import type { Variant } from '../generator/index.js';
import type { Issue } from '../parser/ir.js';
import { type GenerationSettings, validateBody } from '../schema/index.js';
import { type AiProvider, runCli } from './cli-runner.js';
import { parseProviderOutput, type ProviderInfo } from './registry.js';
import { buildPrompt } from './prompt.js';

export interface AiRequest {
  providerId?: string;
  input: ModelInput;
  rootType: string;
  settings?: Partial<GenerationSettings>;
  instruction?: string;
  includeSource?: boolean;
  variant?: Variant;
  seed?: string | number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function digest(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

/** Optional AI generation: nothing is sent without a previewed and confirmed prompt; the local generator is the fallback. */
export class AiService {
  constructor(
    private readonly models: ModelService,
    private readonly providers: AiProvider | { info: ProviderInfo; provider: AiProvider }[],
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly unavailable: { id: string; name: string; note: string }[] = [],
  ) {}

  status(): AiStatus {
    const providers = this.list();
    return { enabled: true, providers: providers.map((p) => p.info), provider: providers[0]?.info, unavailable: this.unavailable };
  }

  private list(): { info: ProviderInfo; provider: AiProvider }[] {
    if (Array.isArray(this.providers)) return this.providers;
    return [{ provider: this.providers, info: { id: this.providers.id, name: this.providers.name, version: '', isolation: 'limited' } }];
  }

  private select(id?: string): { info: ProviderInfo; provider: AiProvider } {
    const entries = this.list();
    const selected = id ? entries.find((entry) => entry.info.id === id) : entries.length === 1 ? entries[0] : undefined;
    if (!selected) throw new StudioError('FORBIDDEN', 'Select an enabled and detected AI provider.');
    return selected;
  }

  private async prepare(request: AiRequest): Promise<{ built: BuiltSchema; prompt: string }> {
    const built = await this.models.schema(request.input, request.rootType, request.settings);
    const errors = built.issues.filter((i: Issue) => i.severity === 'error');
    if (errors.length > 0) throw invalid(errors.map((e) => e.message).join(' '), built.issues);
    const source = request.includeSource ? (await this.models.readSources(request.input)).files : undefined;
    return { built, prompt: buildPrompt({ rootType: built.rootType, schema: built.schema, instruction: request.instruction, source }) };
  }

  /** Shows what would be sent. Nothing is started here. */
  async preview(request: AiRequest): Promise<AiPreview> {
    const { info, provider } = this.select(request.providerId);
    const { prompt } = await this.prepare(request);
    const { command } = provider.invocation(prompt);
    return {
      provider: { id: info.id, name: info.name },
      command,
      prompt,
      hash: digest(`${info.id}\0${prompt}`),
      includesSource: Boolean(request.includeSource),
      bytes: Buffer.byteLength(prompt),
      notes: [
        `The text above is sent to ${info.name}, which forwards it to its service.`,
        info.isolation === 'full' ? 'The CLI runs with tools disabled in an empty temporary folder.' : 'The CLI runs in an empty temporary folder with limited isolation.',
        ...(info.note ? [info.note] : []),
        'The answer is validated against the model; the local generator is used if it fails.',
      ],
    };
  }

  async generate(request: AiRequest, confirm: string, signal?: AbortSignal): Promise<AiResult> {
    const { provider } = this.select(request.providerId);
    const { built, prompt } = await this.prepare(request);
    if (confirm !== digest(`${provider.id}\0${prompt}`)) {
      throw new StudioError('FORBIDDEN', 'The prompt differs from the one you reviewed. Preview it again and confirm.');
    }

    const fallback = async (reason: string): Promise<AiResult> => {
      const local = await this.models.generate(request.input, request.rootType, { settings: request.settings, variant: request.variant, seed: request.seed });
      return { ...local, source: 'local', fallbackReason: reason };
    };

    const run = await runCli(provider.invocation(prompt), { timeoutMs: this.timeoutMs, signal });
    if (!run.ok) {
      if (run.kind === 'cancelled') throw new StudioError('INVALID', run.message);
      return fallback(run.message);
    }
    let value: unknown;
    try {
      value = parseProviderOutput(run.stdout);
    } catch (error) {
      return fallback((error as Error).message);
    }
    const body = JSON.stringify(value, null, 2);
    const validation = validateBody(built.schema, body);
    if (!validation.valid) {
      return fallback(`The AI answer does not match ${built.rootType}: ${validation.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ')}`);
    }
    return { ...built, body, validation, source: 'ai' };
  }
}
