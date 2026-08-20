import type Location from "@/lib/weather/interface/location";

export type WeatherModelCoverage = "global" | "conus" | "japan_korea" | "korea" | "europe"
    | "central_europe" | "canada" | "canada_west" | "france" | "italy" | "nordic"
    | "netherlands" | "uk_ireland" | "switzerland" | "austria";

export interface WeatherModel {
    value: string;
    i18nKey: string;
    provider: string;
    label: string;
    description: string;
    runFrequency: string;
    updateInterval: string;
    forecastLengthDays: number;
    coverage: WeatherModelCoverage;
}

const m = (value: string, provider: string, label: string, description: string, runFrequency: string,
           updateInterval: string, forecastLengthDays: number, coverage: WeatherModelCoverage = "global"): WeatherModel => ({
    value, i18nKey: value, provider, label, description, runFrequency, updateInterval, forecastLengthDays, coverage,
});

// Identifiers mirror the current `models` enum of Open-Meteo's Forecast API.
// English text is the source fallback; pairing pages translate through i18nKey.
export const WEATHER_MODELS: WeatherModel[] = [
    m("best_match", "Open-Meteo", "Best Match (recommended)", "Automatically combines the best available models for this location.", "Depends on the local model", "Depends on the local model", 16),
    m("ecmwf_ifs", "ECMWF", "ECMWF IFS HRES (9 km)", "Global high-resolution ECMWF forecast.", "00, 06, 12 and 18 UTC", "Every 6 hours", 15),
    m("ecmwf_ifs025", "ECMWF", "ECMWF IFS Open Data (25 km)", "Global ECMWF open-data forecast.", "00, 06, 12 and 18 UTC", "Every 6 hours", 15),
    m("ecmwf_aifs025_single", "ECMWF", "ECMWF AIFS Single (25 km)", "Global AI-based ECMWF forecast.", "00, 06, 12 and 18 UTC", "Every 6 hours", 15),
    m("cma_grapes_global", "CMA", "CMA GRAPES Global (15 km)", "Global forecast from the China Meteorological Administration.", "00, 06, 12 and 18 UTC", "Every 6 hours", 10),
    m("bom_access_global", "BOM", "BOM ACCESS-G Global (15 km)", "Global forecast from the Australian Bureau of Meteorology.", "00, 06, 12 and 18 UTC", "Every 6 hours", 10),
    m("ncep_gfs_seamless", "NOAA/NCEP", "NOAA GFS Seamless", "Combines GFS with regional NOAA models where available.", "Depends on the component model", "Hourly", 16),
    m("ncep_gfs_global", "NOAA/NCEP", "NOAA GFS Global (25 km)", "Global NOAA GFS forecast with pressure-level variables.", "00, 06, 12 and 18 UTC", "Every 6 hours", 16),
    m("ncep_hrrr_conus", "NOAA/NCEP", "NOAA HRRR CONUS (3 km)", "Rapid-refresh forecast for the continental United States.", "Hourly", "Hourly", 2, "conus"),
    m("ncep_nbm_conus", "NOAA/NCEP", "NOAA NBM CONUS (2.5 km)", "National Blend of Models for the continental United States.", "Hourly", "Hourly", 11, "conus"),
    m("ncep_nam_conus", "NOAA/NCEP", "NOAA NAM CONUS (3 km)", "High-resolution North American mesoscale forecast.", "00, 06, 12 and 18 UTC", "Every 6 hours", 2.5, "conus"),
    m("ncep_gfs_graphcast025", "NOAA/NCEP", "NOAA GFS GraphCast (25 km)", "Global AI forecast based on GraphCast.", "00, 06, 12 and 18 UTC", "Every 6 hours", 10),
    m("ncep_aigfs025", "NOAA/NCEP", "NOAA AIGFS (25 km)", "Global NOAA artificial-intelligence forecast.", "00, 06, 12 and 18 UTC", "Every 6 hours", 16),
    m("ncep_hgefs025_ensemble_mean", "NOAA/NCEP", "NOAA HGEFS Ensemble Mean (25 km)", "Global machine-learning ensemble-mean forecast.", "00, 06, 12 and 18 UTC", "Every 6 hours", 10),
    m("jma_seamless", "JMA", "JMA Seamless", "Combines JMA regional and global forecasts.", "Depends on the component model", "Every 3 hours", 11),
    m("jma_msm", "JMA", "JMA MSM (5 km)", "Regional forecast for Japan and Korea.", "Every 3 hours", "Every 3 hours", 4, "japan_korea"),
    m("jma_gsm", "JMA", "JMA GSM Global (55 km)", "Global forecast from the Japan Meteorological Agency.", "Every 6 hours", "Every 6 hours", 11),
    m("kma_seamless", "KMA", "KMA Seamless", "Combines KMA regional and global forecasts.", "Depends on the component model", "Every 6 hours", 12),
    m("kma_ldps", "KMA", "KMA LDPS (1.5 km)", "High-resolution forecast for North and South Korea.", "Every 6 hours", "Every 6 hours", 2, "korea"),
    m("kma_gdps", "KMA", "KMA GDPS Global (12 km)", "Global forecast from the Korea Meteorological Administration.", "Every 6 hours", "Every 6 hours", 12),
    m("icon_seamless", "DWD", "DWD ICON Seamless", "Combines ICON-D2, ICON-EU and ICON Global.", "Depends on the component model", "Every 3 hours", 7.5),
    m("icon_global", "DWD", "DWD ICON Global (11 km)", "Global forecast from the German Weather Service.", "00, 06, 12 and 18 UTC", "Every 6 hours", 7.5),
    m("icon_eu", "DWD", "DWD ICON-EU (7 km)", "Regional high-resolution forecast for Europe.", "Every 3 hours", "Every 3 hours", 5, "europe"),
    m("icon_d2", "DWD", "DWD ICON-D2 (2 km)", "High-resolution forecast for Central Europe.", "Every 3 hours", "Every 3 hours", 2, "central_europe"),
    m("cmc_gem_seamless", "ECCC", "GEM Seamless", "Combines Canadian regional and global GEM forecasts.", "Depends on the component model", "Every 6 hours", 10),
    m("cmc_gem_gdps", "ECCC", "GEM Global GDPS", "Global Canadian GEM forecast.", "Every 6 hours", "Every 6 hours", 10),
    m("cmc_gem_rdps", "ECCC", "GEM Regional RDPS", "Regional Canadian forecast for North America.", "Every 6 hours", "Every 6 hours", 3.5, "canada"),
    m("cmc_gem_hrdps", "ECCC", "GEM HRDPS Continental", "High-resolution Canadian continental forecast.", "Every 6 hours", "Every 6 hours", 2, "canada"),
    m("cmc_gem_hrdps_west", "ECCC", "GEM HRDPS West", "High-resolution forecast for western Canada.", "Every 6 hours", "Every 6 hours", 2, "canada_west"),
    m("meteofrance_seamless", "Météo-France", "Météo-France Seamless", "Combines ARPEGE and AROME forecasts.", "Depends on the component model", "Hourly", 4),
    m("meteofrance_arpege_world", "Météo-France", "ARPEGE World (25 km)", "Global Météo-France ARPEGE forecast.", "Every 6 hours", "Every 6 hours", 4),
    m("meteofrance_arpege_europe", "Météo-France", "ARPEGE Europe (11 km)", "Regional ARPEGE forecast for Europe.", "Every 6 hours", "Every 6 hours", 4, "europe"),
    m("meteofrance_arome_france", "Météo-France", "AROME France (2.5 km)", "High-resolution forecast for France and neighbouring areas.", "Every 3 hours", "Every 3 hours", 2, "france"),
    m("meteofrance_arome_france_hd", "Météo-France", "AROME France HD (1.5 km)", "Highest-resolution AROME forecast for France.", "Every 3 hours", "Every 3 hours", 2, "france"),
    m("italia_meteo_arpae_icon_2i", "ItaliaMeteo", "ItaliaMeteo ICON-2I (2 km)", "High-resolution regional forecast for Italy.", "Every 12 hours", "Every 12 hours", 3, "italy"),
    m("metno_seamless", "MET Norway", "MET Nordic Seamless (with ECMWF)", "Combines MET Nordic locally with ECMWF for longer forecasts.", "Depends on the component model", "Hourly", 15, "nordic"),
    m("metno_nordic", "MET Norway", "MET Nordic (1 km)", "Post-processed high-resolution forecast for the Nordic region.", "Hourly", "Hourly", 2.5, "nordic"),
    m("knmi_seamless", "KNMI", "KNMI Seamless (with ECMWF)", "Combines KNMI HARMONIE locally with ECMWF.", "Depends on the component model", "Hourly", 15, "europe"),
    m("knmi_harmonie_arome_europe", "KNMI", "KNMI HARMONIE AROME Europe", "High-resolution HARMONIE forecast for Europe.", "Hourly", "Hourly", 2.5, "europe"),
    m("knmi_harmonie_arome_netherlands", "KNMI", "KNMI HARMONIE AROME Netherlands", "High-resolution forecast for the Netherlands.", "Hourly", "Hourly", 2.5, "netherlands"),
    m("dmi_seamless", "DMI", "DMI Seamless (with ECMWF)", "Combines DMI HARMONIE locally with ECMWF.", "Depends on the component model", "Every 3 hours", 15, "europe"),
    m("dmi_harmonie_arome_europe", "DMI", "DMI HARMONIE AROME Europe", "High-resolution DMI forecast for Europe.", "Every 3 hours", "Every 3 hours", 2.5, "europe"),
    m("ukmo_seamless", "UK Met Office", "UK Met Office Seamless", "Combines UKV with the global UKMO forecast.", "Depends on the component model", "Hourly", 7),
    m("ukmo_global_deterministic_10km", "UK Met Office", "UKMO Global Deterministic (10 km)", "Global deterministic UK Met Office forecast.", "Every 6 hours", "Every 6 hours", 7),
    m("ukmo_uk_deterministic_2km", "UK Met Office", "UKMO UKV Deterministic (2 km)", "High-resolution forecast for the United Kingdom and Ireland.", "Hourly", "Hourly", 2, "uk_ireland"),
    m("meteoswiss_icon_seamless", "MeteoSwiss", "MeteoSwiss ICON Seamless", "Combines MeteoSwiss ICON models for Central Europe.", "Depends on the component model", "Every 3 hours", 5, "switzerland"),
    m("meteoswiss_icon_ch1", "MeteoSwiss", "MeteoSwiss ICON-CH1 (1 km)", "One-kilometre forecast for Switzerland and nearby areas.", "Every 3 hours", "Every 3 hours", 2.5, "switzerland"),
    m("meteoswiss_icon_ch2", "MeteoSwiss", "MeteoSwiss ICON-CH2 (2 km)", "Two-kilometre forecast for Switzerland and nearby areas.", "Every 3 hours", "Every 3 hours", 5, "switzerland"),
    m("geosphere_seamless", "GeoSphere Austria", "GeoSphere Seamless (with ECMWF)", "Combines AROME Austria locally with ECMWF.", "Depends on the component model", "Every 3 hours", 15, "austria"),
    m("geosphere_arome_austria", "GeoSphere Austria", "GeoSphere AROME Austria (2.5 km)", "High-resolution regional forecast for Austria.", "Every 3 hours", "Every 3 hours", 2.5, "austria"),
];

export const DEFAULT_WEATHER_MODEL = "best_match";
const LEGACY_WEATHER_MODEL_ALIASES: Record<string, string> = {ecmwf_ifs04: "ecmwf_ifs", gfs_seamless: "ncep_gfs_seamless", gfs_global: "ncep_gfs_global"};
const COVERAGE_BOUNDS: Record<Exclude<WeatherModelCoverage, "global">, [number, number, number, number]> = {
    conus: [20, 55, -135, -55], japan_korea: [22, 50, 118, 153], korea: [32, 44, 123, 133],
    europe: [29, 72, -25, 45], central_europe: [42, 58, -5, 21], canada: [38, 85, -145, -40],
    canada_west: [42, 72, -145, -100], france: [38, 54, -8, 13], italy: [34, 49, 5, 20],
    nordic: [53, 72, 4, 32], netherlands: [49, 55, 2, 8], uk_ireland: [48, 62, -12, 4],
    switzerland: [42, 51, 3, 17], austria: [44, 50, 8, 20],
};

export function normalizeWeatherModel(value: unknown): string {
    const normalized = typeof value === "string" ? LEGACY_WEATHER_MODEL_ALIASES[value] ?? value : undefined;
    return normalized && WEATHER_MODELS.some((model) => model.value === normalized) ? normalized : DEFAULT_WEATHER_MODEL;
}

export function getWeatherModelsForLocation(location?: Location): WeatherModel[] {
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return WEATHER_MODELS.filter((model) => model.coverage === "global");
    return WEATHER_MODELS.filter((model) => model.coverage === "global" || isInCoverage(location, model.coverage));
}

export function normalizeWeatherModelForLocation(value: unknown, location?: Location): string {
    const normalized = normalizeWeatherModel(value);
    return getWeatherModelsForLocation(location).some((model) => model.value === normalized) ? normalized : DEFAULT_WEATHER_MODEL;
}

function isInCoverage(location: Location, coverage: Exclude<WeatherModelCoverage, "global">): boolean {
    const [minLat, maxLat, minLon, maxLon] = COVERAGE_BOUNDS[coverage];
    return location.latitude >= minLat && location.latitude <= maxLat && location.longitude >= minLon && location.longitude <= maxLon;
}
