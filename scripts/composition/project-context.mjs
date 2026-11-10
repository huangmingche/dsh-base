/** Explicit roots for a standalone base checkout or a product consuming it. */
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const baseRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const within = (parent, child) => child.startsWith(parent + sep);

/** Resolve existing ancestors too, so a not-yet-created output cannot traverse a symlink. */
function realLocation(path) {
  let present = false;
  try { lstatSync(path); present = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
  // A dangling symlink is present but realpath throws: never treat it as a new file.
  if (present) return realpathSync(path);
  const parent = dirname(path);
  if (parent === path) return path;
  return join(realLocation(parent), path.slice(parent.length + 1));
}

export function projectContext(root = baseRepoRoot) {
  const productRoot = realLocation(resolve(root));
  const manifestPath = join(productRoot, "dsh.project.json");
  if (!existsSync(manifestPath)) return {
    root: productRoot, productRoot, baseRoot: productRoot,
    upstreamRoot: join(productRoot, ".submodules/deepseek-harness"),
    generatedRoot: join(productRoot, ".artifacts/dsh"), namespace: "dsh-base", consumer: false,
  };
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)
    || manifest.version !== 1 || Object.keys(manifest).some(key => !["version", "base", "namespace"].includes(key))) {
    throw new Error("dsh.project.json: expected version 1 with base and namespace only");
  }
  if (typeof manifest.namespace !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.namespace)
    || ["dsh-base", "deepseek-ai"].includes(manifest.namespace)) throw new Error("dsh.project.json: namespace must be a distinct lowercase package-scope slug");
  if (typeof manifest.base !== "string" || manifest.base === "" || isAbsolute(manifest.base)
    || manifest.base.split(/[\\/]/).some(part => ["", ".", ".."].includes(part))) throw new Error("dsh.project.json: base must be a nested relative submodule path");
  const baseRoot = realLocation(resolve(productRoot, manifest.base));
  if (!existsSync(baseRoot) || !within(productRoot, baseRoot)) throw new Error("dsh.project.json: base must exist inside the product root");
  if (existsSync(join(baseRoot, "dsh.project.json"))) throw new Error("dsh.project.json: nested consumer bases are not supported");
  const generatedRoot = realLocation(join(productRoot, ".artifacts/dsh"));
  if (!within(productRoot, generatedRoot) || generatedRoot === baseRoot || within(baseRoot, generatedRoot)
    || within(generatedRoot, baseRoot)) throw new Error("dsh.project.json: generated output must stay inside the product and outside the read-only base");
  return { root: productRoot, productRoot, baseRoot, upstreamRoot: join(baseRoot, ".submodules/deepseek-harness"), generatedRoot, namespace: manifest.namespace, consumer: true };
}

/** Check each destination at write time, including already-existing child symlinks. */
export function productOutputPath(root, relativePath) {
  const context = projectContext(root);
  if (typeof relativePath !== "string" || relativePath === "" || isAbsolute(relativePath)
    || relativePath.split(/[\\/]/).some(part => ["", ".", "..", ".git"].includes(part))) throw new Error("product output must use a safe relative path");
  const output = realLocation(resolve(context.productRoot, relativePath));
  if (!within(context.productRoot, output)
    || output === join(context.productRoot, ".git") || within(join(context.productRoot, ".git"), output)
    || context.consumer && (output === context.baseRoot || within(context.baseRoot, output))
    || output === context.upstreamRoot || within(context.upstreamRoot, output)) throw new Error("product output escapes the product or writes into a read-only dependency");
  return output;
}

/** Git verification is separate from pure metadata readers and their fixtures. */
export function verifyProject(root = baseRepoRoot) {
  const context = projectContext(root);
  if (!context.consumer) return context;
  const git = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const path = relative(context.productRoot, context.baseRoot).split(sep).join("/");
  const modules = git(context.productRoot, ["config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"]);
  if (!modules.split("\n").some(line => line.slice(line.indexOf(" ") + 1) === path)) throw new Error("dsh.project.json: base is not registered in .gitmodules");
  const staged = git(context.productRoot, ["ls-files", "--stage", "--", path]);
  const match = /^160000 ([a-f0-9]{40,64}) 0\t([^\n]+)$/.exec(staged);
  if (match === null || match[2] !== path) throw new Error("dsh.project.json: base must be a pinned gitlink");
  const baseCommit = git(context.baseRoot, ["rev-parse", "HEAD"]);
  if (baseCommit !== match[1]) throw new Error("dsh.project.json: base HEAD does not match the product gitlink");
  const lock = JSON.parse(readFileSync(join(context.baseRoot, "dsh-source.lock.json"), "utf8"));
  if (lock.repository !== "https://github.com/deepseek-ai/deepseek-harness.git"
    || lock.referencePath !== ".submodules/deepseek-harness"
    || !/^dsh-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(lock.tag ?? "")
    || !/^[a-f0-9]{40}$/.test(lock.commit ?? "") || !/^[a-f0-9]{40}$/.test(lock.tree ?? "")) throw new Error("dsh.project.json: base must retain its official release source lock");
  const upstreamLink = git(context.baseRoot, ["ls-files", "--stage", "--", lock.referencePath]);
  if (!upstreamLink.startsWith(`160000 ${lock.commit} 0\t`)
    || git(context.upstreamRoot, ["rev-parse", "HEAD"]) !== lock.commit
    || git(context.upstreamRoot, ["rev-parse", "HEAD^{tree}"]) !== lock.tree
    || git(context.upstreamRoot, ["rev-parse", "--verify", `refs/tags/${lock.tag}^{commit}`]) !== lock.commit) throw new Error("dsh.project.json: nested official source does not match the base release lock/gitlink");
  if (git(context.upstreamRoot, ["status", "--porcelain", "--untracked-files=all"]) !== ""
    || git(context.baseRoot, ["status", "--porcelain", "--untracked-files=all"]) !== "") throw new Error("dsh.project.json: base and official source must remain clean read-only submodules");
  return { ...context, baseCommit };
}
