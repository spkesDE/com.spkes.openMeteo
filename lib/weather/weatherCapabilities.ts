export interface CapabilityMigration {
    legacyCapability: string;
    nextCapability: string;
}

export const capabilityMigrations: CapabilityMigration[] = [
    {
        legacyCapability: "mesaure_weathercode",
        nextCapability: "measure_weathercode",
    },
    {
        legacyCapability: "measure_o3",
        nextCapability: "measure_ozone",
    },
    {
        legacyCapability: "measure_so2",
        nextCapability: "measure_sulphur_dioxide",
    },
];

export function findLegacyCapabilityFor(nextCapability: string) {
    return capabilityMigrations.find((migration) => migration.nextCapability === nextCapability)?.legacyCapability ?? null;
}
