---
name: read-documents
description: Reads the PDFs, images, Word files, spreadsheets and screenshots the person hands over and proposes candidate facts in facts.md, marked inferred until they confirm them. Use it when the person says "I left you some files", "read my price list", "my brochure is there" or there are new files in the business folder.
allowed-tools: Bash, mcp__plugin_backoffice_backoffice
---

# Read documents

A document is not the person: it may be out of date. That is why everything that comes from a file enters as `inferred`.

## Procedure

1. List what was handed over with `backoffice_file_list` (prefix `marketing/<business>/documents/`; if nothing is there, also check the other files the person uploaded in the web "Archivos" tab, and if you find nothing ask them to upload the files in the Archivos tab). Compare with `documents/index.md`; read only what does not appear there.
2. Read every file with `backoffice_file_read` (text comes back as text, binary as base64; a file over 5 MB errors: ask for a smaller one). Text types (`.md .txt .csv`) are read directly. For binary types (`.pdf`, images, `.docx .doc .rtf`, `.xlsx`) write the base64 to a scratch folder (`$TMPDIR/backoffice-work/<task>/`) and convert there: `.docx .doc .rtf` with `textutil -convert txt -stdout "<scratch file>"`; `.xlsx` with `unzip -p "<scratch file>" xl/sharedStrings.xml`; PDFs and images as the model can view them (the logo gives approximate colors, the photo of the premises gives context, not facts). Anything unreadable: ask the person to upload a PDF or a screenshot in the Archivos tab.
3. Extract only facts about the business (prices, offer, schedule, location, audience, channels, brand, constraints).
4. Write one row per fact in `facts.md` with status `inferred` and source `file, p. N (file date)`. A document older than 6 months says so in the source.
5. If the document contradicts a `confirmed` fact, keep the confirmed one and add a `missing` row or a note with the question: "The March list says $2,000; you said $2,200, which one holds?".
6. Colors from an image: "approx. #5C0F8B (from logo.png)".
7. Update `documents/index.md` (`backoffice_file_write`) and deliver: "I read N files and proposed M facts as inferred; confirm or correct them."
8. An ads export is not a fact: it is a metric; tell the person to upload it in the Archivos tab (or move it to `marketing/<business>/data/` with `backoffice_file_move`) and use `metrics-sqlite`.

## Exact output format

Rows in `facts.md`: `| fact | value | status | source |`. Index `documents/index.md`: `| file | date | what I took | facts |`.

Example (sample data; the person's own values and wording stay in their language):

```markdown
| monthly_price | $2,200.00 MXN | inferred | documents/precios.pdf, p. 1 (15 Sep 2026) |
| brand_colors | approx. #5C0F8B | inferred | documents/logo.png (undated) |

| file | date | what I took | facts |
| precios.pdf | 15 Sep 2026 | 4 monthly prices | monthly_price |
```

## Never

- Mark `confirmed` something read from a document; only the person confirms.
- Overwrite a `confirmed` fact.
- Copy personal data (customers, phone numbers, credentials, national IDs, bank details); skip them and flag it.
- Delete or move the person's files.
- Ask the person for a disk path or to open a file from disk.
- Deduce what the document does not say.

## Why

Documents save questions, but an old price taken as truth ends up published. Inferred until confirmed keeps the rule of never using facts without a source.
