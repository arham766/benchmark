/**
 * Tilion Provider for ComputeSDK: persistent, hardware-isolated Firecracker sandboxes with a
 * shell, a filesystem, and a Chromium browser in the same VM.
 *
 * Upstream path: packages/tilion/ in github.com/computesdk/computesdk (see README.md here).
 */
import { defineProvider } from '@computesdk/provider';
import type { CommandResult, CreateSandboxOptions, FileEntry, RunCommandOptions, SandboxInfo } from '@computesdk/provider';

import * as api from './client';
import type { TilionConfig, TilionSandbox } from './client';

export type { TilionConfig, TilionSandbox } from './client';

export const tilion = defineProvider<TilionSandbox, TilionConfig>({
  name: 'tilion',
  methods: {
    sandbox: {
      create: async (config: TilionConfig, options?: CreateSandboxOptions) => {
        try {
          const sandbox = await api.createSandbox(config, {
            template: options?.templateId ?? options?.snapshotId ?? 'base',
            envs: options?.envs, name: options?.name,
            labels: options?.metadata ? Object.fromEntries(Object.entries(options.metadata).map(([k, v]) => [k, String(v)])) : undefined,
            vcpus: (options as any)?.cpu ?? (options as any)?.vcpus,
            memoryMib: (options as any)?.memory ?? (options as any)?.memoryMib,
          });
          return { sandbox, sandboxId: sandbox.id };
        } catch (error) {
          throw new Error(`Failed to create Tilion sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: TilionConfig, sandboxId: string) => {
        const sandbox = await api.getSandbox(config, sandboxId).catch(() => null);
        return sandbox ? { sandbox, sandboxId } : null;
      },

      list: async (config: TilionConfig) => {
        const items = await api.listSandboxes(config).catch(() => []);
        return items.map((sandbox) => ({ sandbox, sandboxId: sandbox.id }));
      },

      destroy: async (config: TilionConfig, sandboxId: string) => {
        await api.destroySandbox(config, sandboxId);
      },

      runCommand: async (sandbox: TilionSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const started = Date.now();
        try {
          return await api.exec(sandbox, command, {
            cwd: options?.cwd, env: options?.env, timeoutMs: options?.timeout, background: options?.background,
          });
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127,
                   durationMs: Date.now() - started };
        }
      },

      getInfo: async (sandbox: TilionSandbox): Promise<SandboxInfo> => ({
        id: sandbox.id,
        provider: 'tilion',
        status: sandbox.state === 'error' ? 'error' : sandbox.state === 'running' || sandbox.state === 'paused' ? 'running' : 'stopped',
        createdAt: sandbox.createdAt,
        timeout: 0,   // no session cap: a sandbox lives until deleted and pauses when idle
        metadata: { template: sandbox.template, state: sandbox.state },
      }),

      getUrl: async (sandbox: TilionSandbox, options: { port: number; protocol?: string }): Promise<string> =>
        api.portUrl(sandbox, options.port),

      filesystem: {
        readFile: async (sandbox: TilionSandbox, path: string): Promise<string> => api.readFile(sandbox, path),
        writeFile: async (sandbox: TilionSandbox, path: string, content: string): Promise<void> => api.writeFile(sandbox, path, content),
        mkdir: async (sandbox: TilionSandbox, path: string): Promise<void> => api.mkdir(sandbox, path),
        readdir: async (sandbox: TilionSandbox, path: string): Promise<FileEntry[]> => api.readdir(sandbox, path),
        exists: async (sandbox: TilionSandbox, path: string): Promise<boolean> => api.exists(sandbox, path),
        remove: async (sandbox: TilionSandbox, path: string): Promise<void> => api.remove(sandbox, path),
      },

      getInstance: (sandbox: TilionSandbox): TilionSandbox => sandbox,
    },
  },
});
