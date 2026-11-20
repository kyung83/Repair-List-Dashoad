-- Dedicated trailer PM and Annual checklists; separate from legacy truck templates.
-- Source review: 49 CFR 396.17 and Appendix A to Part 396 (minimum periodic inspection standards).
-- NO changes to existing checklist runs, inspection answers, service dates or truck assignments.
-- Existing in-progress inspections keep their own snapshotted template_id and items.
PRAGMA foreign_keys=ON;

INSERT OR IGNORE INTO maintenance_checklist_templates(event_type,template_key,name,version,active)
VALUES('pm','trailer-service','Trailer Preventive Maintenance - Fleet Service',1,1);
INSERT OR IGNORE INTO maintenance_checklist_templates(event_type,template_key,name,version,active)
VALUES('annual','trailer-annual-dot','Trailer Annual Inspection - DOT Safety',1,1);

-- PM | 39 trailer-only questions
WITH items(position,section,item_text,allow_na) AS (
  VALUES
    (1, 'Tires & Wheels', 'Inspect every trailer tire for tread depth, uneven wear and road damage.', 1),
    (2, 'Tires & Wheels', 'Check tire inflation at each position and correct to the tire and fleet specifications.', 1),
    (3, 'Tires & Wheels', 'Inspect sidewalls, valve stems and tread for cuts, bulges, leaks or exposed cords.', 1),
    (4, 'Tires & Wheels', 'Inspect rims, wheels and lock rings for cracks, bends and damaged bolt holes.', 1),
    (5, 'Tires & Wheels', 'Check wheel studs and nuts for looseness, missing fasteners and wheel seating.', 1),
    (6, 'Tires & Wheels', 'Inspect hubs, wheel bearings and seals for leaks, abnormal play or damage.', 1),
    (7, 'Tires & Wheels', 'Check hub lubricant level and condition where oil-bath hubs are fitted.', 1),
    (8, 'Brakes & Air System', 'Inspect brake linings or pads, shoes, drums and rotors for wear, contamination or damage.', 1),
    (9, 'Brakes & Air System', 'Verify service brakes apply and release at every required trailer axle.', 1),
    (10, 'Brakes & Air System', 'Measure brake pushrod stroke and inspect automatic slack adjusters for proper operation.', 1),
    (11, 'Brakes & Air System', 'Inspect brake chambers, pushrods, camshafts, brackets and other mechanical parts.', 1),
    (12, 'Brakes & Air System', 'Inspect glad hands, seals, air hoses and tubing for leaks, rubbing, cracks or improper connections.', 1),
    (13, 'Brakes & Air System', 'Check for air leaks with the system charged and service brakes applied.', 1),
    (14, 'Brakes & Air System', 'Test trailer spring, parking and emergency brake operation.', 1),
    (15, 'Brakes & Air System', 'Inspect air reservoirs and mounts, and drain accumulated moisture where applicable.', 1),
    (16, 'Brakes & Air System', 'Check trailer ABS warning lamp, wiring and sensor condition where equipped.', 1),
    (17, 'Brakes & Air System', 'Lubricate brake cams and approved grease points per maintenance schedule.', 1),
    (18, 'Suspension & Axles', 'Inspect air springs or leaf springs, spring hangers and mounting hardware.', 1),
    (19, 'Suspension & Axles', 'Inspect axle U-bolts, torque arms, radius rods, bushings and alignment attachments.', 1),
    (20, 'Suspension & Axles', 'Check suspension air lines, height control valve and ride height where equipped.', 1),
    (21, 'Suspension & Axles', 'Check shock absorbers for leaks, broken mounts or damage where equipped.', 1),
    (22, 'Suspension & Axles', 'Operate and inspect sliding tandem locks, pins, rails and stops where equipped.', 1),
    (23, 'Coupling, Frame & Landing Gear', 'Inspect kingpin, upper coupler plate, welds and mounting for wear or damage.', 1),
    (24, 'Coupling, Frame & Landing Gear', 'Inspect landing gear feet, gears, braces, crank, mounting and operation.', 1),
    (25, 'Coupling, Frame & Landing Gear', 'Inspect trailer frame rails, crossmembers, welds, corrosion and fasteners.', 1),
    (26, 'Coupling, Frame & Landing Gear', 'Check rear impact guard and attachment for damage, rust or loose fasteners where required.', 1),
    (27, 'Lighting & Electrical', 'Test tail, stop, turn signal and hazard lamps for operation.', 1),
    (28, 'Lighting & Electrical', 'Test clearance, side-marker, identification and license-plate lamps.', 1),
    (29, 'Lighting & Electrical', 'Inspect seven-way plug, electrical harness, connectors and grounds for wear or chafing.', 1),
    (30, 'Lighting & Electrical', 'Inspect reflectors and required conspicuity tape for condition and visibility.', 1),
    (31, 'Body, Doors & Cargo', 'Check swing or roll-up doors, seals, hinges, handles, latches and locks where equipped.', 1),
    (32, 'Body, Doors & Cargo', 'Inspect roof, interior/exterior walls, floor and body crossmembers for damage or water entry.', 1),
    (33, 'Body, Doors & Cargo', 'Inspect mudflaps, hangers, fenders, side skirts and loose external equipment.', 1),
    (34, 'Body, Doors & Cargo', 'Inspect cargo tie-downs, anchorage points, winches, rub rails and headerboard where equipped.', 1),
    (35, 'Body, Doors & Cargo', 'Inspect Conestoga tarp, bows, tracks and locking devices where equipped.', 1),
    (36, 'Body, Doors & Cargo', 'Inspect flatbed/step-deck deck, stake pockets and edge/rub rails where equipped.', 1),
    (37, 'Finishing & Follow-up', 'Check trailer VIN/ID, license plate, DOT inspection documentation and service sticker.', 1),
    (38, 'Finishing & Follow-up', 'Review outstanding DVIR defects and future repairs; document any new defects found.', 1),
    (39, 'Finishing & Follow-up', 'Record completed lubrication/service, parts used and corrective work required.', 1)
)
INSERT OR IGNORE INTO maintenance_checklist_template_items (
  template_id,position,section,item_text,enabled,allow_pass,allow_fail,allow_na,
  require_notes,require_photo,require_measurement,measurement_label,measurement_unit
)
SELECT t.id,i.position,i.section,i.item_text,1,1,1,i.allow_na,0,0,0,NULL,NULL
FROM items i JOIN maintenance_checklist_templates t ON t.event_type='pm' AND t.template_key='trailer-service' AND t.version=1 AND t.active=1;

-- ANNUAL | 40 trailer-only questions
WITH items(position,section,item_text,allow_na) AS (
  VALUES
    (1, 'Service & Parking Brakes', 'Verify service-brake operation on every axle required to have brakes.', 0),
    (2, 'Service & Parking Brakes', 'Inspect foundation brake parts, chambers, mounts, springs, pins, cams, shoes and brackets for damage, looseness or missing parts.', 0),
    (3, 'Service & Parking Brakes', 'Check brake lining/pad attachment, thickness and contamination against applicable inspection limits.', 0),
    (4, 'Service & Parking Brakes', 'Inspect drums/rotors for cracks, missing sections, severe damage or unsafe wear.', 0),
    (5, 'Service & Parking Brakes', 'Measure pushrod travel and check brake adjustment against applicable chamber readjustment limits.', 1),
    (6, 'Service & Parking Brakes', 'Verify automatic brake adjusters and associated slack adjusters, mounts and linkage are intact and functioning.', 1),
    (7, 'Service & Parking Brakes', 'Inspect air hoses, tubing and glad hands for leaks, chafing, bulges, damage, improper joints or insecure routing.', 1),
    (8, 'Service & Parking Brakes', 'Inspect brake chambers for air leaks, cracked housings, loose clamps and insecure mounting.', 1),
    (9, 'Service & Parking Brakes', 'Inspect brake reservoirs, air plumbing, fittings and mounts for leaks and unsafe condition.', 1),
    (10, 'Service & Parking Brakes', 'Verify trailer spring/parking/emergency brake operation and air supply or breakaway functionality.', 1),
    (11, 'Service & Parking Brakes', 'Verify trailer ABS warning lamp power-up cycle and required ABS components/wiring when applicable.', 1),
    (12, 'Service & Parking Brakes', 'Check electric or hydraulic brake systems and breakaway device to applicable standards when equipped.', 1),
    (13, 'Coupling & Safety Devices', 'Inspect kingpin, upper coupler plate, attachment bolts, welds and structure for cracks, damage or excess wear.', 0),
    (14, 'Coupling & Safety Devices', 'Inspect pintle hook, drawbar/towbar eye, tongue or converter-dolly coupling if equipped.', 1),
    (15, 'Coupling & Safety Devices', 'Inspect required safety chains, hooks or cables and attachment points if equipped.', 1),
    (16, 'Coupling & Safety Devices', 'Check coupling/slider locking devices and stops if installed; all required latches must secure.', 1),
    (17, 'Lighting & Reflectors', 'Verify tail lamps and stop lamps operate and are securely mounted.', 0),
    (18, 'Lighting & Reflectors', 'Verify turn signals and hazard lamps operate and are securely mounted.', 0),
    (19, 'Lighting & Reflectors', 'Verify side markers, clearance and identification lamps required for this trailer operate.', 0),
    (20, 'Lighting & Reflectors', 'Verify required license-plate lamp and electrical connections function correctly.', 0),
    (21, 'Lighting & Reflectors', 'Check required reflectors, conspicuity markings and conspicuity tape for presence and condition.', 0),
    (22, 'Safe Loading & Body', 'Inspect front-end structure or bulkhead and cargo containment for missing or unsafe parts where required.', 1),
    (23, 'Safe Loading & Body', 'Inspect load tie-downs, anchor points, winches and equipment against applicable safe-loading standards.', 1),
    (24, 'Safe Loading & Body', 'Verify spare tire, loose equipment, doors and body parts cannot fall onto the roadway.', 0),
    (25, 'Safe Loading & Body', 'Check container locks and securement on intermodal chassis if equipped.', 1),
    (26, 'Suspension & Axle Location', 'Inspect U-bolts, spring hangers, axle positioning components and attachments for cracks, looseness or missing parts.', 0),
    (27, 'Suspension & Axle Location', 'Check leaf, air, coil or torsion springs for missing, broken, deflated or displaced components.', 0),
    (28, 'Suspension & Axle Location', 'Inspect torque arms, radius rods, tracking components and their frame/axle mountings.', 0),
    (29, 'Frame & Sliders', 'Inspect frame rails, crossmembers, body supports, welds and fasteners for cracks, breaks, looseness or sagging.', 0),
    (30, 'Frame & Sliders', 'Confirm adequate tire/wheel clearance from the body, frame and other components.', 0),
    (31, 'Frame & Sliders', 'Check sliding tandem/adjustable axle locking pins and stops if equipped.', 1),
    (32, 'Tires', 'Measure tread depth on every trailer tire; verify minimum 2/32 inch where applicable.', 0),
    (33, 'Tires', 'Check tire carcass and sidewalls for leaks, exposed ply or cord, cuts, separation and unsafe repairs.', 0),
    (34, 'Tires', 'Verify load rating, inflation, clearance, tire mating and highway-use suitability.', 0),
    (35, 'Wheels & Rims', 'Inspect rims, wheels, rings and welded areas for cracks, broken parts, damage or elongated holes.', 0),
    (36, 'Wheels & Rims', 'Check wheel fasteners, studs and nuts for loose, missing, broken or ineffective hardware.', 0),
    (37, 'Rear Impact Guard', 'Inspect required rear impact guard for presence, damage and secure mounts/welds; mark N/A only when exempt.', 1),
    (38, 'Rear Impact Guard', 'Verify applicable rear impact guard location, height, width and geometry requirements; N/A only when exempt.', 1),
    (39, 'Additional Trailer Safety', 'Inspect landing-gear structure, braces and feet for loose or unsafe mounting.', 1),
    (40, 'Additional Trailer Safety', 'Inspect other trailer-specific safety equipment or any newly discovered condition that would fail Appendix A minimum inspection standards.', 0)
)
INSERT OR IGNORE INTO maintenance_checklist_template_items (
  template_id,position,section,item_text,enabled,allow_pass,allow_fail,allow_na,
  require_notes,require_photo,require_measurement,measurement_label,measurement_unit
)
SELECT t.id,i.position,i.section,i.item_text,1,1,1,i.allow_na,0,0,0,NULL,NULL
FROM items i JOIN maintenance_checklist_templates t ON t.event_type='annual' AND t.template_key='trailer-annual-dot' AND t.version=1 AND t.active=1;

-- Only replace the built-in default selection, never override a manager's custom assignment.
UPDATE maintenance_checklist_template_assignments
SET template_key='trailer-service',updated_at=CURRENT_TIMESTAMP
WHERE event_type='pm' AND applies_to='trailer' AND template_key='default'
  AND (SELECT COUNT(*) FROM maintenance_checklist_template_items i JOIN maintenance_checklist_templates t ON t.id=i.template_id WHERE t.event_type='pm' AND t.template_key='trailer-service' AND t.version=1 AND i.enabled=1)=39;
UPDATE maintenance_checklist_template_assignments
SET template_key='trailer-annual-dot',updated_at=CURRENT_TIMESTAMP
WHERE event_type='annual' AND applies_to='trailer' AND template_key='default'
  AND (SELECT COUNT(*) FROM maintenance_checklist_template_items i JOIN maintenance_checklist_templates t ON t.id=i.template_id WHERE t.event_type='annual' AND t.template_key='trailer-annual-dot' AND t.version=1 AND i.enabled=1)=40;
