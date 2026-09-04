import * as dotenv from 'dotenv';
import { Keypair } from 'stellar-sdk';

dotenv.config();

export const PUBLIC_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
export const TEST_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

export interface KeeperConfig {
  secret: string;
  publicKey?: string;
  networkPassphrase: string;
  allowMainnet: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const secret = env.KEEPER_SECRET;
  if (!secret) {
    throw new Error('KEEPER_SECRET must be set');
  }

  const networkPassphrase = env.NETWORK_PASSPHRASE || TEST_NETWORK_PASSPHRASE;
  const allowMainnet = env.ALLOW_MAINNET === 'true';

  if (networkPassphrase === PUBLIC_NETWORK_PASSPHRASE && !allowMainnet) {
    throw new Error(
      'Mainnet network passphrase detected. Set ALLOW_MAINNET=true to confirm you want to use Mainnet.'
    );
  }

  const publicKey = env.KEEPER_PUBLIC_KEY;
  if (publicKey) {
    const derived = Keypair.fromSecret(secret).publicKey();
    if (derived !== publicKey) {
      throw new Error('KEEPER_PUBLIC_KEY does not match KEEPER_SECRET');
    }
  }

  return {
    secret,
    publicKey,
    networkPassphrase,
    allowMainnet,
  };
}

export function redactSecret(value: string): string {
  return value.replace(/S[A-Z0-9]{55}/gi, (match) => {
    return 'S' + '*'.repeat(8) + match.slice(-4);
  });
}

export function formatConfig(config: KeeperConfig): string {
  const redacted = { ...config, secret: redactSecret(config.secret) };
  return JSON.stringify(redacted, null, 2);
}
