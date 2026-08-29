export const MAX_KNOWLEDGE_IMPORT_BYTES = 10 * 1024 * 1024;

export function parseAdminKnowledgePackage(raw: string): unknown {
  if (Buffer.byteLength(raw, "utf8") > MAX_KNOWLEDGE_IMPORT_BYTES) {
    throw new Error("A tudáscsomag nagyobb a megengedett 10 MB-nál.");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("A fájl nem érvényes JSON.");
  }
}
