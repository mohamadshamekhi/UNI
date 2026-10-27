import { Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AclModule } from '../acl/acl.module.js';
import { WorkflowModule } from '../workflow/workflow.module.js';
import { GatewayRegistry, SandboxGateway } from './gateway.js';
import { PaymentsAdminController, PaymentsController, SandboxBankController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [AclModule, WorkflowModule],
  providers: [PaymentsService, SandboxGateway, GatewayRegistry],
  controllers: [PaymentsController, PaymentsAdminController, SandboxBankController],
  exports: [PaymentsService],
})
export class PaymentsModule implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('PaymentReconciliation');
  private timer?: NodeJS.Timeout;

  constructor(private readonly payments: PaymentsService) {}

  /** PAY-07: reconciliation and request expiry every 10 minutes (MAINTENANCE=off disables). */
  onApplicationBootstrap() {
    if (process.env.MAINTENANCE === 'off') return;
    this.timer = setInterval(() => void this.payments.reconcile().catch((err) => this.logger.error({ err }, 'reconciliation failed')), 600_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
