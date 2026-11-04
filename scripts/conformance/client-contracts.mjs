/** Static loader surface checks; runtime Config validation remains the loader's job. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

function runtimeTargets(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(runtimeTargets);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).filter(([condition]) => condition !== "types").flatMap(([, target]) => runtimeTargets(target));
}
function unComment(source) {
  return source.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g,
    (match, quoted) => quoted ?? match.replace(/[^\n]/g, " "));
}
function sourceFile(path) {
  return [path, `${path}.ts`, `${path}.tsx`, `${path}.js`, `${path}/index.ts`, `${path}/index.tsx`]
    .find(candidate => existsSync(candidate) && statSync(candidate).isFile() && !candidate.endsWith(".d.ts"));
}
/** Follow local named/star re-exports without evaluating plugin code or importing dependencies. */
function exportsValue(file, symbol, directory, seen = new Set()) {
  const key = `${file}:${symbol}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const source = unComment(readFileSync(file, "utf8"));
  const code = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, match => " ".repeat(match.length));
  const name = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // undefined/null placeholders are not a loader schema. This is a surface check,
  // not an attempt to execute or prove arbitrary schema construction expressions.
  const hasBinding = (bindingName) => {
    const escaped = bindingName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const placeholder = new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*(?::[^=;]+)?=\\s*(?:undefined|null|void\\b)\\b`).test(code);
    return new RegExp(`\\b(?:const|let|var|class|function)\\s+${escaped}\\b`).test(code) && !placeholder
      && !new RegExp(`\\bdeclare\\s+(?:const|let|var|class|function)\\s+${escaped}\\b`).test(code);
  };
  const binding = hasBinding(symbol);
  if (binding && new RegExp(`\\bexport\\s+(?:const|let|var|class|function)\\s+${name}\\b`).test(code)) return true;
  const follow = (specifier, childName) => {
    if (!specifier?.startsWith(".")) return false;
    const target = sourceFile(resolve(dirname(file), specifier));
    return target !== undefined && target.startsWith(directory + sep) && exportsValue(target, childName, directory, seen);
  };
  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}(?:\s*from\s*(["'])([^"']+)\2)?/g)) {
    if (code.slice(match.index, match.index + 6) !== "export") continue;
    for (const item of match[1].split(",")) {
      const parts = item.trim().split(/\s+as\s+/);
      if (parts[0].startsWith("type ") || (parts[1] ?? parts[0]) !== symbol) continue;
      if (match[3] === undefined && parts[0] === symbol && binding) return true;
      if (match[3] === undefined) {
        if (hasBinding(parts[0])) return true;
      } else if (follow(match[3], parts[0])) return true;
    }
  }
  for (const match of source.matchAll(/\bexport\s*\*\s*from\s*(["'])([^"']+)\1/g)) {
    if (code.slice(match.index, match.index + 6) === "export" && follow(match[2], symbol)) return true;
  }
  return false;
}

export function checkClientContract({ manifest, path }) {
  if (manifest.dshBase?.client === undefined) return [];
  const failures = [], label = manifest.name, directory = dirname(path);
  const documentRoutes = manifest.dshBase.client.documentRoutes;
  if (documentRoutes !== undefined && (!Array.isArray(documentRoutes) || documentRoutes.length === 0
    || new Set(documentRoutes).size !== documentRoutes.length
    || documentRoutes.some(route => typeof route !== "string" || !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(route)))) {
    failures.push(`${label}: documentRoutes must be unique exact absolute document paths (no queries, hashes, wildcards or traversal)`);
  }
  const client = manifest.dsh?.client;
  if (client === null || typeof client !== "object" || Array.isArray(client) || client.platform !== "web") failures.push(`${label}: composed client requires dsh.client metadata with platform web`);
  const targets = runtimeTargets(manifest.exports?.["./client"]);
  if (targets.length === 0) failures.push(`${label}: composed client requires a runtime /client export`);
  for (const target of new Set(targets)) {
    const resolved = target.startsWith("./") ? resolve(directory, target) : undefined;
    const file = resolved === undefined || !resolved.startsWith(directory + sep) ? undefined : sourceFile(resolved);
    if (file === undefined) failures.push(`${label}: /client export target is missing or outside its package: ${target}`);
    else if (!exportsValue(file, "Config", directory)) failures.push(`${label}: /client must export a runtime Config schema (not a type, comment, or undefined placeholder)`);
  }
  return failures;
}
