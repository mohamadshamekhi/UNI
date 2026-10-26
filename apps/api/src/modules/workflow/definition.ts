import { z } from 'zod';

// Stored workflow definition (WF-01). Data only — executed by the engine, never as code.

const id = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/, 'step id: lowercase letters, digits and dashes');
const actionName = z.string().regex(/^[a-z][a-z0-9_]{1,30}$/);

export const BUILTIN_APPLICANT = '@applicant';

export const formFieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/),
  type: z.enum(['text', 'textarea', 'number', 'select', 'date', 'file', 'checkbox']),
  label: z.string().min(1).max(120),
  required: z.boolean().default(false),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  /** internal fields are never shown to the applicant (THS-08) */
  visibility: z.enum(['public', 'internal']).default('public'),
});

export const assigneeSchema = z.union([
  z.object({ role: z.string().min(2), scope: z.enum(['tenant', 'case_unit', 'case_unit_tree']).default('case_unit_tree') }),
  z.object({ membershipId: z.string().uuid() }),
  z.object({ dynamic: z.string().regex(/^data\.[a-zA-Z][a-zA-Z0-9_]*$/) }),
]);

export const slaSchema = z.object({
  days: z.number().int().min(1).max(365),
  businessDays: z.boolean().default(true),
  /** days before the deadline to remind the assignee */
  remindBefore: z.array(z.number().int().min(1).max(60)).max(5).default([]),
  /** days after the deadline to remind again */
  remindAfter: z.array(z.number().int().min(1).max(60)).max(5).default([]),
  /** WF-22: what happens once the deadline passes */
  onOverdue: z.enum(['notify', 'escalate', 'extend', 'cancel', 'close']).default('notify'),
  /** escalation target (onOverdue = escalate); without it the task only gets flagged */
  escalateTo: z.object({ role: z.string().min(2), scope: z.enum(['tenant', 'case_unit', 'case_unit_tree']).default('case_unit_tree') }).optional(),
  /** one automatic extension (onOverdue = extend) */
  extendDays: z.number().int().min(1).max(60).default(3),
});

const base = { id, title: z.string().min(1).max(120) };

export const stepSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('human'),
    assignee: assigneeSchema,
    actions: z.array(actionName).min(1).max(8),
    form: z.array(formFieldSchema).max(30).default([]),
    sla: slaSchema.optional(),
  }),
  z.object({ ...base, type: z.literal('decision') }),
  z.object({ ...base, type: z.literal('parallel'), branches: z.array(id).min(2).max(6), join: z.enum(['all', 'any']).default('all') }),
  z.object({ ...base, type: z.literal('system'), task: z.enum(['notify', 'request_payment', 'tag']), params: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ ...base, type: z.literal('end'), outcome: z.enum(['success', 'failure']) }),
]);

export const transitionSchema = z
  .object({
    from: id,
    to: z.union([id, z.literal(BUILTIN_APPLICANT)]),
    action: actionName.optional(),
    when: z.string().min(1).max(500).optional(),
    otherwise: z.literal(true).optional(),
  })
  .refine((t) => !(t.when && t.otherwise), 'a transition cannot have both when and otherwise');

export const definitionSchema = z.object({
  /** WF-10: what the applicant fills in when starting a case; values land in case.data */
  requestForm: z.array(formFieldSchema).max(30).default([]),
  start: id,
  steps: z.array(stepSchema).min(2).max(60),
  transitions: z.array(transitionSchema).max(200),
});

export type WorkflowDefinition = z.infer<typeof definitionSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Transition = z.infer<typeof transitionSchema>;

/** Version selector (WF-07): which cases a published version applies to. */
export const selectorSchema = z.object({
  requestType: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  degrees: z.array(z.string()).optional(),
  unitIds: z.array(z.string().uuid()).optional(),
});
export type Selector = z.infer<typeof selectorSchema>;
