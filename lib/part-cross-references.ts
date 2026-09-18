function normalized(value: unknown) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 120);
}

function displayValue(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
}

export function normalizePartReference(value: unknown) {
  return normalized(value);
}

export async function getPartCrossReferencesByPart(db: D1Database) {
  const rows = await db.prepare(`
    SELECT part_id,cross_part_number
    FROM part_cross_references
    WHERE active=1
    ORDER BY part_id,cross_part_number
  `).all<{part_id:number;cross_part_number:string}>();
  const byPart = new Map<number,string[]>();
  for (const row of rows.results) {
    const list = byPart.get(Number(row.part_id)) ?? [];
    list.push(row.cross_part_number);
    byPart.set(Number(row.part_id),list);
  }
  return byPart;
}

export async function replacePartCrossReferences(
  db: D1Database,
  partId: number,
  values: unknown,
) {
  if (!Number.isInteger(partId) || partId <= 0) throw new Error('Part is required.');
  const part = await db.prepare('SELECT id,part_number FROM parts WHERE id=? AND active=1')
    .bind(partId).first<{id:number;part_number:string}>();
  if (!part) throw new Error('Part was not found.');

  const entries = Array.isArray(values) ? values : [];
  const canonical = normalized(part.part_number);
  const unique = new Map<string,string>();
  for (const raw of entries) {
    const label = displayValue(raw);
    const key = normalized(label);
    if (!label || !key || key === canonical) continue;
    if (!unique.has(key)) unique.set(key,label);
    if (unique.size >= 100) break;
  }

  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM part_cross_references WHERE part_id=?').bind(partId),
  ];
  for (const [key,label] of unique) {
    statements.push(db.prepare(`
      INSERT INTO part_cross_references
        (part_id,cross_part_number,normalized_cross_part_number,active,updated_at)
      VALUES (?,?,?,1,CURRENT_TIMESTAMP)
    `).bind(partId,label,key));
  }
  await db.batch(statements);
  return {ok:true,partId,crossReferences:[...unique.values()]};
}

export async function addPartCrossReference(
  db: D1Database,
  partId: number,
  value: unknown,
) {
  if (!Number.isInteger(partId) || partId <= 0) return false;
  const label = displayValue(value);
  const key = normalized(label);
  if (!label || !key) return false;
  const part = await db.prepare('SELECT part_number FROM parts WHERE id=? AND active=1')
    .bind(partId).first<{part_number:string}>();
  if (!part || normalized(part.part_number) === key) return false;
  await db.prepare(`
    INSERT INTO part_cross_references
      (part_id,cross_part_number,normalized_cross_part_number,active,updated_at)
    VALUES (?,?,?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(part_id,normalized_cross_part_number) DO UPDATE SET
      cross_part_number=excluded.cross_part_number,
      active=1,
      updated_at=CURRENT_TIMESTAMP
  `).bind(partId,label,key).run();
  return true;
}

export async function matchPartReference(db: D1Database, value: unknown) {
  const key = normalized(value);
  if (!key) return {matches:[] as Array<{id:number;partNumber:string;description:string;matchedBy:string}>};
  const rows = await db.prepare(`
    SELECT DISTINCT p.id,p.part_number,p.description,
      CASE WHEN UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(p.part_number,'-',''),' ',''),'.',''),'/',''),'_',''))=?
        THEN p.part_number ELSE x.cross_part_number END AS matched_by
    FROM parts p
    LEFT JOIN part_cross_references x
      ON x.part_id=p.id AND x.active=1
    WHERE p.active=1
      AND (
        UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(p.part_number,'-',''),' ',''),'.',''),'/',''),'_',''))=?
        OR x.normalized_cross_part_number=?
      )
    ORDER BY p.part_number,p.id
  `).bind(key,key,key).all<{id:number;part_number:string;description:string;matched_by:string|null}>();
  return {
    matches: rows.results.map((row)=>({
      id:Number(row.id),
      partNumber:row.part_number,
      description:row.description,
      matchedBy:row.matched_by ?? row.part_number,
    })),
  };
}
