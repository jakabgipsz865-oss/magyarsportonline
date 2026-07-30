import { readFileSync, writeFileSync } from "node:fs";

const REDACTION_MARKER = "__MSO_REDACTED__";

const [mode, ...args] = process.argv.slice(2);

if (mode === "validate-export") {
  validateExport(...args);
} else if (mode === "compare-import") {
  compareImport(...args);
} else {
  throw new Error("Usage: validate-knowledge-portability.mjs validate-export|compare-import ...");
}

function validateExport(exportPath, reportPath) {
  const raw = readFileSync(exportPath, "utf8");
  const knowledgePackage = JSON.parse(raw);
  const errors = [];
  const sensitiveFields = [];

  assert(
    knowledgePackage.format === "magyarsportonline.admin-knowledge",
    "unexpected format",
    errors,
  );
  assert(knowledgePackage.schemaVersion === 1, "unexpected schemaVersion", errors);
  assert(
    knowledgePackage.security?.secretsIncluded === false,
    "secretsIncluded must be false",
    errors,
  );
  assert(
    knowledgePackage.security?.importDeletesData === false,
    "importDeletesData must be false",
    errors,
  );
  assert(
    knowledgePackage.metadata?.applicationCommit === process.env["EXPECTED_PRODUCTION_COMMIT"],
    "production export commit does not match the deployed commit",
    errors,
  );

  walk(knowledgePackage.content, [], (key, value, path) => {
    if (!isSecretKey(key)) return;
    sensitiveFields.push(path.join("."));
    assert(value === REDACTION_MARKER, `unredacted sensitive field: ${path.join(".")}`, errors);
  });

  for (const envName of ["PRODUCTION_ADMIN_SECRET", "PRODUCTION_CRON_SECRET"]) {
    const secret = process.env[envName] ?? "";
    if (secret.length > 0) {
      assert(!raw.includes(secret), `${envName} value is present in the export`, errors);
    }
  }

  const counts = knowledgePackage.metadata?.counts ?? {};
  assert(
    counts.staticLexiconEntries ===
      knowledgePackage.content?.staticKnowledge?.footballLexicon?.length,
    "static lexicon count mismatch",
    errors,
  );
  assert(
    counts.editorialCorrections === knowledgePackage.content?.editorialCorrections?.length,
    "editorial correction count mismatch",
    errors,
  );
  assert(
    counts.learnedLexiconEntries ===
      knowledgePackage.content?.derivedEditorialKnowledge?.learnedFootballLexicon?.length,
    "learned lexicon count mismatch",
    errors,
  );
  assert(
    counts.forbiddenTranslations ===
      knowledgePackage.content?.derivedEditorialKnowledge?.forbiddenLiteralTranslations?.length,
    "forbidden translation count mismatch",
    errors,
  );
  assert(
    counts.recommendedPhrasings ===
      knowledgePackage.content?.derivedEditorialKnowledge?.recommendedPhrasings?.length,
    "recommended phrasing count mismatch",
    errors,
  );
  assert(
    counts.sources === knowledgePackage.content?.sources?.length,
    "source count mismatch",
    errors,
  );
  assert(
    counts.reviewLearningPatterns === knowledgePackage.content?.reviewLearningPatterns?.length,
    "review pattern count mismatch",
    errors,
  );

  const duplicateCounts = {
    editorialCorrections: duplicateKeys(knowledgePackage.content?.editorialCorrections),
    sources: duplicateKeys(knowledgePackage.content?.sources),
    reviewLearningPatterns: duplicateKeys(knowledgePackage.content?.reviewLearningPatterns),
  };
  const duplicateCount = Object.values(duplicateCounts).reduce((sum, count) => sum + count, 0);
  assert(duplicateCount === 0, `duplicate portable keys in export: ${duplicateCount}`, errors);

  const report = {
    productionCommit: knowledgePackage.metadata?.applicationCommit,
    exportedAt: knowledgePackage.metadata?.exportedAt,
    counts,
    redactedPathCount: knowledgePackage.security?.redactedPaths?.length ?? 0,
    sensitiveFieldCount: sensitiveFields.length,
    knownProductionSecretsPresent: false,
    duplicateCounts,
    duplicateSourceGroups: describeDuplicateSourceGroups(knowledgePackage.content?.sources),
    duplicateCount,
    errorCount: errors.length,
    errors,
  };
  writeJson(reportPath, report);
  printReport("Production export validation", report);
  if (errors.length > 0) process.exit(1);
}

function compareImport(
  productionExportPath,
  testExportPath,
  previewPath,
  applyPath,
  idempotencyPreviewPath,
  reportPath,
) {
  const production = readJson(productionExportPath);
  const test = readJson(testExportPath);
  const preview = unwrapApiResult(readJson(previewPath));
  const applied = unwrapApiResult(readJson(applyPath));
  const idempotency = unwrapApiResult(readJson(idempotencyPreviewPath));
  const errors = [];

  assert(preview.staticKnowledgeCompatible === true, "static knowledge is incompatible", errors);
  assert(
    stableStringify(preview.counts) === stableStringify(applied.counts),
    "apply result differs from the approved preview",
    errors,
  );

  const expectedCounts = production.metadata.counts;
  assert(
    preview.counts.corrections.create === expectedCounts.editorialCorrections,
    "preview correction create count mismatch",
    errors,
  );
  assert(
    preview.counts.sources.create === expectedCounts.sources,
    "preview Source Registry create count mismatch",
    errors,
  );
  assert(
    preview.counts.reviewPatterns.create === expectedCounts.reviewLearningPatterns,
    "preview review-pattern create count mismatch",
    errors,
  );

  assert(
    idempotency.counts.corrections.create === 0,
    "second preview would create corrections",
    errors,
  );
  assert(idempotency.counts.sources.create === 0, "second preview would create sources", errors);
  assert(idempotency.counts.sources.update === 0, "second preview would update sources", errors);
  assert(
    idempotency.counts.reviewPatterns.create === 0,
    "second preview would create review patterns",
    errors,
  );
  assert(
    idempotency.counts.reviewPatterns.update === 0,
    "second preview would update review patterns",
    errors,
  );

  const contentComparisons = {
    staticKnowledge:
      stableStringify(production.content.staticKnowledge) ===
      stableStringify(test.content.staticKnowledge),
    editorialCorrections:
      stableStringify(production.content.editorialCorrections) ===
      stableStringify(test.content.editorialCorrections),
    derivedEditorialKnowledge:
      stableStringify(production.content.derivedEditorialKnowledge) ===
      stableStringify(test.content.derivedEditorialKnowledge),
    sourceRegistry:
      stableStringify(production.content.sources) === stableStringify(test.content.sources),
    reviewLearningPatterns:
      stableStringify(production.content.reviewLearningPatterns) ===
      stableStringify(test.content.reviewLearningPatterns),
  };
  for (const [category, identical] of Object.entries(contentComparisons)) {
    assert(identical, `${category} differs after test import`, errors);
  }

  const duplicateCount =
    duplicateKeys(test.content.editorialCorrections) +
    duplicateKeys(test.content.sources) +
    duplicateKeys(test.content.reviewLearningPatterns);
  assert(duplicateCount === 0, `duplicate portable keys after import: ${duplicateCount}`, errors);

  const report = {
    productionCommit: production.metadata.applicationCommit,
    productionCounts: expectedCounts,
    importPreview: preview,
    actualImport: applied,
    postImportIdempotencyPreview: idempotency,
    postImportCounts: test.metadata.counts,
    contentComparisons,
    duplicateCount,
    errorCount: errors.length,
    errors,
    rollback:
      "Az import nem töröl és nem módosít szerkesztői korrekciót; Source Registry rollbackhoz a művelet előtti export ugyanitt előnézhető és visszaimportálható. Teljes DB-helyreállításhoz a Neon point-in-time restore/branch restore az infrastruktúra-szintű út.",
  };
  writeJson(reportPath, report);
  printReport("Isolated import validation", report);
  if (errors.length > 0) process.exit(1);
}

function unwrapApiResult(value) {
  if (value?.ok !== true || !value.result) {
    throw new Error(`Knowledge API request failed: ${JSON.stringify(value)}`);
  }
  return value.result;
}

function walk(value, path, visitor) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...path, String(index)], visitor));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = [...path, key];
      visitor(key, item, itemPath);
      walk(item, itemPath, visitor);
    }
  }
}

function isSecretKey(key) {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();
  return /(^|_)(token|secret|password|authorization|credential|api_key|private_key|client_secret|cookie)$/.test(
    normalized,
  );
}

function duplicateKeys(items = []) {
  const keys = new Set();
  let duplicates = 0;
  for (const item of items) {
    if (keys.has(item.key)) duplicates += 1;
    keys.add(item.key);
  }
  return duplicates;
}

function describeDuplicateSourceGroups(items = []) {
  const groups = new Map();
  for (const item of items) {
    const current = groups.get(item.key) ?? [];
    current.push(item);
    groups.set(item.key, current);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const comparable = group.map(({ key: _key, ...item }) => item);
      const fields = new Set(comparable.flatMap((item) => Object.keys(item)));
      return {
        records: group.length,
        allContentIdentical: comparable.every(
          (item) => stableStringify(item) === stableStringify(comparable[0]),
        ),
        differingFields: [...fields].filter((field) => {
          const values = comparable.map((item) => stableStringify(item[field]));
          return values.some((value) => value !== values[0]);
        }),
      };
    });
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function printReport(title, report) {
  console.log(`=== ${title} ===`);
  console.log(JSON.stringify(report, null, 2));
}
