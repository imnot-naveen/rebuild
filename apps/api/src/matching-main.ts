import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MatchingModule } from './matching/matching.module';

async function bootstrap() {
  const app = await NestFactory.create(MatchingModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.MATCHING_PORT ?? 3002), process.env.MATCHING_HOST ?? '127.0.0.1');
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
