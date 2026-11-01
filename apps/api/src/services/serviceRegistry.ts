/**
 * Service Registry — layered resolution:
 *   1. custom_services (user-defined)
 *   2. service_overrides (admin config) + library SERVICE_DEFINITIONS
 *   3. library SERVICE_DEFINITIONS alone (fallback)
 */
import { getServiceInfo, getAllServiceIds } from 'oneringai/shared';
import type { ResolvedService, CustomService, ServiceOverride } from '../types.js';
import { queryOne, queryAll } from '../db/queries.js';

/**
 * Resolve a service by ID with full metering/pricing config.
 * Checks: custom_services → service_overrides + library → library alone
 */
export async function resolveService(
  db: D1Database,
  serviceId: string,
  userId?: string,
): Promise<ResolvedService | null> {
  // 1. Check user's custom services
  if (userId) {
    const custom = await queryOne<CustomService>(
      db,
      'SELECT * FROM custom_services WHERE id = ? AND user_id = ? AND is_active = 1',
      serviceId, userId,
    );
    if (custom) {
      return {
        id: custom.id,
        name: custom.name,
        baseURL: custom.base_url,
        authType: custom.auth_type,
        authConfig: JSON.parse(custom.auth_config || '{}') as Record<string, unknown>,
        meteringConfig: JSON.parse(custom.metering_config || '{}') as Record<string, unknown>,
        pricingMultiplier: 2.0,
        platformKeyEnabled: false,
        source: 'custom',
      };
    }
  }

  // 2. Check library + overrides
  const libraryService = getServiceInfo(serviceId);
  if (!libraryService) return null;

  const override = await queryOne<ServiceOverride>(
    db,
    'SELECT * FROM service_overrides WHERE service_id = ?',
    serviceId,
  );

  return {
    id: libraryService.id,
    name: override?.display_name ?? libraryService.name,
    baseURL: libraryService.baseURL,
    authType: 'bearer',
    authConfig: {},
    meteringConfig: override ? (JSON.parse(override.metering_config || '{}') as Record<string, unknown>) : {},
    pricingMultiplier: override?.pricing_multiplier ?? 2.0,
    platformKeyEnabled: override?.platform_key_enabled === 1,
    source: override ? 'override' : 'library',
  };
}

/**
 * List all available services (library + custom for user)
 */
export async function listServices(
  db: D1Database,
  userId?: string,
): Promise<Array<{ id: string; name: string; category: string; source: string }>> {
  const services: Array<{ id: string; name: string; category: string; source: string }> = [];

  // Library services
  const allIds = getAllServiceIds();
  for (const id of allIds) {
    const info = getServiceInfo(id);
    if (info) {
      services.push({ id: info.id, name: info.name, category: info.category, source: 'library' });
    }
  }

  // User custom services
  if (userId) {
    const customs = await queryAll<CustomService>(
      db,
      'SELECT * FROM custom_services WHERE user_id = ? AND is_active = 1',
      userId,
    );
    for (const c of customs) {
      services.push({ id: c.id, name: c.name, category: 'custom', source: 'custom' });
    }
  }

  return services;
}
