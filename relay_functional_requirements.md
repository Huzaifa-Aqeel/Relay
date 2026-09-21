# Functional Requirements — Relay

**Version:** 1.2 — Organization-scoped Relay Pro  
**Product:** Relay  
**Category:** Student leadership handoff / institutional memory  
**Target:** RevenueCat Shipaton 2026 — Next Gen Award  
**Platforms:** Expo / React Native owner app + mobile-web successor experience

**Priority:** P0 = must ship · P1 = valuable next · P2 = post-launch

---

# 0. Product Definition

Relay helps student organizations preserve operational knowledge when leadership changes.

The outgoing leader can speak, type, and upload existing material. Relay turns that information into reviewable knowledge and runs a **Handoff Preflight** that finds missing details, vague instructions, incomplete processes, and contradictions before the handoff is published.

The incoming leader receives a focused handoff and can ask grounded questions from the approved knowledge and source material.

## Core promise

> **Your club should not forget how to run when its leaders graduate.**

## Product principle

> **Most AI summarizes what you told it. Relay finds what your successor still needs that you forgot to explain.**

## Core loop

**Capture → Structure → Preflight → Resolve → Publish → Ask**

Any v1 feature that does not strengthen this loop should be excluded.

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

A feature belongs in Relay only if it helps **capture, verify, transfer, or retrieve knowledge during a leadership transition**.

---

# 2. Actors

| Actor | Description |
|---|---|
| **Organization Owner** | Authenticated user who creates and currently manages the organization. |
| **Outgoing Leader** | Creates the role handoff, knowledge, and published share; normally also the Organization Owner in v1. |
| **Incoming Leader** | Reads the published handoff and asks questions without needing an account or paid plan. |
| **Purchaser** | Authenticated user who completes a RevenueCat purchase for a selected organization. The Purchaser and Organization Owner may be the same person in v1, but are conceptually separate. |
| **System** | Processes sources, runs AI, retrieval, and entitlement checks. |

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| ACT-01 | Owners must authenticate to create or edit Relay data. | P0 |
| ACT-02 | Incoming leaders can open and read a valid published handoff without installing Relay or creating an account. | P0 |
| ACT-03 | A recipient can access only the handoff and knowledge explicitly published to that recipient link. | P0 |
| ACT-04 | Purchaser identity, organization ownership, outgoing leadership, and incoming leadership remain separate concepts even when one person fills multiple roles in v1. | P0 |
| ACT-05 | Organization ownership can later transfer without creating a new organization or losing its history, handoffs, or understandable subscription association. | P1 |

---

# 3. Core Domain

Relay uses five primary objects:

- **Organization**
- **Role**
- **Handoff**
- **Source**
- **Knowledge Item**

A Handoff belongs to one Role and may have a service period such as `2025–2026`.

A Source is original evidence such as:
- voice transcript
- typed notes
- PDF / DOCX / PPTX
- spreadsheet
- image

A Knowledge Item is a human-approved fact or instruction derived from one or more sources.

v1 uses only seven knowledge types:

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
| DOM-02 | User can create one or more roles within an organization. | P0 |
| DOM-03 | User can create a handoff for a role and optionally assign a service period. | P0 |
| DOM-04 | A role can retain previous published handoffs over time. | P1 |

v1 assumes one authenticated owner manages the organization. Multi-admin collaboration and the ownership-transfer UI are later work; the data model must not make organization continuity depend permanently on the original purchaser.

---

# 4. Handoff Lifecycle

A handoff moves through:

**Draft → Review → Preflight → Ready → Published**

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| HAND-01 | User can create, save, and resume a draft handoff. | P0 |
| HAND-02 | User can add knowledge through voice, typed text, documents, and manual structured entry. | P0 |
| HAND-03 | User can manually edit, reorder, and delete approved knowledge items. | P0 |
| HAND-04 | Publishing requires the handoff to pass through Review and Preflight. | P0 |

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
| CAP-03 | User can upload supported documents such as PDF, DOCX, PPTX, text/Markdown, and common images. | P0 |
| CAP-04 | Original voice/text/document sources remain linked to any knowledge derived from them. | P0 |
| CAP-05 | Capture failures never block manual entry. | P0 |
| CAP-06 | Document UI shows Processing, Ready, or Failed and allows retry after failure. | P0 |

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
| AI-01 | Relay converts source material into proposed knowledge using the seven v1 knowledge types. | P0 |
| AI-02 | Model output is validated against an allow-listed structured schema before it can become product data. | P0 |
| AI-03 | Relay must not invent names, dates, contact details, policies, or procedures absent from evidence. | P0 |
| AI-04 | Uncertain information is surfaced for human review instead of being silently guessed. | P0 |
| AI-05 | User can always add or correct knowledge manually. | P0 |

---

# 9. Handoff Preflight — Signature Feature

Preflight asks:

> **“Could a new person successfully take over this role using what has been documented, without having to guess?”**

v1 detects four problem types.

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
| PRE-10 | More advanced stale-policy detection remains an extension of Preflight rather than a separate v1 subsystem. | P1 |

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
| PUB-01 | Owner can preview exactly what the incoming leader will see. | P0 |
| PUB-02 | Published handoff receives an unguessable access link. | P0 |
| PUB-03 | Owner can copy/share the link and display a QR code. | P0 |
| PUB-04 | Published handoff opens in a mobile browser without account creation. | P0 |
| PUB-05 | Owner can revoke a published link without deleting the underlying handoff. | P0 |
| PUB-06 | Draft-only source material is never automatically exposed to recipients. | P0 |

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
| ASK-03 | Ask Relay uses Astra retrieval plus approved knowledge as grounding evidence. | P0 |
| ASK-04 | Every factual organization-specific answer includes source references. | P0 |
| ASK-05 | If evidence is insufficient, Relay explicitly says the handoff does not contain a reliable answer. | P0 |
| ASK-06 | Relay must not fabricate organization-specific answers from general model knowledge. | P0 |
| ASK-07 | Ask Relay never modifies approved knowledge. | P0 |

Public internet search is out of scope for Ask Relay v1.

---

# 14. RevenueCat Monetization

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
- future advanced history/Preflight features

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| MON-01 | A user performs the RevenueCat purchase. RevenueCat remains the source of truth for whether the `relay_pro` entitlement is active, while Supabase stores the association between purchaser/entitlement and one Organization. | P0 |
| MON-02 | A Free organization can complete one genuine end-to-end handoff. Incoming leaders and other published-link recipients never need an account, Relay Pro entitlement, or purchase. | P0 |
| MON-03 | Premium paywall appears only when the owner attempts a premium organization action, identifies which Organization will be upgraded, and does not appear in the published recipient path. | P0 |
| MON-04 | Relay Pro is an annual subscription positioned around preserving the Organization's knowledge for the academic year. No monthly, lifetime, consumable, or credit plan is offered. | P0 |
| MON-05 | Restore Purchases refreshes RevenueCat customer information, reconciles an unambiguous Organization association without creating duplicates, and refreshes that Organization's plan state. | P0 |
| MON-06 | One Relay Pro subscription unlocks only its associated Organization and must not unlock every unrelated Organization owned by the Purchaser. | P0 |
| MON-07 | Expiration or downgrade returns the Organization to Free without deleting its roles, handoffs, sources, approved knowledge, publications, or institutional history; premium creation may become gated or existing premium data read-only. | P0 |
| MON-08 | Purchaser, Organization Owner, Outgoing Leader, and Incoming Leader are conceptually separate roles; subscription association must not require the Purchaser to remain the Organization Owner. | P0 |
| MON-09 | A complete Organization ownership-transfer flow remains P1. Transfer must preserve the Organization identity, history, handoffs, and understandable subscription association. | P1 |

Do not build a complex credit/currency system unless actual usage costs later justify it.

---

# 15. Privacy, Security & Trust

### Requirements

| ID | Requirement | Priority |
|---|---|---|
| SEC-01 | Draft sources and handoffs are private by default; published access uses unguessable tokens. | P0 |
| SEC-02 | Authorization is enforced server-side and retrieval is scoped before data reaches the LLM. | P0 |
| SEC-03 | Unstructured, Astra, transcription, and LLM credentials remain server-side and are never exposed in the Expo client. | P0 |
| SEC-04 | Raw source content and generated answers are not logged by default. | P0 |
| SEC-05 | Relay warns users not to store passwords, recovery codes, or private keys as handoff knowledge. | P0 |
| SEC-06 | AI-generated information remains proposed until accepted; AI never silently modifies approved knowledge or resolves contradictions. | P0 |
| SEC-07 | Relay prefers “I don't know” over unsupported organization-specific answers. | P0 |

---

# 16. Design & Accessibility

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

No special “AI aesthetic” is required.

---

# 17. Technical Direction

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

## AI
- Groq server-side reasoning with strict structured output
- Groq server-side speech-to-text

## Monetization
- RevenueCat

### Architectural principle

> **Unstructured owns document transformation. Astra owns retrieval. Supabase owns product truth. Relay owns reasoning and user experience.**

All lower-level provider configuration belongs in `technical_spec.md`.

---

# 18. Shipaton Demo Path

The demo should tell one complete story.

## Scenario

**Organization:** University Robotics Club  
**Outgoing President:** Maya  
**Incoming President:** Alex

### Sequence

1. Maya opens the President handoff.
2. Maya records:
   > “RoboFest happens in March. Sarah in Facilities handles the hall. Make sure you book it early. Last year we nearly lost the venue.”
3. Relay transcribes it.
4. Relay proposes:
   - Contact: Sarah / Facilities
   - Process: reserve RoboFest venue
   - Warning: do not leave booking too late
5. Maya Accepts/Edits the proposals.
6. Maya uploads a planning guide or university event-policy document.
7. Unstructured processing completes.
8. Preflight asks:
   > “You said to book the hall ‘early.’ How early should Alex book it?”
9. Maya answers:
   > “12 weeks before RoboFest.”
10. If source evidence conflicts, Preflight shows the disagreement and asks Maya to resolve it.
11. Maya previews and publishes.
12. Alex opens the QR/link without an account.
13. Alex sees Start Here, responsibilities, deadlines, contacts, warnings, and resources.
14. Alex asks:
   > “When should I book RoboFest?”
15. Relay answers with the approved instruction and citation.
16. Alex asks:
   > “Can we use club money to buy laptops?”
17. Relay says:
   > “This handoff does not contain a reliable answer.”
18. Maya attempts a premium action such as adding another role to University Robotics Club.
19. RevenueCat paywall identifies University Robotics Club as the Organization being upgraded.

### Demo must prove

- Relay is more than a summarizer.
- Preflight discovers missing knowledge.
- Human approval controls truth.
- Ask Relay cites evidence.
- Ask Relay refuses unsupported answers.
- Document ingestion is real.
- Recipient needs no account.
- RevenueCat gates a logical Organization feature without gating Alex's recipient path.

---

# 19. P0 Cut Line

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

Do not cut **Preflight, citations, or “I don't know” behavior** to make room for secondary features.

---

# 20. P1

Only after the core loop is polished:

- multiple historical handoffs per role
- previous-year viewing
- simple “what changed?” comparison
- richer table retrieval
- image-description enrichment
- more advanced stale-policy detection
- role archiving
- organization ownership transfer without replacing the organization or losing its history

---

# 21. P2

Post-launch:

- successor feedback-to-update loop
- multiple admins
- member invitations
- organization-wide search
- cloud-drive connectors
- deadline reminders
- activity/audit-feed UI
- advanced year-to-year analytics

---

# 22. Explicitly Out of Scope for v1

- social feed
- club discovery
- chat
- elections
- attendance
- member CRM
- generic project management
- password storage
- financial integrations
- autonomous emails/messages
- automatic modification of approved knowledge
- public-web answers inside Ask Relay
- custom vector database
- custom OCR/parser
- custom chunking engine
- custom embedding/index infrastructure
- elaborate multi-user permissions
- notification subsystem
- generic AI assistant

---

# 23. Product Rule

Before adding a feature, ask:

> **Does this help capture, verify, transfer, or retrieve knowledge during a leadership transition?**

If not, it does not belong in Relay v1.

---

# End
