"use client";
export class ApiError extends Error { constructor(message: string, public status: number, public data: any) { super(message); } }
export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers }, body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data);
  return data as T;
}
