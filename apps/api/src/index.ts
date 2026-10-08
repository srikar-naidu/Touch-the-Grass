import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import * as Sentry from '@sentry/node';
import { config } from 'dotenv';

config(); // Load .env

const app = new Hono();

// Initialize Sentry if DSN is provided
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'development',
    tracesSampleRate: 1.0,
  });
}

// Health check endpoint (used by Render)
app.get('/health', (c) => {
  return c.json({ status: 'ok', time: new Date().toISOString() });
});

// Mock development routes (disabled in production)
const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
  app.post('/dev/run-daily', async (c) => {
    // TODO: Trigger Mastra daily workflow
    return c.json({ status: 'mock_success', message: 'Challenge generated in mock mode' });
  });

  app.post('/dev/verify', async (c) => {
    return c.json({ status: 'mock_success', pass: true, reason: 'Mock verification passed' });
  });
}

// Global error handler
app.onError((err, c) => {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

const port = Number(process.env.PORT) || 3000;
console.log(`Server starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port
});
