// Real Electron renderer/IPC test. Uses the existing isolated dialog fixture hook.
import {spawn} from 'node:child_process';
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const [fixtureArg,evidenceArg]=process.argv.slice(2);if(!fixtureArg||!evidenceArg)throw new Error('Usage: node prototype/pcb-workspace-acceptance.mjs <private-project> <evidence-directory>');
const fixture=resolve(fixtureArg),out=resolve(evidenceArg),root=join(out,'test-projects');await mkdir(root,{recursive:true});
await cp(fixture,join(root,'DemonX-Circuit-Project'),{recursive:true,errorOnExist:true,force:false});
const port=24000+Math.floor(Math.random()*12000);const log=[];const report={checks:[],screenshots:[],errors:[]};
const child=spawn(resolve('node_modules/electron/dist/electron.exe'),['.',`--remote-debugging-port=${port}`],{cwd:process.cwd(),env:{...process.env,DEMONX_CIRCUIT_ACCEPTANCE_ROOT:root,DEMONX_CIRCUIT_USER_DATA:join(out,'profile')},windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stdout.on('data',d=>log.push(String(d)));child.stderr.on('data',d=>log.push(String(d)));
const delay=ms=>new Promise(r=>setTimeout(r,ms));let socket,id=0;const pending=new Map();
function call(method,params={}){return new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error(`Timeout: ${method}`));},20000);pending.set(n,{resolve:v=>{clearTimeout(timer);resolve(v);},reject});socket.send(JSON.stringify({id:n,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function until(expression){for(let n=0;n<80;n++){if(await evaluate(expression))return;await delay(200);}throw new Error(`Condition timed out: ${expression}`);}
async function capture(name){const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(out,name),Buffer.from(shot.data,'base64'));report.screenshots.push(name);}
try {
 let target;for(let n=0;n<120;n++){try{const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();target=tabs.find(t=>t.type==='page');if(target)break;}catch{}await delay(250);}
 if(!target)throw new Error('No real Electron renderer target.');
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails.text);});
 await call('Runtime.enable');await until('!!window.circuit');
 await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
 await evaluate("document.getElementById('open-project').click()");await until("document.getElementById('project-name').textContent.includes('Coffee Maker')");report.checks.push('PASS: project opened through normal renderer and IPC');
 assert.equal(await evaluate("document.getElementById('prepare-manufacturing').disabled"),true);
 const blocked=await evaluate('window.circuit.prepareManufacturing()');assert.equal(blocked.status,'FAIL');assert.match(blocked.message,/no manufacturing files/);report.checks.push('PASS: fabrication blocked in UI and main-process IPC');
 await evaluate("document.getElementById('open-circuit-pcb').click()");await until("!document.getElementById('pcb-workspace').classList.contains('hidden') && document.getElementById('pcb-canvas').children.length>5");
 await capture('board-workspace.png');
 const baseline=await evaluate('window.circuit.loadBoard()');
 await evaluate("(()=>{const i=document.querySelector('input[aria-label=\"R1 x\"]');i.value='112.5';i.dispatchEvent(new Event('change'));})()");assert.equal(await evaluate('document.body.dataset.pcbDirty'), 'true');
 await evaluate("document.getElementById('open-project').click()");assert.equal(await evaluate('document.body.dataset.pcbDirty'),'true');report.checks.push('PASS: unsaved placement prevents project switch');
 await evaluate("document.getElementById('pcb-save').click()");await until("document.getElementById('pcb-error').textContent.startsWith('Saved a new')");
 const saved=await evaluate('window.circuit.loadBoard()');assert.notEqual(saved.sha256,baseline.sha256);assert.equal(saved.footprints.find(f=>f.ref==='R1').x,112.5);assert.equal(await evaluate('document.body.dataset.pcbDirty'),'false');
 await evaluate("document.getElementById('pcb-close').click()");await evaluate("document.getElementById('open-project').click()");await until("document.getElementById('project-name').textContent.includes('Coffee Maker')");
 const reopened=await evaluate('window.circuit.loadBoard()');assert.equal(reopened.sha256,saved.sha256);report.checks.push('PASS: edited native PCB save/reopen preserves exact revision hash and position');
 await evaluate("document.getElementById('open-circuit-pcb').click()");await until("!document.getElementById('pcb-workspace').classList.contains('hidden')");
 await capture('board-reopened.png');
 await evaluate("(()=>{const s=document.getElementById('pcb-layer');s.value='B.Cu';s.dispatchEvent(new Event('change'));})()");await capture('board-back-layer.png');report.checks.push('PASS: back layer filter rendered');
 // Restore R1 by saving another immutable revision; original project and fixture were never replaced.
 const restore=await evaluate(`window.circuit.saveBoard(${JSON.stringify(reopened.sha256)},${JSON.stringify(baseline.footprints.map(({ref,x,y,rotation})=>({ref,x,y,rotation})))})`);
 assert.equal(restore.footprints.find(f=>f.ref==='R1').x,112);
 assert.equal(report.errors.length,0);
 const exited=new Promise(r=>child.once('exit',r));
 // Chromium closes the debugging transport before acknowledging Browser.close.
 socket.send(JSON.stringify({id:++id,method:'Browser.close'}));
 await Promise.race([exited,delay(10000).then(()=>{if(child.exitCode===null)throw new Error('Electron did not exit after closing.');})]);
 report.exitCode=child.exitCode;assert.equal(child.exitCode,0);
}catch(e){report.errors.push(String(e.stack||e));child.kill();process.exitCode=1;}finally{socket?.close();await writeFile(join(out,'acceptance.json'),JSON.stringify(report,null,2));await writeFile(join(out,'electron.log'),log.join(''));}
console.log(JSON.stringify(report,null,2));
