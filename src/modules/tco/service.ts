import type { PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../shared/errors.js';
import { locomotiveTco, type TcoComponentInput } from './engine.js';

export interface RunTcoInput {
  organizationId: string;
  locomotiveId: string;
  horizonYears: number;
  userId: string;
}

export async function runTco(prisma: PrismaClient, input: RunTcoInput) {
  const locomotive = await prisma.locomotive.findFirst({
    where: { id: input.locomotiveId, organizationId: input.organizationId, deletedAt: null },
    include: { systems: { include: { assemblies: { include: { components: true } } } } },
  });
  if (!locomotive) throw new NotFoundError('Locomotive');

  const components: TcoComponentInput[] = locomotive.systems.flatMap((system) =>
    system.assemblies.flatMap((assembly) =>
      assembly.components
        .filter((c) => !c.deletedAt)
        .map((c) => ({
          id: c.id,
          name: c.name,
          replacementCost: c.replacementCost,
          lifeYears: c.lifeYears,
          warrantyYears: c.warrantyYears,
          laborCostPct: c.laborCostPct,
          weibullBeta: c.weibullBeta,
          weibullEta: c.weibullEta,
        })),
    ),
  );

  const outputs = locomotiveTco(components, input.horizonYears, { annualHours: locomotive.annualHours });

  const run = await prisma.tcoRun.create({
    data: {
      organizationId: input.organizationId,
      locomotiveId: input.locomotiveId,
      horizonYears: input.horizonYears,
      inputs: { horizonYears: input.horizonYears, annualHours: locomotive.annualHours, componentCount: components.length },
      outputs: outputs as object,
      createdByUserId: input.userId,
    },
  });

  return run;
}

export async function getTcoRun(prisma: PrismaClient, organizationId: string, id: string) {
  const run = await prisma.tcoRun.findFirst({ where: { id, organizationId } });
  if (!run) throw new NotFoundError('TcoRun');
  return run;
}

export async function listTcoRunsForLocomotive(
  prisma: PrismaClient,
  organizationId: string,
  locomotiveId: string,
) {
  const locomotive = await prisma.locomotive.findFirst({
    where: { id: locomotiveId, organizationId, deletedAt: null },
  });
  if (!locomotive) throw new NotFoundError('Locomotive');
  return prisma.tcoRun.findMany({ where: { organizationId, locomotiveId }, orderBy: { createdAt: 'desc' } });
}
