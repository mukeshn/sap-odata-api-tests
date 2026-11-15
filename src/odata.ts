import type { APIRequestContext, APIResponse } from '@playwright/test';

export const V2 = '/sap/opu/odata/sap';
export const V4 = '/odata/v4/catalog';
export const basic = { authorization: 'Basic ' + Buffer.from('S4_QA_USER:Welcome1!').toString('base64') };

/** Builds an OData query string without URL-encoding the `$` of system options. */
export function q(options: Record<string, string | number | boolean>) {
  return '?' + Object.entries(options).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

export async function v2(request: APIRequestContext, path: string, options: Record<string, string | number> = {}) {
  return request.get(`${V2}${path}${q({ $format: 'json', ...options })}`, { headers: basic });
}

export async function results<T = Record<string, unknown>>(res: APIResponse): Promise<T[]> {
  return (await res.json()).d.results;
}

export async function csrf(request: APIRequestContext) {
  const res = await request.get(`${V2}/API_SALES_ORDER_SRV/`, { headers: { ...basic, 'x-csrf-token': 'Fetch' } });
  return res.headers()['x-csrf-token'];
}
