// Shapes returned by apps/api (v1). Keep in sync until the OpenAPI client is generated.

export type TenantStatus = "draft" | "active" | "suspended" | "archived";
export type MembershipStatus = "draft" | "pending_review" | "needs_revision" | "active" | "rejected" | "suspended" | "ended";
export type MembershipKind = "student" | "faculty" | "staff" | "guest";
export type ScopeType = "tenant" | "unit" | "unit_tree" | "case";

export interface Me {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  isPlatformAdmin: boolean;
}

export interface MyMembership {
  id: string;
  kind: MembershipKind;
  status: MembershipStatus;
  tenantSlug: string;
  tenantNameFa: string;
}

export interface TenantSettings {
  calendar?: "jalali" | "gregorian";
  locale?: "fa" | "en";
  timezone?: string;
  branding?: { logoFileId?: string; primaryColor?: string; displayName?: string };
  passwordPolicy?: { minLength?: number };
  storageQuotaBytes?: number;
  membership?: { reapplyAfterDays?: number; revisionDeadlineDays?: number };
  retention?: { membershipDocsDays?: number };
}

export interface Tenant {
  id: string;
  slug: string;
  nameFa: string;
  nameEn: string | null;
  domain: string | null;
  status: TenantStatus;
  settings: TenantSettings;
  enabledModules: string[];
  createdAt: string;
}

export type PermissionMap = Record<string, { scopeType: ScopeType; scopeId: string | null }[]>;

export interface UnitType {
  id: string;
  key: string;
  nameFa: string;
  nameEn: string | null;
  isFacultyLevel: boolean;
}

export interface UnitNode {
  id: string;
  parentId: string | null;
  typeId: string;
  nameFa: string;
  nameEn: string | null;
  code: string | null;
  depth: number;
  status: "active" | "archived";
  children: UnitNode[];
}

export interface MembershipRow {
  id: string;
  kind: MembershipKind;
  status: MembershipStatus;
  memberNo: string | null;
  fullName: string;
  unitId: string | null;
  unitNameFa: string | null;
  submittedAt: string | null;
  revisionDeadline: string | null;
}

export interface MembershipEvent {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  publicNote: string | null;
  internalNote: string | null;
  data: Record<string, unknown>;
}

export interface FileInfo {
  id: string;
  purpose: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: "pending" | "clean" | "infected" | "error" | "skipped";
  createdAt: string;
}

export interface MembershipDetail {
  id: string;
  kind: MembershipKind;
  status: MembershipStatus;
  memberNo: string | null;
  profile: Record<string, unknown>;
  reviewUnitId: string | null;
  revisionRequest: { fields: string[]; reason: string } | null;
  revisionDeadline: string | null;
  decisionReason: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  user: { id: string; fullName: string; mobile: string; email: string | null };
  units: { unitId: string; isPrimary: boolean }[];
  documents: FileInfo[];
  history: MembershipEvent[];
}

export interface Role {
  id: string;
  key: string;
  nameFa: string;
  nameEn: string | null;
  description: string | null;
  templateKey: string | null;
  permissions: string[];
}

export interface PermissionDef {
  code: string;
  module: string;
  description: string;
}

export interface Assignment {
  id: string;
  roleId: string;
  roleKey: string;
  roleNameFa: string;
  scopeType: ScopeType;
  scopeId: string | null;
  validFrom: string;
  validTo: string | null;
  revokedAt: string | null;
}

export interface AuditRow {
  id: string;
  seq: number;
  occurredAt: string;
  actorType: "user" | "system";
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  result: "success" | "denied" | "error";
  reason: string | null;
  ip: string | null;
  requestId: string | null;
}

// ── workflow cases (phase 2) ────────────────────────────────────────────────

export type CaseStatusCategory = "open" | "revising" | "success" | "failure" | "cancelled";

export interface FormFieldDef {
  key: string;
  type: "text" | "textarea" | "number" | "select" | "date" | "file" | "checkbox";
  label: string;
  required: boolean;
  options?: { value: string; label: string }[];
  visibility: "public" | "internal";
}

export interface CaseStepRef {
  stepId: string;
  title: string;
}

interface CaseBase {
  id: string;
  title: string | null;
  requestType: string;
  workflowName: string;
  statusCategory: CaseStatusCategory;
  lockVersion: number;
  createdAt: string;
  closedAt: string | null;
  data: Record<string, unknown>;
  current: CaseStepRef[];
}

export interface ApplicantCase extends CaseBase {
  view: "applicant";
  revisionTaskId: string | null;
  history: { type: string; occurredAt: string; step: string | null; action: string | null; note: string | null }[];
}

export interface CaseTask {
  id: string;
  stepId: string;
  step: string;
  status: "open" | "done" | "cancelled";
  assigneeType: "role" | "membership" | "applicant";
  roleKey: string | null;
  scope: string | null;
  assigneeMembershipId: string | null;
  action: string | null;
  dueAt: string | null;
  overdueAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  canAct: boolean;
}

export interface StaffCase extends CaseBase {
  view: "staff";
  unitId: string | null;
  applicant: { fullName: string; memberNo: string | null; kind: MembershipKind } | null;
  internal: Record<string, unknown>;
  decisions: Record<string, string>;
  steps: { id: string; title: string; actions?: string[]; form?: FormFieldDef[] }[];
  tasks: CaseTask[];
  history: {
    type: string;
    occurredAt: string;
    stepId: string | null;
    step: string | null;
    action: string | null;
    toStep: string | null;
    actorName: string | null;
    publicNote: string | null;
    internalNote: string | null;
    form: Record<string, unknown> | null;
  }[];
}

export type CaseView = ApplicantCase | StaffCase;

export interface CaseListItem {
  id: string;
  title: string | null;
  requestType: string;
  statusCategory: CaseStatusCategory;
  currentSteps: string[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  workflowName: string;
  unitNameFa: string | null;
}

export interface CartableTask {
  id: string;
  caseId: string;
  stepId: string;
  step: string;
  assigneeType: "role" | "membership" | "applicant";
  caseTitle: string | null;
  requestType: string;
  statusCategory: CaseStatusCategory;
  workflowName: string;
  applicantName: string;
  unitNameFa: string | null;
  dueAt: string | null;
  overdue: boolean;
  createdAt: string;
}

export interface RequestType {
  requestType: string;
  nameFa: string;
  description: string | null;
}
