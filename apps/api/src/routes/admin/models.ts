/**
 * Admin model registry CRUD — add, update, disable, re-seed
 */
import { Hono } from 'hono';
import type { Env } from '../../env.js';
import { listAllModels, getModel } from '../../services/modelRegistry.js';
import { execute } from '../../db/queries.js';
import { logAdminAction } from '../../middleware/auditLog.js';
import { MODEL_REGISTRY } from 'oneringai/shared';

const adminModels = new Hono<{ Bindings: Env }>();

/** GET /admin/models — list all (including disabled) */
adminModels.get('/', async (c) => {
  const models = await listAllModels(c.env.DB);
  return c.json(models);
});

/** GET /admin/models/:id */
adminModels.get('/:id', async (c) => {
  const model = await getModel(c.env.DB, c.req.param('id'));
  if (!model) return c.json({ error: 'not_found', message: 'Model not found' }, 404);
  return c.json(model);
});

/**
 * POST /admin/models — add new model
 */
adminModels.post('/', async (c) => {
  const body = await c.req.json<{
    id: string;
    vendor: string;
    name: string;
    description?: string;
    maxInputTokens: number;
    maxOutputTokens: number;
    vendorInputCpm: number;
    vendorOutputCpm: number;
    vendorInputCpmCached?: number;
    platformInputTpm?: number;
    platformOutputTpm?: number;
    platformFixedCost?: number;
    features?: Record<string, unknown>;
    releaseDate?: string;
    knowledgeCutoff?: string;
    sortOrder?: number;
  }>();

  if (!body.id || !body.vendor || !body.name) {
    return c.json({ error: 'validation', message: 'id, vendor, and name are required' }, 400);
  }

  await execute(
    c.env.DB,
    `INSERT INTO models (id, vendor, name, description, max_input_tokens, max_output_tokens,
       vendor_input_cpm, vendor_output_cpm, vendor_input_cpm_cached,
       platform_input_tpm, platform_output_tpm, platform_fixed_cost,
       features, release_date, knowledge_cutoff, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    body.id, body.vendor, body.name, body.description ?? null,
    body.maxInputTokens, body.maxOutputTokens,
    body.vendorInputCpm, body.vendorOutputCpm, body.vendorInputCpmCached ?? null,
    body.platformInputTpm ?? null, body.platformOutputTpm ?? null, body.platformFixedCost ?? null,
    JSON.stringify(body.features ?? {}),
    body.releaseDate ?? null, body.knowledgeCutoff ?? null, body.sortOrder ?? 0,
  );

  await logAdminAction(c.env.DB, c.get('userId'), 'model.create', 'model', body.id);

  // Invalidate cache
  await c.env.KV.delete('registry:models:all');
  await c.env.KV.delete(`registry:models:${body.vendor}`);

  return c.json({ message: 'Model created', id: body.id }, 201);
});

/**
 * PUT /admin/models/:id — update model
 */
adminModels.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();

  const fieldMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    vendor: 'vendor',
    maxInputTokens: 'max_input_tokens',
    maxOutputTokens: 'max_output_tokens',
    vendorInputCpm: 'vendor_input_cpm',
    vendorOutputCpm: 'vendor_output_cpm',
    vendorInputCpmCached: 'vendor_input_cpm_cached',
    platformInputTpm: 'platform_input_tpm',
    platformOutputTpm: 'platform_output_tpm',
    platformFixedCost: 'platform_fixed_cost',
    releaseDate: 'release_date',
    knowledgeCutoff: 'knowledge_cutoff',
    isActive: 'is_active',
    sortOrder: 'sort_order',
  };

  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, col] of Object.entries(fieldMap)) {
    if (body[key] !== undefined) {
      sets.push(`${col} = ?`);
      if (key === 'isActive') {
        values.push(body[key] ? 1 : 0);
      } else {
        values.push(body[key]);
      }
    }
  }

  if (body.features !== undefined) {
    sets.push('features = ?');
    values.push(JSON.stringify(body.features));
  }

  if (sets.length === 0) {
    return c.json({ error: 'validation', message: 'No fields to update' }, 400);
  }

  sets.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const result = await execute(c.env.DB, `UPDATE models SET ${sets.join(', ')} WHERE id = ?`, ...values);

  if ((result.meta?.changes ?? 0) === 0) {
    return c.json({ error: 'not_found', message: 'Model not found' }, 404);
  }

  await logAdminAction(c.env.DB, c.get('userId'), 'model.update', 'model', id, body);

  // Invalidate cache
  await c.env.KV.delete('registry:models:all');

  return c.json({ message: 'Model updated' });
});

/** DELETE /admin/models/:id — soft delete (disable) */
adminModels.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await execute(c.env.DB, 'UPDATE models SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', id);
  await logAdminAction(c.env.DB, c.get('userId'), 'model.disable', 'model', id);
  await c.env.KV.delete('registry:models:all');
  return c.json({ message: 'Model disabled' });
});

/**
 * POST /admin/models/seed — re-seed from library MODEL_REGISTRY
 * Upserts new models, skips existing ones (preserves admin customizations)
 */
adminModels.post('/seed', async (c) => {
  let added = 0;
  let skipped = 0;

  for (const [id, model] of Object.entries(MODEL_REGISTRY)) {
    const existing = await getModel(c.env.DB, id);
    if (existing) {
      skipped++;
      continue;
    }

    const features = JSON.stringify({
      reasoning: model.features.reasoning ?? false,
      streaming: model.features.streaming,
      structuredOutput: model.features.structuredOutput ?? false,
      functionCalling: model.features.functionCalling ?? false,
      vision: model.features.vision ?? false,
      audio: model.features.audio ?? false,
      video: model.features.video ?? false,
    });

    await execute(
      c.env.DB,
      `INSERT INTO models (id, vendor, name, description, max_input_tokens, max_output_tokens,
         vendor_input_cpm, vendor_output_cpm, vendor_input_cpm_cached, features, release_date, knowledge_cutoff, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, model.provider, id, model.description ?? null,
      model.features.input.tokens, model.features.output.tokens,
      model.features.input.cpm, model.features.output.cpm,
      model.features.input.cpmCached ?? null, features,
      model.releaseDate ?? null, model.knowledgeCutoff ?? null,
      model.isActive ? 1 : 0,
    );
    added++;
  }

  await logAdminAction(c.env.DB, c.get('userId'), 'model.seed', null, null, { added, skipped });
  await c.env.KV.delete('registry:models:all');

  return c.json({ message: `Seeded ${added} new models, skipped ${skipped} existing` });
});

export { adminModels };
