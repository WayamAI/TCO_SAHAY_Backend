import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function paginationMeta(pagination: Pagination, total: number) {
  return { page: pagination.page, pageSize: pagination.pageSize, total };
}

export function paginationArgs(pagination: Pagination) {
  return { skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize };
}
