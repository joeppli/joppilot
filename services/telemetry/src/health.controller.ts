import { Controller, Get } from '@nestjs/common';

/**
 * ALB target-group health check (M2-4-3). Unauthenticated by design: the ALB
 * probes tasks directly (it cannot carry a Cognito token), and the route
 * exposes nothing but liveness. RolesGuard is controller-scoped elsewhere,
 * so nothing protected leaks through here.
 */
@Controller('healthz')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', service: 'telemetry' };
  }
}
