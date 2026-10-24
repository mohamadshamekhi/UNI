import { describe, expect, it } from 'vitest';
import { isValidNationalId, normalizeFa, normalizeMobile } from './normalize.js';
import { detectFileType } from '../../modules/files/file-type.js';
import { AclService, type Grant } from '../../modules/acl/acl.service.js';

describe('normalisation (UX-03, AUTH-03)', () => {
  it.each([
    ['09121234567', '+989121234567'],
    ['۰۹۱۲۱۲۳۴۵۶۷', '+989121234567'],
    ['+98 912 123 4567', '+989121234567'],
    ['9121234567', '+989121234567'],
  ])('mobile %s → %s', (input, out) => expect(normalizeMobile(input)).toBe(out));

  it('rejects landlines and garbage', () => {
    expect(normalizeMobile('02112345678')).toBeNull();
    expect(normalizeMobile('hello')).toBeNull();
  });

  it('unifies Arabic letters and digits', () => {
    expect(normalizeFa('علي  كريمي ١٢٣')).toBe('علی کریمی 123');
  });

  it('validates national id checksum', () => {
    expect(isValidNationalId('0499370899')).toBe(true);
    expect(isValidNationalId('0499370898')).toBe(false);
    expect(isValidNationalId('1111111111')).toBe(false);
  });
});

describe('file sniffing (FIL-03)', () => {
  it('detects by content, not extension', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7\n....'))?.mime).toBe('application/pdf');
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))?.mime).toBe('image/jpeg');
    expect(detectFileType(Buffer.from('<?php echo 1; ?>'))).toBeNull();
  });
});

describe('scope coverage', () => {
  const g = (scopeType: Grant['scopeType'], scopeId: string | null, unitPath: string | null): Grant => ({ permission: 'membership.view', scopeType, scopeId, unitPath });
  it('tenant covers all; unit is exact; unit_tree follows the path; case is exact', () => {
    expect(AclService.covers(g('tenant', null, null), {}, null)).toBe(true);
    expect(AclService.covers(g('unit', 'u1', '/u1/'), { unitId: 'u1' }, '/u1/')).toBe(true);
    expect(AclService.covers(g('unit', 'u1', '/u1/'), { unitId: 'u2' }, '/u1/u2/')).toBe(false);
    expect(AclService.covers(g('unit_tree', 'u1', '/u1/'), { unitId: 'u2' }, '/u1/u2/')).toBe(true);
    expect(AclService.covers(g('unit_tree', 'u1', '/u1/'), { unitId: 'u3' }, '/u3/')).toBe(false);
    expect(AclService.covers(g('case', 'c1', null), { caseId: 'c1' }, null)).toBe(true);
  });
});
