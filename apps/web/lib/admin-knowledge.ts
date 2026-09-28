import {
  EDITORIAL_KNOWLEDGE_FORMAT,
  EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
  createEditorialKnowledgePackage,
  validateEditorialKnowledgePackage,
  type EditorialKnowledgeApplyResult,
  type EditorialKnowledgeImportPreview,
} from "@magyarsportonline/db";
import { createRepositories, d1Binding } from "./db";
import { applyD1KnowledgeImport, listD1Knowledge, previewD1KnowledgeImport } from "./d1-knowledge";
export { MAX_KNOWLEDGE_IMPORT_BYTES, parseAdminKnowledgePackage } from "./admin-knowledge-upload";

export async function buildAdminKnowledgePackage() {
  const d1 = d1Binding();
  const records = d1
    ? await listD1Knowledge(d1)
    : await createRepositories().editorialKnowledgeRepository.listAllRecords();
  const createdAt = new Date();
  const knowledgePackage = createEditorialKnowledgePackage({
    format: EDITORIAL_KNOWLEDGE_FORMAT,
    schema_version: EDITORIAL_KNOWLEDGE_SCHEMA_VERSION,
    package_id: "mso-editorial-knowledge-backup",
    package_version: `1.0.${createdAt.toISOString().slice(0, 10).replaceAll("-", "")}`,
    package_mode: "full",
    base_package_version: null,
    created_at: createdAt.toISOString(),
    record_count: records.length,
    records,
    security: { secrets_included: false },
  });
  const validation = validateEditorialKnowledgePackage(knowledgePackage);
  if (validation.invalid.length > 0) {
    throw new Error("A V2 tudásbázis exportálás előtt nem felelt meg a saját contractjának.");
  }
  return knowledgePackage;
}

export async function previewAdminKnowledgeImport(
  knowledgePackage: unknown,
): Promise<EditorialKnowledgeImportPreview> {
  const d1 = d1Binding();
  return d1
    ? previewD1KnowledgeImport(d1, knowledgePackage)
    : createRepositories().editorialKnowledgeRepository.previewImport(knowledgePackage);
}

export async function applyAdminKnowledgeImport(
  knowledgePackage: unknown,
  expectedDigest: string,
): Promise<EditorialKnowledgeApplyResult> {
  const d1 = d1Binding();
  return d1
    ? applyD1KnowledgeImport(d1, knowledgePackage, expectedDigest)
    : createRepositories().editorialKnowledgeRepository.applyImport(
        knowledgePackage,
        expectedDigest,
      );
}
