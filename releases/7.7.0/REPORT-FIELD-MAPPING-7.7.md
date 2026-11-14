# Trace Assessment Excel Report 7.7 Field Mapping

The workbook is a human-readable assessment record and trace export. `Records` keeps the expanded-record columns used by the supplied Sharpen360 example, then adds evidence content and action-tracking fields. A record linked to multiple indicators produces one row per indicator, while retaining the record ID.

## Records

The first fourteen columns follow the reference `Records` sheet.

| Column | Source and meaning | Data type |
| --- | --- | --- |
| SortID | Recorded sort order, or export row order when none is recorded | Integer |
| ID | Stable assessor record ID | Text |
| Indicator | Explicit linked BP/GP indicator | Text |
| Indicator Name | Assessment indicator title | Text |
| Type | Normalized record type such as Observation, Weakness, Strength, or Recommendation | Text |
| General | Explicit general-record flag | Yes/No |
| Description | Record's saved description or finding text | Text |
| Instance | Assessment instance name | Text |
| Rating | Eligible assessor-confirmed rating for this in-scope indicator; otherwise `NR` | Text |
| WS tag | Workspace short name | Text |
| Created by | Recorded creator | Text |
| Created date | Strict ISO date/timestamp becomes an Excel date serial; invalid source values remain unchanged text | Date / DateTime or Text |
| Modified by | Recorded modifier | Text |
| Modified date | Strict ISO date/timestamp becomes an Excel date serial; invalid source values remain unchanged text | Date / DateTime or Text |
| Evidence content | Source-language text retained from the explicitly linked evidence item, excerpt, or a single unambiguous evidence source | Text |
| Evidence locator | Source file and page, sheet, cell, row, or other stored locator | Text |
| Evidence role | `direct`, `corroborating`, or `index-only` under the rules below | Text |
| Owner | Finding owner | Text |
| Due date | Finding due date, kept as supplied | Text |
| Review status | Saved record/review state; AI candidates remain explicitly provisional | Text |
| Assessment | Assessment name | Text |
| Trace record URL | Explicit source record URL only | Text |
| Jira issue | Explicit linked Jira/JiraFlow key only | Text |
| Record status | Saved record status | Text |
| Source rating | Imported or historical rating, separate from `Rating` | Text |
| Minimum closure evidence | Explicit closure criteria from the record or assessment | Text |

## Evidence

The supplied nine-column evidence shape is retained and enriched with item-level details.

| Column | Meaning |
| --- | --- |
| Instance | Assessment instance |
| Prefix | Explicit display prefix or evidence-code prefix |
| DisplayId | Atomic item's external/catalog identifier, else evidence code |
| Name | Atomic item title, else source evidence name |
| Evidence Type | Atomic item type, else source evidence type |
| Version | Item/evidence version or baseline |
| Comment | Stored source comment |
| URL | Explicit source URL |
| External Doc ID | Stored external document ID |
| Content | Retained source text for the selected evidence item |
| Source locator | Exact stored locator |
| Primary process | Classified primary process |
| Evidence role | Evidence-strength category |
| Confirmation | Source item's saved confirmation state |
| Linked indicators | Explicit trace-link indicators |
| Source file | Original source file name |
| Item ID | Stable atomic evidence-item ID |
| Evidence ID | Stable evidence-register ID/code |

## JiraImport and Info

`JiraImport` provides an export-ready corrective-action view for explicit Weakness, Recommendation, and NC records. The description contains the saved finding text, related BP/GP, assessment name, available evidence content and locator, review status, trace URL, and minimum closure evidence. Assignee, due date, and issue key are populated only when explicitly saved. This workbook does not call Jira or create tickets.

`Info` records the assessment identity, selected formal process scope, draft/approval state, row counts, rating boundary, and evidence-content boundary. The original workpaper's many-to-many indicator relationship is represented by repeated record rows with the same stable record ID.

## Evidence and Rating Rules

- A direct link is shown as `direct` only when retained evidence text and a locator are present, an explicit indicator link exists, the evidence primary process matches that indicator's process, and the link is assessor-confirmed.
- A readable link originating in a different process is `corroborating`; it does not replace direct evidence in the target process.
- A filename, ID, unresolved item, missing locator, or unparsed reference is `index-only`. It remains useful as an index but does not prove implementation.
- When a requested item's source text is absent, the workbook states `Content unavailable; reopen or re-upload the source and select the evidence item.` It does not fill the content cell with a filename or identifier.
- Chinese or other source-language evidence remains verbatim when an English translation is not available.
- Only the Records `Created date` and `Modified date` columns convert strict ISO dates or timestamps to numeric Excel dates. Date-only values display as `yyyy-mm-dd`; timestamps display as `yyyy-mm-dd hh:mm:ss` (with fractional seconds when supplied). Timestamp offsets are normalized to UTC. Empty values remain blank and invalid or non-ISO values remain text. Other date-like fields, including JiraImport due dates, are unchanged text.
- Related-process indicators receive `NR`. Source/imported ratings remain visible in `Source rating` and cannot be used to fill a formal target-process rating.
- AI-derived findings remain candidates until assessor review. Formal rating authorization and evidence confirmation are unchanged by workbook export.
