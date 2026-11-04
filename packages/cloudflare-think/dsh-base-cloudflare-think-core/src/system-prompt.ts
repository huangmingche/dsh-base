/**
 * Official DSH system-prompt registry running inside a Workers Think agent.
 *
 * The registry itself (`@deepseek-ai/dsh-system-prompt`) is pure JavaScript and
 * runs on a plain Cordis context, so the same section ordering, interpolation,
 * rendering, and complete-section rules used by the official Host apply here.
 * Dynamic per-turn values are supplied through prompt variables; the rendered
 * text becomes the Think agent's single system-prompt context block.
 */
import { Context } from "@deepseek-ai/cordis";
import { SystemPrompt, renderPrompt, type PromptSectionOrderName } from "@deepseek-ai/dsh-system-prompt";

/** One section a dsh-base agent plugin contributes to the official registry. */
export interface PromptContribution {
  /** Unique section name inside this agent's registry. */
  readonly name: string;
  /**
   * Explicit numeric order, or an official centrally allocated position name.
   * Defaults to a plugin-guidance slot before the harness-source sections.
   */
  readonly order?: number | PromptSectionOrderName;
  /** Static text or a per-render provider. May reference prompt variables. */
  readonly text: string | (() => string);
  /** Preserve `{{...}}` literally instead of interpolating variables. */
  readonly interpolate?: boolean;
}

/** Deployment persona used by the official persona-prefix slot. */
export interface WorkerPromptOptions {
  /** Deployment persona prefix rendered at the official persona order. */
  readonly personaPrefix: string;
  /** Deployment persona suffix rendered at the official persona-suffix order. */
  readonly personaSuffix?: string;
}

/** One agent-scoped wrapper around the official prompt registry. */
export class WorkerSystemPrompt {
  private readonly ctx: Context;
  private readonly registry: SystemPrompt;
  private readonly variables = new Map<string, () => string | undefined>();
  private presentations = 0;

  /**
   * @param options - deployment persona slots.
   */
  constructor(options: WorkerPromptOptions) {
    this.ctx = new Context();
    this.registry = new SystemPrompt(this.ctx as never, {
      includeHarnessIdentity: true,
      // Runtime context is contributed as durable context in official DSH; this
      // Workers runtime renders the same facts as a prompt section for now.
      includeRuntimeContext: false,
      personaPrefix: options.personaPrefix,
      personaSuffix: options.personaSuffix ?? "",
      toolOrder: undefined,
    } as never);
  }

  /**
   * Register one section, resolving official order names through the registry.
   * @param contribution - section definition.
   */
  section(contribution: PromptContribution): void {
    const order = typeof contribution.order === "string"
      ? this.registry.getSectionOrder(contribution.order)
      : contribution.order ?? 6000;
    this.registry.section({
      name: contribution.name,
      order,
      text: typeof contribution.text === "string" ? contribution.text : () => (contribution.text as () => string)(),
      ...(contribution.interpolate === undefined ? {} : { interpolate: contribution.interpolate }),
    });
  }

  /**
   * Register one dynamic variable. Providers run at every render.
   * @param name - variable name referenced as `{{name}}`.
   * @param provider - current value, or undefined to fail strict interpolation.
   */
  variable(name: string, provider: () => string | undefined): void {
    this.variables.set(name, provider);
    this.registry.variable(name, () => this.variables.get(name)?.());
  }

  /**
   * Register one presentation listener on the official waterfall
   * (`system-prompt/assemble`). The official registry runs listeners in
   * registration order and lets each call `next()`; the counter is exposed for
   * acceptance/diagnostics.
   * @param listener - receives the mutable assembled sections.
   */
  waterfall(listener: (assembly: unknown) => void | Promise<void>): void {
    const dispatch = (async (assembly: unknown, _context: unknown, next: () => Promise<unknown>): Promise<unknown> => {
      this.presentations += 1;
      await listener(assembly);
      return await next();
    }) as never;
    this.ctx.on("system-prompt/assemble", dispatch);
  }

  /** Number of completed presentation-waterfall dispatches. */
  waterfallRuns(): number {
    return this.presentations;
  }

  /** Official section order for a first-party tool contribution. */
  sectionOrder(name: PromptSectionOrderName): number {
    return this.registry.getSectionOrder(name);
  }

  /**
   * Assemble and render the current prompt.
   * @returns the rendered system prompt.
   */
  async render(): Promise<string> {
    return renderPrompt(await this.registry.assemble({}));
  }

  /** Release the Cordis context owned by this wrapper. */
  dispose(): Promise<void> {
    return this.ctx.fiber.dispose();
  }
}
