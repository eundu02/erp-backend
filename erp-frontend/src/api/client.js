// 백엔드 REST API 호출 래퍼. 실패 시 서버의 { error, detail }을 담은 ApiError를 던진다.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `요청에 실패했습니다. (HTTP ${status})`);
    this.status = status;
    this.detail = body?.detail;
  }
}

function toQuery(params) {
  if (!params) return '';
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, v);
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, { params, body } = {}) {
  const res = await fetch(`/api${path}${toQuery(params)}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  del: (path) => request('DELETE', path),
};
