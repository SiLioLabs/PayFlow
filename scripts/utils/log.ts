/**
 * utils/log.ts — Mode-prefixed operator log line for the keeper.
 *
 * Routes through the shared structured logger (logger.ts) so LOG_LEVEL and
 * LOG_FORMAT apply, while keeping the familiar "[DRY-RUN]" / "[LIVE]" prefix.
 */
import { logger } from "../logger.js";

export function log(dryRun: boolean, message: string): void {
  logger.info(`${dryRun ? "[DRY-RUN]" : "[LIVE]"} ${message}`);
}
