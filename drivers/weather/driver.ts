import Homey from 'homey';
import * as crypto from "crypto";
import Location from "../../lib/weather/interface/location";

class WeatherDriver extends Homey.Driver {
    private location?: Location;
    private tempUnit?: string;
    private windSpeedUnit?: string;
    private timezone?: string;
    private precipitationUnit?: string;
    private hourlyWeatherVariables: string[] = [];
    private dailyWeatherVariables: string[] = [];

    /**
     * onInit is called when the driver is initialized.
     */
    async onInit() {
        this.log('WeatherDriver has been initialized');
    }

    /**
     * This method is called when a pair session starts.
     * Params: session – Bi-directional socket for communication with the front-end
     */
    async onPair(session: any) {

        session.setHandler('showView', async (data: any) => {
            console.log(data);
        });

        //Handle Setup
        session.setHandler("setup", async (data: {
            location: Location
            tempUnit: string
            windSpeedUnit: string
            timezone: string
            precipitationUnit: string
        }) => {
            if (data == undefined) return false;
            this.log(data);
            this.location = data.location;
            this.tempUnit = data.tempUnit;
            this.windSpeedUnit = data.windSpeedUnit;
            this.timezone = data.timezone;
            this.precipitationUnit = data.precipitationUnit;
            return true;
        });

        session.setHandler("hourlyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            this.log(data);
            this.hourlyWeatherVariables = data;
            return true;
        });

        session.setHandler("dailyWeatherVariables", async (data: string[]) => {
            if (data == undefined) return false;
            this.log(data);
            this.dailyWeatherVariables = data;
            return true;
        });

        //Get devices
        session.setHandler("list_devices", async () => {
            return [
                {
                    name: this.location?.name,
                    // The data object is required and should be unique for the device.
                    // So a device's MAC address would be good, but an IP address would
                    // be bad since it can change over time.
                    data: {
                        id: crypto.randomUUID()
                    },
                    // Optional: sets the devices initial settings, this allows users to change
                    // them after pairing in the device settings screen.
                    settings: {
                        location: this.location?.name,
                        latitude: this.location?.latitude,
                        longitude: this.location?.longitude,
                    }
                },
            ];
        });
    }

}

module.exports = WeatherDriver;
