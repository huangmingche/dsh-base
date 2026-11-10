/** Read-only source projects with product-owned generated modules and dependency roots. */
import { join, relative } from "node:path";
import { localPackages, walk } from "../conformance/lib.mjs";
import { generatedModulePath } from "../build/product-paths.mjs";

export function sourcePath(context, path) {
  return context.isolated ? generatedModulePath(context, path) ?? path : path;
}

export function parseTypecheckProject(ts, raw, context) {
  const parsed = ts.parseJsonConfigFileContent(raw, ts.sys, context.typecheckRoot);
  parsed.fileNames = [...new Set(parsed.fileNames.map(path => sourcePath(context, path)))];
  return parsed;
}

/** Paths aliases do not affect relative imports. Resolve those through the same
 * generated-file map as Vite, including when an old output still exists in base. */
export function createTypecheckProgram(ts, input, context) {
  const host = ts.createCompilerHost(input.options);
  const mappings = new Map();
  const map = path => {
    if (!mappings.has(path)) mappings.set(path, sourcePath(context, path));
    return mappings.get(path);
  };
  const resolutionHost = {
    ...ts.sys,
    fileExists: path => ts.sys.fileExists(map(path)),
    readFile: path => ts.sys.readFile(map(path)),
  };
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, ...args) => originalGetSourceFile(map(path), ...args);
  host.fileExists = resolutionHost.fileExists;
  host.readFile = resolutionHost.readFile;
  const cache = ts.createModuleResolutionCache(context.productRoot, path => path, input.options);
  host.resolveModuleNameLiterals = (literals, containingFile, redirectedReference, options, containingSourceFile) => literals.map(literal => {
    const mode = ts.getModeForUsageLocation(containingSourceFile, literal, options);
    const result = ts.resolveModuleName(literal.text, containingFile, options, resolutionHost, cache, redirectedReference, mode);
    if (result.resolvedModule) result.resolvedModule = { ...result.resolvedModule, resolvedFileName: map(result.resolvedModule.resolvedFileName) };
    return result;
  });
  return ts.createProgram({ ...input, rootNames: [...new Set(input.rootNames.map(map))], host });
}

/** Both roots are owned source for strict checking; generated replacements are
 * counted at their actual product path rather than accepting stale base output. */
export function checkedOwnedFiles(plane, rootNames, context) {
  const roots = new Set(rootNames);
  const groups = plane === "client" ? ["client"] : ["cloudflare-worker", "cloudflare-think"];
  const owned = [];
  for (const pkg of localPackages(context.productRoot).filter(pkg => groups.includes(pkg.group)
    || (plane === "client" && pkg.group === "boot" && pkg.manifest.dshBase?.boot?.kind === "browser-support"))) {
    walk(join(pkg.directoryPath, "src"), file => {
      if (!/\.[cm]?tsx?$/.test(file)) return;
      const target = sourcePath(context, file);
      if (!roots.has(target)) throw new Error(`${plane}: owned source silently excluded from typecheck: ${relative(context.productRoot, file)}`);
      owned.push(relative(context.productRoot, target));
    });
  }
  return [...new Set(owned)];
}
