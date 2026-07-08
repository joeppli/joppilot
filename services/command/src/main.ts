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
