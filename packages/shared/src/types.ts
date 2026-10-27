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

export type CaseStatusCategory = "draft" | "open" | "revising" | "success" | "failure" | "cancelled";

export interface FormFieldDef {
  key: string;
  type: "text" | "textarea" | "number" | "select" | "date" | "file" | "checkbox" | "member";
  label: string;
  required: boolean;
  options?: { value: string; label: string }[];
  visibility: "public" | "internal";
  eligibility?: { role: string; scope: "tenant" | "case_unit" | "case_unit_tree" };
  capacity?: { default: number };
  multiple?: boolean;
}

/** A member who may be chosen in a member field, with their current load (THS-02/04). */
export interface MemberCandidate {
  membership_id: string;
  full_name: string;
  unit_name: string | null;
  load: number;
  capacity: number | null;
  full: boolean;
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
  labels: Record<string, string>;
  requestForm: FormFieldDef[];
  attachments: CaseAttachment[];
}

export interface CaseAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: string;
  createdAt: string;
  field: string | null;
}

export interface ApplicantCase extends CaseBase {
  view: "applicant";
  revisionTaskId: string | null;
  revision: { fields: string[]; dueAt: string | null } | null;
  waiting: { step: string; dueAt: string | null }[];
  canWithdraw: boolean;
  path: CaseStepRef[];
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
  similarTitles: { id: string; title: string; statusCategory: CaseStatusCategory; score: number }[];
  unitId: string | null;
  applicant: { fullName: string; memberNo: string | null; kind: MembershipKind } | null;
  internal: Record<string, unknown>;
  decisions: Record<string, string>;
  steps: { id: string; title: string; actions?: string[]; form?: FormFieldDef[]; returnsToApplicant?: string[] }[];
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
  requestForm: FormFieldDef[];
}

export type ThesisStatus = "proposal" | "in_progress" | "defense_scheduled" | "defended" | "failed" | "cancelled";

export interface Thesis {
  id: string;
  caseId: string;
  titleFa: string;
  titleEn: string | null;
  degree: string | null;
  researchType: string | null;
  status: ThesisStatus;
  defenseAt: string | null;
  defensePlace: string | null;
  grade: number | null;
  gradeLabel: string | null;
  unitNameFa: string | null;
  student: { membershipId: string; fullName: string; memberNo: string | null };
  advisor: { membershipId: string; fullName: string } | null;
  coAdvisor: { membershipId: string; fullName: string } | null;
  reviewers: string[];
  createdAt: string;
  updatedAt: string;
  myRole?: "advisor" | "co_advisor" | "reviewer";
}

// ── papers (phase 4) ────────────────────────────────────────────────────────

export type ReviewMode = "open" | "single_blind" | "double_blind";
export type PaperStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "reviews_done"
  | "revision_requested"
  | "revised"
  | "accepted_conditional"
  | "accepted"
  | "rejected"
  | "withdrawn";
export type ReviewStatus = "invited" | "accepted" | "declined" | "submitted" | "cancelled";
export type Recommendation = "accept" | "accept_conditional" | "minor_revision" | "major_revision" | "reject";

export interface PaperTrack {
  id: string;
  nameFa: string;
  description: string | null;
  reviewMode: ReviewMode;
  maxRounds: number;
  reviewerDays: number;
  minReviewers: number;
  reviewerDownload: boolean;
  active: boolean;
}

export interface FileRef {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: string;
}

interface PaperBase {
  id: string;
  trackingCode: string | null;
  title: string;
  abstract: string | null;
  keywords: string[];
  degree: string;
  field: string | null;
  status: PaperStatus;
  round: number;
  reviewMode: ReviewMode;
  revisionDueAt: string | null;
  decision: string | null;
  decisionNote: string | null;
  lockVersion: number;
  trackName: string;
  coAuthors: { fullName: string; membershipId?: string; affiliation?: string }[];
  conflicts: { membershipIds?: string[]; note?: string };
}

export interface AuthorPaper extends PaperBase {
  view: "author";
  submittedAt: string | null;
  canWithdraw: boolean;
  canRevise: boolean;
  versions: { round: number; file: FileRef | null; responseLetter: string | null; responseFile: FileRef | null; createdAt: string | null }[];
  reviews: { round: number; reviewer: string; commentsToAuthor: string | null }[];
  history: { type: string; round: number; date: string | null; note: string | null; data: Record<string, unknown> }[];
}

export interface ReviewerPaperView {
  view: "reviewer";
  review: {
    id: string;
    status: ReviewStatus;
    round: number;
    alias: string;
    dueAt: string | null;
    recommendation: Recommendation | null;
    commentsToAuthor: string | null;
    confidentialComments: string | null;
    scores: Record<string, number>;
    canRespond: boolean;
    canSubmit: boolean;
  };
  paper: {
    title: string;
    abstract: string | null;
    keywords: string[];
    degree: string;
    field: string | null;
    trackName: string;
    reviewMode: ReviewMode;
    closed: boolean;
    author: { fullName: string | null; coAuthors: string[] } | null;
  };
  manuscript: { fileId: string | null; name: string; sizeBytes: number; downloadAllowed: boolean; ready: boolean } | null;
  responseLetter: string | null;
  previousRounds: { round: number; recommendation: Recommendation | null; commentsToAuthor: string | null }[];
}

export interface ManagerReview {
  id: string;
  round: number;
  alias: string;
  reviewer:
    | { type: "member"; membershipId: string; fullName: string | null }
    | { type: "guest"; guestId: string | null; fullName: string | null; expiresAt: string | null; revoked: boolean };
  status: ReviewStatus;
  dueAt: string;
  invitedAt: string;
  respondedAt: string | null;
  submittedAt: string | null;
  declineReason: string | null;
  recommendation: Recommendation | null;
  commentsToAuthor: string | null;
  confidentialComments: string | null;
  scores: Record<string, number>;
  attachment: FileRef | null;
  conflictsAcknowledged: string[] | null;
}

export interface ManagerPaper extends PaperBase {
  view: "manager";
  submittedAt: string | null;
  track: { maxRounds: number; minReviewers: number; reviewerDays: number };
  author: { membershipId: string; fullName: string | null; memberNo: string | null };
  manager: { membershipId: string; fullName: string | null } | null;
  versions: { round: number; original: FileRef | null; reviewCopy: FileRef | null; scrubReport: Record<string, unknown>; responseLetter: string | null; responseFile: FileRef | null; createdAt: string }[];
  reviews: ManagerReview[];
  history: { type: string; round: number; occurredAt: string; audience: string; actorName: string | null; note: string | null; data: Record<string, unknown> }[];
}

export interface ReviewerCandidate {
  membership_id: string;
  full_name: string;
  unit_name: string | null;
  active: number;
  done: number;
  conflicts: string[];
}

// ── news & events (phase 5) ───────────────────────────────────────────────

export type NewsStatus = "draft" | "pending_approval" | "approved" | "scheduled" | "published" | "archived" | "deleted";
export type ChannelPolicy = "direct" | "single" | "multi";
export type ChannelRole = "author" | "approver" | "publisher";

export interface Audience {
  public?: boolean;
  members?: boolean;
  units?: { id: string; tree?: boolean }[];
  roles?: string[];
  memberships?: string[];
}

export interface NewsCard {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  category: string | null;
  tags: string[];
  coverFileId: string | null;
  publishedAt: string | null;
  channelName: string;
  isPublic: boolean;
}

export interface NewsArticle extends Omit<NewsCard, "summary"> {
  summary: string;
  bodyHtml: string;
  source: string | null;
  author: string;
  attachments: { id: string; originalName: string; mimeType: string; sizeBytes: number; scanStatus: string }[];
}

export type EventStatus = "draft" | "published" | "registration_open" | "registration_closed" | "held" | "cancelled";
export type RegistrationStatus = "registered" | "pending" | "approved" | "rejected" | "cancelled" | "waitlisted" | "awaiting_payment";
export type EventVisibility = "own_tenant" | "selected_tenants" | "public";

export interface RegistrationRule {
  members?: boolean;
  authenticated?: boolean;
  roles?: string[];
  units?: { id: string; tree?: boolean }[];
  tenants?: string[];
}

export interface EventCard {
  id: string;
  title: string;
  category: string | null;
  organizer: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  online: boolean;
  coverFileId: string | null;
  status: EventStatus;
  capacity: number | null;
  taken: number;
  registrationDeadline: string | null;
  host: { nameFa: string; slug: string } | null;
}

export interface EventDetail extends Omit<EventCard, "online"> {
  descriptionHtml: string | null;
  onlineUrl: string | null;
  waitlist: boolean;
  requiresApproval: boolean;
  allowCancel: boolean;
  form: FormFieldDef[];
  registration: { open: boolean; eligible: boolean; full: boolean };
  mine: { id: string; status: RegistrationStatus; code: string; attended: boolean; paymentId: string | null } | null;
  feeAmount: number | null;
}

// ── payments & reports (phase 6) ──────────────────────────────────────────

export type PaymentStatus = "created" | "pending" | "succeeded" | "failed" | "cancelled" | "review" | "refunded";

export interface PaymentRow {
  id: string;
  trackingCode: string;
  title: string;
  amount: number;
  status: PaymentStatus;
  refType: "case" | "event_registration" | "manual";
  refId: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface PaymentAttempt {
  id: string;
  adapter: string;
  status: "started" | "succeeded" | "failed" | "unknown" | "cancelled";
  referenceId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  authority?: string | null;
  verifyPayload?: Record<string, unknown> | null;
}

export interface PaymentDetail extends PaymentRow {
  serviceKey: string;
  refStepId: string | null;
  payer: { fullName: string; mobile: string | null } | null;
  payable: boolean;
  attempts: PaymentAttempt[];
  receipt: { receiptNo: string; referenceId: string | null; issuedAt: string; amount: number } | null;
  history: { type: string; data: Record<string, unknown>; occurredAt: string; actor: string | null }[];
}

export interface ReportTable {
  title: string;
  columns: { key: string; label: string; type?: "text" | "number" | "date" }[];
  rows: Record<string, unknown>[];
}
