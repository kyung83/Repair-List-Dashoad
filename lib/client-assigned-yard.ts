import {normalizeYard,type YardKey} from './yards';

type MeResponse={user?:{yard?:string;assignedWarehouseCode?:string}};
export type AssignedYard={yard:YardKey|null;warehouseCode:string};

export async function getAssignedYard():Promise<AssignedYard>{
  const response=await fetch('/api/auth/me',{cache:'no-store'});
  if(!response.ok)return {yard:null,warehouseCode:''};
  const payload=await response.json() as MeResponse;
  return {
    yard:normalizeYard(payload.user?.yard??'')||null,
    warehouseCode:String(payload.user?.assignedWarehouseCode??'').trim().toUpperCase(),
  };
}
