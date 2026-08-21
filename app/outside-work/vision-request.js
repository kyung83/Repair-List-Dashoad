const FIELD_SCHEMA={
  type:'object',
  properties:{
    value:{type:'string'},
    confidence:{type:'number',minimum:0,maximum:1},
  },
  required:['value','confidence'],
  additionalProperties:false,
};

const VISION_SCHEMA={
  type:'object',
  properties:{
    vendorName:FIELD_SCHEMA,
    invoiceNumber:FIELD_SCHEMA,
    serviceDate:FIELD_SCHEMA,
    unitNumber:FIELD_SCHEMA,
    mileage:FIELD_SCHEMA,
    totalAmount:FIELD_SCHEMA,
    workPerformed:{
      type:'object',
      properties:{
        value:{type:'array',items:{type:'string'},maxItems:16},
        confidence:{type:'number',minimum:0,maximum:1},
      },
      required:['value','confidence'],
      additionalProperties:false,
    },
  },
  required:['vendorName','invoiceNumber','serviceDate','unitNumber','mileage','totalAmount','workPerformed'],
  additionalProperties:false,
};

export function normalizeVisionBase64(value){
  return String(value||'').trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i,'');
}

export function buildVisionInput({system,user,imageBase64,imageDataUri}){
  const image=normalizeVisionBase64(imageBase64||imageDataUri);
  return {
    messages:[
      {role:'system',content:String(system||'')},
      {role:'user',content:String(user||'')},
    ],
    image,
    response_format:{type:'json_schema',json_schema:VISION_SCHEMA},
    temperature:0,
    max_completion_tokens:1400,
  };
}
