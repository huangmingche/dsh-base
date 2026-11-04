/** Wall-clock recurrence contract. */
import assert from "node:assert/strict";
import { nextDailyOccurrence, nextWeeklyOccurrence, parseLocalTime, requireTimeZone } from "../src/schedule-recurrence.ts";

assert.deepEqual(parseLocalTime("09:30"), { hour: 9, minute: 30, second: 0, millisecond: 0 });
assert.deepEqual(parseLocalTime("23:59:58.5"), { hour: 23, minute: 59, second: 58, millisecond: 500 });
assert.throws(() => parseLocalTime("24:00"), /invalid local time/);
requireTimeZone("UTC");
requireTimeZone("Asia/Shanghai");
assert.throws(() => requireTimeZone("Not/AZone"), /invalid time_zone/);

// 2026-11-09T00:00:00Z = 08:00 Asia/Shanghai; next 09:30 local is 01:30Z.
assert.equal(nextDailyOccurrence(new Date("2026-11-09T00:00:00Z"), parseLocalTime("09:30"), "Asia/Shanghai").toISOString(), "2026-11-09T01:30:00.000Z");
assert.equal(nextDailyOccurrence(new Date("2026-11-09T02:00:00Z"), parseLocalTime("09:30"), "Asia/Shanghai").toISOString(), "2026-11-10T01:30:00.000Z");
// Monday 2026-11-09T00:00Z; next Wednesday 10:00 UTC.
assert.equal(nextWeeklyOccurrence(new Date("2026-11-09T00:00:00Z"), parseLocalTime("10:00"), "UTC", [3]).toISOString(), "2026-11-11T10:00:00.000Z");
// Same day but time already passed -> next week.
assert.equal(nextWeeklyOccurrence(new Date("2026-11-11T11:00:00Z"), parseLocalTime("10:00"), "UTC", [3]).toISOString(), "2026-11-18T10:00:00.000Z");
console.log("session-host: schedule recurrence passed");

// The exact official UI wire format exercises the real durable Host, not only
// a fixture or a stand-alone recurrence calculator.
{
  const { DatabaseSync } = await import("node:sqlite");
  const { SessionHost } = await import("../src/host.ts");
  const { SqliteSessionHostStorage } = await import("../src/sqlite-storage.ts");
  const { ScheduleStore } = await import("../src/schedule-store.ts");
  const { firstRRuleOccurrence, officialRRule } = await import("../src/schedule-rrule.ts");
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query: string, ...bindings: unknown[]) { const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[]; return { toArray: () => rows }; } };
  const schedules = new ScheduleStore(sql);
  const host = new SessionHost(new SqliteSessionHostStorage(sql), [], undefined, undefined, undefined, schedules);
  const dailyRule = "DTSTART;TZID=Asia/Shanghai:20300101T090000\nRRULE:FREQ=DAILY;COUNT=3";
  const daily = host.scheduleCreate({ request: { title: "Daily", prompt: "review", timing: { kind: "rrule", rrule: dailyRule }, target: { kind: "new_once" } } });
  assert.equal(daily.kind, "rrule");
  assert.equal(daily.rrule, dailyRule);
  assert.equal(daily.scheduledAt, "2030-01-01T01:00:00.000Z");
  await host.scheduleRun({ id: daily.id });
  assert.equal(schedules.view(daily.id)?.scheduledAt, daily.scheduledAt, "manual run must not consume its scheduled occurrence");
  await host.processDueSchedules("2030-01-01T01:00:00.000Z");
  assert.equal(schedules.view(daily.id)?.scheduledAt, "2030-01-02T01:00:00.000Z");
  await host.processDueSchedules("2030-01-03T02:00:00.000Z");
  assert.equal(schedules.view(daily.id)?.status, "ended");
  assert.equal(schedules.view(daily.id)?.lastDelivery?.scheduledAt, "2030-01-03T01:00:00.000Z", "late delivery admits the latest due occurrence without replaying a backlog");

  const onceRule = "DTSTART;TZID=Asia/Shanghai:20310101T090000\nRRULE:FREQ=DAILY;COUNT=1";
  const once = host.scheduleCreate({ request: { title: "Once", prompt: "once", timing: { kind: "rrule", rrule: onceRule } } });
  await host.processDueSchedules("2031-01-01T01:00:00.000Z");
  assert.equal(schedules.view(once.id)?.status, "ended");

  const weeklyRule = "DTSTART;TZID=Asia/Shanghai:20320105T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4";
  const weekly = host.scheduleCreate({ request: { title: "Weekly", prompt: "weekly", timing: { kind: "rrule", rrule: weeklyRule } } });
  assert.ok([1, 3].includes(new Date(weekly.scheduledAt).getUTCDay()));
  const edited = host.scheduleEdit({ id: weekly.id, action: "update", expectedUpdatedAt: weekly.updatedAt, patch: { timing: { kind: "rrule", rrule: "DTSTART:20330101T100000Z\nRRULE:FREQ=DAILY;COUNT=2" } } }) as { scheduledAt: string; updatedAt: string };
  assert.equal(edited.scheduledAt, "2033-01-01T10:00:00.000Z");
  assert.notEqual(edited.updatedAt, weekly.updatedAt);
  assert.deepEqual(host.scheduleEdit({ id: weekly.id, action: "update", expectedUpdatedAt: weekly.updatedAt, patch: { title: "stale" } }), { id: weekly.id, code: "schedule_conflict" });

  const dst = officialRRule("DTSTART;TZID=America/New_York:20260307T090000\nRRULE:FREQ=DAILY;COUNT=3");
  assert.equal(dst.next(Date.parse("2026-03-07T00:00:00Z")), "2026-03-07T14:00:00.000Z");
  assert.equal(dst.next(Date.parse("2026-03-07T14:00:00Z")), "2026-03-08T13:00:00.000Z");
  assert.equal(dst.next(Date.parse("2026-03-09T13:00:00Z")), undefined);
  assert.throws(() => firstRRuleOccurrence(onceRule, new Date("2031-01-02T00:00:00Z")), /strictly in the future/);
  assert.throws(() => officialRRule("not a recurrence"), /DTSTART|RRULE|rrule/);
  console.log("session-host: official RRULE once/daily/weekly, timezone/DST, COUNT, editing and delivery passed");
}

// DST gaps must not silently move a nonexistent time into another hour;
// overlaps fire only at the earlier instant, matching the pinned official resolver.
assert.equal(nextDailyOccurrence(new Date('2026-03-08T00:00:00Z'), parseLocalTime('02:30:00'), 'America/New_York').toISOString(), '2026-03-09T06:30:00.000Z');
assert.equal(nextDailyOccurrence(new Date('2026-11-01T00:00:00Z'), parseLocalTime('01:30:00'), 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
assert.equal(nextDailyOccurrence(new Date('2026-11-01T05:31:00Z'), parseLocalTime('01:30:00'), 'America/New_York').toISOString(), '2026-11-02T06:30:00.000Z');

{
  const { DatabaseSync } = await import('node:sqlite');
  const { SessionHost } = await import('../src/host.ts');
  const { SqliteSessionHostStorage } = await import('../src/sqlite-storage.ts');
  const { ScheduleStore } = await import('../src/schedule-store.ts');
  const { firstCronOccurrence, officialCron } = await import('../src/schedule-cron.ts');
  const db = new DatabaseSync(':memory:');
  const sql = { exec(query: string, ...bindings: unknown[]) { const rows = db.prepare(query).all(...bindings as never[]) as Record<string, unknown>[]; return { toArray: () => rows }; } };
  const schedules = new ScheduleStore(sql);
  const storage = new SqliteSessionHostStorage(sql);
  const host = new SessionHost(storage, [], undefined, undefined, undefined, schedules);
  const task = host.scheduleCreate({ request: { title: 'Official cron', prompt: 'review', timing: { kind: 'cron', cron: { expression: '30 9 * * 1-5', time_zone: 'Asia/Shanghai' } }, target: { kind: 'new_once' } } });
  assert.equal(task.kind, 'cron');
  assert.equal(task.expression, '30 9 * * 1-5');
  assert.equal(task.timeZone, 'Asia/Shanghai');
  const resumed = new SessionHost(storage, [], undefined, undefined, undefined, new ScheduleStore(sql));
  const manual = await resumed.scheduleRun({ id: task.id });
  assert.equal((manual as any).scheduledAt, task.scheduledAt);
  await resumed.processDueSchedules('2030-01-08T02:00:00.000Z');
  const next = schedules.view(task.id)!;
  assert.equal(next.lastDelivery?.scheduledAt, '2030-01-08T01:30:00.000Z', 'late alarm selects latest due time, not a backlog');
  assert.equal(next.scheduledAt, '2030-01-09T01:30:00.000Z');
  assert.equal(next.kind, 'cron');
  assert.equal(next.status, 'active');
  const edited = resumed.scheduleEdit({ id: task.id, action: 'update', expectedUpdatedAt: next.updatedAt, patch: { timing: { kind: 'cron', cron: { expression: '45 10 * * *', time_zone: 'UTC' } } } }) as any;
  assert.equal(edited.expression, '45 10 * * *');
  assert.equal(edited.timeZone, 'UTC');
  assert.deepEqual(resumed.scheduleEdit({ id: task.id, action: 'update', expectedUpdatedAt: next.updatedAt, patch: { title: 'stale' } }), { id: task.id, code: 'schedule_conflict' });
  assert.throws(() => officialCron('* * * * * *', 'UTC'), /five/);
  assert.throws(() => officialCron('* * * * *', 'invalid/zone'), /IANA/);
  assert.throws(() => firstCronOccurrence('0 0 31 2 *', 'UTC', new Date('2026-01-01Z')), /future/);
  const dst = officialCron('30 2 * * *', 'America/New_York');
  assert.equal(dst.next(Date.parse('2026-03-08T00:00:00Z')), '2026-03-09T06:30:00.000Z');
  console.log('schedule: official Cron create/edit/restart/manual/late-alarm/DST/refusals and daily overlap/gap semantics passed');
}
