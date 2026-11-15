import { send } from '../lib.mjs';
import { randomUUID } from 'node:crypto';

// SAP S/4HANA style OData mock.
// V2: /sap/opu/odata/sap/API_SALES_ORDER_SRV, /sap/opu/odata/sap/API_BUSINESS_PARTNER
// V4: /odata/v4/catalog (CAP-style)
const V2 = '/sap/opu/odata/sap';
const csrfTokens = new Set();
const BASIC = { 'S4_QA_USER': 'Welcome1!' };

const partners = [
  { BusinessPartner: '17100001', BusinessPartnerFullName: 'Domestic Customer DE 1', Country: 'DE', CityName: 'Augsburg', BusinessPartnerCategory: '2' },
  { BusinessPartner: '17100002', BusinessPartnerFullName: 'Domestic Customer DE 2', Country: 'DE', CityName: 'München', BusinessPartnerCategory: '2' },
  { BusinessPartner: '17100003', BusinessPartnerFullName: 'Alpine Retail GmbH', Country: 'AT', CityName: 'Innsbruck', BusinessPartnerCategory: '2' },
  { BusinessPartner: '17100004', BusinessPartnerFullName: 'Rhein Handel KG', Country: 'DE', CityName: 'Köln', BusinessPartnerCategory: '2' },
  { BusinessPartner: '17100005', BusinessPartnerFullName: 'Lyon Distribution SA', Country: 'FR', CityName: 'Lyon', BusinessPartnerCategory: '2' },
];
const materials = [
  { Product: 'TG11', ProductDescription: 'Trading Good 11, PD, Reg. Trading', BaseUnit: 'PC', NetPrice: 120.5 },
  { Product: 'TG12', ProductDescription: 'Trading Good 12, PD, Serial', BaseUnit: 'PC', NetPrice: 89.0 },
  { Product: 'FG126', ProductDescription: 'Finished Good 126, MTO', BaseUnit: 'PC', NetPrice: 450.0 },
  { Product: 'RM14', ProductDescription: 'Raw Material 14, Batch', BaseUnit: 'KG', NetPrice: 12.75 },
];
const STATUS = { A: 'Not Yet Processed', B: 'Partially Processed', C: 'Completely Processed' };
let orders;
let nextOrder;
function seed() {
  nextOrder = 1000;
  orders = [];
  const mk = (partner, date, status, items, po) => {
    const so = String(nextOrder++);
    const its = items.map(([mat, qty], i) => {
      const m = materials.find((x) => x.Product === mat);
      return { SalesOrder: so, SalesOrderItem: String((i + 1) * 10), Material: mat, SalesOrderItemText: m.ProductDescription, RequestedQuantity: String(qty), RequestedQuantityUnit: m.BaseUnit, NetAmount: (m.NetPrice * qty).toFixed(2), TransactionCurrency: 'EUR' };
    });
    orders.push({ SalesOrder: so, SalesOrderType: 'OR', SalesOrganization: '1710', DistributionChannel: '10', OrganizationDivision: '00', SoldToParty: partner, PurchaseOrderByCustomer: po, SalesOrderDate: `/Date(${Date.parse(date)})/`, TotalNetAmount: its.reduce((s, x) => s + Number(x.NetAmount), 0).toFixed(2), TransactionCurrency: 'EUR', OverallSDProcessStatus: status, to_Item: its });
  };
  const data = [
    ['17100001', '2026-09-02', 'C', [['TG11', 10]], 'PO-4711'], ['17100002', '2026-09-05', 'C', [['TG12', 4], ['RM14', 50]], 'PO-4712'],
    ['17100003', '2026-09-11', 'B', [['FG126', 2]], 'PO-AT-88'], ['17100001', '2026-09-19', 'A', [['TG11', 3], ['TG12', 3]], 'PO-4713'],
    ['17100004', '2026-09-23', 'A', [['RM14', 200]], 'RH-2026-17'], ['17100005', '2026-10-01', 'C', [['FG126', 1]], 'LY-0915'],
    ['17100002', '2026-10-04', 'B', [['TG11', 25]], 'PO-4720'], ['17100003', '2026-10-09', 'A', [['TG12', 12]], 'PO-AT-91'],
    ['17100001', '2026-10-15', 'A', [['FG126', 4], ['TG11', 1]], 'PO-4725'], ['17100004', '2026-10-20', 'C', [['TG11', 8]], 'RH-2026-21'],
    ['17100005', '2026-10-28', 'A', [['RM14', 75]], 'LY-0931'], ['17100002', '2026-11-03', 'A', [['TG12', 6]], 'PO-4731'],
  ];
  data.forEach((d) => mk(...d));
}
seed();

// ---- tiny $filter evaluator: eq ne gt ge lt le, and/or, substringof(), startswith(), contains() ----
function compileFilter(expr) {
  if (!expr) return () => true;
  const tokens = expr.match(/'(?:[^']|'')*'|\(|\)|[A-Za-z_][\w/]*|-?\d+(?:\.\d+)?|,/g) || [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const literal = (t) => (t.startsWith("'") ? t.slice(1, -1).replace(/''/g, "'") : /^-?\d/.test(t) ? Number(t) : t === 'true' ? true : t === 'false' ? false : t === 'null' ? null : { field: t });
  const val = (v, row) => (v && typeof v === 'object' ? row[v.field] : v);
  function primary() {
    const t = next();
    if (t === '(') { const e = or(); next(); return e; }
    if (t === 'not') { const e = primary(); return (r) => !e(r); }
    if (['substringof', 'startswith', 'endswith', 'contains'].includes(t?.toLowerCase())) {
      next(); const a = literal(next()); next(); const b = literal(next()); next();
      const fn = t.toLowerCase();
      return (r) => {
        const A = String(val(a, r) ?? '').toLowerCase(), B = String(val(b, r) ?? '').toLowerCase();
        return fn === 'substringof' ? B.includes(A) : fn === 'startswith' ? A.startsWith(B) : fn === 'endswith' ? A.endsWith(B) : A.includes(B);
      };
    }
    const left = literal(t), op = next(), right = literal(next());
    const cmp = (r) => { let a = val(left, r), b = val(right, r); if (typeof b === 'number' && typeof a === 'string') a = Number(a); return [a, b]; };
    const ops = { eq: (a, b) => a === b, ne: (a, b) => a !== b, gt: (a, b) => a > b, ge: (a, b) => a >= b, lt: (a, b) => a < b, le: (a, b) => a <= b };
    if (!ops[op]) throw new Error(`Invalid filter operator '${op}'`);
    return (r) => ops[op](...cmp(r));
  }
  function and() { let e = primary(); while (peek() === 'and') { next(); const l = e, rgt = primary(); e = (r) => l(r) && rgt(r); } return e; }
  function or() { let e = and(); while (peek() === 'or') { next(); const l = e, rgt = and(); e = (r) => l(r) || rgt(r); } return e; }
  const fn = or();
  if (i < tokens.length) throw new Error('Invalid $filter expression');
  return fn;
}

export function queryOptions(rows, q) {
  let out = rows.filter(compileFilter(q.get('$filter')));
  const count = out.length;
  const orderby = q.get('$orderby');
  if (orderby) {
    const keys = orderby.split(',').map((s) => s.trim().split(/\s+/));
    out = [...out].sort((a, b) => { for (const [k, d] of keys) { const c = String(a[k] ?? '').localeCompare(String(b[k] ?? ''), undefined, { numeric: true }); if (c) return d === 'desc' ? -c : c; } return 0; });
  }
  const skip = Number(q.get('$skip') || 0), top = q.get('$top');
  out = out.slice(skip, top != null ? skip + Number(top) : undefined);
  const select = q.get('$select');
  const expand = (q.get('$expand') || '').split(',').filter(Boolean);
  out = out.map((r) => {
    const base = select ? Object.fromEntries(select.split(',').map((f) => [f.trim(), r[f.trim()]])) : { ...r };
    for (const nav of Object.keys(r).filter((k) => k.startsWith('to_') || k === 'Supplier')) if (!expand.includes(nav)) delete base[nav];
    for (const nav of expand) if (r[nav] !== undefined) base[nav] = r[nav];
    return base;
  });
  return { count, rows: out };
}

function v2Auth(ctx) {
  const h = ctx.req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    const [u, p] = Buffer.from(h.slice(6), 'base64').toString().split(':');
    if (BASIC[u] === p) return true;
  }
  if (ctx.req.headers.cookie?.includes('SAP_SESSIONID_QA=')) return true;
  send(ctx.res, 401, { error: { code: '/IWFND/CM_CONSUMER/101', message: { lang: 'en', value: 'Authentication required' } } }, { 'www-authenticate': 'Basic realm="SAP NetWeaver Application Server"' });
  return false;
}
function csrf(ctx) {
  const t = ctx.req.headers['x-csrf-token'];
  if (t && csrfTokens.has(t)) return true;
  send(ctx.res, 403, 'CSRF token validation failed', { 'x-csrf-token': 'Required' });
  return false;
}
const v2Error = (res, status, code, msg, details = []) => send(res, status, { error: { code, message: { lang: 'en', value: msg }, innererror: { errordetails: details } } });
const meta = (svc, set, key) => ({ __metadata: { id: `${V2}/${svc}/${set}('${key}')`, uri: `${V2}/${svc}/${set}('${key}')`, type: `${svc}.${set}Type` } });
const withMeta = (svc, set, keyField) => (r) => ({ ...meta(svc, set, r[keyField]), ...r, ...(r.to_Item ? { to_Item: { results: r.to_Item.map((it) => ({ ...meta(svc, 'A_SalesOrderItem', `${it.SalesOrder}',SalesOrderItem='${it.SalesOrderItem}`), ...it })) } } : {}) });
const tokenHeaders = (ctx) => {
  const h = {};
  if ((ctx.req.headers['x-csrf-token'] || '').toLowerCase() === 'fetch') {
    const t = randomUUID().replace(/-/g, '').slice(0, 24) + '==';
    csrfTokens.add(t);
    h['x-csrf-token'] = t;
    h['set-cookie'] = 'SAP_SESSIONID_QA=' + randomUUID() + '; Path=/; HttpOnly';
  }
  return h;
};

const METADATA = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
 <edmx:DataServices m:DataServiceVersion="2.0">
  <Schema Namespace="API_SALES_ORDER_SRV" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
   <EntityType Name="A_SalesOrderType"><Key><PropertyRef Name="SalesOrder"/></Key>
    <Property Name="SalesOrder" Type="Edm.String" Nullable="false" MaxLength="10"/><Property Name="SalesOrderType" Type="Edm.String" MaxLength="4"/>
    <Property Name="SalesOrganization" Type="Edm.String" MaxLength="4"/><Property Name="DistributionChannel" Type="Edm.String" MaxLength="2"/>
    <Property Name="OrganizationDivision" Type="Edm.String" MaxLength="2"/><Property Name="SoldToParty" Type="Edm.String" MaxLength="10"/>
    <Property Name="PurchaseOrderByCustomer" Type="Edm.String" MaxLength="35"/><Property Name="SalesOrderDate" Type="Edm.DateTime" Precision="0"/>
    <Property Name="TotalNetAmount" Type="Edm.Decimal" Precision="16" Scale="3"/><Property Name="TransactionCurrency" Type="Edm.String" MaxLength="5"/>
    <Property Name="OverallSDProcessStatus" Type="Edm.String" MaxLength="1"/>
    <NavigationProperty Name="to_Item" Relationship="API_SALES_ORDER_SRV.assoc_SalesOrder_Item" FromRole="FromRole" ToRole="ToRole"/></EntityType>
   <EntityType Name="A_SalesOrderItemType"><Key><PropertyRef Name="SalesOrder"/><PropertyRef Name="SalesOrderItem"/></Key>
    <Property Name="SalesOrder" Type="Edm.String" Nullable="false" MaxLength="10"/><Property Name="SalesOrderItem" Type="Edm.String" Nullable="false" MaxLength="6"/>
    <Property Name="Material" Type="Edm.String" MaxLength="40"/><Property Name="RequestedQuantity" Type="Edm.Decimal" Precision="15" Scale="3"/>
    <Property Name="NetAmount" Type="Edm.Decimal" Precision="16" Scale="3"/></EntityType>
   <EntityContainer Name="API_SALES_ORDER_SRV_Entities" m:IsDefaultEntityContainer="true">
    <EntitySet Name="A_SalesOrder" EntityType="API_SALES_ORDER_SRV.A_SalesOrderType"/><EntitySet Name="A_SalesOrderItem" EntityType="API_SALES_ORDER_SRV.A_SalesOrderItemType"/>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>`;

// ---- V4 catalog (CAP style) ----
const suppliers = [
  { ID: 1, Name: 'Exotic Liquids', Country: 'UK' }, { ID: 2, Name: 'Bavaria Brews', Country: 'DE' }, { ID: 3, Name: 'Nordic Pantry', Country: 'SE' },
];
const products = [
  ['Chai', 'Beverages', 18.0, 39, 1], ['Chang', 'Beverages', 19.0, 17, 1], ['Aniseed Syrup', 'Condiments', 10.0, 13, 1],
  ['Weißbier Hell', 'Beverages', 14.0, 111, 2], ['Laugenbrezel', 'Bakery', 3.5, 0, 2], ['Obatzda', 'Dairy', 7.2, 22, 2],
  ['Knäckebröd', 'Bakery', 4.8, 64, 3], ['Gravlax', 'Seafood', 26.0, 11, 3], ['Lingonberry Jam', 'Condiments', 6.5, 48, 3], ['Cloudberry Liqueur', 'Beverages', 31.0, 5, 3],
].map(([Name, Category, Price, Stock, SupplierID], i) => ({ ID: i + 1, Name, Category, Price, Stock, SupplierID, Supplier: suppliers.find((s) => s.ID === SupplierID) }));

export function register(r) {
  r.post('/sap/__reset', ({ res }) => { seed(); send(res, 200, { reset: true }); });
  // UI session for the Fiori mock (mirrors SAML/form login result)
  r.post('/sap/bc/ui2/login', ({ res, body }) => {
    if (BASIC[body.username] !== body.password) return send(res, 401, { error: 'Logon failed', message: 'Name or password is incorrect (repeat logon)' });
    send(res, 200, { user: body.username, fullName: 'QA Tester (S/4)' }, { 'set-cookie': `SAP_SESSIONID_QA=${randomUUID()}; Path=/` });
  });

  r.get(`${V2}/API_SALES_ORDER_SRV/\\$metadata`, (ctx) => { if (v2Auth(ctx)) send(ctx.res, 200, METADATA, { 'content-type': 'application/xml', ...tokenHeaders(ctx) }); });
  r.get(`${V2}/API_SALES_ORDER_SRV`, (ctx) => { if (v2Auth(ctx)) send(ctx.res, 200, { d: { EntitySets: ['A_SalesOrder', 'A_SalesOrderItem'] } }, tokenHeaders(ctx)); });
  r.get(`${V2}/API_SALES_ORDER_SRV/A_SalesOrder`, (ctx) => {
    if (!v2Auth(ctx)) return;
    try {
      const { count, rows } = queryOptions(orders, ctx.query);
      const d = { results: rows.map(withMeta('API_SALES_ORDER_SRV', 'A_SalesOrder', 'SalesOrder')) };
      if (ctx.query.get('$inlinecount') === 'allpages') d.__count = String(count);
      send(ctx.res, 200, { d }, tokenHeaders(ctx));
    } catch (e) { v2Error(ctx.res, 400, 'SY/530', e.message); }
  });
  r.get(`${V2}/API_SALES_ORDER_SRV/A_SalesOrder/\\$count`, (ctx) => { if (v2Auth(ctx)) send(ctx.res, 200, String(queryOptions(orders, ctx.query).count)); });
  r.get(`${V2}/API_SALES_ORDER_SRV/A_SalesOrder\\('([0-9]+)'\\)`, (ctx) => {
    if (!v2Auth(ctx)) return;
    const id = ctx.url.pathname.match(/A_SalesOrder\('([0-9]+)'\)/)[1];
    const o = orders.find((x) => x.SalesOrder === id);
    if (!o) return v2Error(ctx.res, 404, 'V1/302', `Sales order ${id} does not exist`);
    const { rows } = queryOptions([o], ctx.query);
    send(ctx.res, 200, { d: withMeta('API_SALES_ORDER_SRV', 'A_SalesOrder', 'SalesOrder')(rows[0]) }, tokenHeaders(ctx));
  });
  r.get(`${V2}/API_SALES_ORDER_SRV/A_SalesOrder\\('([0-9]+)'\\)/to_Item`, (ctx) => {
    if (!v2Auth(ctx)) return;
    const id = ctx.url.pathname.match(/A_SalesOrder\('([0-9]+)'\)/)[1];
    const o = orders.find((x) => x.SalesOrder === id);
    if (!o) return v2Error(ctx.res, 404, 'V1/302', `Sales order ${id} does not exist`);
    send(ctx.res, 200, { d: { results: o.to_Item } });
  });
  r.post(`${V2}/API_SALES_ORDER_SRV/A_SalesOrder`, (ctx) => {
    if (!v2Auth(ctx) || !csrf(ctx)) return;
    const b = ctx.body;
    const details = [];
    if (b.SalesOrderType !== 'OR') details.push({ code: 'V1/385', message: 'Sales document type must be OR', target: 'SalesOrderType', severity: 'error' });
    if (b.SalesOrganization !== '1710') details.push({ code: 'V1/320', message: `Sales organization ${b.SalesOrganization ?? ''} is not defined`, target: 'SalesOrganization', severity: 'error' });
    if (!partners.some((p) => p.BusinessPartner === b.SoldToParty)) details.push({ code: 'V1/888', message: `Sold-to party ${b.SoldToParty ?? ''} does not exist`, target: 'SoldToParty', severity: 'error' });
    const items = b.to_Item?.results || [];
    if (!items.length) details.push({ code: 'V1/555', message: 'Enter at least one item', target: 'to_Item', severity: 'error' });
    items.forEach((it, idx) => {
      if (!materials.some((m) => m.Product === it.Material)) details.push({ code: 'V1/392', message: `Material ${it.Material} is not defined`, target: `to_Item[${idx}]/Material`, severity: 'error' });
      if (!(Number(it.RequestedQuantity) > 0)) details.push({ code: 'V1/310', message: 'Quantity must be greater than zero', target: `to_Item[${idx}]/RequestedQuantity`, severity: 'error' });
    });
    if (details.length) return v2Error(ctx.res, 400, details[0].code, details[0].message, details);
    const so = String(nextOrder++);
    const its = items.map((it, i) => { const m = materials.find((x) => x.Product === it.Material); return { SalesOrder: so, SalesOrderItem: String((i + 1) * 10), Material: it.Material, SalesOrderItemText: m.ProductDescription, RequestedQuantity: String(it.RequestedQuantity), RequestedQuantityUnit: m.BaseUnit, NetAmount: (m.NetPrice * Number(it.RequestedQuantity)).toFixed(2), TransactionCurrency: 'EUR' }; });
    const o = { SalesOrder: so, SalesOrderType: 'OR', SalesOrganization: '1710', DistributionChannel: b.DistributionChannel || '10', OrganizationDivision: b.OrganizationDivision || '00', SoldToParty: b.SoldToParty, PurchaseOrderByCustomer: b.PurchaseOrderByCustomer || '', SalesOrderDate: `/Date(${Date.now()})/`, TotalNetAmount: its.reduce((s, x) => s + Number(x.NetAmount), 0).toFixed(2), TransactionCurrency: 'EUR', OverallSDProcessStatus: 'A', to_Item: its };
    orders.push(o);
    send(ctx.res, 201, { d: withMeta('API_SALES_ORDER_SRV', 'A_SalesOrder', 'SalesOrder')(o) }, { location: `${V2}/API_SALES_ORDER_SRV/A_SalesOrder('${so}')`, 'sap-message': JSON.stringify({ code: 'V1/311', message: `Standard Order ${so} has been saved`, severity: 'success' }) });
  });
  r.patch(`${V2}/API_SALES_ORDER_SRV/A_SalesOrder\\('([0-9]+)'\\)`, (ctx) => {
    if (!v2Auth(ctx) || !csrf(ctx)) return;
    const id = ctx.url.pathname.match(/A_SalesOrder\('([0-9]+)'\)/)[1];
    const o = orders.find((x) => x.SalesOrder === id);
    if (!o) return v2Error(ctx.res, 404, 'V1/302', `Sales order ${id} does not exist`);
    if (o.OverallSDProcessStatus === 'C') return v2Error(ctx.res, 400, 'V1/015', `Sales order ${id} is completely processed and cannot be changed`);
    const allowed = ['PurchaseOrderByCustomer', 'DistributionChannel'];
    const bad = Object.keys(ctx.body).filter((k) => !allowed.includes(k));
    if (bad.length) return v2Error(ctx.res, 400, 'SY/530', `Property ${bad[0]} cannot be changed`);
    Object.assign(o, ctx.body);
    send(ctx.res, 204, '');
  });
  r.delete(`${V2}/API_SALES_ORDER_SRV/A_SalesOrder\\('([0-9]+)'\\)`, (ctx) => {
    if (!v2Auth(ctx) || !csrf(ctx)) return;
    const id = ctx.url.pathname.match(/A_SalesOrder\('([0-9]+)'\)/)[1];
    const idx = orders.findIndex((x) => x.SalesOrder === id);
    if (idx < 0) return v2Error(ctx.res, 404, 'V1/302', `Sales order ${id} does not exist`);
    if (orders[idx].OverallSDProcessStatus !== 'A') return v2Error(ctx.res, 400, 'V1/017', `Sales order ${id} has follow-on documents and cannot be deleted`);
    orders.splice(idx, 1);
    send(ctx.res, 204, '');
  });
  r.get(`${V2}/API_BUSINESS_PARTNER/A_BusinessPartner`, (ctx) => {
    if (!v2Auth(ctx)) return;
    try {
      const { count, rows } = queryOptions(partners, ctx.query);
      const d = { results: rows.map(withMeta('API_BUSINESS_PARTNER', 'A_BusinessPartner', 'BusinessPartner')) };
      if (ctx.query.get('$inlinecount') === 'allpages') d.__count = String(count);
      send(ctx.res, 200, { d }, tokenHeaders(ctx));
    } catch (e) { v2Error(ctx.res, 400, 'SY/530', e.message); }
  });
  r.get(`${V2}/API_PRODUCT_SRV/A_Product`, (ctx) => {
    if (!v2Auth(ctx)) return;
    const { rows } = queryOptions(materials, ctx.query);
    send(ctx.res, 200, { d: { results: rows.map(withMeta('API_PRODUCT_SRV', 'A_Product', 'Product')) } });
  });

  // ---- OData V4 ----
  const v4 = (res, ctxPath, payload, status = 200) => send(res, status, { '@odata.context': `$metadata#${ctxPath}`, ...payload }, { 'odata-version': '4.0' });
  r.get('/odata/v4/catalog/Products', (ctx) => {
    try {
      const { count, rows } = queryOptions(products, ctx.query);
      v4(ctx.res, 'Products', { ...(ctx.query.get('$count') === 'true' ? { '@odata.count': count } : {}), value: rows });
    } catch (e) { send(ctx.res, 400, { error: { code: '400', message: e.message } }); }
  });
  r.get('/odata/v4/catalog/Products\\(([0-9]+)\\)', (ctx) => {
    const id = Number(ctx.url.pathname.match(/Products\((\d+)\)/)[1]);
    const p = products.find((x) => x.ID === id);
    if (!p) return send(ctx.res, 404, { error: { code: '404', message: 'Not Found' } });
    const { rows } = queryOptions([p], ctx.query);
    v4(ctx.res, 'Products/$entity', rows[0]);
  });
  r.get('/odata/v4/catalog/Suppliers', (ctx) => { const { rows } = queryOptions(suppliers, ctx.query); v4(ctx.res, 'Suppliers', { value: rows }); });
  r.get('/odata/v4/catalog/\\$metadata', (ctx) => send(ctx.res, 200, '<?xml version="1.0"?><edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices><Schema Namespace="CatalogService" xmlns="http://docs.oasis-open.org/odata/ns/edm"><EntityType Name="Products"><Key><PropertyRef Name="ID"/></Key><Property Name="ID" Type="Edm.Int32" Nullable="false"/><Property Name="Name" Type="Edm.String"/><Property Name="Category" Type="Edm.String"/><Property Name="Price" Type="Edm.Decimal"/><Property Name="Stock" Type="Edm.Int32"/><NavigationProperty Name="Supplier" Type="CatalogService.Suppliers"/></EntityType><EntityType Name="Suppliers"><Key><PropertyRef Name="ID"/></Key><Property Name="ID" Type="Edm.Int32" Nullable="false"/><Property Name="Name" Type="Edm.String"/><Property Name="Country" Type="Edm.String"/></EntityType></Schema></edmx:DataServices></edmx:Edmx>', { 'content-type': 'application/xml', 'odata-version': '4.0' }));
}
