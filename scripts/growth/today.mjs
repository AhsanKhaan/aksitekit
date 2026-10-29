// `npm run growth:today` (and the /today skill): only today's task from growth/plan.json, and the streak. One task,
// no list to scroll: the plan is ADHD-friendly on purpose (HANDBOOK §12). Read-only.
//
//   node scripts/growth/today.mjs                 today's task
//   node scripts/growth/today.mjs --date 2026-11-03   as on another day
//   GROWTH_PLAN=<path> reads another plan (tests).
import { existsSync, readFileSync } from 'node:fs';
import { isMain } from '../lib/site.mjs';

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The local calendar date (YYYY-MM-DD), not UTC: "today" is the owner's day. */
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNumber = (start, date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1;

/** Consecutive "done" days ending on the last finished day (today counts once it's done). */
export function streak(days, today) {
  let n = 0;
  let i = Math.min(today, days.length) - 1;
  if (i >= 0 && days[i]?.status !== 'done') i--; // today isn't over yet
  for (; i >= 0 && days[i]?.status === 'done'; i--) n++;
  return n;
}

/** What to print: { lines, code }. */
export function today(plan, date) {
  if (!plan || !DATE.test(plan.start ?? '') || !Array.isArray(plan.days)) return { lines: ['growth:today: growth/plan.json needs "start" (YYYY-MM-DD) and "days" (the growth-strategist writes it)'], code: 1 };
  const n = dayNumber(plan.start, date);
  if (n < 1) return { lines: [`The plan starts on ${plan.start}, in ${1 - n} day(s). Nothing to do yet.`], code: 0 };
  if (n > plan.days.length) {
    const done = plan.days.filter((d) => d.status === 'done').length;
    return { lines: [`The ${plan.days.length}-day plan ended on day ${plan.days.length}: ${done} of ${plan.days.length} tasks done [M: growth/plan.json].`, 'Ask the growth-strategist for the next plan.'], code: 0 };
  }
  const d = plan.days[n - 1];
  if (!d || !String(d.task ?? '').trim()) return { lines: [`growth:today: day ${n} has no task in growth/plan.json`], code: 1 };
  const open = plan.days.filter((x) => x.status === 'doing').length;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const lines = [
    `Day ${n} of ${plan.days.length} · week ${d.week}${d.theme ? `: ${d.theme}` : ''}`,
    '',
    `Today (${d.minutes} min): ${d.task}`,
    `Done when: ${d.doneWhen}`,
    `Status: ${d.status}`,
    '',
    `Streak: ${streak(plan.days, n)} day(s)`,
  ];
  if (weekday === 1) lines.push('Monday: 10 minutes to plan the week first.');
  if (weekday === 5) lines.push('Friday: 10 minutes to review the week at the end.');
  if (open > 3) lines.push(`${open} tasks are "doing": finish or park some (the limit is 3 open items).`);
  return { lines, code: 0 };
}

if (isMain(import.meta.url)) {
  const file = process.env.GROWTH_PLAN || 'growth/plan.json';
  const i = process.argv.indexOf('--date');
  const date = i !== -1 ? process.argv[i + 1] : localDate();
  if (!DATE.test(date ?? '')) {
    console.error('growth:today: --date must be YYYY-MM-DD');
    process.exitCode = 2;
  } else if (!existsSync(file)) {
    console.error(`growth:today: ${file} not found: the growth-strategist writes it (the growth stage of /start)`);
    process.exitCode = 1;
  } else {
    let plan;
    try {
      plan = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`growth:today: ${file} doesn't parse: ${e.message}`);
      process.exitCode = 1;
    }
    if (plan) {
      const r = today(plan, date);
      (r.code ? console.error : console.log)(r.lines.join('\n'));
      process.exitCode = r.code;
    }
  }
}
