export function buildVisionInput({system,user,imageDataUri}){
  return {
    messages:[
      {role:'system',content:String(system||'')},
      {role:'user',content:String(user||'')},
    ],
    image:String(imageDataUri||''),
    temperature:0,
    max_completion_tokens:1400,
  };
}
