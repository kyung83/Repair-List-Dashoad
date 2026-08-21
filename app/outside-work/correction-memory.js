export const LEARNABLE_FIELDS=['vendorName','invoiceNumber','invoiceDate','mileage','totalAmount'];

export function normalizeCorrectionValue(field,value=''){
  const raw=String(value??'').trim();
  if(!raw)return'';
  if(field==='vendorName')return raw.toUpperCase().replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  if(field==='invoiceNumber')return raw.toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9./:_-]+/g,'');
  if(field==='invoiceDate')return raw.replace(/[^0-9-]+/g,'');
  if(field==='mileage')return raw.replace(/\D/g,'');
  if(field==='totalAmount'){
    const number=Number(raw.replace(/[$,\s]/g,''));
    return Number.isFinite(number)?number.toFixed(2):'';
  }
  return raw.toUpperCase().replace(/\s+/g,' ').trim();
}

export function correctionCandidates(rules,field,detectedValue,vendorId=null){
  const key=normalizeCorrectionValue(field,detectedValue);
  if(!key)return[];
  return (Array.isArray(rules)?rules:[]).filter(rule=>{
    if(rule.fieldName!==field||rule.detectedKey!==key||Number(rule.confirmations||0)<2)return false;
    if(field==='vendorName')return true;
    return vendorId!=null&&Number(rule.vendorId)===Number(vendorId);
  });
}

export function applyLearnedCorrection(rules,field,detectedValue,vendorId=null){
  const candidates=correctionCandidates(rules,field,detectedValue,vendorId);
  if(!candidates.length)return null;
  const byValue=new Map();
  for(const rule of candidates){
    const key=normalizeCorrectionValue(field,rule.correctedValue);
    if(!key)continue;
    const current=byValue.get(key);
    if(!current||Number(rule.confirmations||0)>Number(current.confirmations||0))byValue.set(key,rule);
  }
  if(byValue.size!==1)return null;
  return [...byValue.values()][0];
}
