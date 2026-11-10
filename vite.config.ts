/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { execSync } from 'child_process'

function getGitSha(): string {
  // Docker builds have no .git directory, so the version comes in as a build arg.
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

// Yahoo Finance quotes go through the app's own server (see
// src/lib/market/quotes.ts); docker/nginx.conf does the same in production.
const yahooProxy = {
  '/api/yahoo/v8/finance/chart/': {
    target: 'https://query1.finance.yahoo.com',
    changeOrigin: true,
    // Same honest client identifier as docker/nginx.conf, not the visitor's
    // browser User-Agent.
    headers: { 'User-Agent': 'RetireEh (+https://github.com/Kombatant/retire-eh-reloaded)' },
    rewrite: (p: string) => p.replace(/^\/api\/yahoo/, ''),
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: { proxy: yahooProxy },
  preview: { proxy: yahooProxy },
  define: {
    __APP_VERSION__: JSON.stringify(getGitSha()),
  },
  build: {
    rolldownOptions: {
      output: {
        // Libraries change far less often than the app, so they cache across releases.
        codeSplitting: {
          groups: [
            { name: 'charts', test: /node_modules[\\/].*(recharts|d3-|victory-vendor)/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
