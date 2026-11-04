#!/usr/bin/env node
/** Require official chat composition; this gate does not assert visual parity. */
import { join } from "node:path";
import { clientRows, isMain, localPackages, printResult, readJson, repoRoot } from "./lib.mjs";

export const requiredChatPackages = [
  "@deepseek-ai/dsh-api-session-controller",
  "@deepseek-ai/dsh-api-workspace-controller",
  "@deepseek-ai/dsh-client-file-upload",
  "@deepseek-ai/dsh-client-ui-input-trigger",
  "@deepseek-ai/dsh-client-ui-sidebar-right",
  "@deepseek-ai/dsh-client-ui-workspace",
  "@deepseek-ai/dsh-client-ui-file-drag",
  "@deepseek-ai/dsh-client-ui-context-menu",
  "@deepseek-ai/dsh-client-resources",
  "@deepseek-ai/dsh-client-ui-conversation",
  "@deepseek-ai/dsh-client-ui-chat",
];

export function checkChatParity(root) {
  const rows = clientRows(root);
  const active = rows.filter(row => row.disabled !== true);
  const locals = new Map(localPackages(root).map(({ manifest }) => [manifest.name, manifest]));
  const { commit } = readJson(join(root, "dsh-source.lock.json"));
  const failures = [];
  for (const name of requiredChatPackages) {
    const original = active.find(row => row.name === name);
    const replacements = active.filter(row => row.replaces === name);
    if (original?.origin === "upstream" && replacements.length === 0) continue;
    const row = replacements[0];
    const metadata = locals.get(row?.name)?.dshBase;
    const fork = metadata?.forkOf;
    const tracked = replacements.length === 1 && original === undefined && row?.origin === "custom"
      && rows.some(entry => entry.name === name && entry.disabled === true && entry.origin === "upstream")
      && metadata?.reuse?.mode === "fork" && fork?.package === name && fork.commit === commit
      && typeof fork.path === "string" && fork.path.length > 0 && typeof fork.license === "string" && fork.license.length > 0;
    if (!tracked) failures.push(`required official chat package needs its active original or one pinned fork with disabled original inventory: ${name}`);
  }
  return { failures, summary: `${requiredChatPackages.length} required official chat packages mounted directly or through pinned forks; rendered UI/interaction parity requires browser acceptance` };
}

if (isMain(import.meta.url)) printResult("chat composition", checkChatParity(repoRoot));
