#!/usr/bin/env node
/** Run every regression owned by the selected SaaS capability packages. */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from './lib.mjs';
const clients=['waffo','email','google-auth','account-profile','user-admin','api-keys','entitlements','files','newsletter','contact','notifications','crisp','cache','dashboard'];
const workers=['payment-waffo','email','google-auth','account-profile','user-admin','api-keys','entitlements','files','newsletter','contact','notifications','crisp','cache','operations-dashboard'];
const directories=[...clients.map(id=>`packages/client/dsh-base-client-${id}/tests`),...workers.map(id=>`packages/cloudflare-worker/dsh-base-cloudflare-worker-${id}/tests`),'packages/boot/dsh-base-saas-ui/tests','apps/web/tests/saas'];
const tests=directories.flatMap(path=>existsSync(join(repoRoot,path))?readdirSync(join(repoRoot,path)).filter(name=>/\.test\.(?:ts|mjs)$/u.test(name)).map(name=>join(path,name)):[]);
tests.push('packages/cloudflare-worker/dsh-base-cloudflare-worker-auth/tests/email-google-runtime.test.mjs');
tests.push('packages/cloudflare-worker/dsh-base-cloudflare-worker-auth/tests/composition-runtime.test.mjs');
tests.push('packages/cloudflare-worker/dsh-base-cloudflare-worker-http/tests/outbound-runtime.test.mjs');
tests.push('packages/client/dsh-base-client-auth-login/tests/email-flow.test.ts');
const result=spawnSync(process.execPath,['--experimental-strip-types','--import','./packages/cloudflare-worker/dsh-base-cloudflare-worker-session-host/tests/official-runtime-hook.mjs','--test','--test-concurrency=2',...tests],{cwd:repoRoot,stdio:'inherit'});
process.exit(result.status??1);
