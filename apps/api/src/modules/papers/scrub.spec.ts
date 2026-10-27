import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { DOCX, identityHints, scrubManuscript } from './scrub.js';

describe('manuscript scrubbing (PAP-10)', () => {
  it('PDF: clears the info dictionary and XMP', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setAuthor('Dr. Sara Ahmadi');
    doc.setCreator('Microsoft Word - Ahmadi');
    doc.setTitle('Secret title');
    const src = Buffer.from(await doc.save());
    expect(await identityHints(src, 'application/pdf')).toContain('Dr. Sara Ahmadi');

    const { buffer, report } = await scrubManuscript(src, 'application/pdf');
    expect(report.cleared).toEqual(expect.arrayContaining(['Author', 'Creator', 'Title']));
    expect(await identityHints(buffer, 'application/pdf')).toEqual([]);
    expect(buffer.toString('latin1')).not.toContain('Ahmadi');
  });

  it('DOCX: clears core/app properties and comment / revision authors', async () => {
    const src = Buffer.from(
      zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'docProps/core.xml': strToU8('<cp:coreProperties><dc:creator>Sara Ahmadi</dc:creator><cp:lastModifiedBy>sahmadi</cp:lastModifiedBy></cp:coreProperties>'),
        'docProps/app.xml': strToU8('<Properties><Company>Univ X Lab</Company></Properties>'),
        'word/document.xml': strToU8('<w:document><w:ins w:id="1" w:author="Sara Ahmadi" w:date="2026-01-01"/></w:document>'),
        'word/comments.xml': strToU8('<w:comments><w:comment w:id="0" w:author="Sara Ahmadi" w:initials="SA"/></w:comments>'),
      }),
    );
    expect(await identityHints(src, DOCX)).toEqual(expect.arrayContaining(['Sara Ahmadi', 'sahmadi']));
    const { buffer, report } = await scrubManuscript(src, DOCX);
    expect(report.anonymisedParts).toEqual(expect.arrayContaining(['word/document.xml', 'word/comments.xml']));
    expect(await identityHints(buffer, DOCX)).toEqual([]);
    const all = Object.values(unzipSync(new Uint8Array(buffer))).map((f) => strFromU8(f)).join('');
    expect(all).not.toMatch(/Ahmadi|sahmadi|Univ X Lab|"SA"/);
  });
});
