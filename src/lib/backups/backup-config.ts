/**
 * Backup Configuration Security Validator
 *
 * Validates that all required environment variables are set and properly configured.
 * Ensures no default or insecure values are used in production.
 */

/**
 * Configuration validation result
 */
interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate Telegram configuration
 * @returns Configuration validation result
 */
export function validateTelegramConfig(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check TELEGRAM_BOT_TOKEN
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    errors.push('TELEGRAM_BOT_TOKEN is not set');
  } else if (typeof botToken !== 'string') {
    errors.push('TELEGRAM_BOT_TOKEN must be a string');
  } else if (botToken.length < 50) {
    errors.push('TELEGRAM_BOT_TOKEN appears to be invalid (too short)');
  } else if (botToken.includes('your_') || botToken.includes('example')) {
    errors.push('TELEGRAM_BOT_TOKEN appears to be a placeholder value');
  } else if (botToken === botToken.toLowerCase() || botToken === botToken.toUpperCase()) {
    warnings.push('TELEGRAM_BOT_TOKEN may be invalid (should be mixed case)');
  }

  // Check TELEGRAM_CHAT_ID or TELEGRAM_CHANNEL_ID
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;

  if (!chatId && !channelId) {
    errors.push('Either TELEGRAM_CHAT_ID or TELEGRAM_CHANNEL_ID must be set');
  }

  if (chatId) {
    if (typeof chatId !== 'string') {
      errors.push('TELEGRAM_CHAT_ID must be a string');
    } else if (chatId.includes('your_') || chatId.includes('example')) {
      errors.push('TELEGRAM_CHAT_ID appears to be a placeholder value');
    } else if (!/^-?\d+$/.test(chatId)) {
      warnings.push('TELEGRAM_CHAT_ID should be a numeric string');
    }
  }

  if (channelId) {
    if (typeof channelId !== 'string') {
      errors.push('TELEGRAM_CHANNEL_ID must be a string');
    } else if (channelId.includes('your_') || channelId.includes('example')) {
      errors.push('TELEGRAM_CHANNEL_ID appears to be a placeholder value');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate database configuration
 * @returns Configuration validation result
 */
export function validateDatabaseConfig(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    errors.push('DATABASE_URL is not set');
  } else if (typeof databaseUrl !== 'string') {
    errors.push('DATABASE_URL must be a string');
  } else if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    errors.push('DATABASE_URL must be a valid PostgreSQL connection string');
  } else if (databaseUrl.includes('your_') || databaseUrl.includes('example') || databaseUrl.includes('password')) {
    errors.push('DATABASE_URL appears to contain placeholder or default values');
  } else if (databaseUrl.includes('@localhost:') && process.env.NODE_ENV === 'production') {
    warnings.push('DATABASE_URL points to localhost in production environment');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all backup-related configuration
 * @returns Configuration validation result
 */
export function validateBackupConfig(): ConfigValidationResult {
  const telegramConfig = validateTelegramConfig();
  const databaseConfig = validateDatabaseConfig();

  return {
    valid: telegramConfig.valid && databaseConfig.valid,
    errors: [...telegramConfig.errors, ...databaseConfig.errors],
    warnings: [...telegramConfig.warnings, ...databaseConfig.warnings],
  };
}

/**
 * Validate configuration and throw error if invalid
 * @throws Error if configuration is invalid
 */
export function assertValidConfig(): void {
  const validation = validateBackupConfig();

  if (!validation.valid) {
    const errorMessage = `Invalid backup configuration:\n${validation.errors.map(e => `  - ${e}`).join('\n')}`;
    throw new Error(errorMessage);
  }

  if (validation.warnings.length > 0) {
    console.warn(`[Backup Config] Warnings:\n${validation.warnings.map(w => `  - ${w}`).join('\n')}`);
  }
}

/**
 * Check if running in production environment
 * @returns True if in production
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if running in development environment
 * @returns True if in development
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * Check if running in test environment
 * @returns True if in test
 */
export function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

/**
 * Get environment-specific configuration
 * @returns Configuration object
 */
export function getBackupConfig() {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: isProduction(),
    isDevelopment: isDevelopment(),
    isTest: isTest(),

    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      channelId: process.env.TELEGRAM_CHANNEL_ID,
    },

    database: {
      url: process.env.DATABASE_URL,
    },

    security: {
      // Enable stricter validation in production
      strictMode: isProduction(),

      // Enable audit logging
      auditLogging: process.env.ENABLE_AUDIT_LOGGING !== 'false',

      // Enable rate limiting
      rateLimiting: process.env.ENABLE_RATE_LIMITING !== 'false',
    },
  };
}
