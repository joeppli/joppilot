import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(4002, '0.0.0.0');
  console.log('Joppilot Fleet & Mission Service running on http://localhost:4002');
}
bootstrap();
