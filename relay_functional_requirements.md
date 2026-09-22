# Functional Requirements — Relay

**Version:** 1.3 — Living Handoffs, Multi-Role Continuity & Organization Memory
**Product:** Relay  
**Category:** Student leadership handoff / institutional memory  
**Target:** RevenueCat Shipaton 2026 — Next Gen Award  
**Platforms:** Expo / React Native owner app + mobile-web successor experience

**Priority:** P0 = must ship · P1 = valuable next · P2 = post-launch

---

# 0. Product Definition

Relay is a living institutional-memory layer for student organizations. Leaders capture operational knowledge throughout their service period, deliberately approve what is true, and publish an intentional handoff snapshot for the next leader.

The current leader can return to a Draft Handoff during the year to speak, type, upload new or updated material, and maintain approved knowledge. Relay turns source evidence into reviewable knowledge and runs a **Handoff Preflight** that finds missing details, vague instructions, incomplete processes, and contradictions before publication.

The incoming leader receives a focused immutable publication and can ask grounded questions from its approved knowledge. Across service periods, Relay helps the organization see what materially changed and why—but only when approved evidence or a human confirmation establishes the reason.

Documents remain evidence. Approved Knowledge Items remain product truth.

## Core promise

> **Capture how the role actually works throughout the term, then pass on knowledge the next leader can trust.**

## Product principle

> **Most AI summarizes what you told it. Relay finds what your successor still needs that you forgot to explain.**

> **Relay never turns chronology, source churn, or AI speculation into organizational truth.**

## Core loop

**Capture → Structure → Preflight → Resolve → Publish → Ask**

Any v1.3 feature that does not strengthen this loop should be excluded.

---

# 1. Product Boundaries

Relay is not a:

- student social network
- club marketplace
- voting/election system
- messaging platform
- task-management suite
- LMS
- password manager
- generic AI assistant
- replacement for official university policy

A feature belongs in Relay only if it helps **capture, structure, verify, transfer, retrieve, or learn from operational knowledge across a leader's term and transition**.

---

# 2. Actors

| Actor | Description |
|---|---|
| **Organization Owner** | One authenticated member who oversees continuity, creates Roles, manages Role assignments and subscription association, and may offer ownership to an active member. Ownership alone grants no Role editing or raw-source access. |
| **Role Holder / Current or Outgoing Leader** | Authenticated active member with an active server-side assignment for a specific Organization, Role, and service period. Maintains that living Handoff, approves knowledge, runs Preflight, and deliberately publishes or revokes its recipient snapshot. The Owner may separately hold a Role assignment. |
| **Incoming Recipient** | Reads a published Handoff and asks questions without an account or paid plan. Recipient access never grants membership or Role authority; becoming a successor Role Holder requires a separate authenticated assignment acceptance. |
| **Purchaser** | Human whose RevenueCat/store account purchased the annual entitlement attached to one Organization. Only the current Owner may initiate/attach a purchase. Ownership transfer leaves the original purchaser and store billing account unchanged. |
| **System** | Processes sources, runs AI, retrieval, and entitlement checks. |

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| ACT-01 | Owners and Role Holders authenticate. Server-side active Role Assignment, rather than ownership, job title, recipient link, purchase, client state, or AI inference, authorizes Role maintenance. | P0 |
| ACT-02 | Incoming leaders can open and read a valid published handoff without installing Relay or creating an account. | P0 |
| ACT-03 | A recipient can access only the handoff and knowledge explicitly published to that recipient link. | P0 |
| ACT-04 | Purchaser identity, organization ownership, outgoing leadership, and incoming leadership remain separate concepts even when one person fills multiple roles in v1.3. | P0 |
| ACT-05 | The current Owner may offer ownership to an existing active Organization member. The recipient explicitly accepts within the offer's validity period; transfer atomically changes the sole Owner while preserving Organization identity, data, history, assignments, and subscription association. | P0 |
| ACT-06 | Organization membership records active/ended membership independently of active/ended Role assignments. Only one active maintainer exists per Role and service period. Pending invites grant no edit authority. | P0 |
| ACT-07 | The Owner creates a time-limited, single-use Role assignment invite and copies/shares its link. The invitee authenticates, inspects Organization/Role/service period, and explicitly accepts; membership, assignment, and workspace activation are atomic. | P0 |
| ACT-08 | Replacing an existing assignment requires deliberate Owner confirmation. Ending it removes private working/edit access while preserving contributor attribution and published recipient access. | P0 |
| ACT-09 | Owner oversight shows Role Holder, service period, lifecycle, updated date, approved knowledge count, unresolved Preflight status/count, and publication/history. Owners may inspect approved knowledge and published Organization Memory, but raw Sources, transcripts, draft files, and unresolved proposals require the exact active Role Assignment. | P0 |

---

# 3. Core Domain

Relay uses five primary objects:

- **Organization**
- **Role**
- **Handoff**
- **Source**
- **Knowledge Item**

A Handoff belongs to one Role and has a service period such as `2025–2026`. A Role can retain multiple published Handoffs across service periods.

A Source is original evidence such as:
- voice transcript
- typed notes
- PDF / DOCX / PPTX
- spreadsheet
- image

A Knowledge Item is a human-approved fact or instruction derived from one or more sources.

Supporting lineage metadata connects:

- versions of the same Source within a Handoff
- revisions of canonical Knowledge Items
- logically equivalent Knowledge Items across Handoffs for the same Role
- an approved Lesson to a resulting Process, Warning, or Responsibility when evidence or human confirmation establishes the relationship

v1.3 uses only seven knowledge types:

1. Responsibility / Task
2. Deadline
3. Contact
4. Process
5. Warning
6. Resource
7. Lesson

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| DOM-01 | User can create an organization with name, institution, and optional logo/description. | P0 |
| DOM-02 | The Organization Owner can create Roles subject to Organization plan limits. | P0 |
| DOM-03 | An active Role Assignment authorizes its holder to create/open the corresponding Organization + Role + service-period workspace; changing the human holder does not change workspace identity. | P0 |
| DOM-04 | A role can retain and open multiple immutable published handoffs across service periods. | P0 |
| DOM-05 | Historical comparison and knowledge lineage are always scoped to the same Organization and same Role. | P0 |

v1.3 has exactly one Organization Owner and one active maintainer per Role/service period. For example, Alex may be Owner + President Role Holder while Jordan maintains Treasurer and Priya maintains Events Lead. All authorized holders benefit from their Organization's plan. Assignment acceptance supports academic-year periods such as `2026–2027`, with short forms normalized to prevent duplicate period identities. Co-maintainers, multiple admins, custom permissions, and Billing Manager are out of scope.

---

# 4. Handoff Lifecycle

A handoff moves through:

**Draft → Review → Preflight → Ready → Published**

Draft is not a one-time graduation form. It remains a usable working space throughout the service period. Publishing is a deliberate snapshot after Review and Preflight; later working-source changes never silently alter an existing publication.

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| HAND-01 | User can create, save, and resume a draft handoff. | P0 |
| HAND-02 | User can add knowledge through voice, typed text, documents, and manual structured entry. | P0 |
| HAND-03 | User can manually edit, reorder, and delete approved knowledge items. | P0 |
| HAND-04 | Publishing requires the handoff to pass through Review and Preflight. | P0 |
| HAND-05 | A Draft Handoff can be reopened throughout the service period to add voice notes, typed notes, new or updated files, and maintain approved contacts, deadlines, processes, warnings, resources, responsibilities, and lessons. | P0 |
| HAND-06 | Publishing creates an intentional immutable recipient snapshot; continued Draft work or source replacement must not silently change a published Handoff. | P0 |
| HAND-07 | A Role Holder normally maintains a living Draft throughout the service period and publishes when preparing to transfer the Role. Earlier publication and deliberate republication are allowed for unexpected transitions; publication is never automatic. | P0 |
| HAND-08 | A replacement in the same Role/service period continues the existing working Handoff, including its approved knowledge, private role Sources/version lineage, pending proposals, Preflight, and publication history. Earlier contributors retain attribution and the ended holder loses current private access. | P0 |
| HAND-09 | A successor starting a new service period receives a separate working Handoff initialized from the latest preceding published Handoff for the same Organization and Role. It carries forward published Responsibilities, Deadlines, Contacts, Processes, Warnings, Resources, and Lessons. | P0 |
| HAND-10 | Carry-forward includes only approved publication knowledge and safe lineage/citation metadata. Rejected/unresolved proposals, private scratch notes, raw private Sources, and knowledge retired or absent from the publication are not inherited as current truth. Inherited items visibly identify the prior period. | P0 |
| HAND-11 | New-period changes never mutate the previous publication. Inherited items preserve cross-period lineage and original attribution; stale inherited facts are maintained through the existing human review/edit/retirement flow. | P0 |

---

# 5. Knowledge Capture

## Voice

Example prompt:

> “Tell Relay how this role actually works. Include responsibilities, deadlines, important people, processes, common mistakes, and anything you wish you knew when you started.”

## Text

Users can type or paste existing notes without using a template.

## Documents

Users can upload common organizational documents.

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| CAP-01 | User can record spoken knowledge and receive an editable transcript. | P0 |
| CAP-02 | User can type or paste free-form knowledge. | P0 |
| CAP-03 | User can upload supported documents such as PDF, DOCX, PPTX, XLSX, text/Markdown/CSV, and common images. | P0 |
| CAP-04 | Original voice/text/document sources remain linked to any knowledge derived from them. | P0 |
| CAP-05 | Capture failures never block manual entry. | P0 |
| CAP-06 | Document UI shows Processing, Ready, or Failed and allows retry after failure. | P0 |
| CAP-07 | Capture may show optional prompts for responsibilities, registration/training, finances, recurring events, advisor/vendor contacts, account/tool access, calendars/deadlines, policies, and lessons/common mistakes without creating new knowledge types or separate operational modules. | P0 |

---

# 6. Document Intelligence & Retrieval

Relay uses managed infrastructure rather than custom document/vector plumbing.

## Architecture

**Unstructured**
- parsing / OCR / layout
- document structure
- typed element extraction with page metadata
- optional table/image enrichment
- asynchronous transform-job orchestration
- structured chunk output for Astra DB ingestion

**Astra DB**
- document and query embedding through the collection's Vectorize integration
- vector retrieval
- lexical/hybrid retrieval where configured
- source chunks and retrieval metadata

**Supabase**
- authentication
- organizations / roles / handoffs
- original source records
- approved canonical knowledge
- published share records
- permissions

**Relay AI**
- structured knowledge proposals
- Preflight reasoning
- grounded answer generation

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| RAG-01 | Uploaded binary or visual documents are processed server-side through Unstructured and indexed in Astra DB. Plain-text, Markdown, and CSV uploads may be decoded directly before Astra indexing because they require no OCR or layout parsing. | P0 |
| RAG-02 | Document-derived retrieval content retains source document and page/section metadata when available. | P0 |
| RAG-03 | Retrieval records are scoped with enough metadata to enforce organization/handoff access before generation. | P0 |
| RAG-04 | Relay does not build a custom parser, OCR stack, semantic chunker, embedding store, or vector index when the managed stack already satisfies the requirement. It may apply bounded text segmentation required by the selected embedding model. | P0 |
| RAG-05 | Table/image enrichment may be enabled later when it materially improves retrieval quality. | P1 |
| RAG-06 | Current working retrieval prefers current Source versions and prevents historical/current versions from producing duplicate active evidence. | P0 |
| RAG-07 | Historical Source versions remain available for provenance and comparison but do not silently affect an already published Ask Relay snapshot. | P0 |

## Source versioning and meaningful deltas

File versioning exists only to improve operational knowledge maintenance. Relay is not a generic document version-control product.

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| SRC-01 | Before expensive processing, Relay calculates a content hash and checks existing document Sources in the same Organization/Handoff. | P0 |
| SRC-02 | If the content hash is identical, Relay does not create another active version, upload/process the file again, or create duplicate retrieval evidence; the user is told the file already exists. | P0 |
| SRC-03 | If bytes differ and filename/type or established lineage strongly indicates a newer version, Relay processes it through the existing ingestion pipeline and links it to the prior Source. | P0 |
| SRC-04 | Ambiguous matches require explicit confirmation such as “This looks like an updated version of RoboFest Budget.xlsx. Treat it as a new version?” Unrelated files are never silently linked. | P0 |
| SRC-05 | A linked Source stores minimal lineage metadata including its predecessor/root, version number, current status, content hash, and match basis. Older versions remain immutable. | P0 |
| SRC-06 | Linked versions are compared using extracted/normalized content rather than binary DOCX/XLSX/PDF bytes. | P0 |
| SRC-07 | Only operationally material added, changed, or removed information is surfaced: responsibilities, contacts, deadlines, procedures, policy requirements, warnings, resources, lessons, and operational budget/resource facts. | P0 |
| SRC-08 | Formatting changes, reordered rows, duplicate wording, synonymous rewrites, and other source churn are suppressed. Closely related changes are grouped where practical. | P0 |
| SRC-09 | Every surfaced delta retains exact old/new evidence where applicable and is converted into a reviewable create, update, or retirement proposal only when its canonical knowledge target is sufficiently grounded. | P0 |
| SRC-10 | Disappearing text never automatically deletes approved knowledge. Removal becomes a reviewable retirement/update proposal. | P0 |

Implementation details such as chunk size, Unstructured processing/pipeline configuration, embedding model, and Astra collection configuration belong in `technical_spec.md`, not this file.

---

# 7. Source Knowledge vs Approved Knowledge

Relay must distinguish **evidence** from **human-approved truth**.

**Source knowledge** may be outdated, incomplete, or wrong.

**Approved knowledge** is what the outgoing leader has explicitly accepted or written manually.

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| KNOW-01 | AI-extracted knowledge starts as Proposed rather than Approved. | P0 |
| KNOW-02 | Every proposal retains source provenance. | P0 |
| KNOW-03 | User can Accept, Edit, or Reject each proposal. | P0 |
| KNOW-04 | Only accepted or manually created items appear as approved canonical knowledge. | P0 |
| KNOW-05 | Rejected proposals never appear in the published handoff. | P0 |
| KNOW-06 | New voice/text/file evidence can propose an update to or retirement of an existing approved Knowledge Item instead of creating a duplicate when the intent is clearly the same. | P0 |
| KNOW-07 | Update/retirement review shows the affected approved item, proposed result, and new evidence before the human decides. | P0 |
| KNOW-08 | Accepting an update changes the existing canonical Knowledge Item rather than creating a competing approved duplicate, while preserving revision history, lineage, and provenance. | P0 |
| KNOW-09 | AI and source processing never automatically mutate, retire, or delete approved knowledge. | P0 |

---

# 8. AI Knowledge Structuring

Example source:

> “Sarah from Facilities handles Engineering Hall. Contact her early because last year we almost lost RoboFest.”

Relay may propose:

**Contact**  
Sarah — Facilities

**Process**  
Reserve Engineering Hall for RoboFest

**Warning**  
Do not leave venue booking too late

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| AI-01 | Relay converts source material into proposed knowledge using the seven v1.3 knowledge types. | P0 |
| AI-02 | Model output is validated against an allow-listed structured schema before it can become product data. | P0 |
| AI-03 | Relay must not invent names, dates, contact details, policies, or procedures absent from evidence. | P0 |
| AI-04 | Uncertain information is surfaced for human review instead of being silently guessed. | P0 |
| AI-05 | User can always add or correct knowledge manually. | P0 |
| AI-06 | Proposal reasoning receives relevant approved Knowledge Items so it can distinguish genuinely new knowledge from a supported correction, replacement, or retirement. | P0 |
| AI-07 | Model-selected update targets and evidence excerpts are independently validated before proposals are stored. Low-confidence targets are rejected or omitted. | P0 |

---

# 9. Handoff Preflight — Signature Feature

Preflight asks:

> **“Could a new person successfully take over this role using what has been documented, without having to guess?”**

v1.3 detects four problem types.

## Missing information

> “Call our printer.”

Preflight:

> **Who is the printer?**

## Ambiguous information

> “Book the hall early.”

Preflight:

> **How early should the next president book it?**

## Incomplete instruction

> “Apply for funding by October.”

Preflight:

> **Where or how should the next president apply?**

## Contradiction

Approved knowledge:

> “Book RoboFest 12 weeks before the event.”

Uploaded policy:

> “Large events require booking 16 weeks ahead.”

Preflight:

> **These instructions do not agree. Which should the successor follow?**

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| PRE-01 | Preflight runs before publication using approved knowledge plus relevant authorized source evidence. | P0 |
| PRE-02 | Preflight can identify missing information. | P0 |
| PRE-03 | Preflight can identify vague or ambiguous operational language. | P0 |
| PRE-04 | Preflight can identify incomplete instructions. | P0 |
| PRE-05 | Preflight can identify apparent contradictions between relevant knowledge/evidence. | P0 |
| PRE-06 | Every finding explains the problem in plain language and shows relevant source context when available. | P0 |
| PRE-07 | Relay asks the human to resolve the issue; it never invents or silently chooses the answer. | P0 |
| PRE-08 | User can Resolve, Edit, Skip, or mark a finding Unknown. | P0 |
| PRE-09 | Preflight reruns after material handoff changes. | P0 |
| PRE-10 | More advanced stale-policy detection remains an extension of Preflight rather than a separate v1.3 subsystem. | P1 |
| PRE-11 | For versioned working Sources, Preflight uses the current version as active evidence and retains historical versions only for provenance/history. | P0 |

---

# 10. Readiness

Readiness is deliberately simple.

Example:

> **Ready to hand off**
>
> 14 approved items  
> 0 unresolved critical questions  
> 2 optional suggestions

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| READY-01 | Relay shows unresolved Preflight findings before publication. | P0 |
| READY-02 | Relay does not present an arbitrary AI completeness percentage as objective truth. | P0 |
| READY-03 | User can publish with optional unresolved findings; critical unresolved findings require deliberate acknowledgement. | P0 |

---

# 11. Preview & Publish

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| PUB-01 | The assigned Role Holder can preview exactly what the incoming recipient will see. | P0 |
| PUB-02 | Published handoff receives an unguessable access link. | P0 |
| PUB-03 | The assigned Role Holder can copy/share the link and display a QR code. | P0 |
| PUB-04 | Published handoff opens in a mobile browser without account creation. | P0 |
| PUB-05 | The assigned Role Holder can revoke a published link without deleting the underlying handoff. | P0 |
| PUB-06 | Draft-only source material is never automatically exposed to recipients. | P0 |
| PUB-07 | A published Handoff snapshots approved knowledge, safe citation metadata, service period, and knowledge lineage without exposing raw Sources or proposals. | P0 |
| PUB-08 | Updating a working Source or approved Knowledge Item never silently changes a prior published snapshot. | P0 |

---

# 12. Incoming Leader Experience

Default information order:

1. **Start Here**
2. Responsibilities
3. Deadlines
4. Contacts
5. Processes
6. Warnings
7. Resources
8. Lessons
9. Ask Relay

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| REC-01 | Shared handoff opens with a concise Start Here section and grouped approved knowledge. | P0 |
| REC-02 | Deadlines are easy to scan and contacts are actionable where shared. | P0 |
| REC-03 | Warnings are visually prominent. | P0 |
| REC-04 | Recipient can browse the handoff without reading every item sequentially. | P0 |
| REC-05 | Published approved content still renders if AI services are temporarily unavailable. | P0 |
| REC-06 | Start Here surfaces immediate transition obligations already present in approved published knowledge, including registration/training, financial closeout, key introductions, upcoming deadlines, and account/tool access steps. It does not invent tasks or become a task manager. | P0 |

---

# 13. Ask Relay

Ask Relay is scoped to the published handoff.

Example:

**Question:**  
“When should I book RoboFest?”

**Answer:**  
“Submit the venue request at least 12 weeks before RoboFest.”

**Source:**  
President Handoff → RoboFest → Venue

Unsupported question:

**Question:**  
“Can we use club funds to buy laptops?”

**Answer:**  
“This handoff does not contain a reliable answer to that question.”

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| ASK-01 | Recipient can ask natural-language questions from the published handoff. | P0 |
| ASK-02 | Retrieval is permission-filtered before evidence is provided to the LLM. | P0 |
| ASK-03 | Ask Relay may use permission-filtered Astra matches to rank immutable published Knowledge Items, but generation is grounded in the publication snapshot and never receives raw/private Source chunks. | P0 |
| ASK-04 | Every factual organization-specific answer includes source references. | P0 |
| ASK-05 | If evidence is insufficient, Relay explicitly says the handoff does not contain a reliable answer. | P0 |
| ASK-06 | Relay must not fabricate organization-specific answers from general model knowledge. | P0 |
| ASK-07 | Ask Relay never modifies approved knowledge. | P0 |

Public internet search is out of scope for Ask Relay v1.3.

---

# 14. Organization Memory

Organization Memory answers one focused historical question for a Role:

> **What materially changed from the previous leadership handoff, and why when we actually know why?**

Approved Knowledge Items and immutable published Handoffs are the authoritative comparison basis. Relay compares adjacent service periods for the same Organization and Role by default, such as `2026–2027 → 2027–2028`.

## Relevant change types

- **Added** — new operational knowledge appears in the later publication.
- **Changed** — confidently equivalent knowledge materially changed.
- **Retired** — prior operational knowledge no longer appears and is confidently understood as retired.
- **Unchanged** — may be stored internally but normally remains hidden.

Material means the difference could affect how the successor performs the role, understands a risk, meets a deadline, contacts someone, uses a resource, or follows a process. Punctuation, formatting, reordered content, duplicated wording, and equivalent rewrites are noise.

## Grounded reason categories

- **Policy-driven change** — approved evidence explicitly establishes that a policy, rule, constitution, regulation, or institutional requirement caused the change.
- **Lesson-driven change** — approved evidence or attributable human confirmation explicitly links a documented Lesson/incident to the resulting practice.
- **Leadership preference** — approved evidence or attributable human confirmation explicitly says leadership chose or preferred the change.
- **Contact/resource change** — the approved evidence directly shows a person, vendor, venue, tool, form, link, or other operational resource changed.
- **Unknown / not established** — Relay can establish the change but cannot reliably establish why.

Chronology is not causality. A 2026 projector failure followed by a 2027 equipment-test process is **not** Lesson-driven unless evidence or a human explicitly links them.

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| MEM-01 | Organization Memory compares only published Handoffs for the same Organization and same Role. | P0 |
| MEM-02 | The default comparison uses the latest adjacent published service periods and allows the owner to open preserved historical Handoffs. | P0 |
| MEM-03 | Relay matches equivalent knowledge across years using existing lineage or conservative same-type/topic/entity evidence. It never forces an uncertain match. | P0 |
| MEM-04 | Low-confidence matches are omitted or require human confirmation rather than being presented as facts. | P0 |
| MEM-05 | The What Changed view normally shows only material Added, Changed, and Retired items and suppresses unchanged/noisy differences. | P0 |
| MEM-06 | Every displayed change allows inspection of the before/after approved knowledge and safe source provenance from the immutable publications. | P0 |
| MEM-07 | Relay never invents a reason for change or infers causality merely because events occurred in sequence. Unsupported reasons display `Unknown / not established`. | P0 |
| MEM-08 | Policy-driven requires explicit approved policy/requirement evidence; human assertion alone cannot relabel a change as policy-driven without that evidence. | P0 |
| MEM-09 | Lesson-driven requires explicit approved causal evidence or attributable human confirmation selecting an approved Lesson and resulting Process, Warning, or Responsibility. | P0 |
| MEM-10 | Leadership preference requires an explicit approved statement or attributable human confirmation that leadership chose the approach. | P0 |
| MEM-11 | Contact/resource change requires directly changed Contact or Resource knowledge. | P0 |
| MEM-12 | An evidence-backed or human-confirmed `Lesson → Process/Warning/Responsibility` relationship is stored explicitly as lineage metadata; AI speculation never creates the link. | P0 |
| MEM-13 | Organization Memory does not rank leaders/years, claim improvement without supplied factual metrics, or expose health, quality, completeness, or performance scores. | P0 |

Organization Memory is a focused learning view, not a generic analytics dashboard.

---

# 15. RevenueCat Monetization

RevenueCat supports the real paid value: preserving continuity across more roles and more years. A human user completes the store purchase, but Relay Pro benefits belong to the selected Organization. RevenueCat determines whether the purchaser's entitlement is active; Supabase records which Relay Organization receives it.

## Free organization

- 1 active role
- 1 current handoff
- voice/text capture
- document upload
- AI structuring
- Preflight
- publish/share
- limited Ask Relay usage
- recipient access always free

An authenticated owner account can create one organization on Free. Creating an additional organization requires an active Relay Pro purchase association, but the new organization does not silently inherit another organization's Pro status.

## Relay Pro

- multiple roles
- additional/current handoffs
- larger AI/document allowances
- historical handoffs
- Organization Memory comparison across adjacent service periods
- future advanced Preflight features

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| MON-01 | A user performs the RevenueCat purchase. RevenueCat remains the source of truth for whether the `relay_pro` entitlement is active, while Supabase stores the association between purchaser/entitlement and one Organization. | P0 |
| MON-02 | A Free organization can complete one genuine end-to-end handoff. Incoming leaders and other published-link recipients never need an account, Relay Pro entitlement, or purchase. | P0 |
| MON-03 | Premium actions identify the Organization needing Relay Pro. Its Owner may upgrade it; a non-owner Role Holder sees that the Owner must upgrade the Organization rather than being asked to buy an individual plan. Recipients are never paywalled. | P0 |
| MON-04 | Relay Pro is an annual subscription positioned around preserving the Organization's knowledge for the academic year. No monthly, lifetime, consumable, or credit plan is offered. | P0 |
| MON-05 | Restore Purchases refreshes RevenueCat customer information, reconciles an unambiguous Organization association without creating duplicates, and refreshes that Organization's plan state. | P0 |
| MON-06 | One Relay Pro subscription unlocks only its associated Organization and must not unlock every unrelated Organization owned by the Purchaser. | P0 |
| MON-07 | Expiration or downgrade returns the Organization to Free without deleting its roles, handoffs, sources, approved knowledge, publications, or institutional history; premium creation may become gated or existing premium data read-only. | P0 |
| MON-08 | Purchaser, Organization Owner, Outgoing Leader, and Incoming Leader are conceptually separate roles; subscription association must not require the Purchaser to remain the Organization Owner. | P0 |
| MON-09 | Minimal explicit-acceptance Organization ownership transfer is P0. It preserves Organization identity, history, Role assignments, handoffs, and active Organization Pro association without transferring the purchaser's App Store/Play Store account. | P0 |
| MON-10 | Living Handoffs and Organization Memory do not introduce add-ons or new subscription products. Relay Pro remains annual-only and Organization-scoped. | P0 |
| MON-11 | One verified `relay_pro` entitlement upgrades one Organization for all authorized Role Holders; there is no per-seat billing or individual `isPro` authorization. | P0 |
| MON-12 | Every protected premium Role action independently checks Role authorization and Organization entitlement server-side. A purchase never grants membership or editing access, including to unrelated Organizations. | P0 |
| MON-13 | Only the current Owner may initiate/attach an Organization purchase. RevenueCat verification and Organization attachment are reconciled atomically against current ownership; existing purchaser refreshes after transfer preserve the established association. | P0 |
| MON-14 | Downgrade preserves memberships, assignments, Roles, Sources, knowledge, publications, and recipient access. Free creation limits remain one active Role and one current Handoff; creating further periods and generating Organization Memory comparisons require Organization Pro. Existing information is retained. | P0 |

Do not build a complex credit/currency system unless actual usage costs later justify it.

---

# 16. Privacy, Security & Trust

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| SEC-01 | Draft sources and handoffs are private by default; published access uses unguessable tokens. | P0 |
| SEC-02 | Authorization is enforced server-side and retrieval is scoped before data reaches the LLM. | P0 |
| SEC-03 | Unstructured, Astra, transcription, and LLM credentials remain server-side and are never exposed in the Expo client. | P0 |
| SEC-04 | Raw source content and generated answers are not logged by default. | P0 |
| SEC-05 | Relay warns users not to store passwords, recovery codes, or private keys as handoff knowledge. | P0 |
| SEC-06 | AI-generated information remains proposed until accepted; AI never silently modifies/retires approved knowledge, resolves contradictions, links unrelated Sources, or changes a published snapshot. | P0 |
| SEC-07 | Relay prefers “I don't know” over unsupported organization-specific answers. | P0 |
| SEC-08 | Historical Source versions, canonical revision history, and internal lineage remain private; recipient access exposes only the safe immutable publication payload. | P0 |
| SEC-09 | RLS and guarded RPCs restrict private reads and writes to the exact active Role Assignment. Owner oversight has no implicit access to raw source content, private files, proposal evidence, or detailed Preflight evidence. | P0 |
| SEC-10 | Invites require authenticated explicit acceptance, expiry and single-use checks, and atomic replacement. Direct membership/admin grants, ownership-field changes, attribution rewrites, and cross-workspace storage references are denied. | P0 |
| SEC-11 | Existing single-owner Organizations migrate in place with active Owner membership and compatible assignments for existing Role-period workspaces. IDs, attribution, publications, and RevenueCat associations remain intact. | P0 |

---

# 17. Design & Accessibility

Reuse the existing polished design system from the previous project wherever practical.

Relay should feel like a calm transition tool, not an AI dashboard.

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| UI-01 | Every primary screen has one obvious next action and clear empty/error/loading states. | P0 |
| UI-02 | Proposed AI content is visually distinct from approved knowledge. | P0 |
| UI-03 | Preflight findings use plain language and citations/source context are easy to open. | P0 |
| UI-04 | Shared handoff is optimized for fast mobile scanning and core controls support accessibility semantics. | P0 |
| UI-05 | AI failure never prevents manual capture, editing, publishing of already-approved content, or reading a published handoff. | P0 |
| UI-06 | Source-version and Organization Memory views emphasize material changes, human decisions, and inspectable provenance rather than scores, activity noise, or AI confidence theater. | P0 |
| UI-07 | Publish is framed as a leadership-transition action. Routine year-round edits save to the working Handoff without publication pressure; reopening a published workspace retains the existing snapshot until deliberate Review/Preflight and republication. | P0 |

No special “AI aesthetic” is required.

---

# 18. Technical Direction

## Client
- Expo / React Native
- Expo Router
- Expo Web for shared handoff

## Product backend
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage
- Supabase Edge Functions or equivalent trusted server layer

## Documents / RAG
- Unstructured API for document parsing, OCR, layout, and chunking
- Astra DB Vectorize for document and Ask Relay query embeddings
- Astra DB managed retrieval
- Supabase Source lineage/current-version metadata controls which indexed evidence is active

## AI
- Groq server-side reasoning with strict structured output
- Groq server-side speech-to-text
- independently validated proposal, source-delta, Preflight, Ask Relay, and Organization Memory outputs

## Monetization
- RevenueCat

### Architectural principle

> **Unstructured owns document transformation. Astra owns retrieval. Supabase owns canonical truth, history, and lineage. Relay owns reasoning and user experience.**

All lower-level provider configuration belongs in `technical_spec.md`.

---

# 19. Shipaton Demo Path

The demo should tell one complete story.

## Scenario

**Organization:** University Robotics Club  
**Outgoing President:** Maya  
**Incoming President:** Alex

### Sequence

1. Early in her term, Maya opens the living Draft President handoff.
2. Maya records:
   > “RoboFest happens in March. Sarah in Facilities handles the hall. Make sure you book it early. Last year we nearly lost the venue.”
3. Relay transcribes it.
4. Relay proposes:
   - Contact: Sarah / Facilities
   - Process: reserve RoboFest venue
   - Warning: do not leave booking too late
5. Maya Accepts/Edits the proposals.
6. Months later, Maya records:
   > “Sarah moved departments. Mike now handles Engineering Hall.”
7. Relay proposes an update to the existing Facilities Contact instead of creating a duplicate; Maya reviews and accepts it.
8. Maya uploads the RoboFest planning guide. Uploading the identical file again is detected without reprocessing.
9. Maya uploads a revised guide. Relay links it as a new Source version, preserves the old version, and surfaces only material operational changes.
10. A changed venue deadline and added sponsor-approval step become reviewable knowledge changes; nothing canonical changes until Maya accepts or edits them.
11. Preflight asks:
   > “You said to book the hall ‘early.’ How early should Alex book it?”
12. Maya answers:
   > “12 weeks before RoboFest.”
13. If source evidence conflicts, Preflight shows the disagreement and asks Maya to resolve it.
14. Maya previews and intentionally publishes the `2026–2027` snapshot.
15. Alex opens the QR/link without an account.
16. Alex sees Start Here obligations, responsibilities, deadlines, contacts, warnings, and resources.
17. Alex asks:
   > “When should I book RoboFest?”
18. Relay answers with the approved instruction and citation.
19. Alex asks:
   > “Can we use club money to buy laptops?”
20. Relay says:
   > “This handoff does not contain a reliable answer.”
21. The Owner separately invites Alex as President `2027–2028`. Alex signs in and accepts, receiving a new workspace seeded from the previous published approved knowledge. Alex maintains it throughout the term and deliberately publishes for the next transition.
22. Organization Memory compares the adjacent President periods and shows grounded material changes such as `Facilities contact: Sarah → Mike` and `Venue booking: 12 weeks → 16 weeks`.
23. Relay labels the contact reason as Contact/resource change. It labels the deadline Policy-driven only if approved policy evidence explicitly establishes the cause; otherwise it says `Unknown / not established`.
24. If Alex confirms that a documented projector failure caused the new equipment-test process, Relay records the explicit `Lesson → Process` relationship. It never infers that relationship from sequence alone.
25. Maya attempts another premium Organization action. RevenueCat identifies University Robotics Club as the Organization being upgraded and retains annual-only Organization scope.

### Demo must prove

- Relay is more than a summarizer.
- Preflight discovers missing knowledge.
- Human approval controls truth.
- A Draft Handoff remains useful throughout the term.
- Voice/text context can update existing approved knowledge without automatic mutation.
- Ask Relay cites evidence.
- Ask Relay refuses unsupported answers.
- Document ingestion is real.
- Exact duplicate files avoid reprocessing; linked versions preserve evidence and surface meaningful deltas.
- Organization Memory compares only the same Role across adjacent published periods.
- Change reasons are grounded or explicitly shown as not established.
- Recipient needs no account.
- RevenueCat gates a logical Organization feature without gating Alex's recipient path.

---

# 20. v1.3 Release Cut Line

The Shipaton build is not complete unless these work:

1. authentication
2. organization
3. role
4. draft handoff
5. voice capture + transcription
6. typed capture
7. document upload + Unstructured/Astra indexing
8. AI structured proposals
9. Accept / Edit / Reject
10. Preflight for missing/ambiguous/incomplete/conflicting information
11. preview
12. publish + revoke
13. no-login mobile web recipient experience
14. Ask Relay
15. citations
16. explicit unsupported-answer behavior
17. RevenueCat Organization entitlement/paywall
18. secure server-side provider credentials
19. manual fallback
20. living Draft Handoff that can be resumed throughout the term
21. voice/text proposals that update or retire existing approved knowledge through review
22. exact duplicate upload detection and conservative Source-version linking
23. normalized meaningful deltas that become reviewable knowledge changes
24. current-version working retrieval without historical duplicate evidence
25. multiple preserved published Handoffs for the same Role
26. adjacent-period Organization Memory with material Added/Changed/Retired results
27. grounded reason categories with `Unknown / not established` fallback
28. explicit evidence-backed or human-confirmed Lesson-to-Practice relationships
29. recipient Start Here obligations derived only from approved publication content
30. independent Organization membership and one active Role Holder per Role/service period
31. authenticated, explicit, single-use assignment invite acceptance and deliberate replacement
32. Owner continuity oversight with private raw-source boundaries
33. same-period workspace inheritance and publication-only new-period carry-forward
34. explicit Organization ownership offer/acceptance preserving purchaser identity and Organization Pro
35. independent server-side authorization and Organization entitlement checks

Do not cut **Preflight, human review, citations, immutable publication snapshots, current-version retrieval, or “I don't know / reason not established” behavior** to make room for secondary features.

---

# 21. P1

Only after the core loop is polished:

- richer table retrieval
- image-description enrichment
- more advanced stale-policy detection
- role archiving
- optional human review for borderline cross-year lineage candidates that Relay currently omits

---

# 22. P2

Post-launch:

- successor feedback-to-update loop
- organization-wide search
- activity/audit-feed UI

---

# 23. Explicitly Out of Scope for v1.3

- social feed
- club discovery
- chat
- elections
- attendance
- member CRM
- generic project management
- calendars, reminders, task management, or notifications
- password storage
- finance, event-management, registration, or training modules
- in-app DOCX/XLSX or Google Sheets editing
- Google Drive, OneDrive, or other live cloud-file synchronization
- generic document version-control features
- generic analytics dashboards or broad year-to-year analytics
- organization health, improvement, leadership-quality, or AI-completeness scores
- leader/year rankings or unsupported claims that an organization improved
- comparisons across unrelated Organizations or Roles
- causal claims without explicit approved evidence or attributable human confirmation
- multiple administrators, co-maintainers, custom permissions, teams/groups/departments, or Billing Manager
- per-seat subscriptions or automatic Role assignment from recipient links
- automatic ownership transfer or invite email/messaging infrastructure
- new subscription products, add-ons, monthly plans, lifetime plans, credits, or consumables
- financial integrations
- autonomous emails/messages
- automatic modification of approved knowledge
- public-web answers inside Ask Relay
- custom vector database
- custom OCR/parser
- custom chunking engine
- custom embedding/index infrastructure
- notification subsystem
- generic AI assistant

---

# 24. Product Rule

Before adding a feature, ask:

> **Does this help capture, structure, verify, transfer, retrieve, or responsibly learn from operational knowledge across the leader's term and transition?**

If not, it does not belong in Relay v1.3.

---

# End
