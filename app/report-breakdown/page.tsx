'use client';

import { useEffect, useRef, useState } from 'react';
import DriverFollowup from './driver-followup';

type UnitType = '' | 'truck' | 'trailer';
type UnitResult = { unit: string; equipmentType: string };
type SubmitResult = { ok: true; breakdownId: number; driverToken: string } | { error: string } | null;
type SnapshotChoice = '' | 'verified' | 'corrected' | 'unavailable';
type BreakdownSubmitPayload = {
  ok?: boolean;
  breakdownId?: number;
  driverToken?: string;
  error?: string;
  manualFallbackRequired?: boolean;
};
type GeotabPreview = {
  status: 'idle' | 'loading' | 'available' | 'unavailable' | 'error';
  driverName?: string;
  city?: string;
  state?: string;
  observedAt?: string;
  error?: string;
};
type BreakdownSubcategory = { id:number; categoryId:number; name:string; active:boolean; sortOrder:number };
type BreakdownCategory = {
  id:number;
  name:string;
  requiresPosition:boolean;
  requiresTireSize:boolean;
  active:boolean;
  sortOrder:number;
  subcategories:BreakdownSubcategory[];
};
type Axle = { label: string; positions: { code: string; label: string }[] };

const ACTIVE_BREAKDOWN_KEY='norlow-active-driver-breakdown';

const TRUCK_TIRE_AXLES: Axle[] = [
  { label: 'Axle 1 · Steer', positions: [{ code: 'A1L', label: 'Left' }, { code: 'A1R', label: 'Right' }] },
  { label: 'Axle 2 · Drive', positions: [{ code: 'A2LO', label: 'Left Outer' }, { code: 'A2LI', label: 'Left Inner' }, { code: 'A2RI', label: 'Right Inner' }, { code: 'A2RO', label: 'Right Outer' }] },
  { label: 'Axle 3 · Drive', positions: [{ code: 'A3LO', label: 'Left Outer' }, { code: 'A3LI', label: 'Left Inner' }, { code: 'A3RI', label: 'Right Inner' }, { code: 'A3RO', label: 'Right Outer' }] },
];
const TRAILER_TIRE_AXLES: Axle[] = [
  { label: 'Axle 1', positions: [{ code: 'A1LO', label: 'Left Outer' }, { code: 'A1LI', label: 'Left Inner' }, { code: 'A1RI', label: 'Right Inner' }, { code: 'A1RO', label: 'Right Outer' }] },
  { label: 'Axle 2', positions: [{ code: 'A2LO', label: 'Left Outer' }, { code: 'A2LI', label: 'Left Inner' }, { code: 'A2RI', label: 'Right Inner' }, { code: 'A2RO', label: 'Right Outer' }] },
];
const TRUCK_POSITION_AXLES: Axle[] = [
  { label: 'Axle 1 · Steer', positions: [{ code: 'A1L', label: 'Left' }, { code: 'A1R', label: 'Right' }] },
  { label: 'Axle 2 · Drive', positions: [{ code: 'A2L', label: 'Left' }, { code: 'A2R', label: 'Right' }] },
  { label: 'Axle 3 · Drive', positions: [{ code: 'A3L', label: 'Left' }, { code: 'A3R', label: 'Right' }] },
];
const TRAILER_POSITION_AXLES: Axle[] = [
  { label: 'Axle 1', positions: [{ code: 'A1L', label: 'Left' }, { code: 'A1R', label: 'Right' }] },
  { label: 'Axle 2', positions: [{ code: 'A2L', label: 'Left' }, { code: 'A2R', label: 'Right' }] },
];

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const fieldStyle: React.CSSProperties = {
  width: '100%', minHeight: 50, padding: '10px 13px', border: '1px solid #cbd5dd',
  borderRadius: 10, background: '#fff', color: '#172033', fontSize: 16, boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = { display: 'grid', gap: 7, color: '#334155', fontSize: 13, fontWeight: 850 };

function observedLabel(value?: string) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString();
}

export default function ReportBreakdownPage() {
  const [unitType, setUnitType] = useState<UnitType>('');
  const [unitQuery, setUnitQuery] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('');
  const [units, setUnits] = useState<UnitResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [manualFallback, setManualFallback] = useState(false);
  const [snapshotChoice, setSnapshotChoice] = useState<SnapshotChoice>('');
  const [geotabPreview, setGeotabPreview] = useState<GeotabPreview>({ status: 'idle' });
  const [categories, setCategories] = useState<BreakdownCategory[]>([]);
  const [categoryError, setCategoryError] = useState('');
  const [repairCategory, setRepairCategory] = useState('');
  const [repairSubcategory, setRepairSubcategory] = useState('');
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [tireSizes, setTireSizes] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SubmitResult>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const selectedCategory = categories.find((category) => category.name === repairCategory) || null;
  const tireAxles = unitType === 'trailer' ? TRAILER_TIRE_AXLES : TRUCK_TIRE_AXLES;
  const positionAxles = unitType === 'trailer' ? TRAILER_POSITION_AXLES : TRUCK_POSITION_AXLES;

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/breakdown-categories', { cache:'no-store' });
        const payload = await response.json() as { categories?:BreakdownCategory[]; error?:string };
        if (!response.ok) throw new Error(payload.error || 'Breakdown categories could not be loaded.');
        setCategories(Array.isArray(payload.categories) ? payload.categories : []);
        setCategoryError('');
      } catch (error) {
        setCategoryError(error instanceof Error ? error.message : 'Breakdown categories could not be loaded.');
      }
    })();
  }, []);

  useEffect(() => {
    try {
      const raw=window.localStorage.getItem(ACTIVE_BREAKDOWN_KEY);
      if(!raw)return;
      const parsed=JSON.parse(raw) as {breakdownId?:unknown;driverToken?:unknown};
      const breakdownId=Number(parsed.breakdownId);
      const driverToken=String(parsed.driverToken||'');
      if(Number.isInteger(breakdownId)&&breakdownId>0&&driverToken.length>=32) setResult({ok:true,breakdownId,driverToken});
    } catch { window.localStorage.removeItem(ACTIVE_BREAKDOWN_KEY); }
  }, []);

  useEffect(() => {
    if (!unitType || selectedUnit) { setUnits([]); setHasMore(false); setSearching(false); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true); setSearchError('');
      try {
        const params = new URLSearchParams({ type: unitType, q: unitQuery.trim() });
        const response = await fetch(`/api/equipment/search?${params.toString()}`, { cache:'no-store', signal:controller.signal });
        const payload = await response.json() as { units?:UnitResult[]; hasMore?:boolean; error?:string };
        if (!response.ok) throw new Error(payload.error || 'Unit search failed.');
        setUnits(Array.isArray(payload.units) ? payload.units : []); setHasMore(Boolean(payload.hasMore));
      } catch (error) {
        if (controller.signal.aborted) return;
        setUnits([]); setHasMore(false); setSearchError(error instanceof Error ? error.message : 'Unit search failed.');
      } finally { if (!controller.signal.aborted) setSearching(false); }
    }, 160);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [unitType, unitQuery, selectedUnit]);

  useEffect(() => {
    if (!unitType || !selectedUnit) { setGeotabPreview({ status:'idle' }); return; }
    const controller = new AbortController();
    setGeotabPreview({ status:'loading' }); setManualFallback(false); setSnapshotChoice('');
    void (async () => {
      try {
        const params = new URLSearchParams({ unitType, unitNumber:selectedUnit });
        const response = await fetch(`/api/breakdowns/geotab-preview?${params.toString()}`, { cache:'no-store', signal:controller.signal });
        const payload = await response.json() as { available?:boolean; driverName?:string; city?:string; state?:string; observedAt?:string; error?:string };
        if (!response.ok) throw new Error(payload.error || 'Could not check Geotab.');
        if (!payload.available) { setGeotabPreview({ status:'unavailable' }); setManualFallback(true); setSnapshotChoice('unavailable'); return; }
        setGeotabPreview({ status:'available', driverName:payload.driverName||'', city:payload.city||'', state:payload.state||'', observedAt:payload.observedAt||'' });
      } catch (error) {
        if (controller.signal.aborted) return;
        setGeotabPreview({ status:'error', error:error instanceof Error ? error.message : 'Could not check Geotab.' });
        setManualFallback(true); setSnapshotChoice('unavailable');
      }
    })();
    return () => controller.abort();
  }, [unitType, selectedUnit]);

  function resetBreakdownDetails() {
    setManualFallback(false); setSnapshotChoice(''); setGeotabPreview({ status:'idle' });
    setRepairCategory(''); setRepairSubcategory(''); setSelectedPositions([]); setTireSizes({});
  }
  function chooseType(next: Exclude<UnitType,''>) {
    setUnitType(next); setUnitQuery(''); setSelectedUnit(''); setUnits([]); setHasMore(false); setSearchError(''); resetBreakdownDetails(); setResult(null);
  }
  function chooseUnit(unit:string) {
    setSelectedUnit(unit); setUnitQuery(unit); setUnits([]); setHasMore(false); setSearchError(''); setManualFallback(false); setSnapshotChoice(''); setResult(null);
  }
  function changeUnit() { setSelectedUnit(''); setUnitQuery(''); resetBreakdownDetails(); setResult(null); }
  function chooseSnapshot(choice:'verified'|'corrected') { setSnapshotChoice(choice); setManualFallback(choice==='corrected'); setResult(null); }
  function togglePosition(code:string) {
    setSelectedPositions((current) => current.includes(code) ? current.filter((item) => item!==code) : [...current,code]);
    setResult(null);
  }
  function changeCategory(value:string) {
    setRepairCategory(value); setRepairSubcategory(''); setSelectedPositions([]); setTireSizes({}); setResult(null);
  }

  async function handleSubmit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setResult(null);
    if (!unitType) { setResult({ error:'Pick Truck or Trailer.' }); return; }
    if (!selectedUnit) { setResult({ error:'Search for and tap the unit number.' }); return; }
    if (geotabPreview.status==='loading') { setResult({ error:'Geotab is still checking the driver and location.' }); return; }
    if (geotabPreview.status==='available' && !snapshotChoice) { setResult({ error:'Verify whether the Geotab driver and location are correct.' }); return; }
    if (!selectedCategory) { setResult({ error:'Choose a breakdown category.' }); return; }
    if (selectedCategory.subcategories.length && !repairSubcategory) { setResult({ error:`Choose an ${selectedCategory.name} issue.` }); return; }
    if (selectedCategory.requiresPosition && !selectedPositions.length) { setResult({ error:`Choose at least one ${selectedCategory.name} position.` }); return; }
    if (selectedCategory.requiresTireSize) {
      const missingSize = selectedPositions.find((code) => !String(tireSizes[code]||'').trim());
      if (missingSize) { setResult({ error:`Enter the tire size for ${missingSize}.` }); return; }
    }

    setSubmitting(true);
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch('/api/breakdowns', { method:'POST', body:form });
      const responseText = await response.text();
      let payload:BreakdownSubmitPayload={};
      if (responseText) {
        try { payload=JSON.parse(responseText) as BreakdownSubmitPayload; }
        catch {
          if (response.status===413) throw new Error('That photo is too large to upload. Choose a smaller photo and try again.');
          if (response.ok) throw new Error('The breakdown may have been saved, but the confirmation could not be read. Check the breakdown dashboard before submitting again.');
          throw new Error(`The breakdown service returned an unreadable response (HTTP ${response.status}). Try again.`);
        }
      } else if (!response.ok) throw new Error(`The breakdown service returned HTTP ${response.status}. Try again.`);
      if (response.status===422 && payload.manualFallbackRequired) {
        setManualFallback(true); setSnapshotChoice('unavailable'); setResult({ error:payload.error||'Enter the driver and location manually to continue.' }); return;
      }
      if (!response.ok || !payload.ok || !payload.breakdownId || !payload.driverToken) throw new Error(payload.error||'The breakdown could not be saved.');
      const next={ok:true as const,breakdownId:payload.breakdownId,driverToken:payload.driverToken};
      window.localStorage.setItem(ACTIVE_BREAKDOWN_KEY,JSON.stringify({breakdownId:next.breakdownId,driverToken:next.driverToken}));
      setResult(next); formRef.current?.reset(); resetBreakdownDetails();
    } catch (error) {
      const message=error instanceof Error?error.message:'The breakdown could not be saved.';
      setResult({ error:/string did not match the expected pattern/i.test(message)?'Your iPhone could not attach that camera photo. Re-select the picture from Photo Library and submit again.':message });
    } finally { setSubmitting(false); }
  }

  function reportAnother() {
    window.localStorage.removeItem(ACTIVE_BREAKDOWN_KEY);
    setResult(null); setUnitType(''); setUnitQuery(''); setSelectedUnit(''); setUnits([]); setHasMore(false); setSearchError(''); resetBreakdownDetails();
  }

  if (result && 'ok' in result) return <DriverFollowup breakdownId={result.breakdownId} token={result.driverToken} onReportAnother={reportAnother} />;

  return (
    <main className="easy-page">
      <div className="easy-page-narrow" style={{maxWidth:820}}>
        <p className="easy-eyebrow">NORTHERN LOGISTICS</p>
        <h1 className="easy-title">Report a Roadside Breakdown</h1>
        <p className="easy-subtitle">Choose only the unit that is actually broken down. We&apos;ll show you the driver and location Geotab finds so you can verify them before submitting.</p>

        <form ref={formRef} onSubmit={handleSubmit} className="easy-card" style={{marginTop:20,overflow:'hidden'}}>
          <input type="hidden" name="unitType" value={unitType}/>
          <input type="hidden" name="unitNumber" value={selectedUnit}/>
          <input type="hidden" name="snapshotVerification" value={snapshotChoice}/>
          {manualFallback&&<input type="hidden" name="driverNotListed" value="1"/>}

          <section style={{padding:22,borderBottom:'1px solid #e2e8f0'}}>
            <p className="easy-eyebrow">1 · WHICH UNIT BROKE DOWN?</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:12}}>
              {(['truck','trailer'] as const).map((type)=><button key={type} type="button" className={`easy-button ${unitType===type?'orange':''}`} aria-pressed={unitType===type} onClick={()=>chooseType(type)} style={{minHeight:58,fontSize:16}}>{type==='truck'?'Truck':'Trailer'}</button>)}
            </div>
            {unitType&&!selectedUnit&&<div style={{marginTop:16}}>
              <label style={labelStyle}>Quick search {unitType==='truck'?'truck':'trailer'} number *
                <input className="easy-search-input" value={unitQuery} onChange={(event)=>setUnitQuery(event.target.value.replace(/[^a-zA-Z0-9()\- ]/g,'').slice(0,24))} placeholder={`Start typing ${unitType==='truck'?'truck':'trailer'} #`} autoComplete="off" inputMode="text"/>
              </label>
              {searching&&<p className="easy-section-copy">Searching fleet...</p>}
              {searchError&&<div className="easy-notice">{searchError}</div>}
              {!searching&&!searchError&&units.length>0&&<div style={{marginTop:12,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(92px,1fr))',gap:8}}>{units.map((item)=><button key={item.unit} type="button" className="easy-button" onClick={()=>chooseUnit(item.unit)} style={{minHeight:48,fontSize:14}}>{item.unit}</button>)}</div>}
              {!searching&&!searchError&&unitQuery&&units.length===0&&<div className="easy-notice">No active {unitType}s match “{unitQuery}”. Check the number and try again.</div>}
              {hasMore&&<p className="easy-section-copy">More matches exist — keep typing to narrow the list.</p>}
            </div>}
            {selectedUnit&&<div style={{marginTop:16,padding:14,borderRadius:12,background:'#0d1b2b',color:'#fff',display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}>
              <div><small style={{color:'#9fb0bf',fontWeight:900,textTransform:'uppercase'}}>Selected {unitType}</small><strong style={{display:'block',marginTop:3,fontSize:24}}>{selectedUnit}</strong></div>
              <button type="button" className="easy-button" onClick={changeUnit}>Change</button>
            </div>}
          </section>

          <section style={{padding:22,borderBottom:'1px solid #e2e8f0'}}>
            <p className="easy-eyebrow">2 · VERIFY DRIVER & LOCATION</p>
            {!selectedUnit&&<div className="easy-notice" style={{marginTop:14}}>Select the broken-down unit first.</div>}
            {selectedUnit&&geotabPreview.status==='loading'&&<div className="easy-notice" style={{marginTop:14}}>Checking Geotab for the current driver and location...</div>}
            {selectedUnit&&geotabPreview.status==='available'&&<div style={{marginTop:14,padding:18,borderRadius:14,border:'1px solid #b7d9c4',background:'#f1fbf5'}}>
              <p style={{margin:0,fontSize:12,fontWeight:900,color:'#27623f',textTransform:'uppercase'}}>Geotab found</p>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:14,marginTop:12}}>
                <div><small style={{color:'#64748b',fontWeight:800}}>DRIVER</small><strong style={{display:'block',marginTop:3,fontSize:20}}>{geotabPreview.driverName}</strong></div>
                <div><small style={{color:'#64748b',fontWeight:800}}>LOCATION</small><strong style={{display:'block',marginTop:3,fontSize:20}}>{geotabPreview.city}, {geotabPreview.state}</strong></div>
              </div>
              {observedLabel(geotabPreview.observedAt)&&<p style={{margin:'10px 0 0',color:'#64748b',fontSize:12}}>Location observed {observedLabel(geotabPreview.observedAt)}</p>}
              <p style={{margin:'16px 0 8px',fontWeight:900,color:'#334155'}}>Is this driver and location correct?</p>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <button type="button" className={`easy-button ${snapshotChoice==='verified'?'orange':''}`} onClick={()=>chooseSnapshot('verified')}>Yes, correct</button>
                <button type="button" className={`easy-button ${snapshotChoice==='corrected'?'orange':''}`} onClick={()=>chooseSnapshot('corrected')}>No, correct it</button>
              </div>
            </div>}
            {selectedUnit&&(geotabPreview.status==='unavailable'||geotabPreview.status==='error')&&<div className="easy-notice" style={{marginTop:14,borderColor:'#efb36c',background:'#fff8ed',color:'#7a4514'}}>Geotab could not safely confirm the current driver/location{geotabPreview.error?`: ${geotabPreview.error}`:'.'} Enter them below. The affected unit stays {unitType==='trailer'?'this trailer only':'this truck only'}.</div>}
            {manualFallback&&selectedUnit&&<div style={{marginTop:14,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:14}}>
              <label style={labelStyle}>{snapshotChoice==='corrected'?'Correct Driver Name *':'Driver Name *'}<input name="driverName" required maxLength={120} autoComplete="name" style={fieldStyle}/></label>
              <label style={labelStyle}>State *<select name="state" required defaultValue="" style={fieldStyle}><option value="" disabled>Select state</option>{STATES.map((state)=><option key={state} value={state}>{state}</option>)}</select></label>
              <label style={labelStyle}>City *<input name="city" required maxLength={120} autoComplete="address-level2" style={fieldStyle}/></label>
            </div>}
          </section>

          <section style={{padding:22}}>
            <p className="easy-eyebrow">3 · BREAKDOWN DETAILS</p>
            {categoryError&&<div className="easy-notice" style={{marginTop:14,borderColor:'#e49b95',background:'#fff0ef',color:'#8a2922'}}>{categoryError}</div>}
            <div style={{marginTop:14,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:14}}>
              <label style={labelStyle}>Repair Type *
                <select name="repairCategory" required value={repairCategory} onChange={(event)=>changeCategory(event.target.value)} style={fieldStyle} disabled={!categories.length}>
                  <option value="" disabled>{categories.length?'Select repair type':'Loading repair types...'}</option>
                  {categories.map((category)=><option key={category.id} value={category.name}>{category.name}</option>)}
                </select>
              </label>
              {selectedCategory&&selectedCategory.subcategories.length>0&&<label style={labelStyle}>{selectedCategory.name} Issue *
                <select name="repairSubcategory" required value={repairSubcategory} onChange={(event)=>setRepairSubcategory(event.target.value)} style={fieldStyle}>
                  <option value="" disabled>Select issue</option>
                  {selectedCategory.subcategories.map((subcategory)=><option key={subcategory.id} value={subcategory.name}>{subcategory.name}</option>)}
                </select>
              </label>}
            </div>

            {selectedCategory?.requiresPosition&&unitType&&selectedCategory.requiresTireSize&&<div style={{marginTop:18,padding:16,borderRadius:14,border:'1px solid #cbd5e1',background:'#f8fafc'}}>
              <p style={{margin:0,fontSize:16,fontWeight:900,color:'#172033'}}>Tire position and size *</p>
              <p style={{margin:'6px 0 0',color:'#64748b',fontSize:13}}>Choose every affected tire. Enter the tire size for each selected position.</p>
              {tireAxles.map((axle)=><div key={axle.label} style={{marginTop:16}}><strong style={{display:'block',color:'#334155',marginBottom:8}}>{axle.label}</strong><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(165px,1fr))',gap:10}}>
                {axle.positions.map((position)=>{const selected=selectedPositions.includes(position.code);return <div key={position.code} style={{padding:12,border:selected?'2px solid #ea7b22':'1px solid #cbd5e1',borderRadius:12,background:'#fff'}}>
                  <label style={{display:'flex',gap:9,alignItems:'center',cursor:'pointer',color:'#172033',fontWeight:850}}><input type="checkbox" name="tirePosition" value={position.code} checked={selected} onChange={()=>togglePosition(position.code)}/><span>{position.label}</span></label>
                  <small style={{display:'block',marginTop:4,color:'#64748b'}}>{position.code}</small>
                  {selected&&<label style={{...labelStyle,marginTop:10}}>Tire size *<input name={`tireSize_${position.code}`} required value={tireSizes[position.code]||''} onChange={(event)=>setTireSizes((current)=>({...current,[position.code]:event.target.value.slice(0,40)}))} placeholder="Example: 11R22.5" style={{...fieldStyle,minHeight:44}}/></label>}
                </div>;})}
              </div></div>)}
            </div>}

            {selectedCategory?.requiresPosition&&unitType&&!selectedCategory.requiresTireSize&&<div style={{marginTop:18,padding:16,borderRadius:14,border:'1px solid #cbd5e1',background:'#f8fafc'}}>
              <p style={{margin:0,fontSize:16,fontWeight:900,color:'#172033'}}>{selectedCategory.name} position *</p>
              <p style={{margin:'6px 0 0',color:'#64748b',fontSize:13}}>Choose the axle position that needs repair. Select more than one if needed.</p>
              {positionAxles.map((axle)=><div key={axle.label} style={{marginTop:16}}><strong style={{display:'block',color:'#334155',marginBottom:8}}>{axle.label}</strong><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10}}>
                {axle.positions.map((position)=>{const selected=selectedPositions.includes(position.code);return <label key={position.code} style={{display:'flex',gap:9,alignItems:'center',cursor:'pointer',padding:13,border:selected?'2px solid #ea7b22':'1px solid #cbd5e1',borderRadius:12,background:'#fff',color:'#172033',fontWeight:850}}><input type="checkbox" name="positionCode" value={position.code} checked={selected} onChange={()=>togglePosition(position.code)}/><span>{position.label} <small style={{display:'block',color:'#64748b',fontWeight:700}}>{position.code}</small></span></label>;})}
              </div></div>)}
            </div>}

            <label style={{...labelStyle,marginTop:14}}>What happened / what needs repair? *<textarea name="description" required maxLength={2000} rows={6} style={{...fieldStyle,minHeight:130,resize:'vertical'}}/></label>
            <label style={{...labelStyle,marginTop:14}}>Photos (optional)<input type="file" name="photos" accept="image/*" multiple style={{...fieldStyle,paddingTop:12}}/></label>
            {result&&'error' in result&&<div className="easy-notice" style={{borderColor:'#e49b95',background:'#fff0ef',color:'#8a2922'}}>{result.error}</div>}
            <button type="submit" className="easy-button orange" disabled={submitting||geotabPreview.status==='loading'||!categories.length} style={{width:'100%',minHeight:58,marginTop:18,fontSize:16}}>{submitting?'Saving breakdown...':'Submit Breakdown'}</button>
          </section>
        </form>
      </div>
    </main>
  );
}
