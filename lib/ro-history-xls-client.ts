export type HistoricalPackage = {
  v: 2;
  meta: {
    importKey: string;
    sourceName: string;
    sourceSha256: string;
    rawSourceRows: number;
    rawSourceRos: number;
    historyStart: string;
    historyEnd: string;
  };
  ros: Array<{
    unit: string;
    roNumber: string;
    roDate: string;
    location: string;
    status: string;
    lines: Array<{
      systemCode: string;
      assemblyCode: string;
      description: string;
      laborHours: number;
      laborCost: number;
      partsCost: number;
      subletCost: number;
      totalCost: number;
    }>;
  }>;
};

const END = 0xfffffffe;
const FREE = 0xffffffff;
const EXPECTED_HEADERS = [
  'Invoiced Customer','Location','Unit#','Active','RO#','RO Date','RO Type','Cause/Reason','Correction / Task',
  'SYS','ASM','VMRS Description','Labour Hours','Labour Charge','Parts Charge','Shop Supply Charge','Total Charge',
  'Labour Cost','Parts Cost','Labour Sublet Cost','Part Sublet Cost','Total Cost','Status',
];

function u16(v: DataView, o: number) { return v.getUint16(o, true); }
function u32(v: DataView, o: number) { return v.getUint32(o, true); }
function clean(v: unknown) { return String(v ?? '').trim(); }
function number(v: unknown) { const n = Number(v ?? 0); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function isoDate(v: unknown) {
  if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString().slice(0, 10);
  const text = clean(v).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  throw new Error(`Invalid RO date: ${clean(v) || '(blank)'}`);
}
function excelDate(serial: number, date1904: boolean) {
  const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
  return new Date(epoch + serial * 86400000);
}
function rkValue(raw: number) {
  const mult100 = raw & 1;
  let value: number;
  if (raw & 2) value = (raw >> 2);
  else {
    const buffer = new ArrayBuffer(8); const dv = new DataView(buffer);
    dv.setUint32(0, 0, true); dv.setUint32(4, raw & 0xfffffffc, true); value = dv.getFloat64(0, true);
  }
  return mult100 ? value / 100 : value;
}

class OleFile {
  private bytes: Uint8Array; private view: DataView; sectorSize: number; miniSize: number; miniCut: number;
  private firstDir: number; private fat: number[] = []; private miniFat: number[] = []; private rootStream = new Uint8Array();
  entries: Array<{name:string;type:number;start:number;size:number}> = [];
  constructor(buffer: ArrayBuffer) {
    this.bytes = new Uint8Array(buffer); this.view = new DataView(buffer);
    if (this.bytes.length < 512 || Array.from(this.bytes.slice(0,8)).map(x=>x.toString(16).padStart(2,'0')).join('') !== 'd0cf11e0a1b11ae1') throw new Error('File is not a legacy Excel .xls workbook.');
    this.sectorSize = 1 << u16(this.view, 0x1e); this.miniSize = 1 << u16(this.view, 0x20);
    const fatN=u32(this.view,0x2c); this.firstDir=u32(this.view,0x30); this.miniCut=u32(this.view,0x38);
    const firstMini=u32(this.view,0x3c), miniN=u32(this.view,0x40), firstDifat=u32(this.view,0x44), difatN=u32(this.view,0x48);
    const difat:number[]=[]; for(let i=0;i<109;i++){const x=u32(this.view,0x4c+i*4); if(x!==FREE&&x!==END)difat.push(x)}
    let sid=firstDifat; for(let i=0;i<difatN&&sid!==END&&sid!==FREE;i++){const d=this.sector(sid), dv=new DataView(d.buffer,d.byteOffset,d.byteLength), n=d.byteLength/4; for(let j=0;j<n-1;j++){const x=dv.getUint32(j*4,true); if(x!==FREE&&x!==END)difat.push(x)} sid=dv.getUint32((n-1)*4,true)}
    for(const fsid of difat.slice(0,fatN)){const d=this.sector(fsid),dv=new DataView(d.buffer,d.byteOffset,d.byteLength);for(let i=0;i<d.byteLength/4;i++)this.fat.push(dv.getUint32(i*4,true))}
    const dir=this.concat(this.chain(this.firstDir,this.fat).map(x=>this.sector(x)));
    for(let i=0;i+128<=dir.length;i+=128){const dv=new DataView(dir.buffer,dir.byteOffset+i,128),nlen=dv.getUint16(64,true),type=dir[i+66],start=dv.getUint32(116,true),size=Number(dv.getBigUint64(120,true));if(nlen>=2){const raw=dir.slice(i,i+nlen-2);let name='';for(let j=0;j+1<raw.length;j+=2)name+=String.fromCharCode(raw[j]|raw[j+1]<<8);if(name)this.entries.push({name,type,start,size})}}
    const root=this.entries.find(e=>e.type===5);
    if(miniN&&firstMini!==END&&firstMini!==FREE){const md=this.concat(this.chain(firstMini,this.fat).map(x=>this.sector(x))),dv=new DataView(md.buffer,md.byteOffset,md.byteLength);for(let i=0;i+4<=md.length;i+=4)this.miniFat.push(dv.getUint32(i,true))}
    if(root&&root.size)this.rootStream=this.concat(this.chain(root.start,this.fat).map(x=>this.sector(x))).slice(0,root.size);
  }
  private sector(sid:number){const start=512+sid*this.sectorSize;return this.bytes.slice(start,start+this.sectorSize)}
  private chain(start:number,table:number[]){const out:number[]=[],seen=new Set<number>();let sid=start;while(sid!==END&&sid!==FREE&&sid<table.length&&!seen.has(sid)&&out.length<1_000_000){out.push(sid);seen.add(sid);sid=table[sid]}return out}
  private concat(chunks:Uint8Array[]){const len=chunks.reduce((s,c)=>s+c.length,0),out=new Uint8Array(len);let o=0;for(const c of chunks){out.set(c,o);o+=c.length}return out}
  stream(name:string){const e=this.entries.find(x=>x.name===name);if(!e)throw new Error(`Excel workbook stream ${name} was not found.`);if(e.size<this.miniCut&&e.type===2){return this.concat(this.chain(e.start,this.miniFat).map(msid=>this.rootStream.slice(msid*this.miniSize,(msid+1)*this.miniSize))).slice(0,e.size)}return this.concat(this.chain(e.start,this.fat).map(x=>this.sector(x))).slice(0,e.size)}
}

type Rec={pos:number;rid:number;data:Uint8Array};
function records(bytes:Uint8Array,start=0,end=bytes.length){const out:Rec[]=[];for(let pos=start;pos+4<=end;){const dv=new DataView(bytes.buffer,bytes.byteOffset+pos),rid=dv.getUint16(0,true),len=dv.getUint16(2,true);if(pos+4+len>end)break;out.push({pos,rid,data:bytes.slice(pos+4,pos+4+len)});pos+=4+len}return out}
class ChunkReader{private i=0;private off=0;constructor(private chunks:Uint8Array[]){}private advance(){while(this.i<this.chunks.length&&this.off>=this.chunks[this.i].length){this.i++;this.off=0}if(this.i>=this.chunks.length)throw new Error('Unexpected end of Excel shared strings.')}read(n:number){const out=new Uint8Array(n);let p=0;while(n){this.advance();const c=this.chunks[this.i],take=Math.min(n,c.length-this.off);out.set(c.slice(this.off,this.off+take),p);this.off+=take;p+=take;n-=take}return out}u8(){return this.read(1)[0]}u16(){const x=this.read(2);return x[0]|x[1]<<8}u32(){const x=this.read(4);return (x[0]|x[1]<<8|x[2]<<16|x[3]<<24)>>>0}chars(count:number,high:boolean){let text='';let rem=count;while(rem){this.advance();const c=this.chunks[this.i],bpc=high?2:1,avail=c.length-this.off,nchar=Math.min(rem,Math.floor(avail/bpc));if(nchar){if(high){for(let j=0;j<nchar;j++){const k=this.off+j*2;text+=String.fromCharCode(c[k]|c[k+1]<<8)}}else{text+=new TextDecoder('windows-1252').decode(c.slice(this.off,this.off+nchar))}this.off+=nchar*bpc;rem-=nchar}if(rem){if(this.off<c.length)this.off=c.length;this.i++;this.off=0;if(this.i>=this.chunks.length)throw new Error('Broken Excel shared string continuation.');const flag=this.chunks[this.i][0];this.off=1;high=Boolean(flag&1)}}return text}}
function parseSst(wb:Uint8Array){const recs=records(wb),idx=recs.findIndex(r=>r.rid===0x00fc);if(idx<0)return[];const chunks=[recs[idx].data];for(let i=idx+1;i<recs.length&&recs[i].rid===0x003c;i++)chunks.push(recs[i].data);const r=new ChunkReader(chunks);r.u32();const unique=r.u32(),out:string[]=[];for(let i=0;i<unique;i++){const cch=r.u16(),flags=r.u8(),rich=flags&0x08?r.u16():0,ext=flags&0x04?r.u32():0;out.push(r.chars(cch,Boolean(flags&1)));if(rich)r.read(rich*4);if(ext)r.read(ext)}return out}
function decodeUnicode(data:Uint8Array,offset=0){const dv=new DataView(data.buffer,data.byteOffset,data.byteLength);const cch=dv.getUint16(offset,true);offset+=2;const flags=data[offset++];let rich=0,ext=0;if(flags&0x08){rich=dv.getUint16(offset,true);offset+=2}if(flags&0x04){ext=dv.getUint32(offset,true);offset+=4}let text='';if(flags&1){for(let i=0;i<cch;i++){text+=String.fromCharCode(data[offset+i*2]|data[offset+i*2+1]<<8)}}else{text=new TextDecoder('windows-1252').decode(data.slice(offset,offset+cch))}void rich;void ext;return text}

type Cell=string|number|boolean|Date|null;
function parseWorkbook(buffer:ArrayBuffer){const ole=new OleFile(buffer),name=ole.entries.some(e=>e.name==='Workbook')?'Workbook':'Book',wb=ole.stream(name),recs=records(wb),bounds:Array<{name:string;start:number}>=[],xfs:Array<{fmt:number}>=[],dateFmts=new Set<number>([14,15,16,17,18,19,20,21,22]),formats=new Map<number,string>();let date1904=false;
  for(const r of recs){const d=r.data,dv=new DataView(d.buffer,d.byteOffset,d.byteLength);if(r.rid===0x0085&&d.length>=8){const start=dv.getUint32(0,true),cch=d[6],flags=d[7],raw=d.slice(8,8+cch*(flags&1?2:1));let n='';if(flags&1){for(let i=0;i+1<raw.length;i+=2)n+=String.fromCharCode(raw[i]|raw[i+1]<<8)}else n=new TextDecoder('windows-1252').decode(raw);bounds.push({name:n,start})}else if(r.rid===0x00e0&&d.length>=4)xfs.push({fmt:dv.getUint16(2,true)});else if(r.rid===0x041e&&d.length>=5){const id=dv.getUint16(0,true);try{formats.set(id,decodeUnicode(d,2))}catch{}}else if(r.rid===0x0022&&d.length>=2)date1904=Boolean(dv.getUint16(0,true))}
  for(const [id,fmt] of formats){const lo=fmt.toLowerCase();if(['yy','mm','dd','hh','ss'].some(t=>lo.includes(t)))dateFmts.add(id)}
  const sst=parseSst(wb),sheets:Array<{name:string;rows:Map<number,Map<number,Cell>>}>=[];
  for(let bi=0;bi<bounds.length;bi++){const start=bounds[bi].start,end=bi+1<bounds.length?bounds[bi+1].start:wb.length,rows=new Map<number,Map<number,Cell>>();const set=(row:number,col:number,v:Cell)=>{let m=rows.get(row);if(!m){m=new Map();rows.set(row,m)}m.set(col,v)};for(const r of records(wb,start,end)){const d=r.data,dv=new DataView(d.buffer,d.byteOffset,d.byteLength);let row=0,col=0,xf=0,v:Cell=null;if(r.rid===0x00fd&&d.length>=10){row=dv.getUint16(0,true);col=dv.getUint16(2,true);xf=dv.getUint16(4,true);v=sst[dv.getUint32(6,true)]??'';set(row,col,v)}else if(r.rid===0x0203&&d.length>=14){row=dv.getUint16(0,true);col=dv.getUint16(2,true);xf=dv.getUint16(4,true);v=dv.getFloat64(6,true);if(dateFmts.has(xfs[xf]?.fmt))v=excelDate(v as number,date1904);set(row,col,v)}else if(r.rid===0x027e&&d.length>=10){row=dv.getUint16(0,true);col=dv.getUint16(2,true);xf=dv.getUint16(4,true);v=rkValue(dv.getUint32(6,true));if(dateFmts.has(xfs[xf]?.fmt))v=excelDate(v as number,date1904);set(row,col,v)}else if(r.rid===0x00bd&&d.length>=6){row=dv.getUint16(0,true);const first=dv.getUint16(2,true),last=dv.getUint16(d.length-2,true);let p=4;for(col=first;col<=last;col++){xf=dv.getUint16(p,true);v=rkValue(dv.getUint32(p+2,true));p+=6;if(dateFmts.has(xfs[xf]?.fmt))v=excelDate(v as number,date1904);set(row,col,v)}}else if(r.rid===0x0204&&d.length>=8){row=dv.getUint16(0,true);col=dv.getUint16(2,true);v=decodeUnicode(d,6);set(row,col,v)}}sheets.push({name:bounds[bi].name,rows})}
  return sheets;
}

export async function parseNorlowHistoryXls(file: File, importKey = 'ro-history-9309499-v1'): Promise<HistoricalPackage> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sourceSha256 = Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
  const sheets=parseWorkbook(bytes); if(!sheets.length)throw new Error('No worksheets were found in the Excel export.');
  const ros=new Map<string,HistoricalPackage['ros'][number]>(); const lineMaps=new Map<string,Map<string,HistoricalPackage['ros'][number]['lines'][number]>>(); const seenSourceRows=new Set<string>(); let rawSourceRows=0,historyStart='9999-12-31',historyEnd='0000-00-00',headerValidated=false;
  for(const sheet of sheets){const rowNumbers=[...sheet.rows.keys()].sort((a,b)=>a-b);let dataStart=rowNumbers[0]??0;for(const rn of rowNumbers){const row=sheet.rows.get(rn)!;const vals=EXPECTED_HEADERS.map((_,i)=>clean(row.get(i)));if(EXPECTED_HEADERS.every((h,i)=>vals[i]===h)){headerValidated=true;dataStart=rn+1;break}}
    if(!headerValidated&&sheet===sheets[0])throw new Error('This Excel file does not have the expected Norlow RO History report columns.');
    for(const rn of rowNumbers){if(rn<dataStart)continue;const row=sheet.rows.get(rn)!;const roNumber=clean(row.get(4)).toUpperCase();if(!roNumber.startsWith('WO'))continue;const sourceFingerprint=EXPECTED_HEADERS.map((_,i)=>{const v=row.get(i);return v instanceof Date?v.toISOString():typeof v==='number'?String(number(v)):clean(v)}).join('\u001e');if(seenSourceRows.has(sourceFingerprint))continue;seenSourceRows.add(sourceFingerprint);const unit=clean(row.get(2));const roDate=isoDate(row.get(5));const location=clean(row.get(1));const status=clean(row.get(22)).toUpperCase();const systemCode=clean(row.get(9)).toUpperCase(),assemblyCode=clean(row.get(10)).toUpperCase(),description=clean(row.get(11))||'Unspecified repair';const laborHours=number(row.get(12)),laborCost=number(row.get(17)),partsCost=number(row.get(18)),subletCost=number(row.get(19))+number(row.get(20)),totalCost=number(row.get(21));let ro=ros.get(roNumber);if(!ro){ro={unit,roNumber,roDate,location,status,lines:[]};ros.set(roNumber,ro);lineMaps.set(roNumber,new Map());historyStart=roDate<historyStart?roDate:historyStart;historyEnd=roDate>historyEnd?roDate:historyEnd}else if(ro.unit!==unit||ro.roDate!==roDate)throw new Error(`RO ${roNumber} has inconsistent unit/date rows in the export.`);const key=`${systemCode}\u001f${assemblyCode}\u001f${description}`;const lm=lineMaps.get(roNumber)!;const existing=lm.get(key);if(existing){existing.laborHours=number(existing.laborHours+laborHours);existing.laborCost=number(existing.laborCost+laborCost);existing.partsCost=number(existing.partsCost+partsCost);existing.subletCost=number(existing.subletCost+subletCost);existing.totalCost=number(existing.totalCost+totalCost)}else{const line={systemCode,assemblyCode,description,laborHours,laborCost,partsCost,subletCost:number(subletCost),totalCost};lm.set(key,line);ro.lines.push(line)}rawSourceRows++;}
  }
  if(!headerValidated||!rawSourceRows||!ros.size)throw new Error('No repair-order rows were found in the Excel export.');
  return {v:2,meta:{importKey,sourceName:file.name,sourceSha256,rawSourceRows,rawSourceRos:ros.size,historyStart,historyEnd},ros:[...ros.values()].sort((a,b)=>a.roDate.localeCompare(b.roDate)||a.roNumber.localeCompare(b.roNumber))};
}
