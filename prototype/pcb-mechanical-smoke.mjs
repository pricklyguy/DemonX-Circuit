import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url),pcb=require('../desktop/pcb-mechanical.cjs');
// Synthetic geometry, never an owner fixture or an electrical design.
const text=`(kicad_pcb (version 20260206) (generator "pcbnew")
 (general (thickness 1.6)) (paper "A4")
 (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (31 "F.CrtYd" user "f.courtyard") (29 "B.CrtYd" user "b.courtyard") (25 "Edge.Cuts" user))
 (setup (pad_to_mask_clearance 0))
 (gr_line (start 0 0) (end 30 0) (stroke (width 0.05) (type default)) (layer "Edge.Cuts"))
 (gr_line (start 30 0) (end 30 20) (stroke (width 0.05) (type default)) (layer "Edge.Cuts"))
 (gr_line (start 30 20) (end 0 20) (stroke (width 0.05) (type default)) (layer "Edge.Cuts"))
 (gr_line (start 0 20) (end 0 0) (stroke (width 0.05) (type default)) (layer "Edge.Cuts"))
 (footprint "Synthetic" (layer "F.Cu") (at 10 10 0)
  (property "Reference" "J1" (at 0 -3 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "test" (at 0 3 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
  (fp_rect (start -2 -1) (end 2 4) (stroke (width 0.05) (type default)) (fill none) (layer "F.CrtYd"))
  (pad "1" thru_hole oval (at 0 0 0) (size 1.7 2) (drill 1) (layers "*.Cu" "*.Mask"))
  (pad "2" thru_hole oval (at 0 2.54 0) (size 1.7 2) (drill 1) (layers "*.Cu" "*.Mask")))
 (footprint "SyntheticHole" (layer "F.Cu") (at 25 15)
  (property "Reference" "H1" (at 0 -3 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
  (fp_circle (center 0 0) (end 2 0) (stroke (width 0.05) (type default)) (fill none) (layer "F.CrtYd"))
  (pad "" np_thru_hole circle (at 0 0) (size 2.2 2.2) (drill 2.2) (layers "*.Cu" "*.Mask")))
 (embedded_fonts no))`;
const b=pcb.inspect(text);assert.deepEqual(b.bounds,{x:0,y:0,width:30,height:20});
assert.equal(b.thicknessMm,1.6);
assert.throws(()=>pcb.inspect(text.replace('(thickness 1.6)','(thickness 0)')),/thickness must be positive/);
const backText=text.replace('(footprint "SyntheticHole" (layer "F.Cu")','(footprint "SyntheticHole" (layer "B.Cu")').replace('(fp_circle (center 0 0) (end 2 0) (stroke (width 0.05) (type default)) (fill none) (layer "F.CrtYd"))','(fp_circle (center 0 0) (end 2 0) (stroke (width 0.05) (type default)) (fill none) (layer "B.CrtYd"))');
assert.equal(pcb.inspect(backText).footprints.find(f=>f.ref==='H1').layer,'B.Cu');
assert.equal(b.footprints.find(f=>f.ref==='H1').body.x1,-2);
const placements=b.footprints.map(f=>({ref:f.ref,x:f.x,y:f.y,rotation:f.rotation}));
placements[0]={ref:'J1',x:29,y:15,rotation:90};
const edited=pcb.move(text,placements),moved=pcb.inspect(edited);
assert.equal(moved.footprints[0].rotation,90);assert.match(edited,/\(at 0 2.54 90\)/);
assert.ok(pcb.diagnostics(moved).some(i=>i.includes('crosses board edge')));
placements[0].x=25;placements[0].y=15;
assert.ok(pcb.diagnostics(pcb.inspect(pcb.move(text,placements))).some(i=>i.includes('J1/H1')));
assert.ok(pcb.diagnostics(pcb.inspect(pcb.move(backText,placements))).some(i=>i.includes('across layers')));
assert.throws(()=>pcb.move(text,[placements[0],placements[0]]),/Invalid placement/);
assert.throws(()=>pcb.move(text,placements.map(p=>({...p,x:NaN}))),/Invalid placement/);
assert.throws(()=>pcb.inspect(text.replace('(end 30 0)','(end 29 0)')),/closed axis-aligned/);
assert.throws(()=>pcb.move(text.replace('(embedded_fonts no)','(segment (start 1 1) (end 2 2))'),placements),/unrouted/);
assert.throws(()=>pcb.inspect(text.replace('(embedded_fonts no)','(gr_circle (center 2 2) (end 3 3) (layer "Edge.Cuts"))')),/additional board edge/);
const root=await mkdtemp(join(tmpdir(),'circuit-pcb-'));const base=join(root,'board.kicad_pcb');await writeFile(base,text);
const saved=await pcb.save(root,base,b.sha256,placements);
assert.equal(await readFile(base,'utf8'),text);assert.equal(pcb.inspect(await readFile(saved.path,'utf8')).sha256,saved.sha256);
assert.equal(await pcb.latest(root,base),saved.path);
await assert.rejects(()=>pcb.save(root,base,b.sha256,placements),/changed externally/);
await writeFile(saved.path,edited);await assert.rejects(()=>pcb.save(root,base,saved.sha256,placements),/changed externally/);
await mkdir(join(root,'evidence'));await writeFile(join(root,'evidence','rotated.kicad_pcb'),edited);
console.log('PASS: native parse, closed outline, layer retention, hole courtyard, rotation/pad orientation, edge/overlap diagnostics, immutable revision save/reopen, stale hash refusal and unsupported geometry refusal.');
console.log(`Native KiCad test candidates: ${root}`);
