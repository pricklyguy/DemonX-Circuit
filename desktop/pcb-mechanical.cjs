// Deliberately limited native KiCad reader. Unknown syntax is retained byte-for-byte.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function parse(text) {
  if (Buffer.byteLength(text) > 8*1024*1024) throw new Error('PCB exceeds 8 MB workspace limit.');
  let i=0;
  function read(depth=0) {
    if(depth>100) throw new Error('PCB nesting limit exceeded.');
    while (/\s/.test(text[i] || '') && i<text.length) i++;
    const start=i;
    if(text[i]==='(') {
      i++; const items=[];
      while(true) {
        while(i<text.length && /\s/.test(text[i])) i++;
        if(i>=text.length) throw new Error('Unclosed PCB expression.');
        if(text[i]===')') {i++;return {items,start,end:i};}
        items.push(read(depth+1));
      }
    }
    if(text[i]==='"') {
      i++;let escaped=false;
      while(i<text.length) {const c=text[i++];if(c==='"'&&!escaped)return {value:JSON.parse(text.slice(start,i)),start,end:i};escaped=c==='\\'&&!escaped;}
      throw new Error('Unclosed PCB string.');
    }
    while(i<text.length&&!/[\s()]/.test(text[i]))i++;
    if(start===i)throw new Error('Invalid PCB atom.');
    return {value:text.slice(start,i),start,end:i};
  }
  const root=read(); if(text.slice(i).trim()||root.items?.[0]?.value!=='kicad_pcb')throw new Error('Expected a native KiCad PCB.');
  return root;
}
const kids=(n,name)=>(n.items||[]).filter(x=>x.items?.[0]?.value===name);
const kid=(n,name)=>kids(n,name)[0];
const val=(n,j=1)=>n?.items?.[j]?.value;
const num=(n,j=1)=>{const v=Number(val(n,j));if(!Number.isFinite(v))throw new Error('Invalid PCB coordinate.');return v;};
function inspect(text) {
 const root=parse(text); const edges=[];
 for(const e of kids(root,'gr_line'))if(val(kid(e,'layer'))==='Edge.Cuts')edges.push({a:[num(kid(e,'start')),num(kid(e,'start'),2)],b:[num(kid(e,'end')),num(kid(e,'end'),2)]});
 if(!edges.length||kids(root,'gr_arc').some(e=>val(kid(e,'layer'))==='Edge.Cuts')||kids(root,'gr_rect').some(e=>val(kid(e,'layer'))==='Edge.Cuts'))throw new Error('Workspace supports straight-line Edge.Cuts only. Open other outlines in KiCad.');
 for(const e of root.items||[])if(e.items&&/^gr_/.test(val(e,0))&&val(e.items?.find(k=>k.items?.[0]?.value==='layer'))==='Edge.Cuts'&&val(e,0)!=='gr_line')throw new Error('Unsupported additional board edge geometry.');
 const points=edges.flatMap(e=>[e.a,e.b]); const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 const bounds={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
 // A bounding box is not a board polygon. Reject non-rectangular edges rather than claim fit.
 const {x,y,width:w,height:h}=bounds;
 const key=p=>p.map(v=>v.toFixed(5)).join(',');
 const expected=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
 const actual=new Set(edges.map(e=>[key(e.a),key(e.b)].sort().join('|')));
 if(edges.length!==4||expected.some((p,j)=>!actual.has([key(p),key(expected[(j+1)%4])].sort().join('|'))))throw new Error('Workspace requires a closed axis-aligned rectangular outline.');
 const footprints=kids(root,'footprint').map(f=>{
  const at=kid(f,'at');const ref=kids(f,'property').find(p=>val(p)==='Reference');
  const value=kids(f,'property').find(p=>val(p)==='Value');
  const courtyard=[...kids(f,'fp_rect'),...kids(f,'fp_line')].filter(r=>['F.CrtYd','B.CrtYd'].includes(val(kid(r,'layer'))));
  const cp=courtyard.flatMap(r=>[kid(r,'start'),kid(r,'end')]).map(p=>[num(p),num(p,2)]);
  for(const c of kids(f,'fp_circle').filter(r=>['F.CrtYd','B.CrtYd'].includes(val(kid(r,'layer'))))) {
   const center=kid(c,'center'),end=kid(c,'end'),x=num(center),y=num(center,2),r=Math.hypot(num(end)-x,num(end,2)-y);
   cp.push([x-r,y-r],[x+r,y+r]);
  }
  const body=cp.length?{x1:Math.min(...cp.map(p=>p[0])),y1:Math.min(...cp.map(p=>p[1])),x2:Math.max(...cp.map(p=>p[0])),y2:Math.max(...cp.map(p=>p[1]))}:null;
  const pads=kids(f,'pad').map(p=>({number:val(p),type:val(p,2),x:num(kid(p,'at')),y:num(kid(p,'at'),2),width:num(kid(p,'size')),height:num(kid(p,'size'),2),drill:kid(p,'drill')?num(kid(p,'drill')):0,net:val(kid(p,'net'),2)||''}));
  return {ref:val(ref,2),value:val(value,2),library:val(f),x:num(at),y:num(at,2),rotation:at.items.length>3?num(at,3):0,layer:val(kid(f,'layer')),body,pads};
 });
 if(footprints.some(f=>!f.ref)||new Set(footprints.map(f=>f.ref)).size!==footprints.length)throw new Error('PCB requires unique references.');
 return {sha256:hash(text),bounds,edges,footprints,routed:['segment','arc','via','zone'].some(name=>kids(root,name).length>0)};
}
function extent(f) {
 if(!f.body)return null;
 const a=-f.rotation*Math.PI/180;
 const pts=[[f.body.x1,f.body.y1],[f.body.x1,f.body.y2],[f.body.x2,f.body.y1],[f.body.x2,f.body.y2]].map(([x,y])=>[f.x+x*Math.cos(a)-y*Math.sin(a),f.y+x*Math.sin(a)+y*Math.cos(a)]);
 return {x:Math.min(...pts.map(p=>p[0])),y:Math.min(...pts.map(p=>p[1])),right:Math.max(...pts.map(p=>p[0])),bottom:Math.max(...pts.map(p=>p[1]))};
}
function diagnostics(board,constraints={}) {
 const issues=['PROVISIONAL: board outline and mounting locations require owner measurement.','3D NOT VERIFIED: reference projections do not test depth, snap clips, connector mating, or removal paths.'];
 const b=board.bounds;
 for(const f of board.footprints) {
  const e=extent(f);
  if(!e){issues.push(`${f.ref}: no supported courtyard; fit unknown.`);continue;}
  if(e.x<b.x||e.y<b.y||e.right>b.x+b.width||e.bottom>b.y+b.height)issues.push(`${f.ref}: courtyard crosses board edge.`);
  for(const zone of constraints.keepouts||[])if(e.x<zone.x+zone.width&&e.right>zone.x&&e.y<zone.y+zone.height&&e.bottom>zone.y)issues.push(`${f.ref}: intersects ${zone.label}.`);
 }
 for(let i=0;i<board.footprints.length;i++)for(let j=i+1;j<board.footprints.length;j++) {
  const a=board.footprints[i],c=board.footprints[j],e=extent(a),f=extent(c);
  const through=a.pads.some(p=>p.type.includes('thru_hole'))||c.pads.some(p=>p.type.includes('thru_hole'));
  if(e&&f&&(a.layer===c.layer||through)&&e.x<f.right&&e.right>f.x&&e.y<f.bottom&&e.bottom>f.y)issues.push(`${a.ref}/${c.ref}: projected courtyard overlap${a.layer!==c.layer?' across layers (through-hole present)':''}.`);
 }
 for(const item of constraints.awaiting||[])issues.push(`AWAITING: ${item}`);
 return issues;
}
function move(text,placements) {
 const board=inspect(text);if(board.routed)throw new Error('Placement revisions require an unrouted board.');
 if(!Array.isArray(placements)||placements.length!==board.footprints.length)throw new Error('Supply every footprint exactly once.');
 const seen=new Set(),edits=[]; const root=parse(text);
 for(const p of placements) {
  if(!p||seen.has(p.ref)||![p.x,p.y,p.rotation].every(Number.isFinite)||Math.abs(p.x)>10000||Math.abs(p.y)>10000||Math.abs(p.rotation)>360)throw new Error('Invalid placement.');
  seen.add(p.ref);const node=kids(root,'footprint').find(f=>kids(f,'property').some(k=>val(k)==='Reference'&&val(k,2)===p.ref));
  if(!node)throw new Error('Unknown footprint.');const at=kid(node,'at');
  edits.push({start:at.start,end:at.end,text:`(at ${p.x} ${p.y} ${p.rotation})`});
  const prior=at.items.length>3?num(at,3):0,delta=p.rotation-prior;
  if(delta)for(const pad of [...kids(node,'pad'),...kids(node,'property'),...kids(node,'fp_text')]) {
   if(!kid(pad,'at'))continue;
   const pa=kid(pad,'at'),angle=(pa.items.length>3?num(pa,3):0)+delta;
   // Pad orientation is absolute in KiCad, unlike its local centre coordinate.
   edits.push({start:pa.start,end:pa.end,text:`(at ${num(pa)} ${num(pa,2)} ${angle})`});
  }
 }
 for(const e of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,e.start)+e.text+text.slice(e.end);
 inspect(text);return text;
}
async function latest(root,base) {
 const dir=path.join(root,'pcb-revisions');let names=[];
 try{names=(await fs.readdir(dir)).filter(n=>/^\d{6}-[a-f0-9]{12}\.kicad_pcb$/.test(n)).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
 return names.length?path.join(dir,names.at(-1)):base;
}
async function save(root,base,expectedSha,placements) {
 const source=await latest(root,base),text=await fs.readFile(source,'utf8');
 if(hash(text)!==expectedSha)throw new Error('PCB changed externally; reopen before saving.');
 const candidate=move(text,placements),dir=path.join(root,'pcb-revisions');await fs.mkdir(dir,{recursive:true});
 const names=await fs.readdir(dir);const index=1+names.reduce((n,s)=>Math.max(n,/^(\d{6})-/.test(s)?Number(s.slice(0,6)):0),0);
 const file=path.join(dir,`${String(index).padStart(6,'0')}-${hash(candidate).slice(0,12)}.kicad_pcb`);
 await fs.writeFile(`${file}.json`,JSON.stringify({format:'demonx-pcb-revision',parentSha256:expectedSha,sha256:hash(candidate),createdAt:new Date().toISOString(),source:path.relative(root,source)},null,2)+'\n',{flag:'wx'});
 await fs.writeFile(file,candidate,{flag:'wx'});
 return {path:file,sha256:hash(candidate),parentSha256:expectedSha};
}
module.exports={inspect,extent,diagnostics,move,latest,save,hash};
