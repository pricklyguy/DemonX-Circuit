# Preserve coordinates across suite handoffs

Circuit should publish versioned, explicit handoff packages rather than making Forge, CNC or firmware tools depend on KiCad internals. Each package carries the project ID and revision, units, coordinate frame, source-engine/version and hashes, while native files remain available for re-opening.

## Forge mechanical handoff

Generate a STEP assembly from the EDA engine and pair it with a machine-readable board envelope. The proposed contract carries board outline, thickness, mounting-hole centers/diameters, component reference/value, XYZ positions and height, rotation, connector positions/orientation, keep-out/clearance data, coordinate origin, units, Z-up convention and source revision. In Forge, lengths are millimetres and Z is up. Validate that board origin, top/bottom convention, rotation, courtyard and 3D model orientation agree with the STEP output before presenting it as an enclosure-ready assembly.

KiCad 10 CLI documents STEP export, assembly options and origin settings; this is the recommended source of the first assembly artifact. No current local export or Forge import test exists. Forge's present MCP supports local modeling operations but its documented bridge cannot open/save/export project files or initialize a design. The integration should therefore be a reviewed file handoff first, followed later by a narrow Forge API or MCP workflow. Do not implement the enclosure generator or rewrite Forge in this checkpoint. ([KiCad CLI](https://docs.kicad.org/10.0/en/cli/cli.html), [Forge MCP guide](https://github.com/pricklyguy/DemonX-Forge/blob/main/docs/MCP.md))

## CNC and Gerber handoff

Keep the EDA engine's original Gerber layer files, Excellon drill, board outline, job metadata and DRC report intact. A manifest should state units, selected origin, layer-to-file map, copper side, coordinate orientation, drill tool mapping and hash. Gerber X2/Excellon are manufacturing source outputs; DXF conversion is a separate CNC-prep operation and should never overwrite those sources.

The existing `gerber_to_vectric` converter is a lightweight subset parser, not CAM. Source inspection shows support for top/bottom copper, outline and drill files, with layered R2010 DXF output. It does not implement arcs, aperture macros, step-repeat or full polarity handling; drill format inference can mis-scale; `$INSUNITS` is not visibly set; copper/drill mirroring and coordinate transforms are absent; the `isolation_offset` setting is unused and the UI option does not currently generate isolation contours. It does not create toolpaths or G-code. Linux support is listed as pending. Treat conversion as a prototype-only optional step until curated fixtures and consuming-software tests establish geometry, units, handedness, drill alignment and isolation output. ([converter source](https://github.com/pricklyguy/gerber_to_vectric/blob/main/script/dxf_script.py), [README](https://github.com/pricklyguy/gerber_to_vectric/blob/main/README.md))

Fail closed if the trace width or drill format cannot be resolved; the converter's 1.25 mm fallback is unsafe for arbitrary fine-pitch copper. Display board extents and coordinate alignment for user review. Do not claim converted DXF is manufacturing-ready without DRC, CAM clearance review and machine-specific verification. DemonX CNC is a GRBL controller/machine workflow with PCB mode and probing, not itself a general Gerber CAM parser. Keep CNC machine control on its existing safety path. ([DemonX CNC](https://github.com/pricklyguy/DemonX))

## Shared package and ownership

The manifest references schematics, PCB layouts, component dependencies, manufacturing outputs, STEP/enclosure assets and firmware. Package native files and user-owned libraries with relative references and license/provenance metadata; avoid proprietary cloud links. Revisions and file hashes enable consumer applications to reject stale handoffs. Importing a file never silently changes the source project.

## Conclusion

The suite's highest-risk boundary is coordinate meaning, not file naming. Make origin, units, orientation and revision explicit at every transfer, then validate geometry in the consuming application before automating cuts or enclosure generation.
