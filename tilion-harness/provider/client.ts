/**
 * Minimal Tilion API client used by the ComputeSDK provider. No dependencies beyond fetch.
 */

export interface TilionConfig {
  /** API key; falls back to TILION_API_KEY */
  apiKey?: string;
  /** API base URL; falls back to TILION_BASE_URL, then https://api.sbx.tilion.dev */
  baseUrl?: string;
  /** Default command timeout in milliseconds */
  timeout?: number;
}

export interface TilionSandbox {
  id: string;
  state: string;
  template: string;
  createdAt: Date;
  baseUrl: string;
  apiKey: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export class TilionApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(`${status} ${code}: ${message}`);
    this.status = status;
    this.code = code;
  }
}

export function resolveConfig(config: TilionConfig): { apiKey: string; baseUrl: string } {
  const env = typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);
  const apiKey = config.apiKey || env.TILION_API_KEY || '';
  if (!apiKey) {
    throw new Error("Missing Tilion API key. Provide 'apiKey' in config or set TILION_API_KEY.");
  }
  const baseUrl = (config.baseUrl || env.TILION_BASE_URL || 'https://api.sbx.tilion.dev').replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

async function call(baseUrl: string, apiKey: string, method: string, path: string,
                    body?: unknown, raw?: BodyInit, query?: Record<string, string>): Promise<Response> {
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  let payload: BodyInit | undefined = raw;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  if (res.status >= 400) {
    let code = 'error';
    let message = '';
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? '';
    } catch {
      message = await res.text().catch(() => '');
    }
    throw new TilionApiError(res.status, code, message);
  }
  return res;
}

function toSandbox(data: any, baseUrl: string, apiKey: string): TilionSandbox {
  return { id: data.id, state: data.state, template: data.template,
           createdAt: new Date((data.created_at ?? Date.now() / 1000) * 1000), baseUrl, apiKey };
}

export async function createSandbox(config: TilionConfig, options: {
  template?: string; vcpus?: number; memoryMib?: number; envs?: Record<string, string>;
  labels?: Record<string, string>; name?: string;
} = {}): Promise<TilionSandbox> {
  const { apiKey, baseUrl } = resolveConfig(config);
  const labels = { ...(options.labels ?? {}), ...(options.name ? { name: options.name } : {}) };
  const res = await call(baseUrl, apiKey, 'POST', '/v1/sandboxes', {
    template: options.template ?? 'base', vcpus: options.vcpus ?? 2, memory_mib: options.memoryMib ?? 2048,
    env: options.envs ?? {}, labels,
  });
  return toSandbox(await res.json(), baseUrl, apiKey);
}

export async function getSandbox(config: TilionConfig, id: string): Promise<TilionSandbox | null> {
  const { apiKey, baseUrl } = resolveConfig(config);
  try {
    const res = await call(baseUrl, apiKey, 'GET', `/v1/sandboxes/${id}`);
    return toSandbox(await res.json(), baseUrl, apiKey);
  } catch (e) {
    if (e instanceof TilionApiError && e.status === 404) return null;
    throw e;
  }
}

export async function listSandboxes(config: TilionConfig): Promise<TilionSandbox[]> {
  const { apiKey, baseUrl } = resolveConfig(config);
  const res = await call(baseUrl, apiKey, 'GET', '/v1/sandboxes');
  const data = (await res.json()) as { sandboxes: any[] };
  return data.sandboxes.map((d) => toSandbox(d, baseUrl, apiKey));
}

export async function destroySandbox(config: TilionConfig, id: string): Promise<void> {
  const { apiKey, baseUrl } = resolveConfig(config);
  try {
    await call(baseUrl, apiKey, 'DELETE', `/v1/sandboxes/${id}`);
  } catch (e) {
    if (!(e instanceof TilionApiError && e.status === 404)) throw e;
  }
}

export async function exec(sbx: TilionSandbox, command: string, options: {
  cwd?: string; env?: Record<string, string>; timeoutMs?: number; background?: boolean;
} = {}): Promise<ExecResult> {
  const started = Date.now();
  const res = await call(sbx.baseUrl, sbx.apiKey, 'POST', `/v1/sandboxes/${sbx.id}/exec`, {
    shell: command, cwd: options.cwd, env: options.env ?? {}, background: options.background ?? false,
    timeout_s: options.timeoutMs ? options.timeoutMs / 1000 : undefined,
  });
  const r = (await res.json()) as any;
  if (options.background) return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - started };
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.exit_code ?? (r.timed_out ? 124 : 1),
           durationMs: Date.now() - started };
}

export async function readFile(sbx: TilionSandbox, path: string): Promise<string> {
  const res = await call(sbx.baseUrl, sbx.apiKey, 'GET', `/v1/sandboxes/${sbx.id}/files`, undefined, undefined, { path });
  return await res.text();
}

export async function writeFile(sbx: TilionSandbox, path: string, content: string): Promise<void> {
  await call(sbx.baseUrl, sbx.apiKey, 'PUT', `/v1/sandboxes/${sbx.id}/files`, undefined, content, { path });
}

export async function mkdir(sbx: TilionSandbox, path: string): Promise<void> {
  await call(sbx.baseUrl, sbx.apiKey, 'POST', `/v1/sandboxes/${sbx.id}/files/mkdir`, { path });
}

export async function readdir(sbx: TilionSandbox, path: string): Promise<Array<{ name: string; type: 'file' | 'directory'; size: number; modified: Date }>> {
  const res = await call(sbx.baseUrl, sbx.apiKey, 'GET', `/v1/sandboxes/${sbx.id}/files/list`, undefined, undefined, { path });
  const data = (await res.json()) as { entries: any[] };
  return data.entries.map((e) => ({ name: e.name, type: e.type === 'dir' ? 'directory' : 'file',
                                    size: e.size ?? 0, modified: new Date((e.mtime ?? 0) * 1000) }));
}

export async function exists(sbx: TilionSandbox, path: string): Promise<boolean> {
  const res = await call(sbx.baseUrl, sbx.apiKey, 'POST', `/v1/sandboxes/${sbx.id}/files/stat`, { path });
  return ((await res.json()) as { exists: boolean }).exists;
}

export async function remove(sbx: TilionSandbox, path: string): Promise<void> {
  await call(sbx.baseUrl, sbx.apiKey, 'POST', `/v1/sandboxes/${sbx.id}/files/remove`, { path, recursive: true });
}

export async function portUrl(sbx: TilionSandbox, port: number): Promise<string> {
  const res = await call(sbx.baseUrl, sbx.apiKey, 'POST', `/v1/sandboxes/${sbx.id}/ports`, { port });
  return ((await res.json()) as { url: string }).url;
}
