import Homey from 'homey';
import * as crypto from "crypto";
import Location from "../../lib/weather/interface/location";
import DailyWeatherVariablesConfig from "../../assets/json/dailyWeatherVariables.json";
import HourlyWeatherVariablesConfig from "../../assets/json/hourlyWeatherVariables.json";
import HourlyAirQualityVariablesConfig from "../../assets/json/hourlyAirQualityVariables.json";
import WeatherDevice from "./device";

class WeatherDriver extends Homey.Driver {
    private location?: Location;
    private tempUnit?: string;
    private windSpeedUnit?: string;
    private timezone?: string;
    private precipitationUnit?: string;
    private hourlyWeatherVariables: string[] = [];
    private dailyWeatherVariables: string[] = [];
    private hourlyAirQualityValues: string[] = [];
    private forecast: number = 0;

    /**
     * onInit is called when the driver is initialized.
     */
    async onInit() {
        this.log('WeatherDriver has been initialized');
    }


    /**
     * This method is called when a repair session starts.
     * Params: session – Bi-directional socket for communication with the front-end
     * Params: device - the device that is currently being repaired
     */
    async onRepair(session: any, device: WeatherDevice) {
        session.setHandler("getData", async (data: {
            view: string,
        }) => {
            let store = device.getStore();
            if (data.view === "setup") {
                return {
                    location: store.location,
                    timezone: store.timezone,
                    forecast: store.forecast,
                }
            }
            if (data.view === "dailyWeatherVariables" ||
                data.view === "hourlyWeatherVariables" ||
                data.view === "hourlyAirQualityValues") {
                return {
                    data: device.getCapabilities()
                }
            }

        });

        session.setHandler("setup", async (data: {
            location: Location
            tempUnit: string
            windSpeedUnit: string
            timezone: string
            precipitationUnit: string
            forecast: number
        }) => {
            await device.setStoreValue("location", data.location);
            await device.setStoreValue("timezone", data.timezone == "auto" ? data.location.timezone : data.timezone);
            await device.setStoreValue("forecast", data.forecast);
            return true;
        });
        session.setHandler("hourlyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            this.hourlyWeatherVariables = data;
            return true;
        });

        session.setHandler("dailyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            this.dailyWeatherVariables = data;
            return true;
        });

        session.setHandler("hourlyAirQualityValues", async (data: string[]) => {
            if (data == undefined) return false;
            this.hourlyAirQualityValues = data;
            let capabilities = this.variablesToCapabilities();
            for (let capability of capabilities) {
                if (device.hasCapability(capability)) continue;
                await device.addCapability(capability);
            }
            for (let deviceCapability of device.getCapabilities()) {
                if (capabilities.includes(deviceCapability)) continue;
                await device.removeCapability(deviceCapability);
            }
            await device.setStoreValue("dailyWeatherVariables", this.dailyWeatherVariables);
            await device.setStoreValue("hourlyWeatherVariables", this.hourlyWeatherVariables);
            await device.setStoreValue("hourlyAirQualityValues", this.hourlyAirQualityValues);
            await device.update(true)
            return true;
        });
    }

    /**
     * This method is called when a pair session starts.
     * Params: session – Bi-directional socket for communication with the front-end
     */
    async onPair(session: any) {

        session.setHandler('showView', async (data: any) => {
        });

        //Handle Setup
        session.setHandler("setup", async (data: {
            location: Location
            tempUnit: string
            windSpeedUnit: string
            timezone: string
            precipitationUnit: string
            forecast: number
        }) => {
            if (data == undefined) return false;
            this.location = data.location;
            this.tempUnit = data.tempUnit;
            this.windSpeedUnit = data.windSpeedUnit;
            this.timezone = data.timezone == "auto" ? data.location.timezone : data.timezone;
            this.precipitationUnit = data.precipitationUnit;
            this.forecast = data.forecast;
            return true;
        });

        session.setHandler("hourlyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            this.hourlyWeatherVariables = data;
            return true;
        });

        session.setHandler("dailyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            this.dailyWeatherVariables = data;
            return true;
        });

        session.setHandler("hourlyAirQualityValues", async (data: string[]) => {
            if (data == undefined) return false;
            this.hourlyAirQualityValues = data;
            return true;
        });

        //Get devices
        session.setHandler("list_devices", async () => {
            let nameExtension = "";
            if(this.forecast > 0){
                nameExtension = ` (+${this.forecast}d)`
            }
            return [
                {
                    name: this.location?.name + nameExtension,
                    // The data object is required and should be unique for the device.
                    // So a device's MAC address would be good, but an IP address would
                    // be bad since it can change over time.
                    data: {
                        id: crypto.randomUUID()
                    },
                    store: {
                        location: this.location,
                        tempUnit: this.tempUnit,
                        windSpeedUnit: this.windSpeedUnit,
                        timezone: this.timezone,
                        precipitationUnit: this.precipitationUnit,
                        dailyWeatherVariables: this.dailyWeatherVariables,
                        hourlyWeatherVariables: this.hourlyWeatherVariables,
                        hourlyAirQualityValues: this.hourlyAirQualityValues,
                        forecast: this.forecast,
                    },
                    capabilities: this.variablesToCapabilities()
                },
            ];
        });
    }

    private variablesToCapabilities() {
        let capabilities: string[] = ["date"];
        DailyWeatherVariablesConfig.forEach((d) => {
            if (this.dailyWeatherVariables.includes(d.value) && d.capability != "")
                capabilities.push(d.capability);
            else if (this.dailyWeatherVariables.includes(d.value))
                this.error(d.value + " has no capability")
        });
        HourlyWeatherVariablesConfig.forEach((d) => {
            if (this.hourlyWeatherVariables.includes(d.value) && d.capability != "")
                capabilities.push(d.capability);
            else if (this.hourlyWeatherVariables.includes(d.value))
                this.error(d.value + " has no capability")
        });
        HourlyAirQualityVariablesConfig.forEach((d) => {
            if (this.hourlyAirQualityValues.includes(d.value) && d.capability != "")
                capabilities.push(d.capability);
            else if (this.hourlyAirQualityValues.includes(d.value))
                this.error(d.value + " has no capability")
        });
        return capabilities;
    }

}

module.exports = WeatherDriver;
