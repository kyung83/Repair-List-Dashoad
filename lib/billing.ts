function money(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : fallback;
}

function positiveId(value: unknown, label: string) {
  const raw = String(value ?? '').replace(/^repair-/, '').replace(/^invoice-/, '');
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} is invalid.`);
  return id;
}

function dateOnly(value: unknown, label: string, fallbackToday = false) {
  const text = String(value ?? '').trim();
  if (!text && fallbackToday) return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${label} must be a valid date.`);
  }
  return text;
}

export async function getShopLaborRate(db: D1Database) {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'shop_labor_rate'").first<{ value: string }>();
  const rate = Number(row?.value ?? 100);
  return Number.isFinite(rate) && rate >= 0 ? rate : 100;
}

export async function saveShopLaborRate(db: D1Database, value: unknown) {
  const rate = money(value, -1);
  if (rate < 0) throw new Error('Labor rate must be zero or greater.');
  await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('shop_labor_rate', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).bind(String(rate)).run();
  return { ok: true, laborRate: rate };
}

export async function addRepairLabor(db: D1Database, body: Record<string, unknown>) {
  const repairId = positiveId(body.repairId, 'Repair');
  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error('Labor hours must be greater than zero and no more than 24 per entry.');
  const laborDate = dateOnly(body.laborDate, 'Labor date', true);
  const technicianId = body.technicianId ? positiveId(body.technicianId, 'Technician') : null;
  const rate = body.rate === undefined || body.rate === null || String(body.rate).trim() === ''
    ? await getShopLaborRate(db)
    : money(body.rate, -1);
  if (rate < 0) throw new Error('Labor rate must be zero or greater.');
  const notes = String(body.notes ?? '').trim().slice(0, 500);

  const repair = await db.prepare('SELECT id FROM repairs WHERE id = ?').bind(repairId).first<{ id: number }>();
  if (!repair) throw new Error('Repair was not found.');

  await db.prepare(`
    INSERT INTO repair_labor_entries (repair_id, technician_id, labor_date, hours, rate, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(repairId, technicianId, laborDate, hours, rate, notes).run();

  const totals = await db.prepare(`
    SELECT COALESCE(SUM(hours),0) AS hours,
           CASE WHEN SUM(hours) > 0 THEN SUM(hours * rate) / SUM(hours) ELSE ? END AS blended_rate
    FROM repair_labor_entries WHERE repair_id = ?
  `).bind(rate, repairId).first<{ hours: number; blended_rate: number }>();

  await db.prepare(`
    UPDATE repairs SET labor_hours = ?, labor_rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(Number(totals?.hours ?? 0), Number(totals?.blended_rate ?? rate), repairId).run();

  return { ok: true, repairId: `repair-${repairId}`, hours, rate };
}

export async function getBillingData(db: D1Database) {
  const [laborRate, customers, invoices, repairs] = await Promise.all([
    getShopLaborRate(db),
    db.prepare(`SELECT id, name, contact_name, email, phone, address FROM invoice_customers WHERE active = 1 ORDER BY name`).all<any>(),
    db.prepare(`
      SELECT i.id, i.invoice_number, i.repair_id, i.invoice_date, i.due_date, i.status,
             i.bill_to_name, i.subtotal, i.tax_rate, i.tax_amount, i.total,
             COALESCE(e.unit,'') AS unit, COALESCE(r.title,'') AS repair_title
      FROM invoices i
      LEFT JOIN equipment e ON e.id = i.equipment_id
      LEFT JOIN repairs r ON r.id = i.repair_id
      ORDER BY i.invoice_date DESC, i.id DESC
    `).all<any>(),
    db.prepare(`
      SELECT r.id, COALESCE(e.unit,'') AS unit, r.title, r.status, r.outside_cost,
             COALESCE(SUM(DISTINCT l.hours),0) AS labor_hours,
             COALESCE((SELECT SUM(hours * rate) FROM repair_labor_entries WHERE repair_id = r.id),0) AS labor_cost,
             COALESCE((SELECT SUM(rp.quantity * COALESCE(rp.unit_cost,p.unit_cost,0)) FROM repair_parts rp JOIN parts p ON p.id = rp.part_id WHERE rp.repair_id = r.id),0) AS parts_cost
      FROM repairs r
      LEFT JOIN equipment e ON e.id = r.equipment_id
      LEFT JOIN repair_labor_entries l ON l.repair_id = r.id
      GROUP BY r.id, e.unit, r.title, r.status, r.outside_cost
      ORDER BY r.updated_at DESC
    `).all<any>(),
  ]);

  return {
    laborRate,
    customers: customers.results.map((row: any) => ({ id: row.id, name: row.name, contactName: row.contact_name ?? '', email: row.email ?? '', phone: row.phone ?? '', address: row.address ?? '' })),
    invoices: invoices.results.map((row: any) => ({ id: row.id, invoiceNumber: row.invoice_number ?? '', repairId: row.repair_id, invoiceDate: row.invoice_date, dueDate: row.due_date ?? '', status: row.status, billToName: row.bill_to_name ?? '', subtotal: Number(row.subtotal), taxRate: Number(row.tax_rate), taxAmount: Number(row.tax_amount), total: Number(row.total), unit: row.unit, repairTitle: row.repair_title })),
    repairs: repairs.results.map((row: any) => ({ id: `repair-${row.id}`, unit: row.unit, title: row.title, status: row.status, partsCost: Number(row.parts_cost), laborHours: Number(row.labor_hours), laborCost: Number(row.labor_cost), outsideCost: Number(row.outside_cost ?? 0), total: Number(row.parts_cost) + Number(row.labor_cost) + Number(row.outside_cost ?? 0) })),
    updatedAt: new Date().toISOString(),
  };
}

async function invoiceLinesFromRepair(db: D1Database, repairId: number) {
  const [repair, parts, labor] = await Promise.all([
    db.prepare(`SELECT r.id, r.equipment_id, r.title, COALESCE(e.unit,'') AS unit, COALESCE(r.outside_cost,0) AS outside_cost FROM repairs r LEFT JOIN equipment e ON e.id=r.equipment_id WHERE r.id=?`).bind(repairId).first<any>(),
    db.prepare(`SELECT p.part_number, p.description, rp.quantity, COALESCE(rp.unit_cost,p.unit_cost,0) AS unit_cost FROM repair_parts rp JOIN parts p ON p.id=rp.part_id WHERE rp.repair_id=? ORDER BY rp.id`).bind(repairId).all<any>(),
    db.prepare(`SELECT l.hours, l.rate, l.notes, COALESCE(t.name,'Shop labor') AS technician FROM repair_labor_entries l LEFT JOIN technicians t ON t.id=l.technician_id WHERE l.repair_id=? ORDER BY l.labor_date,l.id`).bind(repairId).all<any>(),
  ]);
  if (!repair) throw new Error('Repair was not found.');
  const lines: Array<{ type: string; description: string; quantity: number; unitPrice: number }> = [];
  for (const row of parts.results) lines.push({ type: 'part', description: `${row.part_number} — ${row.description}`, quantity: Number(row.quantity), unitPrice: Number(row.unit_cost) });
  for (const row of labor.results) lines.push({ type: 'labor', description: `${row.technician}${row.notes ? ` — ${row.notes}` : ''}`, quantity: Number(row.hours), unitPrice: Number(row.rate) });
  if (Number(repair.outside_cost) > 0) lines.push({ type: 'outside', description: 'Outside / vendor repair charge', quantity: 1, unitPrice: Number(repair.outside_cost) });
  return { repair, lines };
}

export async function createInvoice(db: D1Database, body: Record<string, unknown>) {
  const repairId = positiveId(body.repairId, 'Repair');
  const { repair, lines } = await invoiceLinesFromRepair(db, repairId);
  const customerId = body.customerId ? positiveId(body.customerId, 'Customer') : null;
  let customer: any = null;
  if (customerId) customer = await db.prepare('SELECT * FROM invoice_customers WHERE id=? AND active=1').bind(customerId).first<any>();
  const billToName = String(body.billToName ?? customer?.name ?? '').trim();
  if (!billToName) throw new Error('Customer / bill-to name is required.');
  const invoiceDate = dateOnly(body.invoiceDate, 'Invoice date', true);
  const dueDate = String(body.dueDate ?? '').trim() ? dateOnly(body.dueDate, 'Due date') : null;
  const taxRate = money(body.taxRate, 0);
  const extraDescription = String(body.extraDescription ?? '').trim().slice(0, 300);
  const extraAmount = money(body.extraAmount, 0);
  if (extraDescription && extraAmount > 0) lines.push({ type: 'other', description: extraDescription, quantity: 1, unitPrice: extraAmount });
  if (!lines.length) throw new Error('This repair has no billable parts, labor, outside cost, or extra charge.');
  const subtotal = Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  const result = await db.prepare(`
    INSERT INTO invoices (repair_id,equipment_id,customer_id,bill_to_name,bill_to_contact,bill_to_email,bill_to_phone,bill_to_address,invoice_date,due_date,status,subtotal,tax_rate,tax_amount,total,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,'Draft',?,?,?,?,?)
  `).bind(repairId, repair.equipment_id, customerId, billToName, customer?.contact_name ?? '', customer?.email ?? '', customer?.phone ?? '', customer?.address ?? '', invoiceDate, dueDate, subtotal, taxRate, taxAmount, total, String(body.notes ?? '').trim().slice(0,1000)).run();
  const invoiceId = Number(result.meta.last_row_id);
  const invoiceNumber = `INV-${invoiceDate.slice(0,4)}-${String(invoiceId).padStart(5,'0')}`;
  await db.prepare('UPDATE invoices SET invoice_number=? WHERE id=?').bind(invoiceNumber, invoiceId).run();
  await db.batch(lines.map((line, index) => db.prepare(`INSERT INTO invoice_lines (invoice_id,line_type,description,quantity,unit_price,amount,sort_order) VALUES (?,?,?,?,?,?,?)`).bind(invoiceId,line.type,line.description,line.quantity,line.unitPrice,Math.round(line.quantity*line.unitPrice*100)/100,index)));
  return { ok: true, id: invoiceId, invoiceNumber };
}

export async function getInvoice(db: D1Database, idValue: unknown) {
  const id = positiveId(idValue, 'Invoice');
  const invoice = await db.prepare(`SELECT i.*, COALESCE(e.unit,'') AS unit, COALESCE(r.title,'') AS repair_title FROM invoices i LEFT JOIN equipment e ON e.id=i.equipment_id LEFT JOIN repairs r ON r.id=i.repair_id WHERE i.id=?`).bind(id).first<any>();
  if (!invoice) throw new Error('Invoice was not found.');
  const lines = await db.prepare('SELECT id,line_type,description,quantity,unit_price,amount FROM invoice_lines WHERE invoice_id=? ORDER BY sort_order,id').bind(id).all<any>();
  return { invoice: { id: invoice.id, invoiceNumber: invoice.invoice_number, unit: invoice.unit, repairTitle: invoice.repair_title, billToName: invoice.bill_to_name ?? '', billToContact: invoice.bill_to_contact ?? '', billToEmail: invoice.bill_to_email ?? '', billToPhone: invoice.bill_to_phone ?? '', billToAddress: invoice.bill_to_address ?? '', invoiceDate: invoice.invoice_date, dueDate: invoice.due_date ?? '', status: invoice.status, subtotal: Number(invoice.subtotal), taxRate: Number(invoice.tax_rate), taxAmount: Number(invoice.tax_amount), total: Number(invoice.total), notes: invoice.notes ?? '', paidAt: invoice.paid_at ?? '' }, lines: lines.results.map((row:any)=>({ id:row.id, type:row.line_type, description:row.description, quantity:Number(row.quantity), unitPrice:Number(row.unit_price), amount:Number(row.amount) })) };
}

export async function saveCustomer(db: D1Database, body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new Error('Customer name is required.');
  const result = await db.prepare(`INSERT INTO invoice_customers (name,contact_name,email,phone,address) VALUES (?,?,?,?,?)`).bind(name,String(body.contactName??'').trim(),String(body.email??'').trim(),String(body.phone??'').trim(),String(body.address??'').trim()).run();
  return { ok:true, id:Number(result.meta.last_row_id) };
}

export async function updateInvoiceStatus(db: D1Database, body: Record<string, unknown>) {
  const id = positiveId(body.id, 'Invoice');
  const status = String(body.status ?? '').trim();
  if (!['Draft','Sent','Paid','Void'].includes(status)) throw new Error('Invoice status is invalid.');
  await db.prepare(`UPDATE invoices SET status=?, paid_at=CASE WHEN ?='Paid' THEN COALESCE(paid_at,CURRENT_TIMESTAMP) ELSE paid_at END, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status,status,id).run();
  return { ok:true,id,status };
}
