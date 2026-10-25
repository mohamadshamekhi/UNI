import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FilesService } from '../src/modules/files/files.service.js';
import { StorageService } from '../src/modules/files/storage.service.js';
import { as, createPlatformAdmin, createTenant, createUnit, registerStudent, startApp, type TenantFixture, type TestApp } from './helpers.js';

/**
 * Real ClamAV (FIL-04). Opt-in: `docker compose --profile scan up -d clamav`, then
 * `CLAMAV_TEST=1 pnpm --filter @uni/api test`.
 */
describe.runIf(process.env.CLAMAV_TEST === '1')('ClamAV scanning', () => {
  let t: TestApp;
  let tf: TenantFixture;
  let unit: string;

  beforeAll(async () => {
    t = await startApp();
    const platform = await createPlatformAdmin(t);
    tf = await createTenant(t, platform.token);
    unit = (await createUnit(t, tf, 'دانشکده فنی')).id;
  });
  afterAll(() => t.close());

  const pool = () => new pg.Pool({ connectionString: process.env.DATABASE_SYSTEM_URL });

  it('marks a clean upload as clean', async () => {
    const s = await registerStudent(t, tf, unit);
    const db = pool();
    await db.query("update file_objects set scan_status = 'pending', scanned_at = null where id = $1", [s.fileId]);
    await t.app.get(FilesService).scan(s.fileId);
    const { rows } = await db.query('select scan_status from file_objects where id = $1', [s.fileId]);
    await db.end();
    expect(rows[0].scan_status).toBe('clean');
  });

  it('quarantines an infected object and never serves it', async () => {
    const s = await registerStudent(t, tf, unit);
    const db = pool();
    const { rows } = await db.query<{ storage_key: string }>('select storage_key from file_objects where id = $1', [s.fileId]);
    // replace the stored bytes with the EICAR test signature (harmless by design)
    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    await t.app.get(StorageService).put(rows[0]!.storage_key, eicar, 'image/png');
    await db.query("update file_objects set scan_status = 'pending', scanned_at = null where id = $1", [s.fileId]);

    await t.app.get(FilesService).scan(s.fileId);
    const after = await db.query('select scan_status from file_objects where id = $1', [s.fileId]);
    await db.end();
    expect(after.rows[0].scan_status).toBe('infected');

    const link = await t.http.post(`/v1/files/${s.fileId}/download-link`).set(as(tf.adminToken, tf.slug)).send({}).expect(409);
    expect(link.body.error.code).toBe('FILE_NOT_READY');
    const audit = await t.http.get(`/v1/admin/audit?action=file.quarantined&targetId=${s.fileId}`).set(as(tf.adminToken, tf.slug)).expect(200);
    expect(audit.body.length).toBe(1);
  });
});
