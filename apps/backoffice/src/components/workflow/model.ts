import type { FormFieldDef } from "@uni/shared/types";

// Client mirror of the stored workflow definition (apps/api/src/modules/workflow/definition.ts).

export type Scope = "tenant" | "case_unit" | "case_unit_tree";
export type Assignee = { role: string; scope: Scope } | { membershipId: string } | { dynamic: string };

export interface Sla {
  days: number;
  businessDays: boolean;
  remindBefore: number[];
  remindAfter: number[];
  onOverdue: "notify" | "escalate" | "extend" | "cancel" | "close";
  escalateTo?: { role: string; scope: Scope };
  extendDays?: number;
}

export type Step =
  | { id: string; title: string; type: "human"; assignee: Assignee; actions: string[]; form: FormFieldDef[]; sla?: Sla; allowWithdraw?: boolean }
  | { id: string; title: string; type: "decision" }
  | { id: string; title: string; type: "parallel"; branches: string[]; join: "all" | "any" }
  | { id: string; title: string; type: "system"; task: "notify" | "request_payment" | "tag" | "thesis"; params: Record<string, unknown> }
  | { id: string; title: string; type: "end"; outcome: "success" | "failure" };

export type StepType = Step["type"];

export interface Transition {
  from: string;
  to: string;
  action?: string;
  when?: string;
  otherwise?: true;
}

export interface Definition {
  requestForm: FormFieldDef[];
  limits?: { onePerApplicant: boolean; reapplyAfterDays: number };
  start: string;
  steps: Step[];
  transitions: Transition[];
}

export interface Selector {
  requestType: string;
  degrees?: string[];
  unitIds?: string[];
}

export type VersionStatus = "draft" | "validated" | "published" | "retired";

export interface VersionRow {
  id: string;
  workflowId: string;
  version: number;
  status: VersionStatus;
  definition: Definition;
  selector: Selector;
  issues: Issue[];
  createdAt: string;
  publishedAt: string | null;
  retiredAt: string | null;
}

export interface Issue {
  code: string;
  message: string;
  path?: string;
}

export interface WorkflowDetail {
  id: string;
  key: string;
  nameFa: string;
  requestType: string;
  description: string | null;
  versions: { id: string; version: number; status: VersionStatus; createdAt: string; publishedAt: string | null; retiredAt: string | null; openCases: number }[];
}

export const STEP_TYPE: Record<StepType, { label: string; hint: string }> = {
  human: { label: "مرحله انسانی", hint: "یک نفر یا نقش، با فرم و اقدام‌ها" },
  decision: { label: "تصمیم خودکار", hint: "انتخاب مسیر با شرط" },
  parallel: { label: "موازی", hint: "چند بررسی هم‌زمان" },
  system: { label: "سیستمی", hint: "اعلان، درخواست پرداخت یا برچسب" },
  end: { label: "پایان", hint: "نتیجه نهایی پرونده" },
};

export const VERSION_STATUS: Record<VersionStatus, { label: string; tone: "neutral" | "info" | "success" | "warning" }> = {
  draft: { label: "پیش‌نویس", tone: "neutral" },
  validated: { label: "اعتبارسنجی‌شده", tone: "info" },
  published: { label: "منتشرشده", tone: "success" },
  retired: { label: "بازنشسته", tone: "warning" },
};

export const APPLICANT = "@applicant";

/** Next free step id like `step-3`. */
export function newStepId(def: Definition, base = "step"): string {
  const ids = new Set(def.steps.map((s) => s.id));
  for (let i = def.steps.length + 1; ; i++) if (!ids.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function blankStep(type: StepType, id: string): Step {
  switch (type) {
    case "human":
      return { id, type, title: "مرحله جدید", assignee: { role: "expert", scope: "case_unit_tree" }, actions: ["approve", "reject"], form: [] };
    case "decision":
      return { id, type, title: "تصمیم" };
    case "parallel":
      return { id, type, title: "بررسی موازی", branches: [], join: "all" };
    case "system":
      return { id, type, title: "اعلان", task: "notify", params: {} };
    case "end":
      return { id, type, title: "پایان", outcome: "success" };
  }
}

/** Renames a step everywhere it is referenced. */
export function renameStep(def: Definition, from: string, to: string): Definition {
  const r = (x: string) => (x === from ? to : x);
  return {
    requestForm: def.requestForm,
    start: r(def.start),
    steps: def.steps.map((s) => (s.type === "parallel" ? { ...s, id: r(s.id), branches: s.branches.map(r) } : { ...s, id: r(s.id) })),
    transitions: def.transitions.map((t) => ({ ...t, from: r(t.from), to: r(t.to) })),
  };
}

/** Removes a step and every transition touching it. */
export function removeStep(def: Definition, id: string): Definition {
  return {
    requestForm: def.requestForm,
    start: def.start === id ? (def.steps.find((s) => s.id !== id)?.id ?? "") : def.start,
    steps: def.steps.filter((s) => s.id !== id).map((s) => (s.type === "parallel" ? { ...s, branches: s.branches.filter((b) => b !== id) } : s)),
    transitions: def.transitions.filter((t) => t.from !== id && t.to !== id),
  };
}

/** Issue paths look like `review`, `review.sla` or `transitions.3.when`. */
export const issueStep = (i: Issue) => (i.path && !i.path.startsWith("transitions") && i.path !== "start" ? i.path.split(".")[0] : null);
export const issueTransition = (i: Issue) => {
  const m = i.path?.match(/^transitions\.(\d+)/);
  return m ? Number(m[1]) : null;
};

/** Fills the defaults the API schema applies, so stored JSON written by hand edits safely. */
export function normalize(def: Definition): Definition {
  return {
    requestForm: (def.requestForm ?? []).map((f) => ({ ...f, required: f.required ?? false, visibility: f.visibility ?? "public" })),
    start: def.start,
    transitions: def.transitions ?? [],
    steps: (def.steps ?? []).map((s): Step => {
      switch (s.type) {
        case "human":
          return {
            ...s,
            actions: s.actions ?? [],
            form: (s.form ?? []).map((f) => ({ ...f, required: f.required ?? false, visibility: f.visibility ?? "public" })),
            assignee: "role" in s.assignee ? { ...s.assignee, scope: s.assignee.scope ?? "case_unit_tree" } : s.assignee,
            sla: s.sla && { ...({ businessDays: true, remindBefore: [], remindAfter: [], onOverdue: "notify" } as const satisfies Partial<Sla>), ...(s.sla as Partial<Sla> & { days: number }) },
          };
        case "parallel":
          return { ...s, branches: s.branches ?? [], join: s.join ?? "all" };
        case "system":
          return { ...s, params: s.params ?? {} };
        default:
          return s;
      }
    }),
  };
}
