#!/usr/bin/env node
/** Enforce client / Worker / Think / platform-neutral package boundaries. */
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { importsIn, isMain, isPackageExported, localPackages, officialPackages, packageName, printResult, readJson, repoRoot, runtimeGroups, walk } from "./lib.mjs";

const nodeModules = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const idPrefixes = { client: "client:", worker: "cloudflare:worker:", think: "cloudflare:think:" };
const namePrefixes = { client: "@dsh-base/client-", worker: "@dsh-base/cloudflare-worker-", think: "@dsh-base/cloudflare-think-" };

export function checkBoundaries(root) {
  const failures = [];
  const packages = localPackages(root).map((entry) => ({ ...entry, plane: entry.group === "build" ? "build" : runtimeGroups[entry.group] ?? "shared" }));
  const byName = new Map(packages.map((entry) => [entry.manifest.name, entry]));
  const official = officialPackages(root);
  const pin = readJson(join(root, "dsh-source.lock.json")).commit;
  for (const { manifest, directoryPath, plane, path } of packages) {
    const meta = manifest.dshBase?.[plane === "think" ? "agent" : plane];
    if (plane === "build") {
      if (!manifest.name?.startsWith("@dsh-base/build-") || !["vite-plugin", "dependency-environment"].includes(manifest.dshBase?.build?.kind)) failures.push(`${relative(root, path)}: build-only packages require @dsh-base/build- naming and dshBase.build.kind = vite-plugin or dependency-environment`);
      if (manifest.dsh?.client !== undefined || ["client", "worker", "agent"].some(key => manifest.dshBase?.[key] !== undefined)) failures.push(`${relative(root, path)}: build-only packages cannot declare runtime composition`);
    } else if (plane !== "shared") {
      if (!manifest.name?.startsWith(namePrefixes[plane])) failures.push(`${relative(root, path)}: package name must start with ${namePrefixes[plane]}`);
      if (meta !== undefined && (typeof meta.id !== "string" || !meta.id.startsWith(idPrefixes[plane]))) failures.push(`${relative(root, path)}: composition id must start with ${idPrefixes[plane]}`);
      if (plane === "client" && manifest.dsh?.client !== undefined && manifest.dsh.client.platform !== "web") failures.push(`${relative(root, path)}: client plugin platform must be web`);
    }
    walk(join(directoryPath, "src"), (file) => {
      if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) return;
      for (const { specifier, line } of importsIn(readFileSync(file, "utf8"))) {
        const location = `${relative(root, file)}:${line}`;
        const resolved = specifier.startsWith(".") || specifier.startsWith("/") ? resolve(dirname(file), specifier) : undefined;
        const target = resolved === undefined ? byName.get(packageName(specifier)) : packages.find((entry) => resolved.startsWith(entry.directoryPath + sep));
        if (target !== undefined) {
          if (target.plane !== "shared" && target.plane !== plane) failures.push(`${location}: ${plane} package ${manifest.name} imports ${target.plane} package ${target.manifest.name}`);
          continue;
        }
        if (specifier.startsWith("@dsh-base/")) failures.push(`${location}: unknown local package ${packageName(specifier)}`);
        if (plane === "client" || plane === "shared") {
          const workersRuntime = ["@cloudflare/think", "agents", "@cloudflare/workers-types"].includes(packageName(specifier))
            && !["@cloudflare/think/react", "agents/react"].includes(specifier);
          if (specifier.startsWith("node:") || nodeModules.has(specifier) || specifier.startsWith("cloudflare:") || workersRuntime) failures.push(`${location}: ${plane} package imports non-browser module ${specifier}`);
        }
        // This dual-face official package's exported raw HTTP handler is Host code,
        // despite its historical client-* name. Keep the exception exact and pin-reviewed.
        const hostUpload = plane === "worker" && specifier === "@deepseek-ai/dsh-client-file-upload/src/http-route.ts"
          && manifest.dshBase?.reuse?.sourceReviewCommit === pin
          && manifest.dshBase?.reuse?.sourceEntries?.includes(specifier)
          && isPackageExported(official.get(packageName(specifier))?.manifest ?? {}, "./src/http-route.ts");
        if (plane !== "client" && !hostUpload && (/^react(?:-dom)?(?:\/|$)/.test(specifier) || specifier.startsWith("@deepseek-ai/dsh-client-") || ["@cloudflare/think/react", "agents/react"].includes(specifier))) failures.push(`${location}: ${plane} package imports browser module ${specifier}`);
      }
    });
  }
  return { failures, summary: `${packages.length} local packages respect client / worker / think / shared / build planes` };
}

if (isMain(import.meta.url)) printResult("plugin boundaries", checkBoundaries(repoRoot));
