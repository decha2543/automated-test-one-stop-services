import axios, { type AxiosError } from 'axios';

const instance = axios.create({
  baseURL: '',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

/** Throw a uniform Error with backend's `message` when available */
instance.interceptors.response.use(
  (res) => res,
  (err: AxiosError<{ message?: string; code?: string; stage?: string }>) => {
    const data = err.response?.data;
    const msg = data?.message ?? err.message ?? 'Request failed';
    const error = new Error(msg) as Error & { code?: string; stage?: string };
    if (data?.code) error.code = data.code;
    if (data?.stage) error.stage = data.stage;
    return Promise.reject(error);
  },
);

export const api = {
  get: <T>(path: string) => instance.get<T>(path).then((r) => r.data),
  post: <T>(path: string, body?: unknown) => instance.post<T>(path, body).then((r) => r.data),
  put: <T>(path: string, body?: unknown) => instance.put<T>(path, body).then((r) => r.data),
  delete: <T>(path: string) => instance.delete<T>(path).then((r) => r.data),
};
