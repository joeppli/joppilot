import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from './app.module';

// Minimal .env loader. Prisma used to load this automatically; the telemetry
// service now uses raw pg, so we load DATABASE_URL ourselves (no dotenv dep).
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // Enable CORS for the React frontend
  await app.listen(4001, '0.0.0.0');
  console.log(`Joppilot Telemetry Service running on http://localhost:4001`);
}
bootstrap().catch((err) => {
  // A boot failure must be LOUD in the container logs (CloudWatch): a task
  // that dies with an empty log stream is undiagnosable (M2-4-3 lesson).
  console.error('FATAL: bootstrap failed', err);
  process.exit(1);
});
