import { test, expect } from '@playwright/test';
import { V2, basic, csrf } from '../src/odata';

const SO = `${V2}/API_SALES_ORDER_SRV/A_SalesOrder`;
const order = (soldTo = '17100002', items = [{ Material: 'TG11', RequestedQuantity: '2' }]) => ({
  SalesOrderType: 'OR', SalesOrganization: '1710', DistributionChannel: '10', OrganizationDivision: '00', SoldToParty: soldTo,
  PurchaseOrderByCustomer: `ODATA-${Date.now()}`, to_Item: { results: items },
});

test.describe('Writes with CSRF protection', () => {
  test('token is issued only on x-csrf-token: Fetch', async ({ request }) => {
    const without = await request.get(`${V2}/API_SALES_ORDER_SRV/`, { headers: basic });
    expect(without.headers()['x-csrf-token']).toBeUndefined();
    expect(await csrf(request)).toMatch(/^[a-f0-9]{24}==$/);
  });

  test('POST without or with a forged token is 403', async ({ request }) => {
    for (const token of [undefined, 'forged-token']) {
      const res = await request.post(SO, { headers: { ...basic, ...(token ? { 'x-csrf-token': token } : {}) }, data: order() });
      expect(res.status()).toBe(403);
    }
  });

  test('deep insert, read back, patch, delete', async ({ request }) => {
    const token = await csrf(request);
    const headers = { ...basic, 'x-csrf-token': token };
    const created = await request.post(SO, { headers, data: order('17100005', [{ Material: 'TG12', RequestedQuantity: '3' }, { Material: 'RM14', RequestedQuantity: '20' }]) });
    expect(created.status()).toBe(201);
    const { d } = await created.json();
    expect(d.TotalNetAmount).toBe((3 * 89 + 20 * 12.75).toFixed(2));

    const patch = await request.patch(`${SO}('${d.SalesOrder}')`, { headers, data: { PurchaseOrderByCustomer: 'CHANGED' } });
    expect(patch.status()).toBe(204);
    const read = await request.get(`${SO}('${d.SalesOrder}')?$format=json`, { headers: basic });
    expect((await read.json()).d.PurchaseOrderByCustomer).toBe('CHANGED');

    expect((await request.delete(`${SO}('${d.SalesOrder}')`, { headers })).status()).toBe(204);
    expect((await request.get(`${SO}('${d.SalesOrder}')`, { headers: basic })).status()).toBe(404);
  });

  test('all validation messages are returned in errordetails', async ({ request }) => {
    const token = await csrf(request);
    const res = await request.post(SO, { headers: { ...basic, 'x-csrf-token': token }, data: { ...order('00000000', [{ Material: 'NOPE', RequestedQuantity: '0' }]), SalesOrganization: '9999' } });
    expect(res.status()).toBe(400);
    const details = (await res.json()).error.innererror.errordetails;
    expect(details.map((x: { target: string }) => x.target)).toEqual(['SalesOrganization', 'SoldToParty', 'to_Item[0]/Material', 'to_Item[0]/RequestedQuantity']);
    expect(details.every((x: { severity: string }) => x.severity === 'error')).toBe(true);
  });
});
