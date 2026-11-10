# @dsh-base/cloudflare-think-subagent

Restores an **explicit unavailable declaration plus a compatibility export** only — **not real subagent capability**. This deployment's **storage is empty, so there is no history to verify**.

## Current state

- **No `delegate_task` is registered**: the model-facing tool catalog is empty (`subagentTools.tools()` returns `{}`), and the
  system prompt states `SUBAGENT_UNAVAILABLE_REASON` and explicitly tells the model not to claim a subagent was launched.
- The `DshSubagent` class name and Worker export remain, extending the official Think storage implementation so persisted facet
  class names still resolve. Model / turn / step / tool entry points all throw `SUBAGENT_UNAVAILABLE_REASON`; nothing can keep
  executing through platform credentials.
- **Storage is empty**: Commit 1's `deleted` migration cleared historical facets and session records. This package restores the
  class name, the export and the inherited read path, but the deployment holds no historical data that could verify a "history
  readable" claim — documentation and acceptance may only say "no history to verify", never that capability was restored.
- Interactive subagent control (`remote.subagents.prompt/interruptByParent` on the client) still refuses with `subagent/unavailable`.
- The Worker `DshSubagent` Durable Object returns with sqlite storage (the former `state: "deleted"` tombstone is removed). The
  B-state deployment log already proved that tombstone stale (no same-name namespace to preserve), so the resurrected namespace
  starts empty. If Cloudflare rejects the same-name resurrection, follow ADR §11.9 and rename in the three places, keeping the
  acceptance wording in sync.

## Why the official implementation is not mounted

The official delegation tool needs DSH subagent session addresses, ownership, execution and cancellation lifecycles. A Think
facet identity is not an owner Session address, so neither the official package nor a Host-only seam can provide those lifecycles,
and the former agentTool bridge carried neither owner BYOK nor session scope. The deployment therefore declares the capability
unavailable and hides the tool entry instead of faking a working subagent.

## Reuse decision

The official candidates `@deepseek-ai/dsh-tool-subagent` and `@deepseek-ai/dsh-subagent` cannot be mounted for the lifecycle gaps
above; see `dshBase.reuse` in `package.json` (`availability: "unavailable"`).
