export const AI_READING_PROMPT=`Read this outside-repair invoice carefully. Do not guess or invent anything. Return only these labels, one per line. If a value is unclear, write UNCERTAIN instead of guessing.
VENDOR:
INVOICE NUMBER:
SERVICE DATE: YYYY-MM-DD
UNIT:
MILEAGE:
SERVICE CALL:
LABOR:
PARTS:
TAX:
TOTAL:
WORK PERFORMED:
UNCERTAIN:`;

const UNCERTAIN_RE=/\b(?:uncertain|unclear|illegible|unknown|not\s+sure|cannot\s+read|can't\s+read|could\s+be|maybe|verify|year\s+unclear)\b/i;
const FINANCIAL_LABEL_RE=/^(?:service\s*call|labor|labour|parts|tax|subtotal|total|amount\s+due)\b/i;
const STOP_SECTION_RE=/^(?:vendor|invoice(?:\s*\/\s*ro)?(?:\s+number)?|service\s+date|date|unit|truck|tractor|vehicle|equipment|asset|mileage|odometer|service\s*call|labor|labour|parts|tax|subtotal|total|amount\s+due|uncertain)\b/i;

function cleanLine(value){return String(value??'').replace(/^\s*[-*•]+\s*/,'').replace(/\*\*/g,'').replace(/^#+\s*/,'').replace(/\s+/g,' ').trim();}
function linesFrom(text){return String(text??'').split(/\r?\n/).map(cleanLine).filter(Boolean);}
function escapeRe(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function labeledValue(lines,labels){const pattern=new RegExp(`^(?:${labels.map(escapeRe).join('|')})\\s*[:#=-]\\s*(.*)$`,'i');for(const line of lines){const match=line.match(pattern);if(match)return String(match[1]??'').trim();}return'';}
function markedUncertain(value){return !value||/^uncertain\b/i.test(value)||UNCERTAIN_RE.test(value);}
function moneyValue(value){if(markedUncertain(value))return'';const match=String(value).replace(/,/g,'').match(/-?\$?\s*(\d+(?:\.\d{1,2})?)/);if(!match)return'';const number=Number(match[1]);return Number.isFinite(number)&&number>=0?number.toFixed(2):'';}
function mileageValue(value){if(markedUncertain(value))return'';const match=String(value).replace(/,/g,'').match(/\b(\d{1,8})\b/);return match?match[1]:'';}
function normalizeDate(value){if(markedUncertain(value))return'';const raw=String(value).trim();let match=raw.match(/\b(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)\b/);if(match)return`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;match=raw.match(/\b([01]?\d)[-/]([0-3]?\d)[-/](20\d{2})\b/);if(match)return`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;match=raw.match(/\b([01]?\d)[-/]([0-3]?\d)[-/](\d{2})\b/);if(match)return`20${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;return'';}
function trimVendor(value){return String(value??'').replace(/\s+[—–-]\s+[^—–]+$/,'').replace(/^["']|["']$/g,'').trim();}
function fallbackVendor(lines){for(const line of lines.slice(0,5)){if(/^(?:name|city|state|date|no\.?|invoice|unit)\b/i.test(line))continue;const candidate=trimVendor(line);if(/\b(?:repair|service|services|truck|diesel|tire|auto|automotive|inc\.?|llc|corp\.?|company|co\.?)\b/i.test(candidate))return candidate;}return'';}
function fallbackNumbers(lines){const values=[];for(const line of lines){const match=line.match(/^no\.?\s*:?\s*(\d{2,10})\b/i);if(match)values.push(match[1]);}return values;}
function sectionValue(lines,labels){const pattern=new RegExp(`^(?:${labels.map(escapeRe).join('|')})\\s*:\\s*(.*)$`,'i');for(let i=0;i<lines.length;i++){const match=lines[i].match(pattern);if(!match)continue;const out=[];if(match[1])out.push(match[1]);for(let j=i+1;j<lines.length;j++){const next=lines[j];if(STOP_SECTION_RE.test(next)&&/:/.test(next))break;if(FINANCIAL_LABEL_RE.test(next))break;out.push(next);}return out.join('\n').trim();}return'';}
function addUncertain(list,label,value){if(value&&markedUncertain(value)&&!list.includes(label))list.push(label);}
function costLine(label,value){return value?`${label} $${value}`:'';}

export function parseAiReading(text){
  const lines=linesFrom(text);const uncertain=[];
  const vendorRaw=labeledValue(lines,['vendor','outside vendor']);
  const invoiceRaw=labeledValue(lines,['invoice number','invoice / ro number','invoice no','invoice #','ro number','ro #']);
  const dateRaw=labeledValue(lines,['service date','invoice date','date']);
  const unitRaw=labeledValue(lines,['unit','unit number','truck','tractor','vehicle','equipment','asset']);
  const mileageRaw=labeledValue(lines,['mileage','invoice mileage','odometer']);
  const serviceCallRaw=labeledValue(lines,['service call','road call']);
  const laborRaw=labeledValue(lines,['labor','labour']);
  const partsRaw=labeledValue(lines,['parts']);
  const taxRaw=labeledValue(lines,['tax']);
  const totalRaw=labeledValue(lines,['total','invoice total','amount due']);
  const noValues=fallbackNumbers(lines);
  let vendor=markedUncertain(vendorRaw)?'':trimVendor(vendorRaw);
  if(!vendor)vendor=fallbackVendor(lines);
  let invoiceNumber=markedUncertain(invoiceRaw)?'':invoiceRaw.replace(/^#\s*/,'').trim();
  if(!invoiceNumber&&noValues.length)invoiceNumber=noValues[0];
  let unit=markedUncertain(unitRaw)?'':unitRaw.trim();
  if(!unit&&noValues.length>1&&noValues[1]!==invoiceNumber)unit=noValues[1];
  const invoiceDate=normalizeDate(dateRaw);
  const mileage=mileageValue(mileageRaw);
  const serviceCall=moneyValue(serviceCallRaw);const labor=moneyValue(laborRaw);const parts=moneyValue(partsRaw);const tax=moneyValue(taxRaw);const totalAmount=moneyValue(totalRaw);
  let serviceSummary=sectionValue(lines,['work performed','service summary','repairs performed','service','description']);
  if(markedUncertain(serviceSummary))serviceSummary='';
  const breakdown=[costLine('Service call',serviceCall),costLine('Labor',labor),costLine('Parts',parts),costLine('Tax',tax),costLine('Total',totalAmount)].filter(Boolean).join(' · ');
  if(breakdown)serviceSummary=`${serviceSummary}${serviceSummary?'\n\n':''}Cost breakdown: ${breakdown}`;
  addUncertain(uncertain,'Vendor',vendorRaw);addUncertain(uncertain,'Invoice number',invoiceRaw);addUncertain(uncertain,'Service date',dateRaw);addUncertain(uncertain,'Unit',unitRaw);addUncertain(uncertain,'Mileage',mileageRaw);addUncertain(uncertain,'Total',totalRaw);
  if(dateRaw&&!invoiceDate&&!uncertain.includes('Service date'))uncertain.push('Service date');
  for(const line of lines){if(UNCERTAIN_RE.test(line)&&!uncertain.includes(line))uncertain.push(line);}
  return{vendor,invoiceNumber,invoiceDate,unit,mileage,totalAmount,serviceSummary,costs:{serviceCall,labor,parts,tax,total:totalAmount},uncertain};
}
