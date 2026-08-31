import { loadConfig, formatConfig } from './config';

export function run(): void {
  const config = loadConfig();
  console.log('Keeper started with config:', formatConfig(config));
  // The keeper would typically start communicating with the Horizon network here.
}

if (require.main === module) {
  try {
    run();
  } catch (err) {
    console.error('Failed to start keeper:', (err as Error).message);
    process.exit(1);
  }
}
