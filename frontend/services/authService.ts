const API_BASE = import.meta.env.VITE_BACKEND_API || 'http://localhost:8001';

export type AuthUser = {
  id: string;
  username: string;
  is_admin: boolean;
  must_change_password?: boolean;
};

type AuthResponse = {
  accessToken: string;
  user: AuthUser;
};

let accessToken: string | null = null;
let refreshPromise: Promise<AuthResponse | null> | null = null;

export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth:token', { detail: { token } }));
  }
};

const parseAuthResponse = async (response: Response): Promise<AuthResponse> => {
  const data = (await response.json().catch(() => ({}))) as Partial<AuthResponse>;
  if (!response.ok || !data.accessToken || !data.user) {
    const message = typeof (data as any)?.detail === 'string'
      ? (data as any).detail
      : `Auth request failed (${response.status})`;
    throw new Error(message);
  }
  const normalizedUser: AuthUser = {
    id: data.user.id,
    username: data.user.username,
    is_admin: Boolean((data.user as AuthUser).is_admin),
    must_change_password: Boolean((data.user as AuthUser).must_change_password)
  };
  return { accessToken: data.accessToken, user: normalizedUser };
};

export const registerUser = async (username: string, password: string): Promise<AuthResponse> => {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password })
  });
  const data = await parseAuthResponse(response);
  setAccessToken(data.accessToken);
  return data;
};

export const loginUser = async (username: string, password: string): Promise<AuthResponse> => {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password })
  });
  const data = await parseAuthResponse(response);
  setAccessToken(data.accessToken);
  return data;
};

export const refreshAccessToken = async (): Promise<AuthResponse | null> => {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      });
      if (!response.ok) {
        setAccessToken(null);
        return null;
      }
      const data = await parseAuthResponse(response);
      setAccessToken(data.accessToken);
      return data;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
};

export const logoutUser = async (): Promise<void> => {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include'
  }).catch(() => null);
  setAccessToken(null);
};

export const fetchWithAuth = async (input: RequestInfo, init: RequestInit = {}, retry = true): Promise<Response> => {
  const token = getAccessToken();
  const headers = new Headers(init.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? 'include'
  });
  if (response.status !== 401 || !retry) {
    return response;
  }
  const refreshed = await refreshAccessToken();
  if (!refreshed?.accessToken) {
    return response;
  }
  const retryHeaders = new Headers(init.headers || {});
  retryHeaders.set('Authorization', `Bearer ${refreshed.accessToken}`);
  return fetch(input, {
    ...init,
    headers: retryHeaders,
    credentials: init.credentials ?? 'include'
  });
};
