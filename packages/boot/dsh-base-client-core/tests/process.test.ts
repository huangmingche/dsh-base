import assert from "node:assert/strict";
import { ensureBrowserProcess } from "../src/client/process.ts";

const scope: Parameters<typeof ensureBrowserProcess>[0] = {};
ensureBrowserProcess(scope);
assert.equal(scope.process?.versions?.node, "0.0.0");

// Vite define installs only env. Keep those values while disabling Node-internal
// loading through the official Loader's existing pre-22 runtime check.
const env = { DSH_CLIENT_VERSION: "fixture" };
scope.process = { env, versions: { browser: "1" } };
ensureBrowserProcess(scope);
assert.equal(scope.process.env, env);
assert.equal(scope.process.versions?.browser, "1");
assert.ok(Number(scope.process.versions?.node?.split(".")[0]) < 22);
assert.deepEqual(scope.process.execArgv, []);
ensureBrowserProcess(scope);
assert.equal(scope.process.env, env);
assert.equal(scope.process.versions?.node, "0.0.0");
console.log("Browser process Host defaults preserve Vite env and disable Node internals");
