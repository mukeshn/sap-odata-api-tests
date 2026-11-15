import { test, expect } from '@playwright/test';
import { v2, results } from '../src/odata';

test.describe('OData V2 system query options - API_SALES_ORDER_SRV', () => {
  test('$filter eq + and', async ({ request }) => {
    const rows = await results<{ SoldToParty: string; OverallSDProcessStatus: string }>(await v2(request, '/API_SALES_ORDER_SRV/A_SalesOrder', { $filter: "SoldToParty eq '17100001' and OverallSDProcessStatus eq 'A'" }));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toMatchObject({ SoldToParty: '17100001', OverallSDProcessStatus: 'A' });
  });

  test('$filter or + ne', async ({ request }) => {
    const rows = await results<{ OverallSDProcessStatus: string }>(await v2(request, '/API_SALES_ORDER_SRV/A_SalesOrder', { $filter: "OverallSDProcessStatus eq 'B' or OverallSDProcessStatus eq 'C'" }));
    expect(new Set(rows.map((r) => r.OverallSDProcessStatus))).toEqual(new Set(['B', 'C']));
  });

  test('numeric comparison on Edm.Decimal', async ({ request }) => {
    const rows = await results<{ TotalNetAmount: string }>(await v2(request, '/API_SALES_ORDER_SRV/A_SalesOrder', { $filter: 'TotalNetAmount gt 1000' }));
    for (const r of rows) expect(Number(r.TotalNetAmount)).toBeGreaterThan(1000);
  });

  test('substringof() and startswith()', async ({ request }) => {
    const a = await results<{ PurchaseOrderByCustomer: string }>(await v2(request, '/API_SALES_ORDER_SRV/A_SalesOrder', { $filter: "substringof('AT',PurchaseOrderByCustomer)" }));
    expect(a.every((r) => r.PurchaseOrderByCustomer.includes('AT'))).toBe(true);
    const b = await results<{ PurchaseOrderByCustomer: string }>(await v2(request, '/API_SALES_ORDER_SRV/A_SalesOrder', { $filter: "startswith(PurchaseOrderByCustomer,'RH')" }));
    expect(b.every((r) => r.PurchaseOrderByCustomer.startsWith('RH'))).toBe(true);
  });

  test('$orderby with multiple keys', async ({ request }) => {
    const rows = await results<{ SoldToParty: string; SalesOrder: string }>(await v2(request, '/API_SALES_ORDER_SRV/A_SalesOrder', { $orderby: 'SoldToParty asc,SalesOrder desc', $select: 'SoldToParty,SalesOrder' }));
    const keys = rows.map((r) => `${r.SoldToParty}|${String(9_999_999 - Number(r.SalesOrder)).padStart(7, '0')}`);
    expect(keys).toEqual([...keys].sort());
  });

  test('$inlinecount and $count agree', async ({ request }) => {
    const filter = "OverallSDProcessStatus eq 'A'";
    const res = await v2(request, '/API_SALES_ORDER_SRV/A_SalesOrder', { $filter: filter, $inlinecount: 'allpages', $top: 1 });
    const inline = Number((await res.json()).d.__count);
    const count = await (await v2(request, '/API_SALES_ORDER_SRV/A_SalesOrder/$count', { $filter: filter })).text();
    expect(inline).toBe(Number(count));
  });

  test('navigation property to_Item', async ({ request }) => {
    const items = await results<{ SalesOrder: string; SalesOrderItem: string }>(await v2(request, "/API_SALES_ORDER_SRV/A_SalesOrder('1001')/to_Item"));
    expect(items.map((i) => i.SalesOrderItem)).toEqual(['10', '20']);
    expect(items.every((i) => i.SalesOrder === '1001')).toBe(true);
  });

  test('__metadata uri points to the entity', async ({ request }) => {
    const [first] = await results<{ SalesOrder: string; __metadata: { uri: string; type: string } }>(await v2(request, '/API_SALES_ORDER_SRV/A_SalesOrder', { $top: 1 }));
    expect(first.__metadata.uri).toMatch(new RegExp(`A_SalesOrder\\('${first.SalesOrder}'\\)$`));
    expect(first.__metadata.type).toBe('API_SALES_ORDER_SRV.A_SalesOrderType');
  });

  test('invalid operator returns an OData error', async ({ request }) => {
    const res = await v2(request, '/API_SALES_ORDER_SRV/A_SalesOrder', { $filter: "SoldToParty like '1710%'" });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.message.value).toContain("Invalid filter operator 'like'");
  });

  test('business partner value help data', async ({ request }) => {
    const bps = await results<{ Country: string }>(await v2(request, '/API_BUSINESS_PARTNER/A_BusinessPartner', { $filter: "Country eq 'DE'", $select: 'BusinessPartner,Country' }));
    expect(bps.length).toBe(3);
  });
});
