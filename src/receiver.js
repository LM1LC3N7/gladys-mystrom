// -----------------------------------------------------------------------------
// Entry point of the `mystrom-buttons` sub-container (manifest `containers`,
// same image, command `node src/receiver.js`): the HTTP endpoint of the button
// action URLs. No Gladys credentials here: see src/buttons/service.js.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { startButtonService } from './buttons/service.js';

const logger = createLogger({ name: 'mystrom-buttons' });

try {
  const service = await startButtonService({ env: process.env, logger });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      logger.info(`${signal}: stopping`);
      service.stop().finally(() => process.exit(0));
    });
  }
} catch (err) {
  logger.error('The button receiver could not start', err);
  process.exit(1);
}
