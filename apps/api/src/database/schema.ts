// Drizzle mirror of migrations/*.sql. Migrations are the source of truth (RLS, triggers, grants
// live there); keep this file in sync when a migration changes a column.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  integer,
  jsonb,
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
