/** Parse the exact deployable Worker modules without executing platform imports. */
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function checkWorkerOutput(outputRoot) {
  const workersRoot = join(outputRoot, 'workers');
  if (!existsSync(workersRoot)) throw new Error(`Missing Cloudflare Worker output: ${workersRoot}`);
  const modules = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.[cm]?js$/u.test(entry.name)) modules.push(path);
    }
  };
  for (const worker of readdirSync(workersRoot, { withFileTypes: true })) {
    if (!worker.isDirectory()) continue;
    const bundle = join(workersRoot, worker.name, 'bundle');
    if (!existsSync(join(bundle, 'index.js'))) throw new Error(`Missing deployable Worker entry: ${bundle}`);
    visit(bundle);
  }
  if (modules.length === 0) throw new Error('Cloudflare output contains no Worker JavaScript modules');
  for (const path of modules) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`Worker JavaScript syntax check failed: ${path}\n${result.error?.message ?? result.stderr}`);
  }
  return modules.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const count = checkWorkerOutput(resolve(process.argv[2] ?? '.cloudflare/output/v0'));
  console.log(`worker-output: ${count} deployable JavaScript module(s) parsed successfully`);
}
