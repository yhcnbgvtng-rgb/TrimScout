/**
 * One fetch for the deal page that never throws and never trusts the body to be JSON. A 502 from the proxy is an HTML
 * page, and a dropped connection rejects; either way the caller gets `{ ok: false, error }` with a sentence a buyer can act on.
 */
export type DealPageResult<T> = { ok: true; json: T } | { ok: false; status: number; error: string };

export async function dealPageRequest<T = any>(url: string, init: RequestInit, fallbackError: string): Promise<DealPageResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, status: 0, error: `${fallbackError} Check your connection and try again.` };
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const serverSaid = json && typeof json.error === "string" && json.error ? json.error : null;
    return { ok: false, status: res.status, error: serverSaid || (res.status >= 500 ? `${fallbackError} Our server had a problem. Please try again in a moment.` : fallbackError) };
  }
  if (json == null) return { ok: false, status: res.status, error: `${fallbackError} We got an unexpected reply. Please try again.` };
  return { ok: true, json: json as T };
}
