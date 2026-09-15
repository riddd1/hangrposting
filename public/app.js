const API = window.location.origin;

function getSession() {
  const token = sessionStorage.getItem('token');
  const name = sessionStorage.getItem('name');
  const role = sessionStorage.getItem('role');
  if (!token) return null;
  return { token, name, role };
}

function setSession(data) {
  sessionStorage.setItem('token', data.token);
  sessionStorage.setItem('name', data.name);
  sessionStorage.setItem('role', data.role);
}

function clearSession() {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('name');
  sessionStorage.removeItem('role');
}

function authHeaders() {
  const s = getSession();
  return s ? { Authorization: `Bearer ${s.token}` } : {};
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function timeAgo(ts) {
  const d = new Date(ts.includes('Z') ? ts : ts + 'Z');
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
