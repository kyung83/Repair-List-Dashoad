function parseDateMs(value){
  const raw=String(value??'').trim();
  if(!raw)return null;
  const normalized=raw.includes('T')?raw:`${raw.replace(' ','T')}Z`;
  const parsed=Date.parse(normalized);
  return Number.isFinite(parsed)?parsed:null;
}

function boolOrNull(value){
  if(value===true||value===1||value==='1'||String(value).toLowerCase()==='true')return true;
  if(value===false||value===0||value==='0'||String(value).toLowerCase()==='false')return false;
  return null;
}

export function classifyGeotabLocationState(input,now=Date.now()){
  const hasAssignment=input?.hasAssignment!==false;
  const equipmentType=String(input?.equipmentType??'').toLowerCase();
  const trailer=equipmentType==='trailer';
  const communicating=boolOrNull(input?.communicating);
  const gpsMs=parseDateMs(input?.gpsObservedAt);
  const yard=String(input?.yard??'').trim();
  const ageMinutes=gpsMs==null?null:Math.max(0,(now-gpsMs)/60000);

  if(!hasAssignment){
    return{
      code:'UNMAPPED',label:'Not mapped',detail:'No valid current Geotab device assignment.',
      ageMinutes,stale:false,actuallyNotTracking:false,locationUsable:false,
    };
  }

  if(communicating===false){
    return{
      code:'NOT_TRACKING',label:'Not tracking',detail:'Geotab reports that this device is not communicating.',
      ageMinutes,stale:false,actuallyNotTracking:true,locationUsable:gpsMs!=null,
    };
  }

  if(gpsMs==null){
    return{
      code:'NO_GPS_DATA',label:'No GPS data',detail:'A device is assigned, but no usable GPS position has been saved yet.',
      ageMinutes:null,stale:false,actuallyNotTracking:false,locationUsable:false,
    };
  }

  const liveMinutes=trailer?60:15;
  const recentMinutes=trailer?360:60;
  if(ageMinutes<=liveMinutes){
    return{
      code:'LIVE',label:'Live',detail:'GPS is current.',ageMinutes,stale:false,
      actuallyNotTracking:false,locationUsable:true,
    };
  }
  if(ageMinutes<=recentMinutes){
    return{
      code:'RECENT',label:'Recent',detail:'GPS is older, but still within the normal recent window.',ageMinutes,stale:false,
      actuallyNotTracking:false,locationUsable:true,
    };
  }
  if(yard){
    return{
      code:'PARKED_CONFIRMED',label:'Parked · last confirmed',
      detail:'GPS is old, but the last good position was inside a known yard. Keep that yard until movement proves otherwise.',
      ageMinutes,stale:true,actuallyNotTracking:false,locationUsable:true,
    };
  }
  return{
    code:'STALE_LAST_KNOWN',label:'Stale · last known',
    detail:'GPS is old. The last position is retained, but it was not inside a known yard.',
    ageMinutes,stale:true,actuallyNotTracking:false,locationUsable:true,
  };
}

export function geotabAgeLabel(ageMinutes){
  if(ageMinutes==null||!Number.isFinite(Number(ageMinutes)))return 'never';
  const minutes=Math.max(0,Math.round(Number(ageMinutes)));
  if(minutes<60)return `${minutes} min ago`;
  const hours=Math.round((minutes/60)*10)/10;
  if(hours<48)return `${hours} hr ago`;
  return `${Math.round((hours/24)*10)/10} days ago`;
}
