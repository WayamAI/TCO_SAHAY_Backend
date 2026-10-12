import type { PrismaClient } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import type { TcoComponentInput } from '../tco/engine.js';
import { DEFAULT_ITERATIONS, MAX_ITERATIONS, MIN_ITERATIONS, runSimulation } from './engine.js';
import { generateSeed } from './rng.js';

export interface RunSimulationInput {
  organizationId: string;
  locomotiveId: string;
  horizonYears?: number;
  scenarioId?: string;
  iterations?: number;
  seed?: string;
  userId: string;
}

export async function runLocomotiveSimulation(prisma: PrismaClient, input: RunSimulationInput) {
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

  const iterations = input.iterations ?? DEFAULT_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new ValidationError(`iterations must be an integer in [${MIN_ITERATIONS}, ${MAX_ITERATIONS}]`);
  }

  // Same scenario-to-TCO-input resolution as runTco() (src/modules/tco/service.ts) -
  // simulation never diverges from the deterministic engine's own field mapping.
  const maintenanceIntervalMultiplier = scenario?.maintenanceIntervalMultiplier ?? 1;
  const warrantyExtendedYears = scenario?.warrantyExtendedYears ?? 0;
  const baseFailureMultiplier = scenario?.failureRateMultiplier ?? 1;
  const includeDowntime = scenario?.includeDowntime ?? false;
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
          mttrHours: c.mttrHours,
          downtimeCostPerDay: c.downtimeCostPerDay,
        })),
    ),
  );

  if (components.length === 0) {
    throw new ValidationError('Locomotive has no components to simulate');
  }

  const seed = input.seed ?? generateSeed();

  const result = runSimulation({
    components,
    horizonYears,
    event: { annualHours },
    baseFailureMultiplier,
    iterations,
    seed,
    includeDowntime,
  });

  const run = await prisma.simulationRun.create({
    data: {
      organizationId: input.organizationId,
      locomotiveId: input.locomotiveId,
      scenarioId: scenario?.id,
      horizonYears,
      iterations,
      seed,
      engineVersion: result.engineVersion,
      config: {
        annualHours,
        componentCount: components.length,
        baseFailureMultiplier,
        includeDowntime,
        scenarioId: scenario?.id ?? null,
      },
      summary: result.totalCost.summary as object,
      percentiles: result.totalCost.percentiles as object,
      histogram: result.totalCost.histogram as object,
      createdByUserId: input.userId,
    },
  });

  return run;
}

export async function getSimulationRun(prisma: PrismaClient, organizationId: string, id: string) {
  const run = await prisma.simulationRun.findFirst({ where: { id, organizationId } });
  if (!run) throw new NotFoundError('SimulationRun');
  return run;
}

export async function listSimulationRunsForLocomotive(
  prisma: PrismaClient,
  organizationId: string,
  locomotiveId: string,
) {
  const locomotive = await prisma.locomotive.findFirst({
    where: { id: locomotiveId, organizationId, deletedAt: null },
  });
  if (!locomotive) throw new NotFoundError('Locomotive');
  return prisma.simulationRun.findMany({
    where: { organizationId, locomotiveId },
    orderBy: { createdAt: 'desc' },
  });
}
