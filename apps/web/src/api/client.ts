export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : '';
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Raw binary body (uploads). */
  rawBody?: ArrayBuffer | Blob;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody as BodyInit;
    headers['content-type'] = 'application/zip';
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const method = opts.method || (body !== undefined ? 'POST' : 'GET');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['x-csrf-token'] = readCookie('eplyd_csrf');
  }
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body,
    credentials: 'same-origin'
  });
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const j = (await res.json()) as { error?: { message?: string; code?: string } };
      message = j.error?.message || message;
      code = j.error?.code;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(message, res.status, code);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/** Upload with progress via XHR (fetch has no upload progress). */
export function uploadWithProgress(
  path: string,
  data: Blob | ArrayBuffer,
  onProgress: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1${path}`);
    xhr.setRequestHeader('content-type', 'application/zip');
    xhr.setRequestHeader('x-csrf-token', readCookie('eplyd_csrf'));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = `upload failed (${xhr.status})`;
        try {
          msg = JSON.parse(xhr.responseText).error?.message || msg;
        } catch { /* ignore */ }
        reject(new ApiError(msg, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('Network error during upload', 0));
    xhr.send(data);
  });
}

export function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}

export function fileDownloadUrl(path: string): string {
  return `/api/v1${path}`;
}
