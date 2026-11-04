# @dsh-base/cloudflare-think-memory

Think agent plugin with durable, human-approved memory.

- Context: contributes the memory prompt block and injects approved facts from the agent's SQLite table.
- Tool: `recall_facts` reads the approved facts.
- Action: `remember_fact` persists one fact with inline human approval (`approval: true`), low risk, and a
  stable idempotency key so the action ledger does not double-write the same fact.
- Storage: the composed Think agent owns `dsh_agent_facts` in Durable Object SQLite; the plugin receives only the
  `DshAgentRuntime` methods (`rememberFact`, `listFacts`).

Memory is durable state of the current Agent, not the official DSH cross-session global memory service.
