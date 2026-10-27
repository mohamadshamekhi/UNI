import { api } from "@uni/shared/api";

export async function uploadFile(slug: string, file: File, purpose: string) {
  const fd = new FormData();
  fd.append("purpose", purpose);
  fd.append("file", file);
  return api<{ id: string; originalName: string; sizeBytes: number; mimeType: string; scanStatus: string }>("/v1/files", { method: "POST", tenant: slug, body: fd });
}
