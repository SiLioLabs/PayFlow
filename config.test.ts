import { loadConfig, formatConfig, PUBLIC_NETWORK_PASSTHRASE, TEST_NETWORK_PASSPHRASE } from './config';
import { Keypair } from 'stellar-sdk';

describe('config safety gates', () => {
  const keypair = Keypair.random();
  const secret = keypair.secret();
  const publicKey = keypair.publicKey();

  test('throws if KEEPER_SECRET is missing', () => {
    expect(() => loadConfig({})).toThrow('KEEPER_SECRET must be set');
  });

  test('accepts testnet without ALLOW_MAINNET', () => {
    const config = loadConfig({
      KEEPER_SECRET: secret,
      NETWORK_PASSTHRASE: TEST_NETWORK_PASSPHRASE,
    });
    expect(config.secret).toBe(secret);
    expect(config.allowMainnet).toBe(false);
  });

  test('blocks mainnet without ALLOW_MAINNET', () => {
    expect(() =>
      loadConfig({
        KEEPER_SECRET: secret,
        NETWORK_PASSPHRASE: PUBLIC_NETWORK_PASSPHRASE,
      })
    ).toThrow('ALLOW_MAINNET');
  });

  test('allows mainnet with ALLOW_MAINNET=true', () => {
    const config = loadConfig({
      KEEPER_SECRET: secret,
      NETWORK_PASSPHRASE: PUBLIC_NETWORK_PASSPHRASE,
      ALLOW_MAINNET: 'true',
    });
    expect(config.allowMainnet).toBe(true);
  });

  test('throws when KEEPER_PUBLIC_KEY mismatches', () => {
    const otherPublicKey = Keypair.random().publicKey();
    expect(() =>
      loadConfig({
        KEEPER_SECRET: secret,
        KEEPER_PUBLIC_KEY: otherPublicKey,
      })
    ).toThrow('does not match');
  });

  test('accepts matching KEEPER_PUBLIC_KEY', () => {
    const config = loadConfig({
      KEEPER_SECRET: secret,
      KEEPER_PUBLIC_KEY: publicKey,
    });
    expect(config.publicKey).toBe(publicKey);
  });

  test('formatConfig redacts secret', () => {
    const config = loadConfig({ KEEPER_SECRET: secret });
    const formatted = formatConfig(config);
    expect(formatted).not.toContain(secret);
  });
});