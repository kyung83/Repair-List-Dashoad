/**
 * Explicit, conservative equivalence list for trailer-specific template v1.
 * Reuse is allowed only for a same-visit PM PASS on the exact source item text,
 * and only while a separate, unsigned Annual is in progress.
 *
 * A similar-looking PM check is NOT enough to satisfy an Annual safety standard.
 * This list intentionally omits brake stroke legal-limit verification, lamp
 * mounting, tire legal-limit measurements, rear-guard geometry, and other
 * Annual-specific conditions.
 */
export const VERIFIED_TRAILER_PM_ANNUAL_V1=[
  {pm:9,annual:1,pmText:'Verify service brakes apply and release at every required trailer axle.',annualText:'Verify service-brake operation on every axle required to have brakes.'},
  {pm:28,annual:19,pmText:'Test clearance, side-marker, identification and license-plate lamps.',annualText:'Verify side markers, clearance and identification lamps required for this trailer operate.'},
  {pm:30,annual:21,pmText:'Inspect reflectors and required conspicuity tape for condition and visibility.',annualText:'Check required reflectors, conspicuity markings and conspicuity tape for presence and condition.'},
  {pm:22,annual:31,pmText:'Operate and inspect sliding tandem locks, pins, rails and stops where equipped.',annualText:'Check sliding tandem/adjustable axle locking pins and stops if equipped.'},
  {pm:24,annual:39,pmText:'Inspect landing gear feet, gears, braces, crank, mounting and operation.',annualText:'Inspect landing-gear structure, braces and feet for loose or unsafe mounting.'},
] as const;
type PMRun={template_key:string;template_version:number;event_type:string;status:string;started_at:string;pm_body_type_snapshot?:string|null};
type AnnualRun={template_key:string;template_version:number;event_type:string;status:string;started_at:string;signed_at:string|null};
type Pair=typeof VERIFIED_TRAILER_PM_ANNUAL_V1[number];
type PMAnswer={item_number:number;item_text:string;result:string;updated_by_user_id:number|null;require_photo:number;require_measurement:number;require_notes:number};
function sameVisit(pm:PMRun,annual:AnnualRun,at:Date){
  const when=Date.parse(pm.started_at.includes('T')?pm.started_at:pm.started_at.replace(' ','T')+'Z');
  const annualWhen=Date.parse(annual.started_at.includes('T')?annual.started_at:annual.started_at.replace(' ','T')+'Z');
  return pm.event_type==='pm'&&
    annual.template_key==='trailer-annual-dot'&&annual.template_version===1&&annual.event_type==='annual'&&
    annual.status==='in_progress'&&!annual.signed_at&&
    (pm.status==='in_progress'||pm.status==='ready')&&
    Number.isFinite(when)&&when<=at.getTime()&&at.getTime()-when<=36*60*60*1000&&
    Number.isFinite(annualWhen)&&annualWhen<=at.getTime()&&at.getTime()-annualWhen<=36*60*60*1000;
}

export function canReuseTrailerPmAnnual(pm:PMRun,annual:AnnualRun,at=new Date()){
 return pm.template_key==='trailer-service'&&pm.template_version===1&&sameVisit(pm,annual,at);
}
// Body-specific copies may reorder verified questions. Only a recorded body
// override at PM start qualifies; the Annual must still be its verified v1.
export function canReuseTrailerBodyPmAnnual(pm:PMRun,annual:AnnualRun,at=new Date()){
 return Boolean(pm.pm_body_type_snapshot?.trim())&&Boolean(pm.template_key)&&pm.template_version>=1&&sameVisit(pm,annual,at);
}
export function verifiedTrailerPmAnswer<T extends PMAnswer>(pm:PMRun,answers:readonly T[],pair:Pair,userId:number):T|null{
 const original=pm.template_key==='trailer-service'&&pm.template_version===1;
 if(pm.event_type!=='pm'||(!original&&!pm.pm_body_type_snapshot?.trim()))return null;
 const matching=answers.filter(item=>item.item_text===pair.pmText&&(original?item.item_number===pair.pm:true));
 if(matching.length!==1)return null;
 const answer=matching[0];
 return answer.result==='pass'&&answer.updated_by_user_id===userId&&!answer.require_photo&&!answer.require_measurement&&!answer.require_notes?answer:null;
}
