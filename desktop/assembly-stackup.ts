/** One-dimensional assembly review. All depths increase behind the owner's datum. */
export interface AssemblyInputs {
 format: 'demonx-assembly-stackup-v1';
 datumLabel: string;
 displayRearMm: number;
 malePinExtensionMm: number;
 femaleBodyMm: number;
 existingPcbFrontMm: number;
 proposedPcbFrontMm: number;
 pcbThicknessMm: number;
 actuatorTipMm: number;
 switchHeightMm: number;
 targetRestGapMm: number;
 targetPlasticClearanceMm: number;
 alternativesMm: number[];
 // Connector internals are measured from its mouth; null always means unknown.
 malePlasticProjectionMm?: number | null;
 socketCavityDepthMm?: number | null;
 contactStartMm?: number | null;
 contactEndMm?: number | null;
 requiredContactOverlapMm?: number | null;
 switchSeatHeightVerified?: boolean;
 switchOperatingTravelMm?: number | null;
 switchSafeTravelMm?: number | null;
 rearSocketBodyMm?: number | null;
}
export interface AssemblyRow {
 pcbFrontMm:number; pcbRearMm:number; socketMouthMm:number;
 displayBoardClearanceMm:number; malePlasticClearanceMm:number|null;
 insertionMm:number; pinTipToPcbMm:number;
 existingButtonGapMm:number; proposedActuatorMm:number;
 actuatorChangeMm:number; rearSocketMouthMm:number|null;
 contactOverlapMm:number|null; contactStatus:string;
 warnings:string[];
}
function finite(name:string,value:unknown,positive=false):asserts value is number {
 if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1000||(positive?value<=0:value<0))throw new Error(`Invalid assembly measurement: ${name}.`);
}
const rnd=(n:number)=>Math.round(n*1e6)/1e6;
export function evaluateAssembly(input:AssemblyInputs,nativeThicknessMm?:number|null) {
 if(!input||input.format!=='demonx-assembly-stackup-v1')throw new Error('Unsupported assembly stack-up format.');
 if(typeof input.datumLabel!=='string'||!input.datumLabel.trim())throw new Error('Assembly requires an explicit reference plane.');
 for(const key of ['displayRearMm','malePinExtensionMm','femaleBodyMm','existingPcbFrontMm','proposedPcbFrontMm','pcbThicknessMm','actuatorTipMm','switchHeightMm','targetRestGapMm','targetPlasticClearanceMm'] as const)finite(key,input[key],key!=='displayRearMm'&&key!=='actuatorTipMm');
 for(const key of ['malePlasticProjectionMm','socketCavityDepthMm','contactStartMm','contactEndMm','requiredContactOverlapMm','switchOperatingTravelMm','switchSafeTravelMm','rearSocketBodyMm'] as const)if(input[key]!=null)finite(key,input[key],['socketCavityDepthMm','requiredContactOverlapMm','rearSocketBodyMm'].includes(key));
 if(!Array.isArray(input.alternativesMm)||input.alternativesMm.length>12)throw new Error('Assembly alternatives must be a short list.');
 for(const p of input.alternativesMm)finite('mounting alternative',p,true);
 if(input.contactStartMm!=null&&input.contactEndMm!=null&&input.contactEndMm<=input.contactStartMm)throw new Error('Contact region must have increasing depths from the socket mouth.');
 if(input.socketCavityDepthMm!=null&&input.contactEndMm!=null&&input.contactEndMm>input.socketCavityDepthMm)throw new Error('Contact region extends beyond the stated cavity.');
 if(input.switchOperatingTravelMm!=null&&input.switchSafeTravelMm!=null&&input.switchSafeTravelMm<input.switchOperatingTravelMm)throw new Error('Safe switch travel is smaller than operating travel.');
 const thickness=nativeThicknessMm==null?input.pcbThicknessMm:nativeThicknessMm;
 finite('native PCB thickness',thickness,true);
 const warnings=['1D nominal stack only: no mesh collision, tolerance, connector mating or switch actuation verification.'];
 if(nativeThicknessMm!=null&&Math.abs(nativeThicknessMm-input.pcbThicknessMm)>1e-6)warnings.push('Native PCB thickness differs from the assembly note; calculations use the native PCB thickness.');
 if(!input.switchSeatHeightVerified)warnings.push('Reported switch overall height has not been confirmed as PCB-seat-to-actuator height.');
 if(input.malePlasticProjectionMm==null)warnings.push('Male-header plastic projection is unknown; clearance to the display PCB alone is insufficient.');
 if(input.rearSocketBodyMm==null)warnings.push('Rear ESP32 socket height and full module/removal stack remain unmeasured.');
 const pinTip=rnd(input.displayRearMm+input.malePinExtensionMm);
 const row=(p:number):AssemblyRow=>{
  const mouth=rnd(p-input.femaleBodyMm),insertion=rnd(pinTip-mouth),boardGap=rnd(mouth-input.displayRearMm);
  const maleGap=input.malePlasticProjectionMm==null?null:rnd(boardGap-input.malePlasticProjectionMm);
  const issues:string[]=[];
  if(boardGap<0)issues.push('Socket body overlaps the display PCB depth.');
  else if(boardGap<input.targetPlasticClearanceMm)issues.push('Socket-to-display PCB gap is below the proposed clearance target.');
  if(maleGap!=null&&maleGap<input.targetPlasticClearanceMm)issues.push('Socket mouth is too close to, or overlaps, male-header plastic.');
  if(insertion<=0)issues.push('Display pins do not enter the socket.');
  if(pinTip>=p)issues.push('Display pin tips reach or pass the main PCB front face; cavity bottom clearance is not available.');
  let overlap:number|null=null;
  if(input.contactStartMm!=null&&input.contactEndMm!=null)overlap=rnd(Math.max(0,Math.min(insertion,input.contactEndMm)-input.contactStartMm));
  const internalsKnown=overlap!=null&&input.socketCavityDepthMm!=null&&input.requiredContactOverlapMm!=null;
  const internalFailure=(input.socketCavityDepthMm!=null&&insertion>=input.socketCavityDepthMm)||(overlap!=null&&input.requiredContactOverlapMm!=null&&overlap<input.requiredContactOverlapMm);
  let contactStatus=internalFailure?'FAIL against entered contact/cavity dimensions':internalsKnown?'Nominal entered contact/cavity dimensions satisfied; tolerances and real mating unverified':'UNVERIFIED: contact region, overlap requirement or cavity depth missing';
  if(boardGap<0||insertion<=0||pinTip>=p||(maleGap!=null&&maleGap<0))contactStatus='FAIL exterior geometry; contact internals cannot establish fit';
  const gap=rnd(p-input.switchHeightMm-input.actuatorTipMm),actuator=rnd(p-input.switchHeightMm-input.targetRestGapMm);
  if(gap<=0)issues.push('Existing actuator nominally preloads the switch.');
  if(actuator<0)issues.push('Proposed actuator tip would lie in front of the reference plane.');
  return {pcbFrontMm:p,pcbRearMm:rnd(p+thickness),socketMouthMm:mouth,displayBoardClearanceMm:boardGap,malePlasticClearanceMm:maleGap,insertionMm:insertion,pinTipToPcbMm:rnd(p-pinTip),existingButtonGapMm:gap,proposedActuatorMm:actuator,actuatorChangeMm:rnd(actuator-input.actuatorTipMm),rearSocketMouthMm:input.rearSocketBodyMm==null?null:rnd(p+thickness+input.rearSocketBodyMm),contactOverlapMm:overlap,contactStatus,warnings:issues};
 };
 const proposed=row(input.proposedPcbFrontMm),existing=row(input.existingPcbFrontMm);
 return {datumLabel:input.datumLabel,pinTipMm:pinTip,thicknessMm:thickness,existing,proposed,alternatives:[...new Set([input.existingPcbFrontMm,...input.alternativesMm,input.proposedPcbFrontMm])].sort((a,b)=>a-b).map(row),warnings,
  nominalMinimumPlaneMm:rnd(input.displayRearMm+input.femaleBodyMm+input.targetPlasticClearanceMm),
  makeStrokeMm:input.switchOperatingTravelMm==null?null:rnd(input.targetRestGapMm+input.switchOperatingTravelMm),
  maximumStopStrokeMm:input.switchSafeTravelMm==null?null:rnd(input.targetRestGapMm+input.switchSafeTravelMm)};
}
