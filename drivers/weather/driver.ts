import Homey from 'homey';
import * as crypto from "crypto";

class WeatherDriver extends Homey.Driver {
        private location: any;

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

        //Skip login if there is valid session
        session.setHandler('showView', async (data: any) => {
            if (data === 'setup') {}
        });

        //Handle Login
        session.setHandler("setup", async (data: any) => {
            //TODO:
            //Validation
            //AutoComplete using search.json?key=${key}&q=Lübeck
            //  Returns Location[]
            //Translate How To
            //Translate Next Button
            this.location = data;
            return true;
        });

        //Get devices
        session.setHandler("list_devices", async () => {
            return [
                {
                    name: this.location.name,
                    // The data object is required and should be unique for the device.
                    // So a device's MAC address would be good, but an IP address would
                    // be bad since it can change over time.
                    data: {
                        id: crypto.randomUUID()
                    },
                    // Optional: sets the devices initial settings, this allows users to change
                    // them after pairing in the device settings screen.
                    settings: {
                        location: this.location.name
                    }
                },
            ];
        });
    }

}

module.exports = WeatherDriver;
