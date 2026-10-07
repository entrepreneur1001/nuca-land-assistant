import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { userProfile } from "@/db/schema";
import { config } from "./config";
import type { Profile } from "@/engine/scoring";

const featureMode = z.enum(["ignore", "prefer", "require"]);
const nullableNum = z.number().finite().nonnegative().nullable();

export const profileInputSchema = z.object({
  bookingRank: z.number().int().positive().max(1_000_000),
  moneyPaid: z.number().finite().nonnegative(),
  moneyAvailable: nullableNum,
  maxAdditional: z.number().finite().nonnegative(),
  preferredCities: z.array(z.string().max(100)).max(50),
  preferredProjects: z.array(z.string().max(150)).max(100),
  minArea: nullableNum,
  maxArea: nullableNum,
  preferredArea: nullableNum,
  maxPrice: nullableNum,
  preferredPricePerMeter: nullableNum,
  weights: z.record(z.string(), z.number().min(0).max(100)).nullable().optional(),
  preferences: z
    .object({
      garden: featureMode.optional(),
      corner: featureMode.optional(),
      onlyPreferredCities: z.boolean().optional(),
      premiumValues: z.record(z.string(), z.number().min(0).max(1)).optional(),
    })
    .nullable()
    .optional(),
});

export type ProfileRow = Profile & { updatedAt: string };

export async function getProfile(db: DB): Promise<ProfileRow> {
  let [row] = await db.select().from(userProfile).where(eq(userProfile.id, 1));
  if (!row) {
    [row] = await db
      .insert(userProfile)
      .values({
        id: 1,
        bookingRank: config.defaults.bookingRank,
        moneyPaid: config.defaults.moneyPaid,
        maxAdditional: 0,
        preferences: { garden: "prefer", corner: "prefer" },
      })
      .onConflictDoNothing()
      .returning();
    if (!row) [row] = await db.select().from(userProfile).where(eq(userProfile.id, 1));
  }
  return {
    bookingRank: row.bookingRank,
    moneyPaid: row.moneyPaid,
    moneyAvailable: row.moneyAvailable,
    maxAdditional: row.maxAdditional,
    preferredCities: row.preferredCities ?? [],
    preferredProjects: row.preferredProjects ?? [],
    minArea: row.minArea,
    maxArea: row.maxArea,
    preferredArea: row.preferredArea,
    maxPrice: row.maxPrice,
    preferredPricePerMeter: row.preferredPricePerMeter,
    weights: (row.weights as Profile["weights"]) ?? null,
    preferences: (row.preferences as Profile["preferences"]) ?? { garden: "prefer", corner: "prefer" },
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveProfile(db: DB, input: z.infer<typeof profileInputSchema>) {
  await getProfile(db); // ensure row exists
  await db
    .update(userProfile)
    .set({ ...input, weights: input.weights ?? null, preferences: input.preferences ?? null, updatedAt: new Date() })
    .where(eq(userProfile.id, 1));
  return getProfile(db);
}
