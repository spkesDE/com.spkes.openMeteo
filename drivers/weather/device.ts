import Homey from 'homey';
import Location from "../../lib/weather/interface/location";
import OpenMeteo from "../../app";
import DailyWeatherVariablesConfig from "../../assets/json/dailyWeatherVariables.json";
import HourlyWeatherVariablesConfig from "../../assets/json/hourlyWeatherVariables.json";

class WeatherDevice extends Homey.Device {
    private updateInterval!: NodeJS.Timeout;
    private randomNumber: number = 15;

    async onInit() {
        this.randomNumber = Math.floor(Math.random() * (15 - 5 + 1) + 5);

        await this.update(true);
        this.updateInterval = this.homey.setInterval(() => this.update().catch(this.error), 1000 * 60);

        this.log('WeatherDevice has been initialized');
    }

    public async update(ignore: boolean = false) {
        //Interval runs at 1 minute. But we want weather pooling to be not every minute and
        //still have weather pooling at the start of the hour. So we have to generate a random number to even out the pooling
        //so the API Servers are not overloaded and check that random number (5-15) to the current minutes of the hour.
        if (new Date().getMinutes() !== this.randomNumber && !ignore) return;
        let store = this.getStore();

        //Getting the target date in the right timezone, that's why we have to use 3 new Date();
        //store.forecast is a number in days. 0 = today, 1 = tomorrow etc..
        let date = new Date(
            new Date(new Date().getTime() + (store.forecast * 24 * 60 * 60 * 1000))
                .toLocaleString("en-US", {timeZone: store.timezone})
        );

        //Getting the weather data from open-meteo
        let weather = await this.getCurrentWeather(
            store.location,
            store.timezone,
            store.hourlyWeatherVariables,
            store.dailyWeatherVariables,
            date.toISOString().split('T')[0]
        );

        //Setting the weather variables
        for (let v of store.dailyWeatherVariables) {
            await this.updateWeather(v, weather.daily);
        }
        let timeIndex = new Date(new Date().toLocaleString("en-US", {timeZone: store.timezone})).getHours();
        for (let v of store.hourlyWeatherVariables) {
            await this.updateWeather(v, weather.hourly, timeIndex);
        }

        //Setting Date capability to current day/time
        if(this.hasCapability("date")) {
            let hours = ("0" + date.getHours()).slice(-2) + ":" + ("0" + date.getMinutes()).slice(-2);
            let day = ("0" + date.getDate()).slice(-2) + "." + ("0" + date.getMonth()).slice(-2) + "." + date.getFullYear();
            await this.setCapabilityValue("date", `${hours} ${day}`);
        }
        this.log(`Updating weather for location: ${store.location.name}`)
    }

    public async updateWeather(weatherValue: string, weatherArray: any, index: number = 0) {
        //Getting JSON entry of the weatherValue
        let config = this.getConfig(weatherValue);
        if (config === null) {
            this.error("No config found for " + weatherValue);
            return;
        }
        if (!this.hasCapability(config.capability)) return;
        //Custom setCapabilityValue for sunrise and sunset to format date to hours:minutes
        if (config.value == "sunrise") {
            let d = new Date(weatherArray[config.value][index]);
            await this.setCapabilityValue(config.capability, ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2))
            return;
        }
        if (config.value == "sunset") {
            let d = new Date(weatherArray[config.value][index]);
            await this.setCapabilityValue(config.capability, ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2))
            return;
        }
        //If number capability set value.
        await this.setCapabilityValue(config.capability, weatherArray[config.value][index]).catch(this.error)
    }

    public getConfig(query: string): { value: string; i18n: string; default: string; capability: string } | null {
        let result = null;
        HourlyWeatherVariablesConfig.forEach((v) => {
            if (v.value === query) {
                result = v;
                return;
            }
        })
        if(result != null) return result;
        DailyWeatherVariablesConfig.forEach((v) => {
            if (v.value === query) {
                result = v;
                return;
            }
        })
        return result;
    }

    public async getCurrentWeather(location: Location, timeZone: string, hourlyWeatherValues: string[], dailyWeatherValues: string[], startDate: string): Promise<any> {
        return new Promise((resolve, reject) => {
            let endpoint = "forecast";
            (this.homey.app as OpenMeteo).getApi()
                .get<any>(`${endpoint}?latitude=${location.latitude}&longitude=${location.longitude}&timezone=${timeZone}&current_weather=true&hourly=${hourlyWeatherValues.join(",")}&daily=${dailyWeatherValues.join(",")}&start_date=${startDate}&end_date=${startDate}`)
                .then((r) => {
                    if (r.status == 200) {
                        resolve(r.data);
                    } else {
                        reject(`Failed to get weather. Status ${r.status}`);
                    }
                }).catch((err) => reject(err.message));
        });
    }

    onDeleted() {
        this.homey.clearInterval(this.updateInterval);
        this.log("WeatherDevice with location: " + this.getStore().location.name + " deleted. Cleared interval.");
    }

}

module.exports = WeatherDevice;
