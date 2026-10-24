# DemonX Circuit repository instructions

## Product priorities

- Build an approachable, beginner-first electronic design workflow. Prefer simple actions and staged milestones over feature parity with professional EDA tools.
- Keep projects, native files, and component libraries user-owned, locally accessible, portable, exportable, and restorable without a proprietary cloud account.
- Support Windows and Linux. Keep operating-system-specific setup isolated and document tested versions.
- Prefer native, documented upstream APIs and CLI contracts. Gate version-sensitive behavior and label undocumented interfaces as risks.
- Pin tool and dependency versions; keep builds reproducible and avoid unnecessary dependencies or automatic CI costs.

## Evidence and engineering claims

- Do not claim a schematic, PCB, firmware configuration, manufacturing export, or handoff is verified unless the relevant real tool was executed and its results were inspected.
- Never present simulated, stubbed, or inferred success as a real check. Record command, version, platform, exit code, reports, and limitations.
- AI output is a suggestion. Preserve assumptions and provenance; do not call recommendations engineering verification.
- Do not suppress or disable ERC/DRC rules merely to obtain a passing result. Record unresolved warnings and violations.

## Project, library, and file safety

- Preserve native EDA project files and component dependencies in portable formats. Record per-asset provenance and licensing.
- Before replacing an existing user file, make a non-overwriting backup, show a meaningful diff, and obtain explicit approval. Refuse replacement if backup or comparison fails.
- Keep credentials outside version control, AI context, ordinary logs, and component-library exports.
- MCP read-only operations must remain available independently of write privileges. Stage writes, validate them, require approval, and preserve rollback information.
- Do not deploy firmware or modify external Home Assistant instances without explicit approval.

## DemonX Suite and repository boundaries

- Keep all Circuit work within this repository and its dedicated feature branch. Do not modify other DemonX applications or copy their implementation without review.
- Integrate with Forge and CNC through documented, versioned handoff data. Preserve units, origin, orientation, and source revisions.
- Never merge automatically to `main`; avoid unrelated refactoring.

## Development workflow

- Work in small, testable milestones. Run the relevant real checks before reporting completion and state untested platforms clearly.
- Keep installation instructions and verification commands current with pinned versions.
- Add subsystem-specific `AGENTS.md` files only when a subsystem has materially different requirements from this file.
