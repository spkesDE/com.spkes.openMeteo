import type Homey from "homey";

export type WeatherUnitSystem = "metric" | "imperial";

type WeatherUnitKind = "height" | "precipitation" | "snowfall" | "wind";

interface UnitDefinition {
    metric: string;
    imperial: string;
    convertToImperial(value: number): number;
}

export default class WeatherUnits {
    private static readonly APPLIED_UNIT_SYSTEM_STORE_KEY = "capabilityUnitSystem";
    private static readonly APPLIED_CAPABILITY_SIGNATURE_STORE_KEY = "capabilityUnitSignature";
    private static readonly UNSUPPORTED_CAPABILITY_UNITS_STORE_KEY = "unsupportedCapabilityUnits";

    private static readonly CAPABILITY_KINDS: Record<string, WeatherUnitKind> = {
        measure_precipitation: "precipitation",
        measure_precipitation_sum: "precipitation",
        measure_rain: "precipitation",
        measure_rain_sum: "precipitation",
        measure_showers: "precipitation",
        measure_showers_sum: "precipitation",
        measure_snowfall_water_equivalent_sum: "precipitation",
        measure_snowfall: "snowfall",
        measure_snowfall_sum: "snowfall",
        measure_snowfall_depth: "height",
        measure_boundary_layer_height: "height",
        measure_freezinglevel_height: "height",
        measure_visibility: "height",
        measure_visibility_min: "height",
        measure_gust_strength: "wind",
        measure_wind_strength: "wind",
        measure_windgusts_max: "wind",
        measure_windspeed_max: "wind",
        measure_windspeed_mean: "wind",
    };

    private static readonly UNIT_DEFINITIONS: Record<WeatherUnitKind, UnitDefinition> = {
        precipitation: {
            metric: "mm",
            imperial: "in",
            convertToImperial: (value) => value / 25.4,
        },
        snowfall: {
            metric: "cm",
            imperial: "in",
            convertToImperial: (value) => value / 2.54,
        },
        height: {
            metric: "m",
            imperial: "ft",
            convertToImperial: (value) => value * 3.280839895,
        },
        wind: {
            metric: "km/h",
            imperial: "mph",
            convertToImperial: (value) => value * 0.6213711922,
        },
    };

    public static normalize(value: unknown, windSpeedUnit?: unknown, precipitationUnit?: unknown): WeatherUnitSystem {
        if (value === "imperial" || value === "us") return "imperial";
        if (value === "metric") return "metric";

        let legacyWindUnit = typeof windSpeedUnit === "string" ? windSpeedUnit.toLowerCase() : "";
        let legacyPrecipitationUnit = typeof precipitationUnit === "string" ? precipitationUnit.toLowerCase() : "";
        return legacyWindUnit === "mph" || legacyPrecipitationUnit === "inch" || legacyPrecipitationUnit === "in"
            ? "imperial"
            : "metric";
    }

    public static convertCapabilityValue(capabilityId: string, value: number, unitSystem: WeatherUnitSystem): number {
        if (unitSystem !== "imperial") return value;

        let definition = this.getDefinition(capabilityId);
        return definition ? definition.convertToImperial(value) : value;
    }

    public static convertDeviceCapabilityValue(
        device: Homey.Device,
        capabilityId: string,
        value: number,
        unitSystem: WeatherUnitSystem,
    ): number {
        if (this.isUnsupportedDeviceCapability(device, capabilityId)) return value;
        return this.convertCapabilityValue(capabilityId, value, unitSystem);
    }

    public static getDeviceCapabilityUnitSystem(
        device: Homey.Device,
        capabilityId: string,
        unitSystem: WeatherUnitSystem,
    ): WeatherUnitSystem {
        return this.isUnsupportedDeviceCapability(device, capabilityId)
            ? "metric"
            : unitSystem;
    }

    public static getCapabilityUnit(
        capabilityId: string,
        unitSystem: WeatherUnitSystem,
        fallback: string = "",
    ): string {
        let definition = this.getDefinition(capabilityId);
        if (!definition) return fallback;
        return unitSystem === "imperial" ? definition.imperial : definition.metric;
    }

    public static isConvertibleCapability(capabilityId: string): boolean {
        return this.getDefinition(capabilityId) !== undefined;
    }

    public static getCapabilitiesOptions(
        capabilityIds: string[],
        unitSystem: WeatherUnitSystem,
    ): Record<string, {units: Record<string, string>}> {
        let result: Record<string, {units: Record<string, string>}> = {};
        if (unitSystem !== "imperial") return result;

        for (let capabilityId of capabilityIds) {
            let definition = this.getDefinition(capabilityId);
            if (!definition) continue;
            result[capabilityId] = {
                units: {
                    en: definition.imperial,
                    de: definition.imperial,
                },
            };
        }
        return result;
    }

    public static async applyCapabilityOptions(
        device: Homey.Device,
        unitSystem: WeatherUnitSystem,
        force: boolean = false,
    ): Promise<number> {
        let applicableCapabilities = device.getCapabilities()
            .filter((capabilityId) => this.getDefinition(capabilityId))
            .sort();
        let capabilitySignature = `${unitSystem}:${applicableCapabilities.join(",")}`;
        let appliedCapabilitySignature = device.getStoreValue(this.APPLIED_CAPABILITY_SIGNATURE_STORE_KEY);

        if (!force && appliedCapabilitySignature === capabilitySignature) {
            return 0;
        }

        let updates = 0;
        let unsupportedCapabilities: string[] = [];
        for (let capabilityId of applicableCapabilities) {
            let definition = this.getDefinition(capabilityId);
            if (!definition) continue;

            let expectedUnit = unitSystem === "imperial" ? definition.imperial : definition.metric;
            try {
                await device.setCapabilityOptions(capabilityId, {
                    units: {
                        en: expectedUnit,
                        de: expectedUnit,
                    },
                });
                updates++;
            } catch (err: any) {
                if (!this.isInvalidCapabilityError(err)) throw err;
                unsupportedCapabilities.push(capabilityId);
            }
        }

        await device.setStoreValue(this.UNSUPPORTED_CAPABILITY_UNITS_STORE_KEY, unsupportedCapabilities);
        await device.setStoreValue(this.APPLIED_UNIT_SYSTEM_STORE_KEY, unitSystem);
        await device.setStoreValue(this.APPLIED_CAPABILITY_SIGNATURE_STORE_KEY, capabilitySignature);
        return updates;
    }

    private static getDefinition(capabilityId: string): UnitDefinition | undefined {
        let baseCapabilityId = capabilityId.split(".")[0];
        let kind = this.CAPABILITY_KINDS[baseCapabilityId];
        return kind ? this.UNIT_DEFINITIONS[kind] : undefined;
    }

    private static isInvalidCapabilityError(error: unknown): boolean {
        let message = error instanceof Error
            ? error.message
            : typeof error === "string"
                ? error
                : "";
        return message.includes("Invalid Capability");
    }

    private static isUnsupportedDeviceCapability(device: Homey.Device, capabilityId: string): boolean {
        let unsupportedCapabilities = device.getStoreValue(this.UNSUPPORTED_CAPABILITY_UNITS_STORE_KEY);
        if (!Array.isArray(unsupportedCapabilities)) return false;

        let baseCapabilityId = capabilityId.split(".")[0];
        return unsupportedCapabilities.includes(capabilityId) || unsupportedCapabilities.includes(baseCapabilityId);
    }
}
