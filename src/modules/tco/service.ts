import type { PrismaClient } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { locomotiveTco, type TcoComponentInput } from './engine.js';

export interface RunTcoInput {
  organizationId: string;
  locomotiveId: string;
  horizonYears?: number;
  scenarioId?: string;
  userId: string;
}

export async function runTco(prisma: PrismaClient, input: RunTcoInput) {
  const locomotive = await prisma.locomotive.findFirst({
    where: { id: input.locomotiveId, organizationId: input.organizationId, deletedAt: null },
    include: { systems: { include: { assemblies: { include: { components: true } } } } },
  });
  if (!locomotive) throw new NotFoundError('Locomotive');

  let scenario = null;
  if (input.scenarioId) {
    scenario = await prisma.scenario.findFirst({
      where: { id: input.scenarioId, organizationId: input.organizationId },
      include: { operatingProfile: true },
    });
    if (!scenario) throw new NotFoundError('Scenario');
  }

  const horizonYears = input.horizonYears ?? scenario?.planningHorizonYears;
  if (!horizonYears) {
    throw new ValidationError('horizonYears is required when no scenario supplies planningHorizonYears');
  }

  // See TCO_ENGINE_SPECIFICATION.md's "Scenario application" table for which
  // fields are applied here vs. stored-but-not-yet-used. This transform
  // happens here, not inside engine.ts, so the engine stays scenario-agnostic
  // and the math is never duplicated.
  const maintenanceIntervalMultiplier = scenario?.maintenanceIntervalMultiplier ?? 1;
  const warrantyExtendedYears = scenario?.warrantyExtendedYears ?? 0;
  const failureRateMultiplier = scenario?.failureRateMultiplier ?? 1;
  const annualHours = scenario?.operatingProfile?.annualHours ?? locomotive.annualHours;

  const components: TcoComponentInput[] = locomotive.systems.flatMap((system) =>
    system.assemblies.flatMap((assembly) =>
      assembly.components
        .filter((c) => !c.deletedAt)
        .map((c) => ({
          id: c.id,
          name: c.name,
          replacementCost: c.replacementCost,
          lifeYears: c.lifeYears / maintenanceIntervalMultiplier,
          warrantyYears: c.warrantyYears + warrantyExtendedYears,
          laborCostPct: c.laborCostPct,
          weibullBeta: c.weibullBeta,
          weibullEta: c.weibullEta,
        })),
    ),
  );

  const outputs = locomotiveTco(components, horizonYears, { annualHours }, failureRateMultiplier);

  const run = await prisma.tcoRun.create({
    data: {
      organizationId: input.organizationId,
      locomotiveId: input.locomotiveId,
      scenarioId: scenario?.id,
      horizonYears,
      inputs: {
        horizonYears,
        annualHours,
        componentCount: components.length,
        scenarioId: scenario?.id ?? null,
        maintenanceIntervalMultiplier,
        warrantyExtendedYears,
        failureRateMultiplier,
      },
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
