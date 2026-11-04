import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { isPackageExported } from "../../scripts/conformance/lib.mjs";
import { dshComposition } from "../../scripts/composition/client.mjs";
import { browserCompatibility } from "../../packages/build/dsh-base-build-browser-compat/src/vite.mjs";
import { sourceDecorators } from "../../packages/build/dsh-base-build-browser-compat/src/decorators.mjs";
import { sourcePackageMetadata } from "../../packages/build/dsh-base-build-browser-compat/src/package-metadata.mjs";
import { serverManifestPath, serverPackageName } from "../../packages/build/dsh-base-build-server-dependencies/src/resolution.mjs";

const appRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appRoot, "../..");
const sourceRoot = resolve(repoRoot, ".submodules", "deepseek-harness");
const packagesRoot = resolve(repoRoot, "packages");
const generatedRemoteRoot = join(repoRoot, ".artifacts/typecheck/remote");
const requireFromApp = createRequire(import.meta.url);
const appManifest = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { version?: unknown };
const sourceLock = JSON.parse(readFileSync(join(repoRoot, "dsh-source.lock.json"), "utf8")) as { tag?: unknown; commit?: unknown; repository?: unknown };
if (typeof appManifest.version !== "string" || appManifest.version === "") throw new Error("apps/web/package.json must declare a version");
if (typeof sourceLock.tag !== "string" || !sourceLock.tag.startsWith("dsh-")) throw new Error("dsh-source.lock.json must declare an upstream release tag");
if (typeof sourceLock.commit !== "string" || sourceLock.commit === "") throw new Error("dsh-source.lock.json must declare the pinned commit");
if (typeof sourceLock.repository !== "string" || !sourceLock.repository.startsWith("https://")) throw new Error("dsh-source.lock.json must declare an HTTPS upstream repository");
const upstreamRepository = sourceLock.repository.replace(/\.git$/u, "");
if (upstreamRepository === sourceLock.repository.replace(/\/$/u, "")) throw new Error("dsh-source.lock.json repository must be the Git clone URL");
const upstreamRelease = `${upstreamRepository}/releases/tag/${encodeURIComponent(sourceLock.tag)}`;

/**
 * Resolve `@deepseek-ai/*` imports to the pinned submodule source.
 *
 * DSH publishes only built artifacts, while the Web UI and its Cordis plugins
 * are consumed from source. This resolver maps package names and subpaths onto
 * `.submodules/deepseek-harness/`, so the app composes official DSH plugins
 * without copying or prebuilding the harness.
 */
export function dshSource(): Plugin {
  const packages = new Map<string, string>();
  const localPackages = new Map<string, string>();
  const addLocalPackage = (dir: string) => {
    const path = join(dir, "package.json");
    if (!existsSync(path)) return;
    const { name } = JSON.parse(readFileSync(path, "utf8")) as { name?: string };
    if (name !== undefined) localPackages.set(name, dir);
  };
  if (existsSync(packagesRoot)) {
    for (const group of readdirSync(packagesRoot)) {
      const groupDir = join(packagesRoot, group);
      if (!statSync(groupDir).isDirectory()) continue;
      for (const name of readdirSync(groupDir)) {
        const dir = join(groupDir, name);
        if (statSync(dir).isDirectory()) addLocalPackage(dir);
      }
    }
  }
  const addPackage = (dir: string) => {
    const path = join(dir, "package.json");
    if (!existsSync(path)) return;
    const { name } = JSON.parse(readFileSync(path, "utf8")) as { name?: string };
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

  const tryFile = (path: string): string | undefined => {
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
        (importer.startsWith(sourceRoot + sep) || importer.startsWith(packagesRoot + sep) || importer.startsWith(generatedRemoteRoot + sep)) &&
        !id.startsWith(".") &&
        !id.startsWith("/") &&
        !id.startsWith("@deepseek-ai/") &&
        !id.startsWith("@dsh-base/") &&
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
      if (id.startsWith("@dsh-base/")) {
        const nameEnd = id.indexOf("/", id.indexOf("/") + 1);
        const name = nameEnd === -1 ? id : id.slice(0, nameEnd);
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
        const resolved = tryFile(join(dir, target));
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

      let resolved: string | undefined;
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

export default defineConfig({
  plugins: [
    browserCompatibility({ appRoot, sourceRoot }),
    sourcePackageMetadata({ sourceRoot }),
    sourceDecorators({ appRoot }), cloudflare({ viteEnvironment: { name: "worker" }, types: { generate: false } }), dshComposition(), dshSource(), react()],
  define: {
    // DSH Web UI sources read this build-time title from process.env.
    // Approved product display name; also prefixes per-session tab titles.
    "process.env.DSH_CLIENT_TITLE": JSON.stringify(process.env.DSH_CLIENT_TITLE ?? "DeepSeek Harness Base"),
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
  },
  server: {
    fs: {
      allow: [appRoot, sourceRoot, packagesRoot, generatedRemoteRoot],
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    // Opt-in source maps for diagnosing live client failures without shipping
    // maps to the deployed assets.
    sourcemap: process.env.DSH_BUILD_SOURCEMAP === "1",
  },
});
