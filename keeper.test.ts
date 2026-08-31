import { run } from './keeper';
import { Keypair } from 'stellar-sdk';

describe('keeper', () => {
  test('does not log the secret', () => {
    const keypair = Keypair.random();
    process.env.KEEPER_SECRET_ORI = keypair.secret();
    process.env.KEEPER_PUBLIC_KEY = keypair.publicKey();
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    run();
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls.map(args => args.join(' ')).join('\n');
    expect(output).not.toContain(keypair.secret());
    spy.mockRestore();
  });
});