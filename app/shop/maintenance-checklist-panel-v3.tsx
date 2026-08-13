"use client";
import MaintenanceChecklistPanelV2 from './maintenance-checklist-panel-v2';
import InspectionFinal from './inspection-final';
import type {Part} from './maintenance-types';

type Props={repairId:string;canWork:boolean;parts?:Part[]};
export default function MaintenanceChecklistPanelV3(props:Props){return <><MaintenanceChecklistPanelV2 {...props}/><InspectionFinal repairId={props.repairId} canWork={props.canWork}/></>}
