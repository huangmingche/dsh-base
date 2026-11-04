/** Static module transport seam around the unchanged official Web boot implementation. */
import "@deepseek-ai/dsh-client-ui-theme/src/styles/brand-font.css";
import "@deepseek-ai/dsh-client-web/src/base.css";
import { Context, FiberState } from "@deepseek-ai/cordis";
import { createClientModuleSystem } from "@deepseek-ai/dsh-client-modules/client";
import * as modulesClient from "@deepseek-ai/dsh-client-modules/client";
import { bootClient, assertEntriesActive } from "@deepseek-ai/dsh-client-web/src/boot-client.ts";
import { BootPage } from "@deepseek-ai/dsh-client-web/src/boot-page.ts";
import { mountClient } from "@deepseek-ai/dsh-client-web/src/mount.ts";
import { getStaticModules } from "@deepseek-ai/dsh-client-web/src/seed.ts";
import type { StaticPluginLoaderConfig, StaticPluginInspection, StaticPluginPhase } from "@dsh-base/plugin-loader-static";
import { inspectComposition } from "./inspection.ts";
import { publicDocumentEntries } from "./document-routes.ts";

export interface ClientComposition extends StaticPluginLoaderConfig {
  readonly namespaces: Readonly<Record<string, () => Promise<Record<string, unknown>>>>;
}

const phases: Record<FiberState, StaticPluginPhase> = {
  [FiberState.PENDING]: "pending", [FiberState.LOADING]: "loading", [FiberState.ACTIVE]: "active",
  [FiberState.FAILED]: "failed", [FiberState.UNLOADING]: "unloading", [FiberState.DISPOSED]: null,
};

declare global {
  interface Window {
    /** Declared inventory joined to the official Loader's current fiber state. */
    readonly __DSH_BASE_PLUGINS__?: StaticPluginInspection[];
  }
}

/** The app supplies its generated composition; loading, failures and UI use official components. */
export async function startClient(base: ClientComposition, container: HTMLElement): Promise<void> {
  const scope = globalThis as { process?: unknown };
  scope.process ??= { env: {}, pid: 0, execArgv: [], versions: { node: "0.0.0" } };
  const page = new BootPage(container);
  const ctx = new Context();
  ctx.logger.exporter({
    levels: { default: 1 },
    export: message => console[message.type](`[${message.name}]`, ...message.args),
  });
  try {
    const documentEntries = publicDocumentEntries(base.entries, location.pathname);
    // Public documents run only their declared providers. Do not fetch private
    // control state, import app plugins, or mount the authenticated shell here.
    const composition = documentEntries === undefined
      ? base
      : { ...base, entries: documentEntries };
    const bootComposition = composition;
    const active = bootComposition.entries.filter(entry => !entry.disabled);
    if (documentEntries !== undefined && active.length === 0) throw new Error("public document provider is disabled");
    for (const entry of active) {
      if (!Object.hasOwn(bootComposition.namespaces, entry.name)) throw new Error(`static_plugin_not_bundled:${entry.name}`);
    }
    const graph = {
      rev: "static",
      entries: active.map(entry => ({ id: entry.name, url: `plugins/${entry.name}/client.js`, rev: "static" })),
      batches: [{ phase: "application" as const, url: "plugins/static.js", rev: "static", entries: active.map(entry => entry.name) }],
    };
    const target = {
      mode: "queue" as const,
      pendingQueue: [] as Array<{ id: string; factory: () => Record<string, unknown> }>,
      load: () => { throw new Error("dsh-base: module facade is not initialized"); },
      create: (options: Parameters<typeof createClientModuleSystem>[2]) =>
        createClientModuleSystem(target, { id: "@deepseek-ai/dsh-client-modules", exports: modulesClient as unknown as Record<string, unknown> }, options),
    };
    // Materialize ESM imports before registering the official synchronous factory contract.
    await Promise.all(active.filter(entry => entry.name !== "@deepseek-ai/dsh-client-modules").map(async entry => {
      const namespace = await bootComposition.namespaces[entry.name]!();
      target.pendingQueue.push({ id: entry.name, factory: () => namespace });
    }));
    const modules = target.create({ boot: graph, staticModules: getStaticModules() });
    Object.defineProperty(window, "__DSH_BASE_PLUGINS__", {
      configurable: true,
      get: () => inspectComposition(composition.entries, ctx.get("loader") === undefined ? [] :
        Array.from(ctx.loader.entries(), entry => ({
          name: entry.options.name,
          phase: entry.fiber === undefined ? null : phases[entry.fiber.state],
          disabled: entry.disabled,
        }))),
    });
    page.setTotal(active.length);
    const configurations = new Map(active.map(entry => [entry.name, entry.config]));
    const configured = new WeakSet<object>();
    // The official Loader's context-refresh hook runs before initial configuration
    // validation and activation. Subsequent runtime updates retain Loader ownership.
    ctx.on("loader/patch-context", async (entry, next) => {
      if (!configured.has(entry)) {
        configured.add(entry);
        const config = configurations.get(entry.options.name);
        if (config !== undefined) entry.options.config = config;
      }
      await next();
    });
    await bootClient({ ctx, modules, manifest: modules.manifest, onEntryState: (name, state) => page.setState(name, state) });
    assertEntriesActive(ctx, modules);
    if (documentEntries === undefined) await mountClient(ctx, container);
  } catch (error) {
    console.error(error);
    page.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
