# EDA foundation research notes

**Evidence cut-off:** 2026-10-23 (client date). Sources are official project repositories, release pages or documentation. “Confirmed” means directly stated there; missing claims are marked unknown.

## Current stable versions and source health

| Project | Stable version and maintenance evidence | License / redistribution | Windows / Linux |
|---|---|---|---|
| **KiCad** | Source tags show stable **10.0.7** dated 2026-10-06; 10.0.0 shipped 2026-03-19. Active 10.0 patch tags in 2026; source mirror has 90k+ commits. [Tags](https://gitlab.com/kicad/code/kicad/-/tags), [source mirror](https://github.com/KiCad/kicad-source-mirror). | Most source GPL-3.0-or-later; bundled third-party code has varied licenses. KiCad says combined binary redistribution is GPLv3-or-later. File-level SBOM and notices still needed. [LICENSE.README](https://github.com/KiCad/kicad-source-mirror/blob/master/LICENSE.README) | Official Windows and Linux releases/build support. [Downloads](https://www.kicad.org/download/), [build docs](https://dev-docs.kicad.org/en/build/). |
| **LibrePCB** | **2.1.1**, released 2026-06-12; official release directory includes Windows, Linux and source packages. App repo has 4,474 commits and activity into Oct. 2026. [Release notes](https://librepcb.org/blog/), [release files](https://download.librepcb.org/releases/2.1.1/), [repo](https://github.com/LibrePCB/LibrePCB). | App GPL-3.0. Each library repo needs its own license review; official Base library is listed CC0. [License](https://github.com/LibrePCB/LibrePCB/blob/master/LICENSE.txt), [library organization](https://github.com/LibrePCB-Libraries). | Project states Windows/Linux/macOS; official packages include Windows and Linux. [Repo](https://github.com/LibrePCB/LibrePCB), [release files](https://download.librepcb.org/releases/2.1.1/). |
| **Horizon EDA** | GitHub lists **2.7.2 “Mirage”** as Latest. Release page exact calendar date not exposed in rendered source: date unknown. Source/docs repositories remain available; release cadence/support SLA unclear and less active/evident than KiCad/LibrePCB. [Releases](https://github.com/horizon-eda/horizon/releases), [repo](https://github.com/horizon-eda/horizon), [docs](https://github.com/horizon-eda/horizon-docs). | App GPL-3.0; bundled components include GPLv2/GPLv3 and permissive licenses. Whole app redistribution should be treated as GPLv3 with notices/source obligations. [README/dependencies](https://github.com/horizon-eda/horizon), [license](https://github.com/horizon-eda/horizon/blob/master/LICENSE). | README says Linux and Windows. Official install/build docs available. [README](https://github.com/horizon-eda/horizon), [installation](https://github.com/horizon-eda/horizon-docs/blob/master/installation.rst). |
| **Fritzing** (limited alternative) | Source has 2026 PR activity; GitHub release page mixes development and stable builds, so exact latest stable should be verified against official downloads. [Releases](https://github.com/fritzing/fritzing-app/releases), [download](https://fritzing.org/download/), [PRs](https://github.com/fritzing/fritzing-app/pulls). | App GPLv3; part designs/docs CC BY-SA 3.0; keep code and library asset obligations separate. [README](https://github.com/fritzing/fritzing-app). | Current project docs cover Windows and Linux. [Build docs](https://github.com/fritzing/fritzing-app/wiki/1.-Building-Fritzing), [Linux notes](https://github.com/fritzing/fritzing-app/wiki/1.3-Linux-notes). |

## Architecture and technical capabilities

### KiCad

- **Native project:** editable files include .kicad_pro, .kicad_sch, .kicad_pcb, .kicad_sym, .kicad_mod, project library tables, and more. S-expressions are inspectable but edits must use version-aware parsers/writers. [10.0 documentation](https://docs.kicad.org/10.0/en/).
- **Libraries:** symbol, footprint and 3D model libraries are separate; project/global configuration supports them. Official repositories: [symbols](https://gitlab.com/kicad/libraries/kicad-symbols), [footprints](https://gitlab.com/kicad/libraries/kicad-footprints), [3D packages](https://gitlab.com/kicad/libraries/kicad-packages3D). Mature broad ecosystem; exact part count not assessed. Each library repository has a separate license.
- **Programmatic APIs:** documented kicad-cli supports schematic ERC, PCB DRC, Gerber/drill/STEP and BOM/netlist automation. Pcbnew Python API is documented with board/object access. [CLI 10.0](https://docs.kicad.org/10.0/en/cli/cli.html), [Python API](https://docs.kicad.org/doxygen-python-10.0/). The Python interface reflects internal objects and is tied to installed build; no version-independent remote editing API promise found. CLI is the safer supported boundary, but version-gate it. No equivalent documented Eeschema Python editing API found.
- **ERC/DRC:** CLI reports violations; ERC supports JSON and violation exit code. [CLI](https://docs.kicad.org/10.0/en/cli/cli.html).
- **Manufacturing/3D:** Gerber plots; drill output supports Excellon or Gerber X2. STEP export supports board-only and assembly models, origin choices and virtual component filtering. [CLI](https://docs.kicad.org/10.0/en/cli/cli.html), [PCB drill docs](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html). Source docs identify Gerber X2 and Excellon writers. [Source documentation](https://docs.kicad.org/doxygen/).
- **MCP:** No official KiCad MCP server surfaced in upstream source/docs search. Third-party tools would not be upstream-supported; verify separately if considering one.

### LibrePCB

- **Native project/model:** text-based project and semantic library model (component, symbol, device, package, footprint); project files .lpp/.lppz. Native format is project-owned/versioned. [Developer docs](https://librepcb.org/docs/dev/), [user docs](https://librepcb.org/docs/).
- **Libraries:** local workspace/project libraries; users can create and manage elements. Official Base library listing says CC0, but third-party asset licensing varies. [Libraries](https://github.com/LibrePCB-Libraries).
- **Automation:** official librepcb-cli opens projects, runs ERC/DRC and executes configured output jobs; useful for CI. This is not a general editing API; direct changes depend on native format and schema. [Official manual](https://librepcb.org/docs/librepcb-documentation.pdf).
- **Checks/outputs:** manual example runs ERC, DRC and production output jobs producing Gerber/Excellon files. Public evidence did not confirm Gerber X2 or assembled STEP output for 2.1.1; mark unknown. 2.1 release notes confirm 3D visualization/shading, which is not STEP assembly export. [CLI manual](https://librepcb.org/docs/librepcb-documentation.pdf), [2.1 notes](https://librepcb.org/blog/2026-05-19_release_2.1.0/).
- **MCP:** no official integration surfaced in upstream repo/docs.
- **Fit:** strongest native UX and library ownership story, with promising CLI. Before selecting as engine, test project fixture, component coverage, STEP availability and unattended modification limits. Embedding its canvas/branding implies significant work.

### Horizon EDA

- **Architecture/format:** C++, Gtkmm3, OpenGL, JSON on-disk data, UUID references. Unified editors cover parts, symbols, packages and boards. [README](https://github.com/horizon-eda/horizon).
- **Libraries:** pool-based model with project pools and library manager. [Official docs index](https://github.com/horizon-eda/horizon-docs).
- **Programmatic use:** docs include CLI usage, Python and parameter programs. JSON allows inspection, but writes depend on schema/UUID invariants. No version-stable editing API guarantee found. [CLI docs](https://github.com/horizon-eda/horizon-docs/blob/master/cli-usage.rst), [Python docs](https://github.com/horizon-eda/horizon-docs/blob/master/python.rst), [parameter programs](https://github.com/horizon-eda/horizon-docs/blob/master/parameter-programs.rst).
- **Checks/exports:** README claims rule-based DRC and schematic-to-Gerber workflow. Exact ERC scope, Gerber X2/Excellon options and STEP assembly export not confirmed by evidence gathered; source/manual spike needed. [README](https://github.com/horizon-eda/horizon), [feature docs](https://github.com/horizon-eda/horizon-docs/blob/master/feature-overview.rst).
- **MCP:** no upstream MCP found.
- **Fit:** JSON and cohesive model are attractive, but smaller ecosystem and unclear release cadence increase maintenance/library risk. Its use of KiCad-derived router also carries inherited license considerations.

### Other open-source candidates

**Fritzing** is an approachable three-view schematic/breadboard/PCB editor with editable SVG/FZP part assets, a parts repository, Gerber export and documented server mode. [Part format](https://github.com/fritzing/fritzing-app/wiki/2.1-part-file-format), [server mode](https://github.com/fritzing/fritzing-app/wiki/3.1-Running-fritzing-as-a-server). It is useful for recovering/migrating simple assets and beginner workflows, but evidence did not show it as a full electrical/PCB rule-checking engine or STEP assembly backend. Not recommended as core engine.
No other candidate met the combined need for active stable Windows/Linux releases, editable semantic project, mature libraries, documented CLI ERC/DRC, and fabrication/STEP handoff better than the three requested options.

## Implementation approaches

| Approach | Benefits | Risks / assessment |
|---|---|---|
| **Fork/customize EDA** | Full canvas and engine already exist; deep workflow/UI patching possible. | Upstream divergence and GPL obligations; UX work entangles DemonX with internal APIs. Do not fork at checkpoint. |
| **DemonX UI + existing EDA engine** | Keep familiar native editor intact while DemonX adds wizard, MCP, staged edits, checks, manufacturing, Forge and ESPHome flow. | Process orchestration and per-engine adapters; initial prototype can launch native editor instead of embed canvas. **Recommended.** Start KiCad 10.0.x through documented CLI; preserve native files. Keep LibrePCB as a serious alternate adapter test. |
| **New EDA from selected libraries** | Full brand, UX, MCP safety and shared project format control. | Reimplement semantic editing, robust ERC/DRC, routing, manufacturing and 3D reliability; high risk. Build DemonX workflow/manifest/MCP layer first, not a complete new engine. |

## Recommendation and unverified assumptions

**Prototype recommendation:** DemonX-owned workflow/UI and MCP service over a versioned engine adapter, initially using KiCad 10.0.x via kicad-cli for supported ERC/DRC, fabrication and STEP output. Preserve native KiCad projects as user-editable assets. Parse normalized information from CLI outputs and versioned formats; stage all writes with backup, validation and explicit approval. Do not promise API compatibility across engine versions. Keep adapter boundaries and compare LibrePCB CLI on a fixture before locking the engine.

Evidence for KiCad: current active stable, Windows/Linux distribution, broad official libraries, editable project format, documented CLI, actual ERC/DRC, Gerber X2/Excellon and STEP paths. This is a prototype foundation choice, not an endorsement of KiCad as final DemonX UI. Bundling/redistributing KiCad executables or derivatives invokes GPL and third-party notice/source obligations; have counsel assess exact packaging/linking. Separately installed executable invocation reduces coupling but does not replace legal review.

**Unknown / requires prototype test:** real library breadth and license compatibility of selected parts; pcbnew API stability; any upstream MCP; EasyEDA Standard recovery compatibility; CNC isolation quality and coordinate correctness; Forge STEP model units/orientation/heights; Horizon's exact latest release date and STEP support; embedding any native editor canvas.

## Primary URLs

- KiCad tags: https://gitlab.com/kicad/code/kicad/-/tags
- KiCad CLI: https://docs.kicad.org/10.0/en/cli/cli.html
- KiCad 10 manual: https://docs.kicad.org/10.0/en/
- KiCad Python API: https://docs.kicad.org/doxygen-python-10.0/
- KiCad license: https://github.com/KiCad/kicad-source-mirror/blob/master/LICENSE.README
- KiCad libraries: https://gitlab.com/kicad/libraries/kicad-symbols ; https://gitlab.com/kicad/libraries/kicad-footprints ; https://gitlab.com/kicad/libraries/kicad-packages3D
- LibrePCB release/blog: https://librepcb.org/blog/
- LibrePCB release files: https://download.librepcb.org/releases/2.1.1/
- LibrePCB source/license: https://github.com/LibrePCB/LibrePCB
- LibrePCB CLI manual: https://librepcb.org/docs/librepcb-documentation.pdf
- LibrePCB libraries: https://github.com/LibrePCB-Libraries
- Horizon source/releases: https://github.com/horizon-eda/horizon ; https://github.com/horizon-eda/horizon/releases
- Horizon documentation: https://github.com/horizon-eda/horizon-docs
- Fritzing source/release: https://github.com/fritzing/fritzing-app ; https://github.com/fritzing/fritzing-app/releases
