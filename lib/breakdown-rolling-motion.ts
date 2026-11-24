/** Conservative movement evidence; never decides that the repair itself is complete. */
export type Position={lat:number;lon:number};
export type MotionPoint=Position&{at:number;mph:number};
export type MotionAnchor=Position&{at:number};
export type RollingEvidence={startedAt:number;observedAt:number;distanceMiles:number;maxSpeedMph:number;durationMinutes:number};
export const ROLLING_DISTANCE_MILES=5;
export const ROLLING_SPEED_MPH=25;
export const ROLLING_DURATION_MINUTES=10;
const MAX_GAP_MS=5*60_000;
const STOP_MPH=3;
const RAD=Math.PI/180;
export function validPosition(lat:unknown,lon:unknown):Position|null{
  if(lat==null||lon==null||lat===''||lon==='')return null;
  const a=Number(lat),b=Number(lon);
  return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180&&(a!==0||b!==0)?{lat:a,lon:b}:null;
}
export function distanceMiles(a:Position,b:Position){
  const h=Math.sin((b.lat-a.lat)*RAD/2)**2+Math.cos(a.lat*RAD)*Math.cos(b.lat*RAD)*Math.sin((b.lon-a.lon)*RAD/2)**2;
  return 3958.76*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}
export function parseRollingTime(value:unknown):number{
  if(typeof value!=='string'||!value)return NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?value.replace(' ','T')+'Z':value);
}
export function inspectRollingMovement(points:readonly MotionPoint[],options:{reportedAt:number;notBefore:number;origin:Position|null;anchor:MotionAnchor|null;rechecking:boolean}):{anchor:MotionAnchor|null;evidence:RollingEvidence|null}{
  const {reportedAt,notBefore,origin,rechecking}=options;
  let anchor=options.anchor;
  let start:MotionPoint|null=null,previous:MotionPoint|null=null,peak=0,count=0;
  for(const p of [...points].sort((a,b)=>a.at-b.at)){
    if(!validPosition(p.lat,p.lon)||!Number.isFinite(p.at)||p.at<notBefore||!Number.isFinite(p.mph)||p.mph<0||p.mph>120)continue;
    if(p.mph<=STOP_MPH){
      // Require actual stationary telemetry at the reported location, or a stop
      // close in time to a manually entered report. After a tow rejection a
      // new stop can establish a new baseline.
      if(rechecking||(origin?distanceMiles(origin,p)<=1:p.at<=reportedAt+30*60_000)){
        anchor={lat:p.lat,lon:p.lon,at:p.at};
      }
      start=null;previous=null;peak=0;count=0;continue;
    }
    if(!anchor||p.at<anchor.at||p.at<reportedAt)continue;
    if(!start||!previous||p.at-previous.at>MAX_GAP_MS||p.at<=previous.at){
      start=p;peak=p.mph;count=1;
    }else{
      // Reject a physically implausible GPS jump instead of treating it as travel.
      const implied=distanceMiles(previous,p)/((p.at-previous.at)/3_600_000);
      if(implied>130){start=p;peak=p.mph;count=1;previous=p;continue;}
      peak=Math.max(peak,p.mph);count++;
    }
    previous=p;
    const duration=(p.at-start.at)/60_000;
    const distance=distanceMiles(anchor,p);
    if(count>=3&&duration>=ROLLING_DURATION_MINUTES&&distance>=ROLLING_DISTANCE_MILES&&peak>ROLLING_SPEED_MPH){
      return {anchor,evidence:{startedAt:start.at,observedAt:p.at,distanceMiles:distance,maxSpeedMph:peak,durationMinutes:duration}};
    }
  }
  return {anchor,evidence:null};
}
