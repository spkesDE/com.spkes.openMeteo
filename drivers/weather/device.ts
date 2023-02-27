import Homey from 'homey';
import Location from "../../lib/weather/interface/location";
import OpenMeteo from "../../app";
import DailyWeatherVariablesConfig from "../../assets/json/dailyWeatherVariables.json";
import HourlyWeatherVariablesConfig from "../../assets/json/hourlyWeatherVariables.json";

class WeatherDevice extends Homey.Device {
    private updateInterval!: NodeJS.Timeout;

    async onInit() {
        await this.update();
        this.updateInterval = this.homey.setInterval(this.update, 1000 * 60 * 60);
        this.log('WeatherDevice has been initialized');
    }

    public async update() {
        let store = this.getStore();
        let weather = await this.getCurrentWeather(store.location, store.timezone, store.hourlyWeatherVariables, store.dailyWeatherVariables);
        for (let v of store.dailyWeatherVariables) {
            await this.updateWeather(v, weather.daily);
        }
        let timeIndex = new Date(new Date().toLocaleString("en-US", {timeZone: store.timezone})).getHours();
        for (let v of store.hourlyWeatherVariables) {
            await this.updateWeather(v, weather.hourly, timeIndex);
        }
        this.log(`Updating weather for location: ${store.location.name}`)
    }

    public async updateWeather(weatherValue: string, weatherArray: any, index: number = 0) {
        let config = this.getConfig(weatherValue);
        if (config === null) {
            this.error("No config found for " + weatherValue);
            return;
        }
        if (!this.hasCapability(config.capability)) return;
        for (const key of Object.keys(weatherArray)) {
            //Custom setCapabilityValue for sunrise and sunset to format date to hours:minutes
            if (key === config?.value && key == "sunrise") {
                let d = new Date(weatherArray[key][index]);
                await this.setCapabilityValue(config.capability, ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2))
                break;
            }
            if (key === config?.value && key == "sunset") {
                let d = new Date(weatherArray[key][index]);
                await this.setCapabilityValue(config.capability, ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2))
                break;
            }
            //If number capability set value.
            if (key === config?.value)
                await this.setCapabilityValue(config.capability, weatherArray[key][index])
        }
    }

    public getConfig(query: string): { value: string; i18n: string; default: string; capability: string } | null {
        let result = null;
        HourlyWeatherVariablesConfig.forEach((v) => {
            if (v.value === query) {
                result = v;
                return;
            }
        })
        DailyWeatherVariablesConfig.forEach((v) => {
            if (v.value === query) {
                result = v;
                return;
            }
        })
        return result;
    }

    public async getCurrentWeather(location: Location, timeZone: string, hourlyWeatherValues: string[], dailyWeatherValues: string[]): Promise<any> {
        return new Promise((resolve, reject) => {
            let endpoint = "forecast";
            (this.homey.app as OpenMeteo).getApi().get<any>(`${endpoint}?latitude=${location.latitude}&longitude=${location.longitude}&timezone=${timeZone}&current_weather=true&hourly=${hourlyWeatherValues.join(",")}&daily=${dailyWeatherValues.join(",")}`).then((r) => {
                if (r.status == 200) {
                    resolve(r.data);
                } else {
                    reject(`Failed to get weather. Status ${r.status}`);
                }
            }).catch((err) => reject(err));
        });
    }

    onDeleted() {
        super.onDeleted();
    }

}

module.exports = WeatherDevice;
