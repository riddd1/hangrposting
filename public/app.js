const API = window.location.origin;

function getSession() {
  const token = localStorage.getItem('token');
  const name = localStorage.getItem('name');
  const role = localStorage.getItem('role');
  if (!token) return null;
  return { token, name, role };
}

function setSession(data) {
  localStorage.setItem('token', data.token);
  localStorage.setItem('name', data.name);
  localStorage.setItem('role', data.role);
}

function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('name');
  localStorage.removeItem('role');
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
