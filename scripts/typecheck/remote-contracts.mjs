/** Real pinned Typert generation into our ignored artifacts; never invokes upstream writers. */
import "./official-hook.mjs";
const { WorkspaceAnalyzer, FaceModelEmitter } = await import("@deepseek-ai/dsh-typert-generator");
import { mkdirSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { createRequire } from "node:module";
import { buildContext, cliProductRoot } from "../build/product-paths.mjs";
const context = buildContext(cliProductRoot());
const { appRoot: app, upstreamRoot, typecheckRoot: output } = context;
// The official analyzer canonicalizes its workspace root. Its TypeScript inputs
// must use the same root when the pinned checkout is reached through a link.
const source = realpathSync(upstreamRoot);
const ts = createRequire(join(app, "package.json"))("typescript");
const read = ts.readConfigFile(join(source, "tsconfig.host.json"), ts.sys.readFile);
const original = ts.parseJsonConfigFileContent(read.config, ts.sys, source);
const worker = JSON.parse(readFileSync(join(output, "worker.json"), "utf8"));
const paths = Object.fromEntries(Object.entries(worker.compilerOptions.paths).map(([name, values]) => [name,
  values.map(value => value.startsWith(upstreamRoot + sep) ? source + value.slice(upstreamRoot.length) : value),
]));
for (const [name, values] of Object.entries(original.options.paths)) paths[name] = values.map(value => join(source, value));
const configPath = join(output, "typert-host.json");
writeFileSync(configPath, JSON.stringify({ extends: join(source, "tsconfig.host.json"), compilerOptions: { paths, typeRoots: [join(app, "node_modules/@types")], types: ["node"] }, files: [], include: [], references: original.projectReferences.map(reference => ({ path: reference.path })) }, null, 2));
const options = { root: source, hostConfig: configPath, faces: ["host"], checkDiagnostics: false, rejectBuildOutputs: true, mode: "check" };
const contributors = new WorkspaceAnalyzer(options).discoverPackages(manifest => manifest.exports?.["./remote"] !== undefined).map(entry => entry.package);
const workspace = new WorkspaceAnalyzer({ ...options, packages: contributors }).analyze();
const generated = {};
for (const face of workspace.faces) {
  const emitter = new FaceModelEmitter(face);
  for (const pkg of face.packages) {
    const artifact = emitter.emit(pkg.name);
    if (!artifact.remote) continue;
    const directory = join(output, "remote", pkg.name.replace("@deepseek-ai/", ""));
    mkdirSync(directory, { recursive: true });
    const file = join(directory, "remote.d.ts");
    writeFileSync(file, artifact.remote.dts.replace(/\/\/# sourceMappingURL=.*$/m, ""));
    writeFileSync(join(directory, "remote.js"), artifact.remote.js);
    generated[`${pkg.name}/remote`] = [file];
  }
}
writeFileSync(join(output, "remote-paths.json"), JSON.stringify(generated, null, 2));
const clientPath = join(output, "client.json");
const client = JSON.parse(readFileSync(clientPath, "utf8"));
client.compilerOptions.paths = { ...client.compilerOptions.paths, ...generated };
writeFileSync(clientPath, JSON.stringify(client, null, 2));
console.log(`Generated ${Object.keys(generated).length} official Remote declarations outside the pinned checkout`);
