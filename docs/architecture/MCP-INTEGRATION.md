# Keep agent access scoped and reviewable

DemonX Circuit's MCP service should expose project knowledge and workflow operations through explicit read and write scopes. An agent can inspect without gaining modification rights. Every modification is a proposal that DemonX stages, validates and presents for user approval; MCP tool annotations and host confirmation are helpful signals but are not the safety boundary.

## Transport and protocol

Start with a local stdio server that accesses the user's selected project. Add Streamable HTTP only for a deliberate remote deployment with authentication, origin validation and per-project authorization. Never expose an unauthenticated local bridge on a LAN address. The current official MCP specification revision researched here is 2026-07-28. Pin the protocol and SDK version and run conformance against named clients (Codex, Claude Desktop and Claude Code) before claiming compatibility. The TypeScript SDK v2 documents 2026-07-28 support; older v1 Stdio transport targets an earlier revision. ([specification](https://modelcontextprotocol.io/specification/2026-07-28), [authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/))

The local feasibility prototype hand-writes an earlier initialize/tools/resources JSON-RPC surface. It demonstrates intended data access only; it is not current-spec conformance. DemonX Forge provides a useful local stdio pattern and read/undo-oriented tool model, but its documented implementation negotiates older protocol versions and has not been tested with genuine AI clients according to its notes. Reuse its onboarding and local-process lessons, not its wire contract unchanged. ([Forge MCP guide](https://github.com/pricklyguy/DemonX-Forge/blob/main/docs/MCP.md), [source](https://github.com/pricklyguy/DemonX-Forge/blob/main/server/src/mcp.ts))

## Tool groups

Read-only tools should include project summary, schematic/component/pin/net inspection, PCB geometry inspection, library search and provenance lookup, design report retrieval, and firmware mapping preview. Each response includes project/revision, engine/version, source file and confidence. A later suggestion tool may review calculations and component suitability, but it must cite datasheets or rule definitions and mark assumptions.

Write-capable tools should propose component/library changes, net edits, placements, manufacturing exports and ESPHome files. Their outputs create staged artifacts only. A separate approval action applies a displayed diff after required ERC/DRC or schema checks pass; a rollback action restores the recorded revision. Export tools write to a new, deterministic staging directory by default. Upload/deployment requires a separate explicit action and target confirmation.

Tools should be narrowly scoped: `circuit.inspect_project`, `circuit.inspect_nets`, `library.search`, `library.import_preview`, `design.propose_change`, `design.validate`, `design.approve_change`, `manufacturing.export_preview`, `firmware.generate_preview`, and `firmware.validate`. Do not give an AI an unrestricted shell, arbitrary file path, generic G-code, credential read, or direct device upload tool.

## Validation, approval and audit

Every proposal has a transaction ID, base revision, patch or generated artifact, affected objects, validation results and content hash. Reject stale-base changes or require a new preview. User approval applies only to the displayed patch and scope. Keep audit records local and redact secrets; allow undo/rollback to a previous known-good snapshot. ERC/DRC findings and ESPHome validation are evidence about syntax/rules, not certification that electrical behavior is safe.

MCP's human-control guidance does not enforce these guarantees on behalf of Circuit; clients differ in how they display or confirm calls. Circuit owns the gates and denies unapproved writes irrespective of host UI. For remote HTTP, implement the current supported authorization flow and access policy; stdio credentials, if needed, come from environment or OS secret storage. ([MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization))

## Conclusion

The first public MCP milestone should remain read-only and prove two named clients can inspect an actual native project. Add staged writes only after the transaction, validation, approval, audit and rollback path works through the product UI.
