function clean(value,max=500){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);}

export function parseJsonText(value){
  if(typeof value!=='string')return null;
  const text=value.trim();
  if(!text)return null;
  try{return JSON.parse(text);}catch{}
  const fenced=text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fenced?.[1]){try{return JSON.parse(fenced[1].trim());}catch{}}
  const object=text.match(/\{[\s\S]*\}/);
  if(object?.[0]){try{return JSON.parse(object[0]);}catch{}}
  return null;
}

function textFromContent(value){
  if(typeof value==='string')return value;
  if(!Array.isArray(value))return'';
  const parts=[];
  for(const item of value){
    if(typeof item==='string'){parts.push(item);continue;}
    if(!item||typeof item!=='object')continue;
    const row=item;
    for(const key of ['text','content','output_text']){
      if(typeof row[key]==='string'&&row[key].trim())parts.push(row[key]);
    }
  }
  return parts.join('\n').trim();
}

function objectFromMessage(message){
  if(!message||typeof message!=='object')return null;
  if(message.parsed&&typeof message.parsed==='object')return message.parsed;
  if(message.content&&typeof message.content==='object'&&!Array.isArray(message.content))return message.content;
  const parsed=parseJsonText(textFromContent(message.content));
  if(parsed)return parsed;
  const toolCalls=Array.isArray(message.tool_calls)?message.tool_calls:[];
  for(const call of toolCalls){
    const args=call&&typeof call==='object'&&call.function&&typeof call.function==='object'?call.function.arguments:null;
    const toolParsed=parseJsonText(args);
    if(toolParsed)return toolParsed;
  }
  return null;
}

export function unwrapWorkersAiResult(result){
  if(!result||typeof result!=='object')return null;
  let row=result;
  for(let i=0;i<3;i++){
    if(row&&typeof row==='object'&&row.result&&typeof row.result==='object')row=row.result;
    else break;
  }
  return row;
}

export function extractResultObject(result){
  const row=unwrapWorkersAiResult(result);
  if(!row||typeof row!=='object')return null;

  for(const key of ['answer','response','output_text','text']){
    const value=row[key];
    if(value&&typeof value==='object'&&!Array.isArray(value))return value;
    const parsed=parseJsonText(textFromContent(value));
    if(parsed)return parsed;
  }

  const choices=Array.isArray(row.choices)?row.choices:[];
  for(const choice of choices){
    if(!choice||typeof choice!=='object')continue;
    const messageParsed=objectFromMessage(choice.message);
    if(messageParsed)return messageParsed;
    const choiceParsed=parseJsonText(textFromContent(choice.text));
    if(choiceParsed)return choiceParsed;
  }
  return null;
}

export function responseDiagnostic(result){
  if(!result||typeof result!=='object')return`Workers AI returned ${typeof result}.`;
  const outerKeys=Object.keys(result).slice(0,12).join(',')||'<none>';
  const row=unwrapWorkersAiResult(result);
  if(!row||typeof row!=='object')return`Workers AI response keys: ${outerKeys}.`;
  const innerKeys=row===result?'':` Nested result keys: ${Object.keys(row).slice(0,12).join(',')||'<none>'}.`;
  let payload='';
  for(const key of ['answer','response','output_text','text']){
    payload=textFromContent(row[key]);
    if(payload)break;
  }
  if(!payload){
    const choices=Array.isArray(row.choices)?row.choices:[];
    const first=choices[0];
    const message=first&&typeof first==='object'&&first.message&&typeof first.message==='object'?first.message:null;
    if(message)payload=textFromContent(message.content)||textFromContent(message.reasoning_content);
    if(!payload&&first&&typeof first==='object')payload=textFromContent(first.text);
  }
  const preview=clean(payload,420);
  return`Workers AI response keys: ${outerKeys}.${innerKeys}${preview?` Text preview: ${preview}`:' No text payload was returned.'}`;
}
