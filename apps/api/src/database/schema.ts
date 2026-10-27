// Drizzle mirror of migrations/*.sql. Migrations are the source of truth (RLS, triggers, grants
// live there); keep this file in sync when a migration changes a column.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();

export type TenantStatus = 'draft' | 'active' | 'suspended' | 'archived';
export type MembershipKind = 'student' | 'faculty' | 'staff' | 'guest';
export type MembershipStatus =
  | 'draft'
  | 'pending_review'
  | 'needs_revision'
  | 'active'
  | 'rejected'
  | 'suspended'
  | 'ended';
export type ScopeType = 'tenant' | 'unit' | 'unit_tree' | 'case';
export type OtpPurpose = 'login' | 'register' | 'reset_password' | 'verify_mobile';
export type ScanStatus = 'pending' | 'clean' | 'infected' | 'error' | 'skipped';

export interface TenantSettings {
  calendar?: 'jalali' | 'gregorian';
  locale?: 'fa' | 'en';
  timezone?: string;
  branding?: { logoFileId?: string; primaryColor?: string; displayName?: string };
  passwordPolicy?: { minLength?: number };
  storageQuotaBytes?: number;
  membership?: { reapplyAfterDays?: number; revisionDeadlineDays?: number };
  /** FIL-09: days after a final membership decision before identity documents are removed (unset = keep) */
  retention?: { membershipDocsDays?: number };
  /** WF-20: weekly days off (0 = Sunday … 6 = Saturday); default Friday */
  weekendDays?: number[];
  /** NTF-11: monthly SMS cap (unset = unlimited) */
  notifications?: { smsMonthlyQuota?: number };
}

export const users = pgTable('users', {
  id: id(),
  mobile: text('mobile').notNull(),
  email: text('email'),
  passwordHash: text('password_hash'),
  fullName: text('full_name').notNull(),
  nationalIdHash: text('national_id_hash'),
  kind: text('kind').$type<'internal' | 'guest'>().notNull().default('internal'),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  mobileVerifiedAt: ts('mobile_verified_at'),
  emailVerifiedAt: ts('email_verified_at'),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabledAt: ts('totp_enabled_at'),
  recoveryCodeHashes: text('recovery_code_hashes').array().notNull().default(sql`'{}'`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const platformAdmins = pgTable('platform_admins', {
  userId: uuid('user_id').primaryKey(),
  createdAt: createdAt(),
});

export const otpChallenges = pgTable('otp_challenges', {
  id: id(),
  mobile: text('mobile').notNull(),
  purpose: text('purpose').$type<OtpPurpose>().notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  createdIp: text('created_ip'),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id').notNull(),
  refreshHash: text('refresh_hash').notNull(),
  prevRefreshHash: text('prev_refresh_hash'),
  userAgent: text('user_agent'),
  ip: text('ip'),
  createdAt: createdAt(),
  lastUsedAt: ts('last_used_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  revokeReason: text('revoke_reason'),
});

export const tenants = pgTable('tenants', {
  id: id(),
  slug: text('slug').notNull(),
  nameFa: text('name_fa').notNull(),
  nameEn: text('name_en'),
  domain: text('domain'),
  status: text('status').$type<TenantStatus>().notNull().default('draft'),
  settings: jsonb('settings').$type<TenantSettings>().notNull().default({}),
  enabledModules: text('enabled_modules').array().notNull().default(sql`'{}'`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const orgUnitTypes = pgTable('org_unit_types', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  key: text('key').notNull(),
  nameFa: text('name_fa').notNull(),
  nameEn: text('name_en'),
  isFacultyLevel: boolean('is_faculty_level').notNull().default(false),
  createdAt: createdAt(),
});

export const orgUnits = pgTable('org_units', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  parentId: uuid('parent_id'),
  typeId: uuid('type_id').notNull(),
  nameFa: text('name_fa').notNull(),
  nameEn: text('name_en'),
  code: text('code'),
  path: text('path').notNull(),
  depth: integer('depth').notNull(),
  status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable('memberships', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  kind: text('kind').$type<MembershipKind>().notNull(),
  status: text('status').$type<MembershipStatus>().notNull(),
  memberNo: text('member_no'),
  profile: jsonb('profile').$type<Record<string, unknown>>().notNull().default({}),
  reviewUnitId: uuid('review_unit_id'),
  revisionRequest: jsonb('revision_request').$type<{ fields: string[]; reason: string } | null>(),
  revisionDeadline: ts('revision_deadline'),
  decisionReason: text('decision_reason'),
  submittedAt: ts('submitted_at'),
  decidedAt: ts('decided_at'),
  decidedBy: uuid('decided_by'),
  validFrom: ts('valid_from'),
  validTo: ts('valid_to'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const membershipUnits = pgTable(
  'membership_units',
  {
    tenantId: uuid('tenant_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.unitId] })],
);

export const membershipEvents = pgTable('membership_events', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  membershipId: uuid('membership_id').notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  actorUserId: uuid('actor_user_id'),
  type: text('type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  publicNote: text('public_note'),
  internalNote: text('internal_note'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
});

export const fileObjects = pgTable('file_objects', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  ownerUserId: uuid('owner_user_id'),
  uploadSubject: text('upload_subject'),
  purpose: text('purpose').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull(),
  scanStatus: text('scan_status').$type<ScanStatus>().notNull().default('pending'),
  scannedAt: ts('scanned_at'),
  linkedType: text('linked_type'),
  linkedId: uuid('linked_id'),
  isConfidential: boolean('is_confidential').notNull().default(false),
  createdAt: createdAt(),
  deletedAt: ts('deleted_at'),
  purgedAt: ts('purged_at'),
});

export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
  module: text('module').notNull(),
  description: text('description').notNull(),
  platformOnly: boolean('platform_only').notNull().default(false),
});

export const roles = pgTable('roles', {
  id: id(),
  tenantId: uuid('tenant_id'),
  key: text('key').notNull(),
  nameFa: text('name_fa').notNull(),
  nameEn: text('name_en'),
  description: text('description'),
  templateKey: text('template_key'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: ts('archived_at'),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull(),
    tenantId: uuid('tenant_id'),
    permissionCode: text('permission_code').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })],
);

export const roleAssignments = pgTable('role_assignments', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  membershipId: uuid('membership_id').notNull(),
  roleId: uuid('role_id').notNull(),
  scopeType: text('scope_type').$type<ScopeType>().notNull(),
  scopeId: uuid('scope_id'),
  validFrom: ts('valid_from').notNull().defaultNow(),
  validTo: ts('valid_to'),
  grantedBy: uuid('granted_by'),
  createdAt: createdAt(),
  revokedAt: ts('revoked_at'),
  revokedBy: uuid('revoked_by'),
  revokeReason: text('revoke_reason'),
});

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
  tenantId: uuid('tenant_id'),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  actorType: text('actor_type').$type<'user' | 'system'>().notNull(),
  actorUserId: uuid('actor_user_id'),
  actorMembershipId: uuid('actor_membership_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  result: text('result').$type<'success' | 'denied' | 'error'>().notNull(),
  reason: text('reason'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  prevHash: text('prev_hash'),
  hash: text('hash'),
});

export const outboxEvents = pgTable('outbox_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  tenantId: uuid('tenant_id'),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: createdAt(),
  availableAt: ts('available_at').notNull().defaultNow(),
  dispatchedAt: ts('dispatched_at'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
});

export type WorkflowVersionStatus = 'draft' | 'validated' | 'published' | 'retired';
export type CaseStatusCategory = 'draft' | 'open' | 'revising' | 'success' | 'failure' | 'cancelled';

export const workflows = pgTable('workflows', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  key: text('key').notNull(),
  nameFa: text('name_fa').notNull(),
  requestType: text('request_type').notNull(),
  description: text('description'),
  createdAt: createdAt(),
  archivedAt: ts('archived_at'),
});

export const workflowVersions = pgTable('workflow_versions', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  workflowId: uuid('workflow_id').notNull(),
  version: integer('version').notNull(),
  status: text('status').$type<WorkflowVersionStatus>().notNull().default('draft'),
  definition: jsonb('definition').$type<unknown>().notNull(),
  selector: jsonb('selector').$type<unknown>().notNull(),
  issues: jsonb('issues').$type<unknown[]>().notNull().default([]),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  publishedAt: ts('published_at'),
  publishedBy: uuid('published_by'),
  retiredAt: ts('retired_at'),
});

export const cases = pgTable('cases', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  workflowVersionId: uuid('workflow_version_id').notNull(),
  requestType: text('request_type').notNull(),
  title: text('title'),
  applicantMembershipId: uuid('applicant_membership_id').notNull(),
  unitId: uuid('unit_id'),
  statusCategory: text('status_category').$type<CaseStatusCategory>().notNull().default('open'),
  currentSteps: text('current_steps').array().notNull().default(sql`'{}'`),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  internal: jsonb('internal').$type<Record<string, unknown>>().notNull().default({}),
  decisions: jsonb('decisions').$type<Record<string, string>>().notNull().default({}),
  lockVersion: integer('lock_version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  closedAt: ts('closed_at'),
  submittedAt: ts('submitted_at'),
});

export const caseTasks = pgTable('case_tasks', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  caseId: uuid('case_id').notNull(),
  stepId: text('step_id').notNull(),
  assigneeType: text('assignee_type').$type<'role' | 'membership' | 'applicant'>().notNull(),
  roleKey: text('role_key'),
  scope: text('scope').$type<'tenant' | 'case_unit' | 'case_unit_tree'>(),
  assigneeMembershipId: uuid('assignee_membership_id'),
  parallelOf: text('parallel_of'),
  returnTo: text('return_to'),
  status: text('status').$type<'open' | 'done' | 'cancelled'>().notNull().default('open'),
  action: text('action'),
  dueAt: ts('due_at'),
  createdAt: createdAt(),
  completedAt: ts('completed_at'),
  completedBy: uuid('completed_by'),
  slaSchedule: jsonb('sla_schedule').$type<SlaEntry[]>().notNull().default([]),
  slaNextAt: ts('sla_next_at'),
  overdueAt: ts('overdue_at'),
  escalatedAt: ts('escalated_at'),
  autoExtended: boolean('auto_extended').notNull().default(false),
  revisionFields: text('revision_fields').array().notNull().default(sql`'{}'`),
});

export const caseEvents = pgTable('case_events', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  caseId: uuid('case_id').notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  actorUserId: uuid('actor_user_id'),
  actorMembershipId: uuid('actor_membership_id'),
  type: text('type').notNull(),
  stepId: text('step_id'),
  action: text('action'),
  toStep: text('to_step'),
  publicNote: text('public_note'),
  internalNote: text('internal_note'),
  form: jsonb('form').$type<Record<string, unknown>>(),
});

export const calendarHolidays = pgTable('calendar_holidays', {
  id: id(),
  tenantId: uuid('tenant_id'),
  day: date('day', { mode: 'string' }).notNull(),
  title: text('title').notNull(),
  createdAt: createdAt(),
  createdBy: uuid('created_by'),
});

export interface SlaEntry {
  at: string;
  kind: 'before' | 'due' | 'after';
  done: boolean;
}

export type NotificationChannel = 'inapp' | 'sms' | 'email';
export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'dead' | 'skipped';

export const notificationTemplates = pgTable('notification_templates', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  event: text('event').notNull(),
  channel: text('channel').$type<NotificationChannel>().notNull(),
  locale: text('locale').notNull().default('fa'),
  subject: text('subject'),
  body: text('body').notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid('updated_by'),
});

export const notificationRules = pgTable('notification_rules', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  event: text('event').notNull(),
  recipient: text('recipient').notNull(),
  channels: text('channels').array().$type<NotificationChannel[]>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: updatedAt(),
  updatedBy: uuid('updated_by'),
});

export const notificationDeliveries = pgTable('notification_deliveries', {
  id: id(),
  tenantId: uuid('tenant_id'),
  event: text('event').notNull(),
  userId: uuid('user_id').notNull(),
  channel: text('channel').$type<NotificationChannel>().notNull(),
  critical: boolean('critical').notNull().default(false),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status').$type<DeliveryStatus>().notNull().default('queued'),
  subject: text('subject'),
  body: text('body').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
  providerMessageId: text('provider_message_id'),
  error: text('error'),
  createdAt: createdAt(),
  sentAt: ts('sent_at'),
});

export const notifications = pgTable('notifications', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  event: text('event').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  createdAt: createdAt(),
  readAt: ts('read_at'),
});

export const notificationMutes = pgTable(
  'notification_mutes',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId, t.channel] })],
);

export type ThesisStatus = 'proposal' | 'in_progress' | 'defense_scheduled' | 'defended' | 'failed' | 'cancelled';

export const theses = pgTable('theses', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  caseId: uuid('case_id').notNull(),
  studentMembershipId: uuid('student_membership_id').notNull(),
  unitId: uuid('unit_id'),
  titleFa: text('title_fa').notNull(),
  titleEn: text('title_en'),
  degree: text('degree'),
  researchType: text('research_type'),
  advisorMembershipId: uuid('advisor_membership_id'),
  coAdvisorMembershipId: uuid('co_advisor_membership_id'),
  reviewerMembershipIds: uuid('reviewer_membership_ids').array().notNull().default(sql`'{}'`),
  status: text('status').$type<ThesisStatus>().notNull().default('proposal'),
  defenseAt: ts('defense_at'),
  defensePlace: text('defense_place'),
  grade: numeric('grade', { precision: 4, scale: 2 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type ReviewMode = 'open' | 'single_blind' | 'double_blind';
export type PaperStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'reviews_done'
  | 'revision_requested'
  | 'revised'
  | 'accepted_conditional'
  | 'accepted'
  | 'rejected'
  | 'withdrawn';
export type ReviewStatus = 'invited' | 'accepted' | 'declined' | 'submitted' | 'cancelled';
export type Recommendation = 'accept' | 'accept_conditional' | 'minor_revision' | 'major_revision' | 'reject';

export const paperTracks = pgTable('paper_tracks', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  nameFa: text('name_fa').notNull(),
  description: text('description'),
  reviewMode: text('review_mode').$type<ReviewMode>().notNull(),
  maxRounds: integer('max_rounds').notNull().default(3),
  reviewerDays: integer('reviewer_days').notNull().default(14),
  minReviewers: integer('min_reviewers').notNull().default(2),
  reviewerDownload: boolean('reviewer_download').notNull().default(true),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export interface CoAuthor {
  fullName: string;
  membershipId?: string;
  affiliation?: string;
}

export const papers = pgTable('papers', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  trackId: uuid('track_id').notNull(),
  trackingCode: text('tracking_code'),
  authorMembershipId: uuid('author_membership_id').notNull(),
  managerMembershipId: uuid('manager_membership_id'),
  reviewMode: text('review_mode').$type<ReviewMode>().notNull(),
  title: text('title').notNull(),
  abstract: text('abstract'),
  keywords: text('keywords').array().notNull().default(sql`'{}'`),
  degree: text('degree').notNull(),
  field: text('field'),
  coAuthors: jsonb('co_authors').$type<CoAuthor[]>().notNull().default([]),
  conflicts: jsonb('conflicts').$type<{ membershipIds?: string[]; note?: string }>().notNull().default({}),
  status: text('status').$type<PaperStatus>().notNull().default('draft'),
  round: integer('round').notNull().default(0),
  revisionDueAt: ts('revision_due_at'),
  decision: text('decision'),
  decisionNote: text('decision_note'),
  lockVersion: integer('lock_version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  submittedAt: ts('submitted_at'),
  decidedAt: ts('decided_at'),
});

export const paperVersions = pgTable('paper_versions', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  paperId: uuid('paper_id').notNull(),
  round: integer('round').notNull(),
  originalFileId: uuid('original_file_id').notNull(),
  reviewFileId: uuid('review_file_id'),
  scrubReport: jsonb('scrub_report').$type<Record<string, unknown>>().notNull().default({}),
  responseLetter: text('response_letter'),
  responseFileId: uuid('response_file_id'),
  createdAt: createdAt(),
});

export const paperGuests = pgTable('paper_guests', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  fullName: text('full_name').notNull(),
  mobile: text('mobile'),
  email: text('email'),
  tokenHash: text('token_hash').notNull(),
  tokenUsedAt: ts('token_used_at'),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const paperReviews = pgTable('paper_reviews', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  paperId: uuid('paper_id').notNull(),
  round: integer('round').notNull(),
  reviewerMembershipId: uuid('reviewer_membership_id'),
  guestId: uuid('guest_id'),
  aliasNo: integer('alias_no').notNull(),
  status: text('status').$type<ReviewStatus>().notNull().default('invited'),
  dueAt: ts('due_at').notNull(),
  invitedAt: ts('invited_at').notNull().defaultNow(),
  respondedAt: ts('responded_at'),
  submittedAt: ts('submitted_at'),
  declineReason: text('decline_reason'),
  recommendation: text('recommendation').$type<Recommendation>(),
  commentsToAuthor: text('comments_to_author'),
  confidentialComments: text('confidential_comments'),
  scores: jsonb('scores').$type<Record<string, number>>().notNull().default({}),
  attachmentFileId: uuid('attachment_file_id'),
  conflictsAcknowledged: jsonb('conflicts_acknowledged').$type<string[] | null>(),
  remindedAt: ts('reminded_at'),
});

export const paperEvents = pgTable('paper_events', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  paperId: uuid('paper_id').notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  actorUserId: uuid('actor_user_id'),
  actorGuestId: uuid('actor_guest_id'),
  type: text('type').notNull(),
  round: integer('round').notNull(),
  audience: text('audience').$type<'all' | 'author' | 'reviewers' | 'managers'>().notNull(),
  note: text('note'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
});

export interface Audience {
  public?: boolean;
  members?: boolean;
  units?: { id: string; tree?: boolean }[];
  roles?: string[];
  memberships?: string[];
}

export type NewsStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'published' | 'archived' | 'deleted';

export const newsChannels = pgTable('news_channels', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  nameFa: text('name_fa').notNull(),
  description: text('description'),
  unitId: uuid('unit_id'),
  policy: text('policy').$type<'direct' | 'single' | 'multi'>().notNull().default('single'),
  approvalsRequired: integer('approvals_required').notNull().default(1),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const newsChannelMembers = pgTable(
  'news_channel_members',
  {
    tenantId: uuid('tenant_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    role: text('role').$type<'author' | 'approver' | 'publisher'>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.channelId, t.membershipId, t.role] })],
);

export const newsPosts = pgTable('news_posts', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  bodyHtml: text('body_html').notNull().default(''),
  coverFileId: uuid('cover_file_id'),
  attachmentFileIds: uuid('attachment_file_ids').array().notNull().default(sql`'{}'`),
  category: text('category'),
  tags: text('tags').array().notNull().default(sql`'{}'`),
  source: text('source'),
  authorMembershipId: uuid('author_membership_id').notNull(),
  status: text('status').$type<NewsStatus>().notNull().default('draft'),
  audience: jsonb('audience').$type<Audience>().notNull().default({ public: true }),
  publishAt: ts('publish_at'),
  expireAt: ts('expire_at'),
  publishedAt: ts('published_at'),
  archivedAt: ts('archived_at'),
  deletedAt: ts('deleted_at'),
  unpublishReason: text('unpublish_reason'),
  notifyAudience: boolean('notify_audience').notNull().default(false),
  version: integer('version').notNull().default(1),
  lockVersion: integer('lock_version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const newsPostVersions = pgTable('news_post_versions', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  postId: uuid('post_id').notNull(),
  version: integer('version').notNull(),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const newsApprovals = pgTable('news_approvals', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  postId: uuid('post_id').notNull(),
  version: integer('version').notNull(),
  approverMembershipId: uuid('approver_membership_id').notNull(),
  decision: text('decision').$type<'approve' | 'return'>().notNull(),
  note: text('note'),
  createdAt: createdAt(),
});

export const newsEvents = pgTable('news_events', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  postId: uuid('post_id').notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  actorUserId: uuid('actor_user_id'),
  type: text('type').notNull(),
  version: integer('version').notNull(),
  note: text('note'),
});

export type EventStatus = 'draft' | 'published' | 'registration_open' | 'registration_closed' | 'held' | 'cancelled';
export type RegistrationStatus = 'registered' | 'pending' | 'approved' | 'rejected' | 'cancelled' | 'waitlisted' | 'awaiting_payment';

export interface RegistrationRule {
  members?: boolean;
  roles?: string[];
  units?: { id: string; tree?: boolean }[];
  tenants?: string[];
  authenticated?: boolean;
}

export const events = pgTable('events', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  title: text('title').notNull(),
  descriptionHtml: text('description_html').notNull().default(''),
  category: text('category'),
  organizer: text('organizer'),
  organizerUnitId: uuid('organizer_unit_id'),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  location: text('location'),
  onlineUrl: text('online_url'),
  coverFileId: uuid('cover_file_id'),
  status: text('status').$type<EventStatus>().notNull().default('draft'),
  visibility: text('visibility').$type<'own_tenant' | 'selected_tenants' | 'public'>().notNull().default('own_tenant'),
  visibleTenantIds: uuid('visible_tenant_ids').array().notNull().default(sql`'{}'`),
  registrationRule: jsonb('registration_rule').$type<RegistrationRule>().notNull().default({ members: true }),
  capacity: integer('capacity'),
  waitlist: boolean('waitlist').notNull().default(false),
  registrationDeadline: ts('registration_deadline'),
  requiresApproval: boolean('requires_approval').notNull().default(false),
  allowCancel: boolean('allow_cancel').notNull().default(true),
  form: jsonb('form').$type<unknown[]>().notNull().default([]),
  feeAmount: bigint('fee_amount', { mode: 'number' }),
  certificateEnabled: boolean('certificate_enabled').notNull().default(false),
  paperTrackId: uuid('paper_track_id'),
  newsPostId: uuid('news_post_id'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const eventRegistrations = pgTable('event_registrations', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  eventId: uuid('event_id').notNull(),
  userId: uuid('user_id').notNull(),
  homeTenantId: uuid('home_tenant_id'),
  membershipId: uuid('membership_id'),
  status: text('status').$type<RegistrationStatus>().notNull(),
  answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
  code: text('code').notNull(),
  attendedAt: ts('attended_at'),
  decidedAt: ts('decided_at'),
  cancelledAt: ts('cancelled_at'),
  paymentRequestId: uuid('payment_request_id'),
  createdAt: createdAt(),
});

// ── payments (phase 6) ─────────────────────────────────────────────────────

export type PaymentStatus = 'created' | 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'review' | 'refunded';
export type TransactionStatus = 'started' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
export type PaymentRefType = 'case' | 'event_registration' | 'manual';

const rial = (name: string) => bigint(name, { mode: 'number' });

export const feeSchedules = pgTable('fee_schedules', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  serviceKey: text('service_key').notNull(),
  title: text('title').notNull(),
  amount: rial('amount').notNull(),
  effectiveFrom: ts('effective_from').notNull().defaultNow(),
  version: integer('version').notNull(),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const gatewayConfigs = pgTable('gateway_configs', {
  tenantId: uuid('tenant_id').primaryKey(),
  adapter: text('adapter').notNull(),
  merchantId: text('merchant_id'),
  secretEncrypted: text('secret_encrypted'),
  active: boolean('active').notNull().default(true),
  updatedBy: uuid('updated_by'),
  updatedAt: updatedAt(),
});

export const paymentRequests = pgTable('payment_requests', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  trackingCode: text('tracking_code').notNull(),
  serviceKey: text('service_key').notNull(),
  feeScheduleId: uuid('fee_schedule_id'),
  title: text('title').notNull(),
  amount: rial('amount').notNull(),
  payerUserId: uuid('payer_user_id').notNull(),
  payerMembershipId: uuid('payer_membership_id'),
  refType: text('ref_type').$type<PaymentRefType>().notNull(),
  refId: uuid('ref_id'),
  refStepId: text('ref_step_id'),
  status: text('status').$type<PaymentStatus>().notNull().default('created'),
  idempotencyKey: text('idempotency_key').notNull(),
  expiresAt: ts('expires_at'),
  paidAt: ts('paid_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lockVersion: integer('lock_version').notNull().default(0),
});

export const paymentTransactions = pgTable('payment_transactions', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  requestId: uuid('request_id').notNull(),
  adapter: text('adapter').notNull(),
  amount: rial('amount').notNull(),
  authority: text('authority'),
  referenceId: text('reference_id'),
  status: text('status').$type<TransactionStatus>().notNull().default('started'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  verifyPayload: jsonb('verify_payload').$type<Record<string, unknown>>(),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
  checkedAt: ts('checked_at'),
});

export const paymentReceipts = pgTable('payment_receipts', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  requestId: uuid('request_id').notNull(),
  transactionId: uuid('transaction_id').notNull(),
  receiptNo: text('receipt_no').notNull(),
  amount: rial('amount').notNull(),
  referenceId: text('reference_id'),
  issuedAt: ts('issued_at').notNull().defaultNow(),
});

export const paymentEvents = pgTable('payment_events', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  requestId: uuid('request_id').notNull(),
  type: text('type').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  actorUserId: uuid('actor_user_id'),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});

export const newsPostViews = pgTable(
  'news_post_views',
  {
    tenantId: uuid('tenant_id').notNull(),
    postId: uuid('post_id').notNull(),
    day: date('day').notNull(),
    views: integer('views').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.postId, t.day] })],
);
