import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const [what, arg] = process.argv.slice(2);

if (what === "invoices") {
  const r = await c.query(
    `select i."invoiceNumber", i.kind, i.status, i."totalAmount", i."amountPaid", i."amountDue",
            (select count(*) from payments p where p."invoiceId" = i.id) as pays
     from invoices i order by i."createdAt" desc limit 6`);
  console.log("INVOICES:");
  for (const row of r.rows)
    console.log(" ", row.invoiceNumber, row.kind, row.status, "total:" + row.totalAmount, "paid:" + row.amountPaid, "due:" + row.amountDue, "payments:" + row.pays);
} else if (what === "serial") {
  const r = await c.query(
    `select s."serialNumber", s.status, s."soldInvoiceId", i."invoiceNumber"
     from serial_units s left join invoices i on i.id = s."soldInvoiceId"
     where s."serialNumber" = $1`, [arg]);
  console.log("SERIAL:", JSON.stringify(r.rows[0]));
} else if (what === "last-stock") {
  const r = await c.query(
    `select st.type, st.quantity, st.reference, st."documentType", pr.name
     from stock_transactions st
     left join products pr on pr.id = st."productId"
     order by st."createdAt" desc limit 6`);
  console.log("LAST STOCK TXNS:");
  for (const row of r.rows) console.log(" ", row.type, row.quantity, row["documentType"] || "-", row.reference || "-", row.name);
} else if (what === "quotations") {
  const r = await c.query(
    `select q."quotationNumber", q.status, q."totalAmount", q."convertedAt"
     from quotations q order by q."createdAt" desc limit 5`);
  console.log("QUOTATIONS:");
  for (const row of r.rows) console.log(" ", row.quotationNumber, row.status, row.totalAmount, row.convertedAt ? "CONVERTED" : "-");
} else if (what === "payments") {
  const r = await c.query(
    `select p."paymentNumber", p.amount, p.method, i."invoiceNumber"
     from payments p left join invoices i on i.id = p."invoiceId"
     order by p."createdAt" desc limit 6`);
  console.log("PAYMENTS:");
  for (const row of r.rows) console.log(" ", row.paymentNumber, row.amount, row.method, row.invoiceNumber || "(ADVANCE)");
} else if (what === "returns") {
  const r = await c.query(
    `select r."returnNumber", r.status, r."totalAmount", i."invoiceNumber"
     from sales_returns r join invoices i on i.id = r."invoiceId"
     order by r."createdAt" desc limit 5`);
  console.log("SALES RETURNS:");
  for (const row of r.rows) console.log(" ", row.returnNumber, row.status, row.totalAmount, "for", row.invoiceNumber);
} else if (what === "returned-serials") {
  const r = await c.query(`select "serialNumber", status from serial_units where status = 'RETURNED' limit 5`);
  console.log("RETURNED SERIALS:", JSON.stringify(r.rows));
} else if (what === "adjustments") {
  const r = await c.query(
    `select a."adjustmentNumber", a.reason, a.status from stock_adjustments a
     order by a."createdAt" desc limit 4`);
  console.log("ADJUSTMENTS:", JSON.stringify(r.rows));
} else if (what === "transfers") {
  const r = await c.query(
    `select t."transferNumber", t.status from stock_transfers t order by t."createdAt" desc limit 4`);
  console.log("TRANSFERS:", JSON.stringify(r.rows));
} else if (what === "expenses") {
  const r = await c.query(
    `select e."expenseNumber", e.category, e.amount, e.status from expenses e order by e."createdAt" desc limit 4`);
  console.log("EXPENSES:", JSON.stringify(r.rows));
} else if (what === "purchase-invoices") {
  const r = await c.query(
    `select p."invoiceNumber", p.status, p."totalAmount" from purchase_invoices p
     order by p."createdAt" desc limit 4`);
  console.log("PURCHASE INVOICES:", JSON.stringify(r.rows));
} else if (what === "audit") {
  const r = await c.query(`select action, "entityType" from audit_logs order by "createdAt" desc limit 8`);
  console.log("AUDIT:", JSON.stringify(r.rows));
}

await c.end();
