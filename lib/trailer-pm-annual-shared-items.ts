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
export function canReuseTrailerPmAnnual(pm:{template_key:string;template_version:number;event_type:string;status:string;started_at:string},annual:{template_key:string;template_version:number;event_type:string;status:string;started_at:string;signed_at:string|null},at=new Date()){
  const when=Date.parse(pm.started_at.includes('T')?pm.started_at:pm.started_at.replace(' ','T')+'Z');
  const annualWhen=Date.parse(annual.started_at.includes('T')?annual.started_at:annual.started_at.replace(' ','T')+'Z');
  return pm.template_key==='trailer-service'&&pm.template_version===1&&pm.event_type==='pm'&&
    annual.template_key==='trailer-annual-dot'&&annual.template_version===1&&annual.event_type==='annual'&&
    annual.status==='in_progress'&&!annual.signed_at&&
    (pm.status==='in_progress'||pm.status==='ready')&&
    Number.isFinite(when)&&when<=at.getTime()&&at.getTime()-when<=36*60*60*1000&&
    Number.isFinite(annualWhen)&&annualWhen<=at.getTime()&&at.getTime()-annualWhen<=36*60*60*1000;
}
