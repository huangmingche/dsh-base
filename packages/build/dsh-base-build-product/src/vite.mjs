/** Build-only source composition for a base checkout or an independent product. */
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPackageExported } from '../../../../scripts/conformance/lib.mjs';
import { dshComposition } from '../../../../scripts/composition/client.mjs';
import { buildContext, generatedModulePath } from '../../../../scripts/build/product-paths.mjs';
import { browserCompatibility } from '../../dsh-base-build-browser-compat/src/vite.mjs';
import { sourceDecorators } from '../../dsh-base-build-browser-compat/src/decorators.mjs';
import { sourcePackageMetadata } from '../../dsh-base-build-browser-compat/src/package-metadata.mjs';
import { developmentDate, developmentWorkerOverrides } from './development.mjs';
import { workerCompatibilityDate } from './cloudflare.mjs';
import { getServerManifestPath, serverPackageName } from '../../dsh-base-build-server-dependencies/src/resolution.mjs';
const defaultBaseRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
function sourceContext({ productRoot = defaultBaseRoot, appRoot, app } = {}) {
  const context = buildContext(productRoot, { appRoot, app });
  return { ...context,
    sourceRoot: existsSync(context.upstreamRoot) ? realpathSync(context.upstreamRoot) : context.upstreamRoot,
    packagesRoots: [...new Set([join(context.baseRoot, 'packages'), join(context.productRoot, 'packages')])],
    generatedRemoteRoot: join(context.typecheckRoot, 'remote') };
}
export function dshSource(options = {}) {
  const context = sourceContext(options);
  const { appRoot, productRoot, baseRoot, sourceRoot, packagesRoots, generatedRemoteRoot, generatedRoot } = context;
  const requireFromApp = createRequire(join(appRoot, 'package.json'));
  const serverManifestPath = getServerManifestPath(productRoot);
  const packages = new Map();
  const localPackages = new Map();
  const addLocalPackage = (dir) => {
    const path = join(dir, "package.json");
    if (!existsSync(path)) return;
    const { name } = JSON.parse(readFileSync(path, "utf8"));
    if (name !== undefined) { if (localPackages.has(name)) throw new Error(`Duplicate local package: ${name}`); localPackages.set(name, dir); }
  };
  for (const packagesRoot of packagesRoots) if (existsSync(packagesRoot)) {
    for (const group of readdirSync(packagesRoot)) {
      const groupDir = join(packagesRoot, group);
      if (!statSync(groupDir).isDirectory()) continue;
      for (const name of readdirSync(groupDir)) {
        const dir = join(groupDir, name);
        if (statSync(dir).isDirectory()) addLocalPackage(dir);
      }
    }
  }
  const addPackage = (dir) => {
    const path = join(dir, "package.json");
    if (!existsSync(path)) return;
    const { name } = JSON.parse(readFileSync(path, "utf8"));
    if (name !== undefined) packages.set(name, dir);
  };
  const packageGroups = join(sourceRoot, "packages");
  if (existsSync(packageGroups)) {
    for (const group of readdirSync(packageGroups)) {
      const groupDir = join(packageGroups, group);
      if (!statSync(groupDir).isDirectory()) continue;
      for (const name of readdirSync(groupDir)) {
        const dir = join(groupDir, name);
        if (statSync(dir).isDirectory()) addPackage(dir);
      }
    }
  }
  const vendor = join(sourceRoot, "vendor");
  if (existsSync(vendor)) {
    for (const name of readdirSync(vendor)) {
      const dir = join(vendor, name);
      if (statSync(dir).isDirectory()) addPackage(dir);
    }
  }

  const tryFile = (path) => {
    const candidates = [path, `${path}.ts`, `${path}.tsx`, `${path}.js`, `${path}.mjs`, `${path}.json`, `${path}.css`];
    for (const candidate of candidates) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {}
    }
    for (const suffix of ["index.ts", "index.tsx", "index.js"]) {
      try {
        if (statSync(join(path, suffix)).isFile()) return join(path, suffix);
      } catch {}
    }
    return undefined;
  };

  return {
    name: "dsh-base:dsh-source",
    enforce: "pre",
    async resolveId(id, importer) {
      if (importer && id.startsWith('.')) {
        const mapped = generatedModulePath(context, resolve(dirname(importer.split('?')[0]), id));
        if (mapped) return mapped;
      }
      if (serverPackageName(id)) {
        if (id === "agents/react" || id === "@cloudflare/think/react") throw new Error(`dsh-base: server SDK React entrypoint is not part of the official browser runtime: ${id}`);
        const resolved = await this.resolve(id, serverManifestPath, { skipSelf: true });
        if (resolved !== null) return resolved;
        throw new Error(`dsh-base: missing isolated server SDK export: ${id}`);
      }
      // Official sources and generated Remote runtimes live outside the app's
      // node_modules tree. Preserve Vite's browser/import conditions while
      // resolving their third-party dependencies against the app installation.
      if (
        importer !== undefined &&
        (importer.startsWith(sourceRoot + sep) || importer.startsWith(join(baseRoot, "apps/web") + sep) || packagesRoots.some(root => importer.startsWith(root + sep)) || importer.startsWith(generatedRoot + sep) || importer.startsWith(generatedRemoteRoot + sep)) &&
        !id.startsWith(".") &&
        !id.startsWith("/") &&
        !id.startsWith("@deepseek-ai/") &&
        !localPackages.has(id.startsWith("@") ? id.split("/").slice(0, 2).join("/") : id.split("/")[0]) &&
        !id.startsWith("\0")
      ) {
        // Official util-time consumes rrule's Node/CommonJS default export;
        // its legacy `module` field instead points to an ESM build without it.
        if (id === "rrule") return requireFromApp.resolve(id);
        // Keep Vite's import/browser/Worker conditions. require.resolve would
        // force CommonJS, mixing Temporal's CJS build with JSBI's ESM facade.
        const resolved = await this.resolve(id, join(appRoot, "package.json"), { skipSelf: true });
        if (resolved !== null) return resolved;
      }
      const localName = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0];
      if (localPackages.has(localName)) {
        const nameEnd = id.length === localName.length ? -1 : localName.length;
        const name = localName;
        const subpath = nameEnd === -1 ? "" : id.slice(nameEnd + 1);
        const dir = localPackages.get(name);
        if (dir === undefined) return null;
        const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        const key = subpath === "" ? "." : `./${subpath}`;
        let target = manifest.exports?.[key];
        if (target === undefined) {
          for (const [pattern, value] of Object.entries(manifest.exports ?? {})) {
            const star = pattern.indexOf("*");
            if (star < 0 || typeof value !== "string") continue;
            const prefix = pattern.slice(0, star), suffix = pattern.slice(star + 1);
            if (key.startsWith(prefix) && key.endsWith(suffix)) {
              target = value.replaceAll("*", key.slice(prefix.length, key.length - suffix.length));
              break;
            }
          }
        }
        if (typeof target !== "string" || !target.startsWith("./")) {
          throw new Error(`dsh-base: ${id} has no executable local package export`);
        }
        // Follow the declared entry (which may wrap an unchanged official fork
        // with Config), rather than silently loading a conventional index.ts.
        const sourceTarget = join(dir, target);
        const resolved = tryFile(generatedModulePath(context, sourceTarget) ?? sourceTarget);
        if (resolved === undefined) throw new Error(`dsh-base: missing exported file for ${id}`);
        return resolved;
      }
      if (!id.startsWith("@deepseek-ai/")) return null;
      const nameEnd = id.indexOf("/", id.indexOf("/") + 1);
      const name = nameEnd === -1 ? id : id.slice(0, nameEnd);
      const subpath = nameEnd === -1 ? "" : id.slice(nameEnd + 1);
      const dir = packages.get(name);
      if (dir === undefined) return null;
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (!isPackageExported(manifest, subpath === "" ? "." : `./${subpath}`)) {
        throw new Error(`dsh-base: ${id} is not exported by the pinned official package`);
      }

      let resolved;
      if (subpath === "remote") {
        // Generated by the pinned official FaceModelEmitter during check:types;
        // never generate or edit files inside the upstream checkout.
        const generated = join(generatedRemoteRoot, name.replace("@deepseek-ai/", ""), "remote.js");
        if (!existsSync(generated)) throw new Error(`dsh-base: generated official Remote missing for ${id}; run pnpm check:types`);
        resolved = generated;
      } else if (subpath === "") {
        resolved = tryFile(join(dir, "src", "index"));
      } else if (subpath === "client") {
        // Some official packages ship a single `src/client.ts` file instead of
        // a `src/client/index.ts` directory.
        resolved = tryFile(join(dir, "src", "client"))
          ?? tryFile(join(dir, "src", "client", "index"))
          ?? tryFile(join(dir, "src", "index"));
      } else if (subpath.startsWith("src/")) {
        resolved = tryFile(join(dir, subpath));
      } else {
        resolved =
          tryFile(join(dir, "src", subpath)) ??
          tryFile(join(dir, subpath)) ??
          tryFile(join(dir, "src", subpath, "index"));
      }
      return resolved ?? null;
    },
  };
}


export async function defineDshViteConfig(options = {}) {
  const context = sourceContext(options);
  const { appRoot, productRoot, baseRoot, sourceRoot, packagesRoots, generatedRemoteRoot } = context;
  const importTool = name => {
    const packageRoot = join(appRoot, 'node_modules', name);
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    let target = manifest.exports?.['.'] ?? manifest.exports ?? manifest.module ?? manifest.main;
    while (target && typeof target === 'object') target = target.import ?? target.node ?? target.default;
    if (typeof target !== 'string' || !target.startsWith('./')) throw new Error(`Missing import export for build tool: ${name}`);
    return import(pathToFileURL(resolve(packageRoot, target)).href);
  };
  const [{ default: react }, { cloudflare }, { defineConfig }] = await Promise.all([
    importTool('@vitejs/plugin-react'), importTool('@cloudflare/vite-plugin'), importTool('vite'),
  ]);
  const appManifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
  const sourceLock = JSON.parse(readFileSync(join(baseRoot, 'dsh-source.lock.json'), 'utf8'));
  if (typeof appManifest.version !== 'string' || !appManifest.version) throw new Error('Product app package.json must declare a version');
  if (typeof sourceLock.tag !== 'string' || !sourceLock.tag.startsWith('dsh-') || !sourceLock.commit) throw new Error('Base must declare a pinned official release');
  if (typeof sourceLock.repository !== 'string' || !sourceLock.repository.startsWith('https://') || !sourceLock.repository.endsWith('.git')) throw new Error('Official source repository must be an HTTPS Git clone URL');
  const upstreamRepository = sourceLock.repository.replace(/\.git$/u, '');
  const upstreamRelease = `${upstreamRepository}/releases/tag/${encodeURIComponent(sourceLock.tag)}`;
  return defineConfig(({ command, mode }) => {
    const localCompatibilityDate = developmentDate(appRoot, command, workerCompatibilityDate);
    const localConfig = developmentWorkerOverrides(appRoot, { command, mode, consumer: context.isolated, compatibilityDate: localCompatibilityDate });
    return {
  root: appRoot,
  ...(context.isolated ? {
    tsconfig: join(context.typecheckRoot, "client.json"),
    optimizeDeps: { include: ["rrule"], rolldownOptions: { tsconfig: join(context.typecheckRoot, "client.json") } },
    environments: { worker: { optimizeDeps: { include: ["rrule"], rolldownOptions: { tsconfig: join(context.typecheckRoot, "worker.json") } } } },
  } : {}),
  publicDir: context.isolated ? join(context.generatedRoot, context.appPath, "public") : join(appRoot, "public"),
  plugins: [
    browserCompatibility({ appRoot, sourceRoot }),
    sourcePackageMetadata({ sourceRoot }),
    sourceDecorators({ appRoot }), cloudflare({ viteEnvironment: { name: "worker" }, types: { generate: false },
      ...(localConfig ? { config: localConfig } : {}),
      ...(context.isolated && command === 'serve' ? { remoteBindings: options.remoteBindings ?? false } : {}),
    }), dshComposition({ root: productRoot, app: context.appId }), dshSource({ productRoot, appRoot, app: context.appId }), react()],
  define: {
    // The official localized title contract reads published site values through
    // the locale Host seam; a build-time override would create a second source.
    "process.env.DSH_CLIENT_TITLE": "undefined",
    "process.env.DSH_CLIENT_VERSION": JSON.stringify(appManifest.version),
    "process.env.DSH_CLIENT_UPSTREAM_VERSION": JSON.stringify(sourceLock.tag),
    "process.env.DSH_CLIENT_UPSTREAM_REPOSITORY": JSON.stringify(upstreamRepository),
    "process.env.DSH_CLIENT_UPSTREAM_RELEASE_URL": JSON.stringify(upstreamRelease),
    "process.env.DSH_CLIENT_COMMIT_HASH": "undefined",
    "process.env.DSH_CLIENT_GIT_DIRTY": "undefined",
  },
  esbuild: { supported: { decorators: false } },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [{ find: /^rrule$/u, replacement: createRequire(join(appRoot, "package.json")).resolve("rrule") }],
  },
  server: {
    fs: {
      allow: [appRoot, join(baseRoot, "apps/web"), sourceRoot, ...packagesRoots, context.generatedRoot, generatedRemoteRoot],
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    // Opt-in source maps for diagnosing live client failures without shipping
    // maps to the deployed assets.
    sourcemap: process.env.DSH_BUILD_SOURCEMAP === "1",
  },
};
  });
}
