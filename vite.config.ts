/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import { securityPlugin } from './build/securityPlugin.ts';

// Served from the root of its own origin (Cloudflare Pages, spec 004).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: '/',
    plugins: [preact(), securityPlugin(env.VITE_SUPABASE_URL)],
    test: {
      include: ['src/**/*.test.ts', 'build/**/*.test.ts'],
      environment: 'node',
    },
  };
});
