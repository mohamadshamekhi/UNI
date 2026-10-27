import { sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../../database/db.service.js';
import type { Audience } from '../../database/schema.js';

/** Who is looking: anonymous, or a member with their units and roles (resolved once per request). */
export interface Viewer {
  membershipId: string | null;
  unitIds: string[];
  unitPaths: string[];
  roleKeys: string[];
}

export const ANONYMOUS: Viewer = { membershipId: null, unitIds: [], unitPaths: [], roleKeys: [] };

/** Postgres array literal for a list of plain strings (uuids, role keys, paths). */
export const pgArray = (items: string[]) => `{${items.map((i) => `"${i.replace(/["\\]/g, '')}"`).join(',')}}`;

export async function loadViewer(tx: Executor, membershipId: string | undefined | null, active: boolean): Promise<Viewer> {
  if (!membershipId || !active) return ANONYMOUS;
  const units = (
    await tx.execute<{ id: string; path: string }>(sql`
      select ou.id, ou.path from membership_units mu join org_units ou on ou.id = mu.unit_id where mu.membership_id = ${membershipId}`)
  ).rows;
  const roles = (
    await tx.execute<{ key: string }>(sql`
      select distinct r.key from role_assignments ra join roles r on r.id = ra.role_id and r.archived_at is null
      where ra.membership_id = ${membershipId} and ra.revoked_at is null and ra.valid_from <= now() and (ra.valid_to is null or ra.valid_to > now())`)
  ).rows;
  return { membershipId, unitIds: units.map((u) => u.id), unitPaths: units.map((u) => u.path), roleKeys: roles.map((r) => r.key) };
}

/**
 * SQL predicate: the viewer belongs to the audience stored in `col` (NWS-10). Anonymous viewers only
 * ever match public audiences. Evaluated in the database for lists, search and direct links alike.
 */
export function audienceMatch(col: SQL, v: Viewer): SQL {
  if (!v.membershipId) return sql`coalesce((${col}->>'public')::boolean, false)`;
  return sql`(
    coalesce((${col}->>'public')::boolean, false)
    or coalesce((${col}->>'members')::boolean, false)
    or (${col} ? 'memberships' and ${col}->'memberships' ? ${v.membershipId})
    or (${col} ? 'roles' and ${col}->'roles' ?| ${pgArray(v.roleKeys)}::text[])
    or exists (
      select 1 from jsonb_array_elements(coalesce(${col}->'units', '[]'::jsonb)) au
      join org_units ou on ou.id = (au->>'id')::uuid
      where ou.id = any(${pgArray(v.unitIds)}::uuid[])
         or (coalesce((au->>'tree')::boolean, false) and exists (select 1 from unnest(${pgArray(v.unitPaths)}::text[]) vp where vp like ou.path || '%'))
    ))`;
}

/** Normalises an audience from input: at least one rule, no empty lists. */
export function cleanAudience(a: Audience): Audience {
  const out: Audience = {};
  if (a.public) out.public = true;
  if (a.members) out.members = true;
  if (a.units?.length) out.units = a.units.slice(0, 50).map((u) => ({ id: u.id, tree: !!u.tree }));
  if (a.roles?.length) out.roles = [...new Set(a.roles)].slice(0, 20);
  if (a.memberships?.length) out.memberships = [...new Set(a.memberships)].slice(0, 500);
  return out;
}

export const isPublic = (a: Audience) => !!a.public;
