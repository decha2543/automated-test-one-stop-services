import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';

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
  get: <T>(path: string, config?: AxiosRequestConfig) =>
    instance.get<T>(path, config).then((r) => r.data),
  // `config` lets a single call override defaults (e.g. a longer `timeout` for a
  // slow install) without changing the shared instance.
  post: <T>(path: string, body?: unknown, config?: AxiosRequestConfig) =>
    instance.post<T>(path, body, config).then((r) => r.data),
  put: <T>(path: string, body?: unknown, config?: AxiosRequestConfig) =>
    instance.put<T>(path, body, config).then((r) => r.data),
  delete: <T>(path: string, config?: AxiosRequestConfig) =>
    instance.delete<T>(path, config).then((r) => r.data),
};
