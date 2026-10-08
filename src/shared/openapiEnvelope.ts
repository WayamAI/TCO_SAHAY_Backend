// Shared response-envelope shapes for OpenAPI docs, matching API_CONTRACT.md.
// Defined once and reused across every route's `schema.response` instead of
// repeating {data, meta} / {error} inline everywhere.

export function dataResponse(dataSchema: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      data: dataSchema,
      meta: { type: 'object' },
    },
    required: ['data'],
  };
}

export const errorResponse: Record<string, unknown> = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
};

export const bearerAuth = [{ bearerAuth: [] as string[] }];
