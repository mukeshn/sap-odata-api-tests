import { test, expect } from '@playwright/test';
import { V4, q } from '../src/odata';

test.describe('OData V4 catalog service (CAP-style)', () => {
  test('OData-Version header and @odata.context', async ({ request }) => {
    const res = await request.get(`${V4}/Products`);
    expect(res.headers()['odata-version']).toBe('4.0');
    expect((await res.json())['@odata.context']).toBe('$metadata#Products');
  });

  test('$count=true returns @odata.count', async ({ request }) => {
    const body = await (await request.get(`${V4}/Products${q({ $count: true, $top: 2 })}`)).json();
    expect(body['@odata.count']).toBe(10);
    expect(body.value).toHaveLength(2);
  });

  test('contains(), gt and and', async ({ request }) => {
    const { value } = await (await request.get(`${V4}/Products${q({ $filter: "contains(Category,'Bev') and Price gt 15" })}`)).json();
    expect(value.map((p: { Name: string }) => p.Name).sort()).toEqual(['Chai', 'Chang', 'Cloudberry Liqueur']);
  });

  test('$expand=Supplier and $select', async ({ request }) => {
    const { value } = await (await request.get(`${V4}/Products${q({ $select: 'ID,Name', $expand: 'Supplier', $filter: 'SupplierID eq 2' })}`)).json();
    for (const p of value) {
      expect(Object.keys(p).sort()).toEqual(['ID', 'Name', 'Supplier']);
      expect(p.Supplier.Country).toBe('DE');
    }
  });

  test('$orderby desc + $skip/$top paging', async ({ request }) => {
    const all = (await (await request.get(`${V4}/Products${q({ $orderby: 'Price desc', $select: 'Price' })}`)).json()).value.map((p: { Price: number }) => p.Price);
    expect(all).toEqual([...all].sort((a: number, b: number) => b - a));
    const page = (await (await request.get(`${V4}/Products${q({ $orderby: 'Price desc', $select: 'Price', $skip: 3, $top: 3 })}`)).json()).value.map((p: { Price: number }) => p.Price);
    expect(page).toEqual(all.slice(3, 6));
  });

  test('single entity by key and 404', async ({ request }) => {
    const p = await (await request.get(`${V4}/Products(4)`)).json();
    expect(p).toMatchObject({ '@odata.context': '$metadata#Products/$entity', ID: 4, Name: 'Weißbier Hell' });
    expect((await request.get(`${V4}/Products(404)`)).status()).toBe(404);
  });

  test('$metadata is EDMX 4.0', async ({ request }) => {
    const xml = await (await request.get(`${V4}/$metadata`)).text();
    expect(xml).toContain('Version="4.0"');
    expect(xml).toContain('<NavigationProperty Name="Supplier"');
  });
});
