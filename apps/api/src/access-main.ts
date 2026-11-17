import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AccessModule } from './access/access.module';

async function bootstrap() {
  const app = await NestFactory.create(AccessModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.ACCESS_PORT ?? 3001), process.env.ACCESS_HOST ?? '127.0.0.1');
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
