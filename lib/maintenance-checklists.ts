export type ChecklistItem = { number: number; section: string; text: string };

export const PERFORMANCE_PM_CHECKLIST: ChecklistItem[] = [
  { number: 1, section: 'Cab Interior Inspection', text: 'Truck cleanliness — visually inspect interior and report all driver neglect (trash, ashes, food, coffee stains, etc)' },
  { number: 2, section: 'Cab Interior Inspection', text: 'Inspect dash/windshield area for cracks, chips, signs of leaks' },
  { number: 3, section: 'Cab Interior Inspection', text: 'Observe cluster operation — check for faults, record' },
  { number: 4, section: 'Cab Interior Inspection', text: 'Set brakes, test parking, shut off truck' },
  { number: 5, section: 'Cab Interior Inspection', text: 'Check for low air warning buzzer and light — make sure dash parking brake valves pop out at 35 psi' },
  { number: 6, section: 'Cab Interior Inspection', text: 'Check clutch pedal free travel' },
  { number: 7, section: 'Cab Interior Inspection', text: 'Check clutch brake operation' },
  { number: 8, section: 'Cab Interior Inspection', text: 'Check clutch hydraulic fluid if equipped' },
  { number: 9, section: 'Cab Interior Inspection', text: 'Check horns — electric and air' },
  { number: 10, section: 'Cab Interior Inspection', text: 'Check wiper and washer operation — check condition of blades, replace if needed' },
  { number: 11, section: 'Cab Interior Inspection', text: 'Check document holder for up to date insurance, IFTA, cab card, etc — check for ELD folder' },
  { number: 12, section: 'Cab Interior Inspection', text: 'Check 5th wheel slider operation' },
  { number: 13, section: 'Cab Interior Inspection', text: 'Check air suspension dump valve' },
  { number: 14, section: 'Cab Interior Inspection', text: 'Check PDL operation' },
  { number: 15, section: 'Cab Interior Inspection', text: 'Check HVAC controls' },
  { number: 25, section: 'Around Vehicle Inspection', text: 'Check ALL batteries — remove and clean cables/terminals, check hold downs, make sure secure, look for rubbing' },
  { number: 26, section: 'Around Vehicle Inspection', text: 'Check fuel tanks and straps — check for leaks, loose or breaking straps, rolling tank, fender rubbing' },
  { number: 27, section: 'Around Vehicle Inspection', text: 'Check def tank mounting, check for leaks at cap, inspect header' },
  { number: 28, section: 'Around Vehicle Inspection', text: 'Check hood and cab mirrors for visibility and mounting — tighten if needed' },
  { number: 29, section: 'Around Vehicle Inspection', text: 'Check hood latches/shock/pivots' },
  { number: 30, section: 'Around Vehicle Inspection', text: 'Check trailer air couplers for cracks, leaks, wear — adjust slack if needed' },
  { number: 31, section: 'Around Vehicle Inspection', text: 'Check truck electrical cord for wear — check/clean/grease 7-way plug behind cab' },
  { number: 32, section: 'Around Vehicle Inspection', text: 'Check 5th wheel slider, mounting and jaws — check for excessive play, grease plate' },
  { number: 33, section: 'Around Vehicle Inspection', text: 'Check frame and crossmembers' },
  { number: 34, section: 'Around Vehicle Inspection', text: 'Check steer axle hub oil level' },
  { number: 35, section: 'Around Vehicle Inspection', text: 'Check for loose frame bolts' },
  { number: 36, section: 'Around Vehicle Inspection', text: 'Check for broken or leaking shocks' },
  { number: 37, section: 'Around Vehicle Inspection', text: 'Check for broken or loose leaf springs' },
  { number: 38, section: 'Around Vehicle Inspection', text: 'Check for broken or leaking air bags' },
  { number: 39, section: 'Around Vehicle Inspection', text: 'Check tires for tread depth, damage, PSI — paint rims if needed' },
];

export const ANNUAL_INSPECTION_CHECKLIST: ChecklistItem[] = [
  { number: 1, section: 'Brakes', text: 'Adjustment, mech components, drum/rotor, hose/tubing, lining, low air warning, trailer air supply, compressor, parking brakes' },
  { number: 2, section: 'Exhaust', text: 'Leaks, placement' },
  { number: 3, section: 'Steering', text: 'Adjustments, column/gear, axle, linkage, power steering, other steering components' },
  { number: 4, section: 'Frame', text: 'Members, attachment, clearance' },
  { number: 5, section: 'Lighting', text: 'Headlights, tail/stop, clearance marker, identification, reflectors, other lighting' },
  { number: 6, section: 'Tires', text: 'Tread, inflation, damage, other tire condition' },
  { number: 7, section: 'Fuel System', text: 'Tank, lines' },
  { number: 8, section: 'Wheels/Rim', text: 'Fasteners, disc/spoke, other wheel/rim condition' },
  { number: 9, section: 'Couplers', text: 'Fifth wheel & mount, pin/upper plate, pintle-hook/eye, safety chain(s)' },
  { number: 10, section: 'Cab/Body', text: 'Access, eqpt/load secure, tie-downs, headerboard, other cab/body condition' },
  { number: 11, section: 'Suspension', text: 'Springs, attachments, sliders' },
  { number: 12, section: 'Windshield/Wipers', text: 'Windshield condition, wipers' },
  { number: 13, section: 'Mirrors', text: 'Mirror condition and mounting' },
];

export function checklistFor(eventType: 'pm' | 'annual'): ChecklistItem[] {
  return eventType === 'annual' ? ANNUAL_INSPECTION_CHECKLIST : PERFORMANCE_PM_CHECKLIST;
}
