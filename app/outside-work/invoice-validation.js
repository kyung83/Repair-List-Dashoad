export function normalizePhone(value=''){
  let digits=String(value||'').replace(/\D/g,'');
  if(digits.length===11&&digits.startsWith('1'))digits=digits.slice(1);
  return digits.length===10?digits:'';
}

export function formatPhone(digits=''){
  const normalized=normalizePhone(digits);
  return normalized?`(${normalized.slice(0,3)}) ${normalized.slice(3,6)}-${normalized.slice(6)}`:'';
}

export function detectVendorPhone(text=''){
  const rows=String(text||'').split(/\r?\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean);
  const candidates=[];
  const phonePattern=/(?:\+?1[\s().-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/g;
  for(let index=0;index<Math.min(rows.length,80);index++){
    const line=rows[index];
    if(/\b(?:FAX|FACSIMILE)\b/i.test(line))continue;
    const matches=line.match(phonePattern)||[];
    for(const raw of matches){
      const digits=normalizePhone(raw);
      if(!digits)continue;
      let score=100-index;
      if(/\b(?:PHONE|TEL|TELEPHONE|CALL)\b/i.test(line))score+=80;
      if(index<30)score+=25;
      if(/\b(?:CUSTOMER|BILL\s+TO|DELIVER\s+TO|SHIP\s+TO)\b/i.test(line))score-=60;
      candidates.push({digits,raw:formatPhone(digits),score});
    }
  }
  if(!candidates.length)return{digits:'',raw:'',confidence:0};
  candidates.sort((a,b)=>b.score-a.score);
  const best=candidates[0];
  const tied=candidates.filter(item=>item.score===best.score&&item.digits!==best.digits);
  if(tied.length)return{digits:'',raw:'',confidence:0};
  return{digits:best.digits,raw:best.raw,confidence:best.score>=180?.99:best.score>=120?.94:.86};
}

function moneyValues(line=''){
  const matches=String(line).match(/(?:\$\s*)?-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|(?:\$\s*)?-?\d+\.\d{2}/g)||[];
  return matches.map(raw=>Number(raw.replace(/[$,\s]/g,''))).filter(value=>Number.isFinite(value)&&value>=0&&value<=1_000_000);
}

function labeledAmount(lines,label){
  const candidates=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(!label.test(line)||/\b(?:SUBTOTAL|SUB\s+TOTAL|GRAND\s+TOTAL|TOTAL\s+DUE|AMOUNT\s+DUE)\b/i.test(line))continue;
    const values=moneyValues(line);
    if(values.length){candidates.push(values.at(-1));continue;}
    if(i+1<lines.length){
      const next=moneyValues(lines[i+1]);
      if(next.length&&lines[i+1].length<40)candidates.push(next.at(-1));
    }
  }
  return candidates.length===1?candidates[0]:null;
}

export function simpleChargeBreakdown(text=''){
  const lines=String(text||'').split(/\r?\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean);
  return{
    serviceCall:labeledAmount(lines,/^(?:SERVICE\s*CALL|ROAD\s*CALL|MOBILE\s*SERVICE|CALL\s*OUT)\b/i),
    labor:labeledAmount(lines,/^LAB(?:O|OU)R\b/i),
    parts:labeledAmount(lines,/^PARTS?\b/i),
    tax:labeledAmount(lines,/^(?:SALES\s+)?TAX\b/i),
  };
}

export function validateSimpleInvoiceArithmetic(text='',enteredTotal=0){
  const components=simpleChargeBreakdown(text);
  const present=Object.entries(components).filter(([,value])=>typeof value==='number'&&Number.isFinite(value));
  const meaningful=present.filter(([key])=>key!=='tax');
  if(meaningful.length<3)return{status:'insufficient',components,sum:null,total:Number(enteredTotal)||0,difference:null};
  const sum=present.reduce((total,[,value])=>total+Number(value||0),0);
  const total=Number(enteredTotal)||0;
  const difference=Math.round((sum-total)*100)/100;
  return{
    status:Math.abs(difference)<=0.02?'balanced':'mismatch',
    components,
    sum:Math.round(sum*100)/100,
    total:Math.round(total*100)/100,
    difference,
  };
}

export function isOwnFleetCompany(value=''){
  return /\b(?:NORTHERN\s+LOGISTICS|NORLOWORLD)\b/i.test(String(value||''));
}
