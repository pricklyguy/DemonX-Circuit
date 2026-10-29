# Assembly depth review

Checkpoint 6B-2 adds a read-only depth review to the existing mechanical PCB
workspace. It does not add routing, manufacturing capability or a 3D mesh editor.
Owner designs and measurement records remain private project data.

An optional `assembly` object in `mechanical/constraints.json` uses the
`demonx-assembly-stackup-v1` format declared in `desktop/assembly-stackup.ts`.
All lengths are millimetres behind an explicit owner-defined reference plane.
It contains measured display-back position, male-pin extension, socket body
height, existing/proposed front PCB support planes and switch/actuator dimensions.
References, sources and uncertainty should remain in the local project record.

The PCB reader obtains thickness from the native board's `general/thickness`
field. Calculations use that value when available and warn if it differs from
the assembly note. No existing native PCB geometry or original mesh is rewritten
by this feature. The renderer shows proposed front/rear faces, socket-mouth
position, pin insertion, button rest gap and an effective actuator-tip proposal.

Socket plastic-body height alone can never produce a contact-fit result.
Usable cavity depth, contact start/end measured from its mouth, and required
contact overlap are separate optional inputs. Missing inputs produce an explicit
unverified result. Male-header plastic projection is also separate; clearance to
the display PCB rear surface does not imply clearance to its male insulator.
Even complete nominal entered dimensions do not verify real mating or tolerances.

Reported switch overall height is not silently treated as a verified seating
datum. The review warns unless PCB-seat-to-actuator height has been confirmed.
Operating travel and safe total compression remain unknown unless provided;
the calculator does not invent them or dimension an approved overtravel stop.
Rear ESP32 socket height is independent of the front display socket measurement.

The native board remains authoritative for XY, layers, pads and thickness.
The assembly note describes a proposal; it does not create approved component
Z positions or imply a full assembly model. Mechanical-review manufacturing
blocks remain in effect.

Validation:

```text
npm run test:assembly-stackup
npm run test:pcb-mechanical
npm run test:schematic-model
npm run test:native-roundtrip
npm run test:mcp
npm run test:owner-schematic-cli-args
```

Tests use synthetic dimensions, including exterior interference, unknown contact
refusal, contact/cavity limits, actuator and stop arithmetic, native-thickness
authority and invalid inputs. The existing Electron workspace acceptance test
also recognizes the optional assembly panel and checks that its unverified
contact result survives native placement save/reopen. Real component mating,
switch operation, clearances and Linux GUI use require separate evidence.
