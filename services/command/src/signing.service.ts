import { Injectable, Logger } from '@nestjs/common';
import { createPrivateKey, sign, KeyObject } from 'crypto';
import { canonicalStringify } from '@joppilot/contract';

/**
 * Envelope / zone-config signing (ICD §4, M2-5).
 *
 * Ed25519 over the CANONICAL JSON (sorted keys, no whitespace) of the
 * document WITHOUT its `signature` field. The vehicle verifies against its
 * pinned PUBLIC key and NACKs anything unsigned or invalid — so a spoofed or
 * compromised path between Gate 1 and the vehicle cannot inject or alter
 * commands (defense on top of mTLS transport auth, which lands with IoT
 * Core provisioning).
 *
 * Key source: COMMAND_SIGNING_KEY env — either a PEM PKCS8 Ed25519 private
 * key (what the terraform-generated Secrets Manager secret holds, DEV-19) or
 * base64 PKCS8 DER (the committed dev key in .env.example — DEV ONLY, same
 * trust level as the committed docker-compose password). Ed25519 was chosen
 * over an HMAC shared secret so the vehicle holds NO signing secret (SEC-08
 * spirit).
 *
 * FAIL-CLOSED: the service refuses to start without a usable key — since
 * M2-5 the vehicle rejects every unsigned command, so a Gate 1 that cannot
 * sign can only produce dead envelopes.
 */
@Injectable()
export class SigningService {
  private readonly logger = new Logger(SigningService.name);
  private readonly key: KeyObject;

  constructor() {
    const raw = process.env.COMMAND_SIGNING_KEY;
    if (!raw) {
      throw new Error(
        'COMMAND_SIGNING_KEY is required since M2-5 (ICD §4: every command is signed). ' +
        'Local dev: copy it from services/command/.env.example.',
      );
    }
    try {
      this.key = raw.includes('BEGIN')
        ? createPrivateKey(raw) // PEM (Secrets Manager / terraform tls_private_key)
        : createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' });
    } catch (e) {
      throw new Error(`COMMAND_SIGNING_KEY is not a PEM or base64 PKCS8 Ed25519 key: ${(e as Error).message}`);
    }
    this.logger.log('Envelope signing ready (Ed25519, ICD §4)');
  }

  /** Returns `doc` with `signature` = base64 Ed25519 over its canonical JSON. */
  signDocument<T extends object>(doc: T): T & { signature: string } {
    const unsigned = { ...doc } as Record<string, unknown>;
    delete unsigned.signature;
    const signature = sign(null, Buffer.from(canonicalStringify(unsigned), 'utf8'), this.key).toString('base64');
    return { ...doc, signature };
  }
}
