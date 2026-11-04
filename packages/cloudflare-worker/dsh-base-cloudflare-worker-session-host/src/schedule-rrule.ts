/** Workers Host seam over the official, platform-neutral recurrence engine. */
import { RRule } from "@deepseek-ai/dsh-util-time";
import { ScheduleInputError } from "./schedule-store.ts";

export function officialRRule(expression: unknown): RRule {
  if (typeof expression !== "string") throw new ScheduleInputError("invalid_rule", "rrule must be DTSTART and RRULE content");
  const parsed = RRule.parse(expression, { rejectIneffectiveSetPositions: true });
  if (parsed.kind === "rejected") throw new ScheduleInputError("invalid_rule", parsed.detail);
  return parsed.rule;
}

export function firstRRuleOccurrence(expression: unknown, now: Date): { rrule: string; scheduledAt: string } {
  const rule = officialRRule(expression);
  const scheduledAt = rule.next(now.getTime());
  if (scheduledAt === undefined) throw new ScheduleInputError("not_future", "rrule must contain an occurrence strictly in the future");
  return { rrule: rule.expression, scheduledAt };
}
