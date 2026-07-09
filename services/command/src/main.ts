import * as fs from 'fs';
import * as path from 'path';

// Minimal .env loader (mirrors services/telemetry). Prisma only loads .env
// when ITS client initializes — the SigningService (M2-5) needs
// COMMAND_SIGNING_KEY in process.env before any provider constructs, so we
// load it explicitly instead of relying on Prisma's import timing.
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // Enable CORS for the React frontend
  await app.listen(4000, '0.0.0.0');
  console.log(`Joppilot Services running on http://localhost:4000`);
}
bootstrap().catch((err) => {
  // A boot failure must be LOUD in the container logs (CloudWatch): a task
  // that dies with an empty log stream is undiagnosable (M2-4-3 lesson).
  console.error('FATAL: bootstrap failed', err);
  process.exit(1);
});
