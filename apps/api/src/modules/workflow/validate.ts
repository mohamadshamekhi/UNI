import { ExprError, parseExpr, referencedPaths } from './expr.js';
import { BUILTIN_APPLICANT, definitionSchema, type Selector, type WorkflowDefinition } from './definition.js';

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationContext {
  /** role keys that exist in the tenant (assignee rules must reference them) */
  roleKeys: Set<string>;
}

/**
 * Pre-publish validation (WF-14): structure, references, reachability, termination and
 * condition syntax. Returns every problem found, not just the first.
 */
export function validateDefinition(raw: unknown, ctx: ValidationContext): { ok: boolean; issues: ValidationIssue[]; definition?: WorkflowDefinition } {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ code: 'schema', message: i.message, path: i.path.join('.') })),
    };
  }
  const def = parsed.data;
  const issues: ValidationIssue[] = [];
  const steps = new Map(def.steps.map((s) => [s.id, s]));

  // unique ids
  if (steps.size !== def.steps.length) issues.push({ code: 'duplicate_step', message: 'شناسه مراحل باید یکتا باشد.' });
  if (!steps.has(def.start)) issues.push({ code: 'unknown_start', message: 'مرحله شروع تعریف نشده است.', path: 'start' });
  if (steps.get(def.start)?.type === 'end') issues.push({ code: 'start_is_end', message: 'مرحله شروع نمی‌تواند پایان باشد.' });

  // transitions reference existing steps; actions belong to the source step
  def.transitions.forEach((t, i) => {
    const from = steps.get(t.from);
    if (!from) issues.push({ code: 'unknown_step', message: `مرحله «${t.from}» وجود ندارد.`, path: `transitions.${i}.from` });
    if (t.to !== BUILTIN_APPLICANT && !steps.has(t.to)) issues.push({ code: 'unknown_step', message: `مرحله «${t.to}» وجود ندارد.`, path: `transitions.${i}.to` });
    if (from?.type === 'end') issues.push({ code: 'transition_from_end', message: 'از مرحله پایان نمی‌توان خارج شد.', path: `transitions.${i}` });
    if (from?.type === 'human' && (!t.action || !from.actions.includes(t.action))) {
      issues.push({ code: 'unknown_action', message: `اقدام «${t.action ?? '—'}» برای مرحله «${t.from}» تعریف نشده است.`, path: `transitions.${i}.action` });
    }
    if (from?.type === 'decision' && !t.when && !t.otherwise) {
      issues.push({ code: 'decision_needs_condition', message: 'انتقال‌های مرحله تصمیم باید شرط یا «در غیر این صورت» داشته باشند.', path: `transitions.${i}` });
    }
    if (t.when) {
      try {
        for (const p of referencedPaths(parseExpr(t.when))) {
          if (p === 'data' || p === 'case' || p === 'actor') issues.push({ code: 'bad_path', message: `مسیر «${p}» کامل نیست.`, path: `transitions.${i}.when` });
        }
      } catch (err) {
        issues.push({ code: 'bad_condition', message: `شرط نامعتبر: ${(err as ExprError).message}`, path: `transitions.${i}.when` });
      }
    }
  });

  // branch steps of a parallel never route on their own: the parallel's single exit does (join)
  const branchIds = new Set(def.steps.flatMap((s) => (s.type === 'parallel' ? s.branches : [])));
  for (const s of def.steps) {
    const out = def.transitions.filter((t) => t.from === s.id);
    if (s.type === 'human' && branchIds.has(s.id) && out.length) {
      issues.push({ code: 'branch_transition', message: `شاخه موازی «${s.id}» نباید انتقال خروجی داشته باشد.`, path: s.id });
    }
    if (s.type === 'human' && !branchIds.has(s.id)) {
      for (const a of s.actions) {
        if (!out.some((t) => t.action === a)) issues.push({ code: 'action_without_transition', message: `اقدام «${a}» در مرحله «${s.id}» مقصد ندارد.`, path: s.id });
      }
    }
    if (s.type === 'human') {
      if ('role' in s.assignee && !ctx.roleKeys.has(s.assignee.role)) {
        issues.push({ code: 'unknown_role', message: `نقش «${s.assignee.role}» در این دانشگاه وجود ندارد.`, path: s.id });
      }
    }
    if (s.type === 'decision') {
      const otherwise = out.filter((t) => t.otherwise).length;
      if (otherwise !== 1) issues.push({ code: 'decision_otherwise', message: `مرحله تصمیم «${s.id}» باید دقیقاً یک «در غیر این صورت» داشته باشد.`, path: s.id });
    }
    if ((s.type === 'system' || s.type === 'parallel') && out.length !== 1) {
      issues.push({ code: 'single_exit', message: `مرحله «${s.id}» باید دقیقاً یک انتقال خروجی داشته باشد.`, path: s.id });
    }
    if (s.type === 'parallel') {
      for (const b of s.branches) {
        const st = steps.get(b);
        if (!st || st.type !== 'human') issues.push({ code: 'bad_branch', message: `شاخه «${b}» باید یک مرحله انسانی باشد.`, path: s.id });
      }
    }
  }

  // reachability from start and termination of every reachable step
  const edges = new Map<string, string[]>();
  for (const t of def.transitions) if (t.to !== BUILTIN_APPLICANT) edges.set(t.from, [...(edges.get(t.from) ?? []), t.to]);
  for (const s of def.steps) {
    if (s.type !== 'parallel') continue;
    edges.set(s.id, [...(edges.get(s.id) ?? []), ...s.branches]);
    // a branch finishes by joining into the parallel's exit
    const exit = def.transitions.find((t) => t.from === s.id && t.to !== BUILTIN_APPLICANT);
    if (exit) for (const b of s.branches) edges.set(b, [...(edges.get(b) ?? []), exit.to]);
  }
  const reachable = new Set<string>();
  const stack = steps.has(def.start) ? [def.start] : [];
  while (stack.length) {
    const cur = stack.pop()!;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    stack.push(...(edges.get(cur) ?? []));
  }
  for (const s of def.steps) if (!reachable.has(s.id)) issues.push({ code: 'unreachable', message: `مرحله «${s.id}» از شروع قابل دستیابی نیست.`, path: s.id });

  // every reachable step can reach an end (reverse reachability)
  const reverse = new Map<string, string[]>();
  for (const [from, tos] of edges) for (const to of tos) reverse.set(to, [...(reverse.get(to) ?? []), from]);
  const canEnd = new Set<string>();
  const queue = def.steps.filter((s) => s.type === 'end').map((s) => s.id);
  while (queue.length) {
    const cur = queue.pop()!;
    if (canEnd.has(cur)) continue;
    canEnd.add(cur);
    queue.push(...(reverse.get(cur) ?? []));
  }
  for (const s of reachable) if (!canEnd.has(s)) issues.push({ code: 'no_end', message: `از مرحله «${s}» هیچ مسیری به پایان نمی‌رسد.`, path: s });

  // automatic loops (cycles with no human step) would spin forever
  const auto = new Set(def.steps.filter((s) => s.type === 'decision' || s.type === 'system').map((s) => s.id));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const dfs = (n: string): boolean => {
    if (visiting.has(n)) return true;
    if (done.has(n) || !auto.has(n)) return false;
    visiting.add(n);
    const cyc = (edges.get(n) ?? []).some(dfs);
    visiting.delete(n);
    done.add(n);
    return cyc;
  };
  for (const n of auto) if (dfs(n)) issues.push({ code: 'automatic_loop', message: `حلقه بدون مرحله انسانی از «${n}» تشکیل شده است.`, path: n });

  return { ok: issues.length === 0, issues, definition: def };
}

/** WF-08: two published versions must not both match the same request. */
export function selectorsOverlap(a: Selector, b: Selector): boolean {
  if (a.requestType !== b.requestType) return false;
  const overlap = (x?: string[], y?: string[]) => !x?.length || !y?.length || x.some((v) => y.includes(v));
  return overlap(a.degrees, b.degrees) && overlap(a.unitIds, b.unitIds);
}
