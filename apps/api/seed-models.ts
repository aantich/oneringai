/**
 * Seed script: Generate SQL to populate the `models` table from library MODEL_REGISTRY.
 *
 * Usage:
 *   npx tsx seed-models.ts > seed-models.sql
 *   wrangler d1 execute oneringai-db --local --file=seed-models.sql
 *
 * Or pipe directly:
 *   npx tsx seed-models.ts | wrangler d1 execute oneringai-db --local --file=-
 */
import { MODEL_REGISTRY } from 'oneringai/shared';

const lines: string[] = [];

lines.push('-- Auto-generated from MODEL_REGISTRY');
lines.push('-- Run: wrangler d1 execute oneringai-db --local --file=seed-models.sql');
lines.push('');

for (const [id, model] of Object.entries(MODEL_REGISTRY)) {
  const features = JSON.stringify({
    reasoning: model.features.reasoning ?? false,
    streaming: model.features.streaming,
    structuredOutput: model.features.structuredOutput ?? false,
    functionCalling: model.features.functionCalling ?? false,
    vision: model.features.vision ?? false,
    audio: model.features.audio ?? false,
    video: model.features.video ?? false,
    extendedThinking: model.features.extendedThinking ?? false,
    batchAPI: model.features.batchAPI ?? false,
    promptCaching: model.features.promptCaching ?? false,
    fineTuning: model.features.fineTuning ?? false,
    realtime: model.features.realtime ?? false,
    inputText: model.features.input.text,
    inputImage: model.features.input.image ?? false,
    inputAudio: model.features.input.audio ?? false,
    inputVideo: model.features.input.video ?? false,
    outputText: model.features.output.text,
    outputImage: model.features.output.image ?? false,
    outputAudio: model.features.output.audio ?? false,
  });

  const escapedDesc = (model.description ?? '').replace(/'/g, "''");
  const escapedFeatures = features.replace(/'/g, "''");

  lines.push(`INSERT OR IGNORE INTO models (id, vendor, name, description, max_input_tokens, max_output_tokens, vendor_input_cpm, vendor_output_cpm, vendor_input_cpm_cached, features, release_date, knowledge_cutoff, is_active, sort_order) VALUES ('${id}', '${model.provider}', '${id}', '${escapedDesc}', ${model.features.input.tokens}, ${model.features.output.tokens}, ${model.features.input.cpm}, ${model.features.output.cpm}, ${model.features.input.cpmCached ?? 'NULL'}, '${escapedFeatures}', ${model.releaseDate ? `'${model.releaseDate}'` : 'NULL'}, ${model.knowledgeCutoff ? `'${model.knowledgeCutoff}'` : 'NULL'}, ${model.isActive ? 1 : 0}, 0);`);
}

console.log(lines.join('\n'));
