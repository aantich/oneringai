# Logging Configuration

The `oneringai` library provides comprehensive logging capabilities that can be configured using environment variables.

## Environment Variables

### LOG_LEVEL

Controls the minimum log level to output.

**Values**: `trace` | `debug` | `info` | `warn` | `error` | `silent`
**Default**: `info`

```bash
# Show all logs including debug messages
LOG_LEVEL=debug npm run example:agent

# Only show warnings and errors
LOG_LEVEL=warn npm run example:agent

# Disable all logging
LOG_LEVEL=silent npm run example:agent
```

**Log Levels Explained**:
- `trace`: Extremely detailed information (use for deep debugging)
- `debug`: Detailed information useful during development
- `info`: General informational messages (default)
- `warn`: Warning messages that don't prevent operation
- `error`: Error messages indicating failures
- `silent`: No logging output

### LOG_FILE

Path to a file where logs should be written. If not set, logs are written to console (stdout/stderr).

**Default**: Not set (console output)

```bash
# Write logs to a file
LOG_FILE=./logs/app.log npm run example:agent

# Write to an absolute path
LOG_FILE=/var/log/oneringai.log npm run example:agent
```

**Features**:
- Automatically creates the directory if it doesn't exist
- Appends to existing files (doesn't overwrite)
- Handles file I/O errors gracefully
- Automatically closes the file stream on process exit

### LOG_PRETTY

Controls whether logs are formatted in a human-readable format with colors (console) or as JSON.

**Values**: `true` | `false`
**Default**: `true` in development (`NODE_ENV=development`), `false` otherwise

```bash
# Force JSON format
LOG_PRETTY=false npm run example:agent

# Force pretty format
LOG_PRETTY=true npm run example:agent
```

**Pretty Format** (human-readable):
```
[11:15:48.083] INFO  Agent run started component="Agent" model="gpt-4"
[11:15:49.319] DEBUG Tool execution started toolName="get_weather"
```

**JSON Format** (machine-readable):
```json
{"level":"info","time":1769253323266,"component":"Agent","model":"gpt-4","msg":"Agent run started"}
{"level":"debug","time":1769253324134,"toolName":"get_weather","msg":"Tool execution started"}
```

## Usage Examples

### 1. Development Mode (Console with Colors)

```bash
# Default: info level, pretty format to console
npm run example:agent

# Show debug messages
LOG_LEVEL=debug npm run example:agent
```

### 2. Production Mode (JSON to File)

```bash
# JSON format to file
LOG_FILE=/var/log/app.log LOG_PRETTY=false npm run start
```

### 3. Debug to File

```bash
# Pretty format debug logs to file
LOG_LEVEL=debug LOG_FILE=./logs/debug.log LOG_PRETTY=true npm run example:agent

# Check the logs
tail -f ./logs/debug.log
```

### 4. Using in .env File

Create a `.env` file:

```env
# Development
LOG_LEVEL=debug
LOG_PRETTY=true

# Production
# LOG_LEVEL=info
# LOG_FILE=/var/log/oneringai.log
# LOG_PRETTY=false
```

### 5. Programmatic Configuration

```typescript
import { logger, FrameworkLogger } from 'oneringai';

// Use the global logger
logger.info('Application started');
logger.debug({ userId: 123 }, 'Processing user request');
logger.error({ error: err }, 'Failed to process request');

// Create a custom logger
const customLogger = new FrameworkLogger({
  level: 'debug',
  pretty: true,
  filePath: './logs/custom.log',
  context: { service: 'my-service' },
});

// Create child logger with additional context
const requestLogger = customLogger.child({ requestId: 'abc-123' });
requestLogger.info('Request received');
```

## Best Practices

### Development
- Use `LOG_LEVEL=debug` or `LOG_LEVEL=trace` for detailed debugging
- Keep `LOG_PRETTY=true` for easy reading in terminal
- Consider logging to file for long-running tests

### Production
- Use `LOG_LEVEL=info` or `LOG_LEVEL=warn` to reduce noise
- Set `LOG_FILE` to persist logs for analysis
- Use `LOG_PRETTY=false` for JSON format (easier to parse/analyze)
- Consider log rotation (external tool like `logrotate`)

### CI/CD
- Use `LOG_LEVEL=debug` during tests for better diagnostics
- Output to console (no `LOG_FILE`) for CI logs
- Use JSON format (`LOG_PRETTY=false`) for log aggregation

## Log Rotation

The library doesn't include built-in log rotation. For production use, consider:

1. **logrotate** (Linux):
```bash
# /etc/logrotate.d/oneringai
/var/log/oneringai/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
}
```

2. **External Libraries**:
```bash
npm install rotating-file-stream
```

3. **Cloud Services**:
- AWS CloudWatch Logs
- Google Cloud Logging
- Azure Monitor Logs

## Troubleshooting

### Logs not appearing

1. Check log level: `LOG_LEVEL=trace` to see everything
2. Check file permissions if using `LOG_FILE`
3. Ensure directory exists or is writable

### File logging not working

```bash
# Test file writing
LOG_FILE=./test.log node -e "import('./dist/index.js').then(m => m.logger.info('test'))"

# Check the file
cat test.log
```

### Too many logs in production

```bash
# Reduce log level
LOG_LEVEL=warn  # Only warnings and errors
LOG_LEVEL=error # Only errors
LOG_LEVEL=silent # No logs
```

## API Reference

### FrameworkLogger

```typescript
class FrameworkLogger {
  constructor(config?: LoggerConfig)

  // Logging methods
  trace(obj: Record<string, any> | string, msg?: string): void
  debug(obj: Record<string, any> | string, msg?: string): void
  info(obj: Record<string, any> | string, msg?: string): void
  warn(obj: Record<string, any> | string, msg?: string): void
  error(obj: Record<string, any> | string, msg?: string): void

  // Configuration
  updateConfig(config: Partial<LoggerConfig>): void
  getLevel(): LogLevel
  isLevelEnabled(level: LogLevel): boolean

  // Child logger
  child(context: Record<string, any>): FrameworkLogger

  // Cleanup
  close(): void
}
```

### LoggerConfig

```typescript
interface LoggerConfig {
  level?: LogLevel
  pretty?: boolean
  context?: Record<string, any>
  destination?: 'console' | 'stdout' | 'stderr'
  filePath?: string
}
```

## Integration with Other Tools

### Winston

If you need more advanced features, you can integrate with Winston:

```typescript
import { logger } from 'oneringai';
import winston from 'winston';

// Create Winston logger
const winstonLogger = winston.createLogger({
  transports: [
    new winston.transports.File({ filename: 'app.log' })
  ]
});

// Override the output method (advanced)
// See Logger.ts implementation for details
```

### Pino

For high-performance logging:

```typescript
import pino from 'pino';

const pinoLogger = pino({ level: 'info' });

// Use pino for your application
// oneringai logger for library logs
```
