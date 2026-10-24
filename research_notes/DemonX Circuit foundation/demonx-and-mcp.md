# DemonX ecosystem and MCP notes

Research date: 2026-10-23. Sources reviewed: official public DemonX repositories via GitHub API, official EasyEDA Std file-format documentation/repository, and the current MCP specification and SDK documentation. The local `DemonX-Circuit` checkout was empty at inspection; source review was against the owner's GitHub repositories, not a local build.

## DemonX repositories and integration surfaces

| Repository | Evidence | Relevance / caveat |
|---|---|---|
| [DemonX CNC](https://github.com/pricklyguy/DemonX) | README describes Node + TypeScript GRBL controller/server, React/Vite client and separate Design surface. Main README lists PCB mode, Z probing/autolevel and Home Assistant MQTT integration. README timestamp in GitHub snapshot: 2026-10-20. | This is the CNC controller and machine workflow; it is not a Gerber parser or PCB CAM. Browser clients share a server-owned machine connection. GPL-3.0-or-later licensing is stated in README. The CNC app's tested controls and safety protections are relevant to a manufacturing handoff, but should not be bypassed with direct/unreviewed G-code. |
| [DemonX Forge](https://github.com/pricklyguy/DemonX-Forge) | Tree includes `server/src/mcp.ts`, `docs/MCP.md`, `server/test/mcp.test.ts`, `e2e/mcp.mjs`; it already offers tools to inspect a design, list/run commands, measure, screenshot, set parameters, undo and redo. | Reuse its existing MCP onboarding and local-process design as a pattern. Forge works in mm, Z up. Existing MCP is a local stdio bridge to `http://127.0.0.1:8120`; it cannot open/save/export files or initialize a new design, and the Forge process refuses file commands. README/docs explicitly say genuine Codex/Claude client testing was not yet performed. |
| [gerber_to_vectric](https://github.com/pricklyguy/gerber_to_vectric) | Python source `script/dxf_script.py` (40,953 bytes; 1,183 lines), `requirements.txt`, README, MIT license. Pinned requirements `ezdxf==1.4.3`, `shapely==2.1.2`. Recent visible source commits are 2026-04-17. | This is the actual existing Gerber-to-DXF converter. GUI and CLI entry points; Windows instructions exist; Linux support is explicitly “Coming soon.” Good candidate to adapt only after tests establish units, handedness, geometry and edge cases. It is not yet a reliable general-purpose CAM engine. |

### Converter source findings

The README and implementation support top and bottom copper Gerber, an outline layer, and Excellon drill files. File auto-detection recognizes common extensions/names (`GTL/TOP/CMP`, `GBL/BOT/SOL`, `GKO/GM1/GML`, `DRL/TXT/XLN`). Output is a layered R2010 DXF: `TOP_COPPER`, `BOTTOM_COPPER`, `DRILLS`, `BOARD_OUTLINE`. Gerber traces are buffered to polygons with Shapely at aperture width (or fallback width); circular, rectangular and obround apertures are modeled; copper regions are optional; drill holes are emitted as circles.

Important limitations visible in code (not only README):

- The parser is explicitly “lightweight”; it handles a subset of RS-274X commands and does not implement circular interpolation (G02/G03), aperture macros, step-repeat, full polarity/compositing behavior or all valid Gerber constructs. Non-circular aperture flashes are approximated only for the supported circle/rectangle/obround types.
- Excellon format inference defaults to 2.4 and guesses precision from coordinate digit count; its retry heuristic only tries 2.3. It does not fully interpret all Excellon format/zero-suppression conventions. This can silently scale/shift drill data.
- The converter reads dimensions as mm internally but does not visibly set DXF `$INSUNITS`; importing CAM software must be checked for unit assumptions and coordinate alignment.
- Drill coordinates are not transformed/mirrored relative to copper. No board-origin selection, panel transform, top-vs-bottom mirroring, tool assignment/export policy, or CNC toolpath is performed. The DXF is geometric layer output, not isolation milling or G-code.
- `isolation_offset` is stored but unused in geometry generation. Although the GUI presents “Generate isolation contour layers,” `finalize_copper()` contains the comment “leave isolation OFF for now until copper is stable”; this checkbox currently does not deliver its advertised isolation geometry.
- The design is aimed at simple one/two-layer hobby and through-hole jobs. The README warns that copper pours, region-heavy layouts and unusual Gerber cases may be problematic and says imported geometry must be verified before cutting.

The app's current default GUI fallback trace width is 1.25 mm (the lower-level processing function also defaults to 1.25 mm); that is dangerously wide as an implicit fallback for arbitrary fine-pitch copper. Any integration must either fail closed when trace width cannot be resolved or require an explicit user-confirmed value. Dependency versions are pinned by the converter repo; check their current upstream release and license in the dependency inventory before repackaging.

**Recommended handoff:** generate a complete, unmodified manufacturing export set from the EDA engine (Gerber layers + drill + outline, plus metadata/manifest with units, origin, board side and layer mapping). Keep the converter as an optional CNC-prep operation on selected Gerbers. Validate converted DXF extents and layer entities against the board outline and drill coordinates before showing it as ready. Do not represent the current converter as a replacement for Gerber X2/Excellon export, a DRC, CAM clearance verification, or CNC toolpath generation.

## Existing Forge MCP implementation and interoperability

`DemonX-Forge/server/src/mcp.ts` implements newline-delimited JSON-RPC over stdio directly, without an MCP SDK dependency. It advertises nine tools in source and the e2e script expects nine. The source's supported protocol versions are `2025-06-18`, `2025-03-26`, and `2024-11-05`. `docs/MCP.md` describes the server as local-only and not reachable from Claude web/ChatGPT hosted MCP without HTTPS; it warns not to expose the unauthenticated Forge HTTP API publicly. The bridge's allowed operations are routed to Forge's local API, which enforces modelling-only commands. Its e2e (`e2e/mcp.mjs`) starts the bridge as a child process, uses a real browser and Forge engine, exercises add-hole/model/screenshot/measure/undo, and checks that file access and an invalid operation are refused. The repo doc says actual Claude/Codex clients had not been tested. These are source-defined tests, not tests rerun during this research.

As of the research date, the [current official MCP specification revision is 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28). Its overview defines MCP as JSON-RPC-based host/client/server interoperability and server tools, resources and prompts. Compared with Forge's explicit legacy initialization negotiation, 2026-07-28 introduces `server/discover`, per-request protocol/capability metadata, and a stateless request model; a server that only implements the 2025-era handshake will interoperate with many existing clients but does not yet implement the latest revision. MCP specification/tool listing does not guarantee every host exposes/approves every tool identically. Tool confirmation UX is host-specific; the spec recommends human control and confirmation and does not itself enforce user approval. Circuit must therefore enforce its own read-only vs write tool split, transaction preview, permission scopes, validation, audit, approval and rollback.

For HTTP remote use, MCP's [authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) says HTTP servers SHOULD use the OAuth-based MCP authorization flow when supporting auth, while stdio servers SHOULD obtain credentials from the environment instead. Keep a local stdio server as the simplest client launch path; add Streamable HTTP for deliberate remote/server deployments only with Origin validation, authentication, per-project authorization, and approval. Never bind an unauthenticated loopback bridge on a LAN address.

The official [TypeScript SDK v2 documentation](https://ts.sdk.modelcontextprotocol.io/) indicates 2026-07-28 support in v2, while v1 implements 2025-11-25 and does not plan the latest revision. SDK transition caveat: connecting a hand-built MCP server directly to the old `StdioServerTransport` still speaks the 2025-era wire protocol; modern serving uses the v2 `serveStdio` entry point. Pin SDK and protocol expectations and test with named clients (Codex, Claude Desktop, Claude Code) rather than claiming generic “MCP compatible” after only testing an ad-hoc JSON-RPC script. The spec presents server tools as model-controlled and recommends the human be able to deny calls; approval must remain host/application responsibility.

## EasyEDA Standard component recovery

Recovery is feasible when a user has exported/downloaded EasyEDA Standard source. EasyEDA's official [Std format repository](https://github.com/easyeda/easyeda-std-file-format) states that the format is open JSON and documents schematics, PCB, symbol libraries and footprint libraries; listed `docType`s include schematic (1), symbol (2), PCB (3), footprint (4), and multi-sheet schematic project (5). The official [EasyEDA document-format manual](https://docs.easyeda.com/en/DocumentFormat/EasyEDA-Document-Format/index.html) documents shape delimiters, component/pin/wire/net data and states that schematic-symbol/subpart files share a format, while PCB and package/footprint use a common object format. Official [export instructions](https://docs.easyeda.com/en/Export/Export-EasyEDA-Source-File/index.html) describe “EasyEDA File Source” and downloading a project ZIP containing source files.

Practical route: import the user's **local exported JSON** using a versioned importer into an owned native component model, preserve source/origin/licence/provenance and original JSON as a dependency/backup, and export to the new library format. Build fixture-based round-trip and pin-number/geometry validation. Don't depend on undocumented cloud URLs or proprietary account access. The parser needs explicit Standard-vs-Pro version detection: EasyEDA Pro v3 is a different format, and its official guide says Pro V3 does not export Standard format; import/export compatibility is lossy/constrained. EasyEDA Std JSON being readable does not establish the right to republish vendor or user library records; keep the license of each imported library separate from the parser/library file format, get user authority, and mark unknown provenance before community redistributing.

## Evidence and remaining gaps

- Direct code inspection supports converter scope and the Forge MCP capabilities/limitations above. GitHub source-repo snapshot confirmed repository names and default branches; local checkout was empty, so no compilation or operational tests were possible here.
- Forge has a documented/e2e-probed path for stdio MCP, but not latest 2026 MCP revision nor real AI client conformance evidence.
- Converter has no visible automated test directory in repo root and I did not run it. Need curated Gerber/Excellon fixtures (RS-274X versions, metric/inch, leading/trailing zero suppression, apertures/macros, arcs, pours, PTH+NPTH, mirrored bottom) and geometry comparison tests before CNC handoff.
- No direct current machine demonstration of converter DXF in VCarve or DemonX CNC was performed. Need inspect/confirm alignment, `$INSUNITS`, arcs/closed board outline, drill mapping, and exported geometry in real consuming software.
- Need confirm the current exact MCP SDK release/license/version against pinned dependency data when selecting an implementation, and verify supported clients at release time.

## Primary references

- [DemonX CNC source and README](https://github.com/pricklyguy/DemonX)
- [DemonX Forge MCP guide](https://github.com/pricklyguy/DemonX-Forge/blob/main/docs/MCP.md)
- [DemonX Forge MCP bridge source](https://github.com/pricklyguy/DemonX-Forge/blob/main/server/src/mcp.ts)
- [DemonX Forge MCP e2e](https://github.com/pricklyguy/DemonX-Forge/blob/main/e2e/mcp.mjs)
- [Gerber-to-DXF source](https://github.com/pricklyguy/gerber_to_vectric/blob/main/script/dxf_script.py)
- [Gerber-to-DXF README](https://github.com/pricklyguy/gerber_to_vectric/blob/main/README.md)
- [EasyEDA Standard format spec repo](https://github.com/easyeda/easyeda-std-file-format)
- [EasyEDA Standard export guide](https://docs.easyeda.com/en/Export/Export-EasyEDA-Source-File/index.html)
- [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/)
