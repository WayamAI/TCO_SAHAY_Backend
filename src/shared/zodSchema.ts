import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodType } from 'zod';

/** Converts a zod schema to a plain JSON Schema object for OpenAPI docs. */
export function z2j(schema: ZodType): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });
  // zodToJsonSchema includes a top-level $schema key that OpenAPI doesn't want.
  delete (json as Record<string, unknown>).$schema;
  return json as Record<string, unknown>;
}
