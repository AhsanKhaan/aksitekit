// gate:design (scripts/design/contrast.mjs) and growth:today (scripts/growth/today.mjs), with planted failures.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDesign, contrast, frontMatter, parseColor, resolveRef } from '../../scripts/design/contrast.mjs';
import { streak, today } from '../../scripts/growth/today.mjs';

const REPO = path.resolve(__dirname, '..', '..');
const template = frontMatter(readFileSync(path.join(REPO, 'docs', 'templates', 'DESIGN.md'), 'utf8'));

describe('gate:design', () => {
  it('passes the DESIGN.md template: every pair meets WCAG AA', () => {
    const { results, problems } = checkDesign(template);
    expect(problems).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(8);
    expect(results.find((r: { name: string }) => r.name === 'input-border')).toMatchObject({ need: 3, kind: 'UI boundary' });
  });

  it('computes contrast as WCAG does', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(Math.round(contrast('#767676', '#FFFFFF') * 100) / 100).toBe(4.54);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
  });

  it('fails light grey text on white (planted: 2.5:1)', () => {
    const tokens = structuredClone(template);
    tokens.colors.muted = '#9CA3AF';
    expect(checkDesign(tokens).problems).toEqual([expect.stringMatching(/components\.caption: #9CA3AF on #FFFFFF is 2\.54:1, under the 4\.5:1 WCAG AA minimum for text/)]);
  });

  it('fails a faint input border (planted: under 3:1 for a UI boundary)', () => {
    const tokens = structuredClone(template);
    tokens.colors.border = '#D1D5DB';
    expect(checkDesign(tokens).problems).toEqual([expect.stringMatching(/components\.input-border: .* under the 3:1 WCAG AA minimum for UI boundary/)]);
  });

  it('fails a reference to a token that does not exist', () => {
    expect(() => resolveRef(template, '{colors.nope}')).toThrow();
    const tokens = structuredClone(template);
    tokens.components.link.textColor = '{colors.nope}';
    expect(checkDesign(tokens).problems).toEqual([expect.stringMatching(/^components\.link: /)]);
  });

  it('fails a DESIGN.md with nothing to check', () => {
    expect(checkDesign({}).problems).toEqual([expect.stringMatching(/no components/)]);
  });
});

describe('growth:today', () => {
  const day = (i: number, status = 'todo') => ({ day: i + 1, week: Math.floor(i / 7) + 1, theme: 'Foundations', minutes: 30, task: `Task ${i + 1}`, doneWhen: `Check ${i + 1}`, status });
  const plan = { start: '2026-10-26', days: Array.from({ length: 90 }, (_, i) => day(i, i < 3 ? 'done' : 'todo')) };

  it('prints only today\'s task, its done check and the streak', () => {
    const r = today(plan, '2026-10-29');
    expect(r.code).toBe(0);
    expect(r.lines).toEqual(expect.arrayContaining(['Day 4 of 90 · week 1: Foundations', 'Today (30 min): Task 4', 'Done when: Check 4', 'Streak: 3 day(s)']));
    expect(r.lines.join('\n')).not.toContain('Task 5');
  });

  it('adds the Monday planning and Friday review nudges', () => {
    expect(today(plan, '2026-11-02').lines).toContain('Monday: 10 minutes to plan the week first.');
    expect(today(plan, '2026-10-30').lines).toContain('Friday: 10 minutes to review the week at the end.');
  });

  it('warns when more than 3 tasks are open', () => {
    const busy = { ...plan, days: plan.days.map((d, i) => (i < 4 ? { ...d, status: 'doing' } : d)) };
    expect(today(busy, '2026-10-29').lines.join('\n')).toMatch(/4 tasks are "doing"/);
  });

  it('counts the streak up to the last finished day', () => {
    const days = [day(0, 'done'), day(1, 'skipped'), day(2, 'done'), day(3, 'done'), day(4, 'todo')];
    expect(streak(days, 5)).toBe(2);
    expect(streak(days, 4)).toBe(2);
    expect(streak(days, 2)).toBe(1);
  });

  it('handles the days before and after the plan', () => {
    expect(today(plan, '2026-10-20').lines[0]).toMatch(/starts on 2026-10-26, in 6 day\(s\)/);
    expect(today(plan, '2027-03-01').lines[0]).toMatch(/90-day plan ended/);
  });

  it('fails a plan without a start date or days (planted)', () => {
    expect(today({ days: [] }, '2026-10-29').code).toBe(1);
    expect(today({ start: '2026-10-26', days: [{ ...day(0), task: '' }] }, '2026-10-26')).toEqual({ lines: ['growth:today: day 1 has no task in growth/plan.json'], code: 1 });
  });
});
