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
