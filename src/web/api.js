// Fetch helpers for the daemon API.
export class ApiError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new ApiError(res.status, json.error || `HTTP ${res.status}`, json);
  return json;
}

export const historyApi = {
  list: () => api('GET', '/api/docs'),
  activate: (id) => api('POST', `/api/docs/${id}/activate`),
  remove: (id) => api('DELETE', `/api/docs/${id}`),
  reveal: (id) => api('POST', `/api/docs/${id}/reveal`),
};

export const docApi = (id) => ({
  get: () => api('GET', `/api/docs/${id}`),
  add: (spec) => api('POST', `/api/docs/${id}/annotations`, spec),
  update: (aid, patch) => api('PATCH', `/api/docs/${id}/annotations/${aid}`, patch),
  remove: (aid) => api('DELETE', `/api/docs/${id}/annotations/${aid}`),
  export: (format, out) => api('POST', `/api/docs/${id}/export`, { format, out }),
  addSession: (spec) => api('POST', `/api/docs/${id}/sessions`, spec),
  updateSession: (sid, patch) => api('PATCH', `/api/docs/${id}/sessions/${sid}`, patch),
  archiveSession: (sid, archived) => api('PATCH', `/api/docs/${id}/sessions/${sid}`, { archived }),
  removeSession: (sid) => api('DELETE', `/api/docs/${id}/sessions/${sid}`),
  setColors: (patch) => api('PATCH', `/api/docs/${id}/colors`, patch),
  tags: () => api('GET', `/api/docs/${id}/tags`),
  updateTag: (tag, patch) => api('PATCH', `/api/docs/${id}/tags/${encodeURIComponent(tag)}`, patch),
  removeTag: (tag) => api('DELETE', `/api/docs/${id}/tags/${encodeURIComponent(tag)}`),
});
