/** Cloudflare timer adapter; all Cron parsing/timezone/DST policy is official. */
import { Cron } from '@deepseek-ai/dsh-util-time';
import { ScheduleInputError } from './schedule-store.ts';

export function officialCron(expression: unknown, timeZone: unknown): Cron {
  if (typeof expression !== 'string' || typeof timeZone !== 'string') throw new ScheduleInputError('invalid_rule', 'cron requires expression and time_zone strings');
  const result = Cron.parse(expression, timeZone);
  if (result.kind === 'rejected') throw new ScheduleInputError('invalid_rule', result.detail);
  return result.rule;
}

export function firstCronOccurrence(expression: unknown, timeZone: unknown, now: Date): { expression: string; timeZone: string; scheduledAt: string } {
  const rule = officialCron(expression, timeZone);
  const scheduledAt = rule.next(now.getTime());
  if (!scheduledAt) throw new ScheduleInputError('not_future', 'cron has no representable future occurrence');
  return { expression: rule.expression, timeZone: rule.timeZone, scheduledAt };
}
