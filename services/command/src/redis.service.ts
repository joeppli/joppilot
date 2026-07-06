import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private readonly logger = new Logger(RedisService.name);

  onModuleInit() {
    // TLS is an explicit deployment property (REDIS_TLS=true for ElastiCache
    // in-transit encryption, SEC-02), NOT implied by NODE_ENV: the production
    // image also runs against plain local/CI Valkey, where a TLS handshake
    // just times out silently.
    const useTls = process.env.REDIS_TLS === 'true';
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      tls: useTls ? {} : undefined,
    });
    this.logger.log(`Connected to Valkey/Redis (${useTls ? 'TLS enabled' : 'plaintext'})`);
  }

  onModuleDestroy() {
    this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }
}
