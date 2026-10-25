import { describe, expect, it } from 'vitest';
import { evaluateCondition, parseExpr } from './expr.js';
import { selectorsOverlap, validateDefinition } from './validate.js';
import { selectorMatches } from './engine.service.js';
import { dueDate, validateForm } from './forms.js';

describe('condition language (WF-03)', () => {
  const scope = { data: { degree: 'phd', score: 17, tags: ['a', 'b'], needsCommittee: false }, case: { round: 2 }, actor: {} };
  it.each([
    ["data.degree == 'phd'", true],
    ["data.degree == 'msc' || data.score >= 15", true],
    ['data.score > 18 && data.degree == "phd"', false],
    ['!data.needsCommittee', true],
    ["'a' in data.tags", true],
    ["data.degree in ['msc', 'phd']", true],
    ['case.round < 3', true],
    ['data.missing == null', true],
    ['data.degree > 3', false],
  ])('%s → %s', (src, expected) => expect(evaluateCondition(src, scope)).toBe(expected));

  it.each(['process.exit()', 'data.__proto__.x', 'data.constructor', 'foo == 1', 'data.x = 1', "data.a ==", '(' .repeat(40) + 'true' + ')'.repeat(40)])(
    'rejects %s',
    (src) => expect(() => parseExpr(src)).toThrow(),
  );
});

const roles = new Set(['expert', 'faculty', 'university_admin']);
const sample = {
  start: 'expert-check',
  steps: [
    { id: 'expert-check', type: 'human', title: 'بررسی کارشناس', assignee: { role: 'expert' }, actions: ['approve', 'return_for_fix', 'reject'], sla: { days: 5 } },
    { id: 'route', type: 'decision', title: 'مسیر' },
    { id: 'advisor', type: 'human', title: 'استاد راهنما', assignee: { dynamic: 'data.advisorMembershipId' }, actions: ['approve', 'reject'] },
    { id: 'done', type: 'end', title: 'تأیید', outcome: 'success' },
    { id: 'rejected', type: 'end', title: 'رد', outcome: 'failure' },
  ],
  transitions: [
    { from: 'expert-check', action: 'approve', to: 'route' },
    { from: 'expert-check', action: 'return_for_fix', to: '@applicant' },
    { from: 'expert-check', action: 'reject', to: 'rejected' },
    { from: 'route', when: "data.degree == 'phd'", to: 'advisor' },
    { from: 'route', otherwise: true, to: 'done' },
    { from: 'advisor', action: 'approve', to: 'done' },
    { from: 'advisor', action: 'reject', to: 'rejected' },
  ],
};

describe('definition validation (WF-14)', () => {
  it('accepts a well-formed workflow', () => {
    const r = validateDefinition(sample, { roleKeys: roles });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('reports missing transitions, unknown roles, unreachable steps and bad conditions', () => {
    const broken = structuredClone(sample) as typeof sample;
    broken.steps[0]!.assignee = { role: 'ghost' } as never;
    broken.steps.push({ id: 'orphan', type: 'end', title: 'یتیم', outcome: 'success' } as never);
    broken.transitions = broken.transitions.filter((t) => !(t.from === 'advisor' && t.action === 'reject'));
    broken.transitions[3] = { from: 'route', when: 'data.degree ==', to: 'advisor' };
    const codes = validateDefinition(broken, { roleKeys: roles }).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['unknown_role', 'unreachable', 'action_without_transition', 'bad_condition']));
  });

  it('detects dead ends and automatic loops', () => {
    const loop = {
      start: 'aa',
      steps: [
        { id: 'aa', type: 'decision', title: 'a' },
        { id: 'bb', type: 'decision', title: 'b' },
        { id: 'end', type: 'end', title: 'end', outcome: 'success' },
      ],
      transitions: [
        { from: 'aa', when: 'data.x == 1', to: 'bb' },
        { from: 'aa', otherwise: true, to: 'bb' },
        { from: 'bb', when: 'data.x == 1', to: 'aa' },
        { from: 'bb', otherwise: true, to: 'aa' },
      ],
    };
    const codes = validateDefinition(loop, { roleKeys: roles }).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['automatic_loop', 'no_end', 'unreachable']));
  });

  it('flags overlapping selectors (WF-08)', () => {
    expect(selectorsOverlap({ requestType: 'thesis' }, { requestType: 'thesis', degrees: ['msc'] })).toBe(true);
    expect(selectorsOverlap({ requestType: 'thesis', degrees: ['phd'] }, { requestType: 'thesis', degrees: ['msc'] })).toBe(false);
    expect(selectorsOverlap({ requestType: 'thesis' }, { requestType: 'paper' })).toBe(false);
  });
});

describe('forms, SLA and selectors', () => {
  const fields = [
    { key: 'grade', type: 'number' as const, label: 'نمره', required: true, visibility: 'public' as const },
    { key: 'note', type: 'textarea' as const, label: 'یادداشت', required: false, visibility: 'internal' as const },
  ];

  it('splits public and internal values and rejects bad input', () => {
    expect(validateForm(fields, { grade: 18, note: 'x' })).toEqual({ public: { grade: 18 }, internal: { note: 'x' } });
    expect(() => validateForm(fields, {})).toThrow();
    expect(() => validateForm(fields, { grade: '18' })).toThrow();
    expect(() => validateForm(fields, { grade: 1, other: true })).toThrow();
  });

  it('business-day due dates skip Fridays', () => {
    const thu = new Date('2026-10-22T08:00:00Z'); // Thursday
    expect(dueDate(thu, { days: 1, businessDays: true, remindBefore: [], onOverdue: 'notify' })!.toISOString().slice(0, 10)).toBe('2026-10-24');
    expect(dueDate(thu, { days: 1, businessDays: false, remindBefore: [], onOverdue: 'notify' })!.toISOString().slice(0, 10)).toBe('2026-10-23');
    expect(dueDate(thu, undefined)).toBeNull();
  });

  it('selector matches degree and unit subtree', () => {
    const s = { requestType: 'x', degrees: ['phd'], unitIds: ['u1'] };
    expect(selectorMatches(s, { degree: 'phd', unitPath: '/root/u1/dept/' })).toBe(true);
    expect(selectorMatches(s, { degree: 'msc', unitPath: '/root/u1/dept/' })).toBe(false);
    expect(selectorMatches(s, { degree: 'phd', unitPath: '/root/u2/' })).toBe(false);
  });

  it('parallel branches must not route on their own', () => {
    const def = {
      start: 'pp',
      steps: [
        { id: 'pp', type: 'parallel', title: 'p', branches: ['aa', 'bb'] },
        { id: 'aa', type: 'human', title: 'a', assignee: { role: 'expert' }, actions: ['ok'] },
        { id: 'bb', type: 'human', title: 'b', assignee: { role: 'expert' }, actions: ['ok'] },
        { id: 'end', type: 'end', title: 'e', outcome: 'success' },
      ],
      transitions: [{ from: 'pp', to: 'end' }],
    };
    expect(validateDefinition(def, { roleKeys: new Set(['expert']) }).issues).toEqual([]);
    const bad = { ...def, transitions: [...def.transitions, { from: 'aa', action: 'ok', to: 'end' }] };
    expect(validateDefinition(bad, { roleKeys: new Set(['expert']) }).issues.map((i) => i.code)).toContain('branch_transition');
  });
});
