// Native PCB is authoritative; this view edits only footprint placement in new revisions.
import { evaluateAssembly } from './assembly-stackup';
export function mountBoardWorkspace() {
 const el=(id:string)=>document.getElementById(id)!;
 const panel=el('pcb-workspace'); const ns='http://www.w3.org/2000/svg';
 let board:MechanicalBoard|null=null;let original='';
 function svgNode(name:string,attrs:Record<string,string|number>,text?:string) {
  const node=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,String(v));if(text)node.textContent=text;return node;
 }
 function dirty() {document.body.dataset.pcbDirty=String(!!board&&JSON.stringify(board.footprints.map(f=>[f.ref,f.x,f.y,f.rotation]))!==original);el('pcb-save').textContent=document.body.dataset.pcbDirty==='true'?'Save new PCB revision • unsaved':'Save new PCB revision';}
 function draw() {
  if(!board)return;const b=board.bounds;const svg=el('pcb-canvas');svg.replaceChildren();
  svg.setAttribute('viewBox',`${b.x-9} ${b.y-12} ${b.width+18} ${b.height+22}`);
  svg.append(svgNode('rect',{x:b.x,y:b.y,width:b.width,height:b.height,fill:'#152f30',stroke:'#e9d57b','stroke-width':.25}));
  for(let x=Math.ceil(b.x/5)*5;x<b.x+b.width;x+=5)svg.append(svgNode('path',{d:`M ${x} ${b.y} v ${b.height}`,stroke:'#355254','stroke-width':.08}));
  for(let y=Math.ceil(b.y/5)*5;y<b.y+b.height;y+=5)svg.append(svgNode('path',{d:`M ${b.x} ${y} h ${b.width}`,stroke:'#355254','stroke-width':.08}));
  if((el('pcb-references') as HTMLInputElement).checked) {
   for(const r of board.constraints.references||[]) {
    svg.append(svgNode(r.radius?'circle':'rect',r.radius?{cx:r.x,cy:r.y,r:r.radius,fill:'none',stroke:'#a9b7f3','stroke-width':.2,'stroke-dasharray':'1 1'}:{x:r.x,y:r.y,width:r.width!,height:r.height!,fill:'none',stroke:'#a9b7f3','stroke-width':.2,'stroke-dasharray':'1 1'}));
    svg.append(svgNode('text',{x:r.x+(r.radius?0:1),y:r.y+(r.radius?0:2),'font-size':1.4,fill:'#d1d6ff'},r.label));
   }
   for(const r of board.constraints.keepouts||[]) {
    svg.append(svgNode('rect',{x:r.x,y:r.y,width:r.width,height:r.height,fill:'#f0a452','fill-opacity':.13,stroke:'#f0a452','stroke-width':.2,'stroke-dasharray':'.7 .7'}));
    svg.append(svgNode('text',{x:r.x+1,y:r.y+2,'font-size':1.5,fill:'#ffc67c'},r.label));
   }
  }
  const layer=(el('pcb-layer') as HTMLSelectElement).value;
  for(const f of board.footprints) {
   if(layer!=='all'&&f.layer!==layer)continue;
   const color=f.layer==='B.Cu'?'#91b7ff':'#6ee6bb';
   const group=svgNode('g',{transform:`translate(${f.x} ${f.y}) rotate(${-f.rotation})`});
   if(f.body)group.append(svgNode('rect',{x:f.body.x1,y:f.body.y1,width:f.body.x2-f.body.x1,height:f.body.y2-f.body.y1,fill:color,'fill-opacity':.07,stroke:color,'stroke-width':.2}));
   for(const p of f.pads){group.append(svgNode('rect',{x:p.x-p.width/2,y:p.y-p.height/2,width:p.width,height:p.height,fill:'#d5b869'}));if(p.drill)group.append(svgNode('circle',{cx:p.x,cy:p.y,r:p.drill/2,fill:'#0c151b'}));}
   group.append(svgNode('text',{x:0,y:-1,'font-size':1.8,fill:color,'text-anchor':'middle'},f.ref));
   svg.append(group);
  }
  const outlineStatus=board.constraints.board?.fitStatus==='owner-template-fit-confirmed'?'TEMPLATE CHECKED':'PROVISIONAL';
  svg.append(svgNode('text',{x:b.x+b.width/2,y:b.y-4,'text-anchor':'middle','font-size':2,fill:'#e9d57b'},`${b.width.toFixed(2)} × ${b.height.toFixed(2)} mm · ${outlineStatus}`));
  el('pcb-revision').textContent=`Native SHA-256 ${board.sha256.slice(0,12)} · ${board.footprints.length} items · front view; back components projected`;
  dirty();
 }
 function populate() {
  if(!board)return; original=JSON.stringify(board.footprints.map(f=>[f.ref,f.x,f.y,f.rotation]));
  el('pcb-placements').replaceChildren();
  for(const f of board.footprints) {
   const row=document.createElement('tr');
   const title=document.createElement('td');title.textContent=`${f.ref} · ${f.value}`;title.title=f.library;row.append(title);
   for(const key of ['x','y','rotation'] as const){const td=document.createElement('td');const input=document.createElement('input');input.type='number';input.step=key==='rotation'?'90':'.1';input.value=String(f[key]);input.setAttribute('aria-label',`${f.ref} ${key}`);input.addEventListener('change',()=>{const value=Number(input.value);if(input.value!==''&&Number.isFinite(value)&&Math.abs(value)<10000){f[key]=value;draw();el('pcb-issues').textContent='Placements changed. Save a revision to recompute server-side fit diagnostics.';}else input.value=String(f[key]);});td.append(input);row.append(td);}
   const side=document.createElement('td');side.textContent=f.layer;row.append(side);el('pcb-placements').append(row);
  }
  el('pcb-issues').replaceChildren();for(const issue of board.issues){const p=document.createElement('p');p.textContent=issue;el('pcb-issues').append(p);}
  el('pcb-reference-note').textContent=board.constraints.description||'No registered enclosure geometry. Rectangular 2D courtyard checks only.';
  const assembly=el('pcb-assembly');assembly.replaceChildren();
  el('pcb-assembly-details').classList.toggle('hidden',!board.constraints.assembly);
  if(board.constraints.assembly) {
   const heading=document.createElement('h3');heading.textContent='Assembly depth review · mm';assembly.append(heading);
   try {
    const stack=evaluateAssembly(board.constraints.assembly,board.thicknessMm),p=stack.proposed;
    const targetLabel=stack.proposedPcbFrontStatus==='owner-selected-target'?'Owner-selected PCB front target':'Proposed PCB front';
    for(const message of [`Reference: ${stack.datumLabel}; positive depth is behind this plane.`,`${targetLabel} ${p.pcbFrontMm}; rear ${p.pcbRearMm}. Display pin tips ${stack.pinTipMm}.`,...(stack.proposedPcbFrontBasis?[`Selection basis: ${stack.proposedPcbFrontBasis}`]:[]),`Socket mouth ${p.socketMouthMm}; display PCB gap ${p.displayBoardClearanceMm}; pin insertion into body ${p.insertionMm}.`,p.contactStatus,`Button: existing rest gap ${p.existingButtonGapMm}; proposed actuator tip ${p.proposedActuatorMm} for the stated rest-gap target. Travel and stop remain unverified.`,...stack.warnings,...p.warnings]){const line=document.createElement('p');line.textContent=message;assembly.append(line);}
   } catch(error){const line=document.createElement('p');line.textContent=`Assembly data refused: ${String(error)}`;assembly.append(line);}
  }
  draw();
 }
 async function open(){try{el('pcb-error').textContent='';board=await window.circuit.loadBoard();populate();panel.classList.remove('hidden');panel.scrollIntoView();}catch(error){el('pcb-error').textContent=String(error);panel.classList.remove('hidden');}}
 el('open-circuit-pcb').addEventListener('click',()=>void open());
 el('pcb-layer').addEventListener('change',draw);el('pcb-references').addEventListener('change',draw);
 el('pcb-close').addEventListener('click',()=>{if(document.body.dataset.pcbDirty==='true'){el('pcb-error').textContent='Save the placement revision before closing.';return;}panel.classList.add('hidden');});
 el('pcb-save').addEventListener('click',async()=>{
  if(!board)return;el('pcb-save').setAttribute('disabled','');
  try{board=await window.circuit.saveBoard(board.sha256,board.footprints.map(({ref,x,y,rotation})=>({ref,x,y,rotation})));populate();el('pcb-error').textContent='Saved a new native PCB revision. Earlier files remain available.';}
  catch(error){el('pcb-error').textContent=String(error);}finally{el('pcb-save').removeAttribute('disabled');}
 });
 // A project switch must not attach an old placement draft to another project.
 for(const id of ['open-project','new-project','recent-projects'])el(id).addEventListener('click',event=>{if(document.body.dataset.pcbDirty==='true'){event.stopImmediatePropagation();el('pcb-error').textContent='Save the PCB revision before switching projects.';}},true);
 window.circuit.onProjectChanged(()=>{if(document.body.dataset.pcbDirty!=='true'){board=null;panel.classList.add('hidden');}});
 window.addEventListener('beforeunload',e=>{if(document.body.dataset.pcbDirty==='true'){e.preventDefault();e.returnValue='';}});
}
