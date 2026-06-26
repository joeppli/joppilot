import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private readonly logger = new Logger(RedisService.name);

  onModuleInit() {
    const isProd = process.env.NODE_ENV === 'production';
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      tls: isProd ? {} : undefined, // Amazon ElastiCache typically requires TLS in transit
    });
    this.logger.log(`Connected to Valkey/Redis (${isProd ? 'TLS Enabled' : 'Local'})`);
  }

  onModuleDestroy() {
    this.client.quit();
  }

  getClient(): Redis {
    return this.client;
  }
}
