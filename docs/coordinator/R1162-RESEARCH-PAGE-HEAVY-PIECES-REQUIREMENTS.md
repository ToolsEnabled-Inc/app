# R1162 research page — reconciled workbench requirements

## Status and purpose

This document supersedes and reconciles the earlier R1162 “heavy, swappable pieces” requirements with the owner’s research-pipeline vision. It is a requirements reconciliation, not a build-ready specification. This cycle must not build the heavy research pieces or the pipeline; a separately scoped design pass must make the decisions and produce the contracts below before implementation is queued.

## Retained visual and product foundation

- Keep the approved research visual foundation: bare text, hairlines, brace-framed context, square corners, and the existing professional research register.
- Research retains its dedicated fixed black-and-white theme. It is intentionally distinct from the application’s white/tan/black surface themes; its theme treatment must be clearly scoped so the global switcher is not misleading.
- Home and the established Metrics surface remain locked. Research may reuse their interaction conventions and the movable-module/layout-persistence pattern by reference, but must not redesign or alter either surface.
- Research is progressively disclosed. A reader can orient on a simple first depth; specialized controls, telemetry, provenance, and review material unfold only when a researcher needs them.

## Reframed objective

The heavy swappable pieces are not the endpoint and are not merely visual result cards. They are workbench and presentation modules within one end-to-end experiment pipeline: formulate or select an experiment, launch it, observe live execution, interrogate evidence, conduct independent adversarial and literature checks, and produce accountable reports or drafts. Modules remain movable/customizable, but each must correspond to a real pipeline stage and real data contract rather than invented dashboard content.

## Required future capabilities

### Experiment workbench

- Launchable experiments begin from the research page through an explicit, permission-gated action. “Hash” is only an owner shorthand for now, not an approved technical trigger or identifier.
- Runs require durable identity, project scope, immutable configuration/version information, launch authorization, lifecycle state, cancellation, and a rollback/cleanup policy.
- Live telemetry is streamed or incrementally observed during execution. It must distinguish live facts, delayed/stale facts, unavailable telemetry, and simulated/demo material; it must never turn absence into a successful run.

### Data, provenance, and safety contracts

- Each module must declare the source contract, freshness/window, schema version, units, run identity, and provenance of every displayed substantive value.
- Input datasets, configurations, model/tool versions, prompts where permitted, artifact hashes/locations, and transformations must be traceable enough to reproduce or honestly qualify a claim.
- Failed, partial, cancelled, unauthorized, and rolled-back work must be explicit states with retained audit evidence; a partial lower bound or incomplete result may not be styled as a completed conclusion.
- Data retention, export, redaction, and access decisions are prerequisites, not presentation details.

### Independent review and literature

- A completed experiment enters adversarial independent review: reviewers must be meaningfully independent, tasked to falsify claims, and able to surface dissent rather than collapse it into a consensus summary.
- The workbench must expose the claim under review, evidence considered, review status, counterarguments, unresolved dissent, reviewer provenance, and final disposition.
- Literature cross-checking uses real source retrieval and verified citations. It must record what was checked, citation verification status, date/access limitations, contradictions, and missing evidence. Fabricated or unverified citations are prohibited.
- Report and draft generation consumes identified run evidence plus its review/literature status and clearly labels drafts, qualifications, citations, and outstanding dissent.

### Settings and permissions

- Pipeline capability is enabled per user and per project, not by one global switch. It must support owner personal-use enablement without implicitly authorizing other users/projects.
- Settings need progressive disclosure, auditable grants, least-privilege defaults, revocation, cancellation authority, and clear status at the point of a consequential action.

## Domain and discovery boundary

LLMBenchmarking remains behind the established R198 authorization boundary. This document neither reads nor expands that repository’s contents, and future work must preserve the existing `needsOwnerAuthorization`/fail-closed behavior until separately authorized. RAG-bench and QuantConnect discovery are a separately authorized and scoped future lane; do not infer their locations, source shapes, or permissions from their names.

“Robinhood legend” is unresolved. Do not guess or invent a legend from that phrase. A future design pass must obtain owner clarification, or perform an explicitly authorized MarkIV design/source inspection, before treating it as a design requirement.

## Decisions and prerequisites for the future design pass

1. Owner clarifies the experiment-launch interaction and the unresolved Robinhood legend reference.
2. A bounded architecture decision names the compute dispatcher/runner, its trust boundary, cancellation semantics, and resource/cost controls.
3. Telemetry transport, event schema/versioning, ordering, retention, and stale/offline behavior are designed and testable.
4. Per-user/per-project authorization, settings model, audit trail, and data-classification/redaction rules are approved.
5. The independent-review protocol defines reviewer independence, dissent preservation, escalation, and claim-disposition semantics.
6. The literature integration defines allowed sources, retrieval, citation verification, attribution, and failure behavior.
7. Report/draft outputs, storage/access policy, and provenance/citation rendering are specified.
8. R198-safe source discovery and any RAG/QuantConnect lane are explicitly authorized before domain-specific module design starts.

## Requeue and acceptance criteria

Requeue a design pass only when the prerequisites are owned and a bounded deliverable is named. It is accepted when it produces: a sequenced experiment state machine; explicit contracts for launch, telemetry, provenance, review, citations, drafts, settings, cancellation, and rollback; domain-safe module definitions; authorization/data-flow diagrams; failure and partial-state UX; and a test/observability plan. A later implementation cycle is accepted only when it uses real authorized sources, launches no hidden work, renders live/partial/cancelled/unavailable states honestly, preserves dissent and verified citations, enforces per-user/per-project permissions, and leaves Home, Metrics, the R198 boundary, and the fixed research theme intact.
