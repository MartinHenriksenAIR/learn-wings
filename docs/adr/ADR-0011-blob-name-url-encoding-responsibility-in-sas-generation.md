---
id: "ADR-0011"
title: "Blob Name URL Encoding Responsibility in SAS Generation"
status: accepted
date: 2026-05-19
deciders: ['le-dawg']
tags: ['storage', 'sas', 'security', 'api-contract']
policy:
  rationales: ['Encoding inside generateSasToken risks double-encoding; caller is responsible for URL-safe blob names', 'Blob names must be alphanumeric, hyphens, underscores, dots, and forward slashes only when passed to generateSasToken']
approval_date: 2026-05-19
approval_notes: "Surfaced by Task 6 security review. Caller-responsibility pattern chosen to avoid double-encoding risk. Current callers (UUID-based blob names) are safe. Add JSDoc contract comment in Task 8 when sas.ts is wired into real functions."

---

## Context

functions/shared/sas.ts generates Azure Blob SAS tokens. Neither generateSasToken nor buildBlobUrl applies encodeURIComponent to the blobName parameter. The canonicalResource string and the URL path are both built from the raw value — keeping them consistent so the HMAC signature verifies — but a caller passing a blob name with spaces, percent characters, or other URL-unsafe chars would produce a broken URL at the HTTP layer rather than a signature mismatch. Surfaced as a suggestion in the Task 6 security review (2026-05-19). Current callers (azure-upload-url, azure-document-upload-url) construct blob names as UUID + extension only — all URL-safe — so there is no current breakage.

## Decision

Encoding is the caller's responsibility. generateSasToken and buildBlobUrl accept raw blob names and do not apply encodeURIComponent internally. Callers must pass URL-safe blob names (alphanumeric, hyphens, underscores, dots, forward slashes only). Don't encode inside sas.ts — encoding in both canonicalResource and the URL path must be identical; centralising it inside the function risks double-encoding if callers also encode. Document the input contract in sas.ts with a JSDoc comment on the blobName parameter.

## Consequences

Positive: No double-encoding risk. Signature always verifies because canonicalResource and URL path use identical raw value. Simple implementation. Negative: Callers that pass blob names with spaces or special characters will produce silently broken URLs rather than an explicit error. Requires input validation or documentation discipline at call sites.

## Alternatives

1. Encode inside sas.ts — rejected: creates double-encoding if caller also encodes; requires encoding in both canonicalResource and URL path identically, which is brittle. 2. Validate and throw on unsafe characters — considered: adds safety but adds complexity for a constraint that current and planned callers (UUID-based names) will never hit. Deferred; can be added if a future caller needs arbitrary filenames.
