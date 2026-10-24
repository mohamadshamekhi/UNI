// Content sniffing (FIL-03): the declared extension / MIME type is never trusted.

export type DetectedType = { mime: string; ext: string };

const startsWith = (buf: Buffer, sig: number[], offset = 0) => sig.every((b, i) => buf[offset + i] === b);

export function detectFileType(buf: Buffer): DetectedType | null {
  if (buf.length < 8) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', ext: 'pdf' };
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    // OOXML container: identify Word documents by their part names
    const head = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString('latin1');
    if (head.includes('[Content_Types].xml') && head.includes('word/')) {
      return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
    }
    return null;
  }
  return null;
}

export interface UploadPolicy {
  mimes: string[];
  maxBytes: number;
  confidential: boolean;
  /** Allowed before an account exists, authorised by a mobile proof token. */
  allowProofUpload?: boolean;
}

const MB = 1024 * 1024;

/** Per-purpose limits (FIL-03; sizes are the proposed defaults, «نیازمند تأیید»). */
export const UPLOAD_POLICIES = {
  membership_document: {
    mimes: ['image/jpeg', 'image/png', 'application/pdf'],
    maxBytes: 5 * MB,
    confidential: true,
    allowProofUpload: true,
  },
  branding_logo: { mimes: ['image/png', 'image/jpeg'], maxBytes: 1 * MB, confidential: false },
} as const satisfies Record<string, UploadPolicy>;

export type UploadPurpose = keyof typeof UPLOAD_POLICIES;
export const isUploadPurpose = (p: string): p is UploadPurpose => Object.hasOwn(UPLOAD_POLICIES, p);
