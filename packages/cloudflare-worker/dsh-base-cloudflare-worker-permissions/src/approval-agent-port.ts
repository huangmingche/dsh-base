/** Narrow Host port for the two reviewed official approval-policy operations.
 * This is not a native DSH Agent: it has no inbox runner, wake, tools or registry.
 * The pinned setPolicy implementation borrows only session and inject; its
 * context provider borrows only session. Keep this boundary pin-reviewed.
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ApprovalPolicy, ApprovalService } from '@deepseek-ai/dsh-user-approval';
import type { SystemPrompt, PromptAssembly } from '@deepseek-ai/dsh-system-prompt';

export type ApprovalPolicyAgentPort = Pick<Agent, 'session' | 'inject'>;

/** Invoke the unchanged official policy writer and message producer. */
export function applyApprovalPolicy(service: ApprovalService, port: ApprovalPolicyAgentPort, policy: ApprovalPolicy): void {
  // Reflect makes the runtime compatibility boundary explicit instead of casting
  // the port to a full Agent. Tests exercise the actual official method.
  Reflect.apply(service.setPolicy, service, [port, policy]);
}

/** Read the unchanged official current-value context, after retained history. */
export async function approvalPolicyContext(prompt: SystemPrompt, port: ApprovalPolicyAgentPort): Promise<string> {
  const assembly: PromptAssembly = await Reflect.apply(prompt.assemble, prompt, [{ agent: port }]);
  const policy = assembly.contexts.find(context => context.name === 'approval:policy');
  if (policy === undefined || policy.text === '') throw new Error('Official approval policy context is unavailable');
  return policy.text;
}
