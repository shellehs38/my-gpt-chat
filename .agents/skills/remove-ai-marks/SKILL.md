---
name: remove-ai-marks
description: Inspect and optionally clean provenance metadata, invisible Unicode marks, and AI-related file metadata in company-owned content through the upstream watermarks-remover HTTP service. Use only on authorized files, with inspection first and explicit approval before cleaning.
license: MIT
metadata:
  upstream: https://github.com/guillaumemeyer/watermarks-remover
  upstream-skill: skills/remove-ai-marks
---

# Remove AI marks — ООО «СВОИ ЛЮДИ»

This is a project-local integration guide for the upstream [watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) project. It is **not** a standalone remover: the upstream service must be installed and reachable first. Do not claim that a skill markdown file alone provides working cleaning.

## Allowed workflow

1. Process only files owned by or authorized for ООО «СВОИ ЛЮДИ». Preserve originals and audit results.
2. Explain that removing C2PA/EXIF/provenance can erase origin evidence. Never claim that cleaning proves human authorship or that any watermark is guaranteed to be removed. Preserve required disclosures.
3. Check `WATERMARKS_SERVICE_URL` (default `http://127.0.0.1:8765`) using `GET /health`. Stop if unavailable. If a remote service is used, require HTTPS and server-side API-key authentication; never expose keys in a browser or chat.
4. Query `GET /capabilities` to identify actual supported detectors and tools. Do not promise pixel-domain SynthID removal without an available backend.
5. Send authorized file content to `POST /inspect` as JSON: `{"file":"<base64>","name":"example.png"}`. Report findings and uncertainty.
6. Only after the user approves cleaning, send the same file to `POST /clean`; save the returned `cleaned` base64 to a **new** output file, not the original. Reinspect and compare. For PDFs, verify the service reports required `qpdf` and `exiftool` capabilities; otherwise warn about best-effort metadata removal.
7. For text, preserve quotations, formulas, prices, measurements, legal disclosures and technical identifiers. Do not alter construction plans or financial data as a side effect.
8. Never modify Google Sheets, existing CRM data, Vercel secrets or Production as part of this skill.

## Installation and integration

Upstream source: https://github.com/guillaumemeyer/watermarks-remover

The upstream agent skill lives in `skills/remove-ai-marks/SKILL.md` and the Python HTTP service in `service/`. Follow upstream README to deploy that service separately (e.g. `make serve` on a trusted machine). The local URL `127.0.0.1` is **not reachable** from a remote Vercel function; a production integration would require a separately secured reachable service and a reviewed API route. No service is deployed by adding this file.

This project skill can be loaded by a compatible agent from `.agents/skills/remove-ai-marks/SKILL.md`. For manual execution, use the documented service endpoints. No automatic hook, auto-cleaning or background processing is enabled.

## Testing checklist

- Verify upstream service health and capabilities.
- Inspect a synthetic test file without changing it.
- With explicit approval, clean a copy and compare metadata and file integrity.
- Confirm failure when service is unavailable, and verify originals remain unchanged.
- Review security and CI before any website integration.
