import { createHash } from 'node:crypto';
import type { ModelService } from '../core/model-service.js';
import { StudioError, invalid } from '../core/errors.js';
import type { AiPreview, AiResult, AiStatus, BuiltSchema, ModelInput } from '../core/view.js';
import type { Variant } from '../generator/index.js';
import type { Issue } from '../parser/ir.js';
import { type GenerationSettings, validateBody } from '../schema/index.js';
import { type AiProvider, extractJson, runCli } from './cli-runner.js';
import { buildPrompt } from './prompt.js';

export interface AiRequest {
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
    private readonly provider: AiProvider,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  status(): AiStatus {
    return { enabled: true, provider: { id: this.provider.id, name: this.provider.name } };
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
    const { prompt } = await this.prepare(request);
    const { command } = this.provider.invocation(prompt);
    return {
      provider: { id: this.provider.id, name: this.provider.name },
      command,
      prompt,
      hash: digest(prompt),
      includesSource: Boolean(request.includeSource),
      bytes: Buffer.byteLength(prompt),
      notes: [
        `The text above is sent to ${this.provider.name}, which forwards it to its service.`,
        'The CLI runs without tools (no shell, no file access) in an empty temporary folder.',
        'The answer is validated against the model; the local generator is used if it fails.',
      ],
    };
  }

  async generate(request: AiRequest, confirm: string, signal?: AbortSignal): Promise<AiResult> {
    const { built, prompt } = await this.prepare(request);
    if (confirm !== digest(prompt)) {
      throw new StudioError('FORBIDDEN', 'The prompt differs from the one you reviewed. Preview it again and confirm.');
    }

    const fallback = async (reason: string): Promise<AiResult> => {
      const local = await this.models.generate(request.input, request.rootType, { settings: request.settings, variant: request.variant, seed: request.seed });
      return { ...local, source: 'local', fallbackReason: reason };
    };

    const run = await runCli(this.provider.invocation(prompt), { timeoutMs: this.timeoutMs, signal });
    if (!run.ok) {
      if (run.kind === 'cancelled') throw new StudioError('INVALID', run.message);
      return fallback(run.message);
    }
    let value: unknown;
    try {
      value = extractJson(run.stdout);
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
