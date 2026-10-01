import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logLevel,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['password', 'token', 'secret', '*.password', '*.token', '*.secret', 'req.headers.cookie', 'req.headers.authorization'],
    censor: '[redacted]'
  }
});
