import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PDFDocument, PDFName } from 'pdf-lib';

// PAP-10 / section 9 leak table: the review copy of a manuscript carries no author identity in its
// metadata. The text of the paper itself cannot be guaranteed (authors get a preparation guide).

export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ANON = 'Anonymous';

export interface ScrubReport {
  format: 'pdf' | 'docx';
  /** metadata fields that held a value and were cleared */
  cleared: string[];
  /** DOCX parts whose comment / revision authors were anonymised */
  anonymisedParts: string[];
}

export async function scrubManuscript(buf: Buffer, mime: string): Promise<{ buffer: Buffer; report: ScrubReport }> {
  if (mime === 'application/pdf') return scrubPdf(buf);
  if (mime === DOCX) return scrubDocx(buf);
  throw new Error(`unsupported manuscript type ${mime}`);
}

async function scrubPdf(buf: Buffer) {
  const doc = await PDFDocument.load(buf, { updateMetadata: false });
  const cleared: string[] = [];
  const fields: [string, () => string | undefined, () => void][] = [
    ['Title', () => doc.getTitle(), () => doc.setTitle('')],
    ['Author', () => doc.getAuthor(), () => doc.setAuthor('')],
    ['Subject', () => doc.getSubject(), () => doc.setSubject('')],
    ['Keywords', () => doc.getKeywords(), () => doc.setKeywords([])],
    ['Creator', () => doc.getCreator(), () => doc.setCreator('')],
    ['Producer', () => doc.getProducer(), () => doc.setProducer('')],
  ];
  for (const [name, get, clear] of fields) {
    if (get()) cleared.push(name);
    clear();
  }
  // XMP packet duplicates the Info dictionary (dc:creator, xmp:CreatorTool…)
  if (doc.catalog.has(PDFName.of('Metadata'))) {
    doc.catalog.delete(PDFName.of('Metadata'));
    cleared.push('XMP');
  }
  const out = await doc.save({ updateFieldAppearances: false });
  return { buffer: Buffer.from(out), report: { format: 'pdf' as const, cleared, anonymisedParts: [] } };
}

const TEXT_PARTS = /^word\/(document|comments|commentsExtended|commentsExtensible|footnotes|endnotes|header\d*|footer\d*)\.xml$/;

function scrubDocx(buf: Buffer) {
  const files = unzipSync(new Uint8Array(buf));
  const cleared: string[] = [];
  const anonymisedParts: string[] = [];

  const core = files['docProps/core.xml'];
  if (core) {
    let xml = strFromU8(core);
    for (const tag of ['dc:creator', 'cp:lastModifiedBy', 'dc:title', 'dc:subject', 'dc:description', 'cp:keywords', 'cp:category']) {
      const re = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)</${tag}>`, 'g');
      xml = xml.replace(re, (_, attrs: string, v: string) => {
        if (v.trim()) cleared.push(tag);
        return `<${tag}${attrs}></${tag}>`;
      });
    }
    files['docProps/core.xml'] = strToU8(xml);
  }
  const app = files['docProps/app.xml'];
  if (app) {
    let xml = strFromU8(app);
    for (const tag of ['Company', 'Manager', 'HyperlinkBase']) {
      xml = xml.replace(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'), (_, v: string) => {
        if (v.trim()) cleared.push(`app:${tag}`);
        return `<${tag}></${tag}>`;
      });
    }
    files['docProps/app.xml'] = strToU8(xml);
  }
  // custom properties can hold anything (e.g. author ids from a template)
  if (files['docProps/custom.xml']) {
    files['docProps/custom.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>');
    cleared.push('custom');
  }
  // comment and tracked-change authors / initials, and the people list behind them
  for (const name of Object.keys(files)) {
    if (!TEXT_PARTS.test(name) && name !== 'word/people.xml') continue;
    const xml = strFromU8(files[name]!);
    const next = xml
      .replace(/(w:author|w15:author|w:initials)="[^"]*"/g, (_, attr: string) => `${attr}="${attr === 'w:initials' ? 'A' : ANON}"`)
      .replace(/(w15:userId|w15:providerId)="[^"]*"/g, (_, attr: string) => `${attr}="${ANON}"`);
    if (next !== xml) {
      files[name] = strToU8(next);
      anonymisedParts.push(name);
    }
  }
  return { buffer: Buffer.from(zipSync(files)), report: { format: 'docx' as const, cleared, anonymisedParts } };
}

/** Identity hints left in a manuscript's metadata (used by tests and the manager's scrub report). */
export async function identityHints(buf: Buffer, mime: string): Promise<string[]> {
  const out: string[] = [];
  if (mime === 'application/pdf') {
    const doc = await PDFDocument.load(buf, { updateMetadata: false });
    for (const v of [doc.getAuthor(), doc.getCreator(), doc.getProducer(), doc.getTitle(), doc.getSubject(), doc.getKeywords()]) if (v) out.push(v);
    if (doc.catalog.has(PDFName.of('Metadata'))) out.push('XMP');
  } else if (mime === DOCX) {
    const files = unzipSync(new Uint8Array(buf));
    const core = files['docProps/core.xml'] ? strFromU8(files['docProps/core.xml']) : '';
    for (const m of core.matchAll(/<(dc:creator|cp:lastModifiedBy)[^>]*>([^<]+)</g)) out.push(m[2]!);
    for (const [name, data] of Object.entries(files)) {
      if (!name.startsWith('word/')) continue;
      for (const m of strFromU8(data).matchAll(/w:author="([^"]*)"/g)) if (m[1] !== ANON) out.push(m[1]!);
    }
  }
  return out;
}
