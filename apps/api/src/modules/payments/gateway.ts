import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ENV, type Env } from '../../config/env.js';
import { RedisService } from '../../infra/redis.js';

/** Merchant settings of one tenant (secret already decrypted). */
export interface GatewayConfig {
  merchantId: string | null;
  secret: string | null;
}

export interface StartInput {
  amount: number;
  description: string;
  callbackUrl: string;
  config: GatewayConfig;
}

export interface VerifyResult {
  status: 'succeeded' | 'failed' | 'unknown';
  referenceId?: string;
  /** amount the gateway reports; must equal the request (PAY-05) */
  amount?: number;
  errorCode?: string;
  errorMessage?: string;
  /** stored for audit; adapters never put card data here (PAY-04) */
  payload: Record<string, unknown>;
}

/**
 * Swappable bank / PSP connection (PAY-03). The callback the payer's browser brings back is only a
 * hint; `verify` is the server-to-server check that decides the result (PAY-05).
 */
export interface GatewayAdapter {
  readonly key: string;
  readonly label: string;
  start(input: StartInput): Promise<{ authority: string; redirectUrl: string }>;
  verify(input: { authority: string; amount: number; config: GatewayConfig }): Promise<VerifyResult>;
}

export type SandboxOutcome = 'success' | 'fail' | 'cancel' | 'hang';
interface SandboxState {
  amount: number;
  callbackUrl: string;
  description: string;
  outcome?: SandboxOutcome;
}

/**
 * Development gateway: a simulated bank page served by the API where the tester picks the outcome
 * (success, failure, cancel or a hang that never answers — for reconciliation). Disabled in production.
 */
@Injectable()
export class SandboxGateway implements GatewayAdapter {
  readonly key = 'sandbox';
  readonly label = 'درگاه آزمایشی';

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly redis: RedisService,
  ) {}

  get enabled() {
    return this.env.NODE_ENV !== 'production';
  }

  private k(authority: string) {
    return `paysandbox:${authority}`;
  }

  async start(input: StartInput) {
    const authority = `SBX${randomBytes(12).toString('hex').toUpperCase()}`;
    const state: SandboxState = { amount: input.amount, callbackUrl: input.callbackUrl, description: input.description };
    await this.redis.client.set(this.k(authority), JSON.stringify(state), 'EX', 3600);
    return { authority, redirectUrl: `${this.env.API_PUBLIC_URL}/v1/payment-sandbox/${authority}` };
  }

  async state(authority: string): Promise<SandboxState | null> {
    const raw = await this.redis.client.get(this.k(authority));
    return raw ? (JSON.parse(raw) as SandboxState) : null;
  }

  /** The tester's choice on the simulated bank page. */
  async decide(authority: string, outcome: SandboxOutcome) {
    const s = await this.state(authority);
    if (!s || s.outcome) return null;
    s.outcome = outcome;
    await this.redis.client.set(this.k(authority), JSON.stringify(s), 'EX', 3600);
    return s;
  }

  async verify({ authority }: { authority: string; amount: number; config: GatewayConfig }): Promise<VerifyResult> {
    const s = await this.state(authority);
    if (!s) return { status: 'failed', errorCode: 'NOT_FOUND', errorMessage: 'تراکنش در درگاه آزمایشی پیدا نشد.', payload: { authority } };
    if (!s.outcome || s.outcome === 'hang') return { status: 'unknown', payload: { authority, outcome: s.outcome ?? null } };
    if (s.outcome === 'success') return { status: 'succeeded', amount: s.amount, referenceId: `REF${authority.slice(-10)}`, payload: { authority, outcome: 'success' } };
    return {
      status: 'failed',
      errorCode: s.outcome === 'cancel' ? 'CANCELLED_BY_PAYER' : 'DECLINED',
      errorMessage: s.outcome === 'cancel' ? 'پرداخت‌کننده انصراف داد.' : 'بانک تراکنش را رد کرد.',
      payload: { authority, outcome: s.outcome },
    };
  }
}

/** Registry of installed adapters; the real gateway joins here once the contract is known. */
@Injectable()
export class GatewayRegistry {
  private readonly adapters: Map<string, GatewayAdapter>;

  constructor(sandbox: SandboxGateway) {
    this.adapters = new Map(sandbox.enabled ? [[sandbox.key, sandbox]] : []);
  }

  get(key: string): GatewayAdapter | undefined {
    return this.adapters.get(key);
  }

  list() {
    return [...this.adapters.values()].map((a) => ({ key: a.key, label: a.label }));
  }
}
