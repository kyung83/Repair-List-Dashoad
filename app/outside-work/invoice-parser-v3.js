import {
  parseOutsideWorkInvoice as parseV2,
  suspiciousInvoiceNumber,
  suspiciousServiceSummary,
  suspiciousVendor,
} from "./invoice-parser-v2.js";
import { parseDateToken } from "./invoice-parser.js";

export { suspiciousInvoiceNumber, suspiciousServiceSummary, suspiciousVendor };

const out=(value="",confidence=0,source="")=>({value,confidence,source});
const clean=value=>String(value||"").replace(/[|]+/g," ").replace(/\s+/g," ").trim();
const lines=text=>String(text||"").split(/\r?\n/).map(clean).filter(Boolean);

function parseFirstDate(value){
  const candidates=clean(value).toUpperCase().match(/\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[- ]?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[- ]?\d{2,4}|(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[ -]\d{1,2},?[ -]\d{2,4})\b/g)||[];
  for(const candidate of candidates){const parsed=parseDateToken(candidate);if(parsed)return parsed;}
  return"";
}

function detectExplicitInvoiceDate(text){
  const label=/\b(?:INVOICE\s*DATE|INV\.?\s*DATE|SERVICE\s*DATE|REPAIR\s*DATE|CLOSED\s*DATE|COMPLETED\s*DATE)\b\s*[:#=.-]*/i;
  for(const line of lines(text)){
    const match=line.match(label);
    if(!match||match.index===undefined)continue;
    const value=parseFirstDate(line.slice(match.index+match[0].length));
    if(value)return out(value,.999,"explicit invoice/service date");
  }
  return out();
}

export function parseOutsideWorkInvoice(text){
  const parsed=parseV2(text);
  const explicitDate=detectExplicitInvoiceDate(text);
  return {
    ...parsed,
    invoiceDate:explicitDate.confidence>parsed.invoiceDate.confidence?explicitDate:parsed.invoiceDate,
  };
}
