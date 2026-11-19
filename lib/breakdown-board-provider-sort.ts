/**
 * Client-side Breakdown Board grouping for final-cost entry.
 * Reads existing provider snapshots and repair category; no DB/schema changes.
 */
export type BoardStageFilter='all'|'reported'|'diagnostics'|'enroute'|'onlocation'|'readyForTotals';
export type BoardSortMode='newest'|'provider'|'category'|'providerCategory';
export const UNASSIGNED_PROVIDER='__unassigned__';

export type BoardRow={
  id:number;stage:number;status:string;unit:string;driver_name:string;city:string;state:string;
  repair_category:string;repair_needed:string|null;description:string;
  service_provider:string|null;eta:string|null;updated_at:string;
};
export type BoardFilters={
  stage:BoardStageFilter;
  repairCategory:string;
  provider:string;
  search:string;
  sort:BoardSortMode;
};

const collator=new Intl.Collator('en-US',{sensitivity:'base',numeric:true});
const normalized=(value:unknown)=>String(value??'').trim().toLowerCase();
function category(row:BoardRow){return String(row.repair_needed||row.repair_category||'').trim();}
function provider(row:BoardRow){return String(row.service_provider||'').trim();}
function compareEmptyLast(a:string,b:string){
  if(!a)return b?1:0;
  if(!b)return -1;
  return collator.compare(a,b);
}

export function breakdownProviderNames(rows:readonly Pick<BoardRow,'service_provider'>[]){
  const names=new Map<string,string>();
  for(const row of rows){
    const name=provider(row as BoardRow);
    if(name&&!names.has(normalized(name)))names.set(normalized(name),name);
  }
  return [...names.values()].sort((a,b)=>collator.compare(a,b));
}

export function breakdownBoardRows<T extends BoardRow>(rows:readonly T[],filters:BoardFilters):T[]{
  const query=normalized(filters.search);
  const providerChoice=normalized(filters.provider);
  const shown=rows.filter(row=>{
    if(filters.stage==='reported'&&row.stage!==1)return false;
    if(filters.stage==='diagnostics'&&row.stage!==2)return false;
    if(filters.stage==='enroute'&&row.stage!==3)return false;
    if(filters.stage==='onlocation'&&row.stage!==4)return false;
    if(filters.stage==='readyForTotals'&&normalized(row.status)!=='ready_for_review')return false;
    if(filters.repairCategory&&category(row)!==filters.repairCategory)return false;
    const providerName=normalized(provider(row));
    if(providerChoice===UNASSIGNED_PROVIDER&&providerName)return false;
    if(providerChoice&&providerChoice!==UNASSIGNED_PROVIDER&&providerName!==providerChoice)return false;
    if(!query)return true;
    return [row.id,row.unit,row.driver_name,row.city,row.state,row.repair_category,row.repair_needed,row.description,row.service_provider,row.eta].join(' ').toLowerCase().includes(query);
  });
  if(filters.sort==='newest')return shown; // Preserve the original server order.
  return shown.sort((a,b)=>{
    const byProvider=compareEmptyLast(provider(a),provider(b));
    const byCategory=compareEmptyLast(category(a),category(b));
    const difference=filters.sort==='provider'
      ?byProvider
      :filters.sort==='category'
        ?byCategory
        :byProvider||byCategory;
    return difference||b.updated_at.localeCompare(a.updated_at)||b.id-a.id;
  });
}
