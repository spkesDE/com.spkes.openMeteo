(function () {
    "use strict";

    function translate(key, fallback) {
        const value = Homey.__(key);
        return value && value !== key ? value : fallback;
    }

    function createCountryFlag(location, small) {
        const code = String(location.country_code || "").toLowerCase();
        if (!/^[a-z]{2}$/.test(code)) {
            return null;
        }

        const flag = document.createElement("img");
        flag.className = "country-flag" + (small ? " country-flag-small" : "");
        flag.src = "https://hatscripts.github.io/circle-flags/flags/" + code + ".svg";
        flag.alt = location.country || code.toUpperCase();
        flag.title = location.country || code.toUpperCase();
        return flag;
    }

    function locationDescription(location) {
        const admin = location.admin1 || location.admin2 || location.admin3;
        return [admin, location.country].filter(Boolean).join(" - ");
    }

    async function init(config) {
        const configuredRoot = config && config.root;
        let form = configuredRoot && configuredRoot.matches &&
            configuredRoot.matches("form.location-setup-form")
            ? configuredRoot
            : configuredRoot && configuredRoot.querySelector
                ? configuredRoot.querySelector("form.location-setup-form")
                : null;

        if (!form) {
            form = document.querySelector(
                '.hy-view.visible form.location-setup-form, form.location-setup-form'
            );
        }

        if (!form) {
            throw new Error("Location setup view is missing its form");
        }

        const view = form.closest(".hy-view") || configuredRoot;
        if (view && view.dataset.locationSetupReady === "true") {
            return;
        }

        const input = form.querySelector("#location");
        const nextButton = form.querySelector("#setup-next");
        const selectedResult = form.querySelector("#selectedResult");
        const selectedResultItem = form.querySelector("#selectedResultItem");
        const timezone = form.querySelector("#select-timezone");
        const forecast = form.querySelector("#select-forecast");
        const unitSystem = form.querySelector("#select-unit-system");
        if (!input || !nextButton || !selectedResult || !selectedResultItem || !timezone || !forecast || !unitSystem) {
            throw new Error("Location setup view is missing required elements");
        }
        if (view) {
            view.dataset.locationSetupReady = "true";
        }
        const requiredMessage = translate(
            "pair.setup.location.required",
            "Please select a location from the search results"
        );
        let locationObject;
        let working = false;
        let unitSystemTouched = false;

        Homey.setTitle(null);
        input.placeholder = translate("pair.setup.location.placeholder", "Hamburg");
        unitSystem.addEventListener("change", function () {
            unitSystemTouched = true;
        });

        if (config.repair) {
            Homey.showLoadingOverlay(Homey.__("pair.setup.loading"));
            try {
                const result = await Homey.emit("getData", {view: "setup"});
                locationObject = result && result.location;
                if (result && result.timezone) {
                    timezone.value = result.timezone;
                }
                if (result && result.forecast !== undefined) {
                    forecast.value = result.forecast;
                }
                if (result && result.unitSystem) {
                    unitSystem.value = result.unitSystem;
                }
            } finally {
                Homey.hideLoadingOverlay();
            }
        }

        function renderSelection() {
            selectedResultItem.textContent = "";
            if (!locationObject) {
                selectedResult.classList.add("hidden");
                input.classList.remove("complete");
                input.setCustomValidity(requiredMessage);
                nextButton.disabled = true;
                return;
            }

            const flag = createCountryFlag(locationObject, false);

            const selectedText = document.createElement("div");
            selectedText.className = "selectedText";

            const name = document.createElement("div");
            name.className = "selected-location-name";
            name.textContent = locationObject.name;

            const description = document.createElement("div");
            description.className = "description";
            description.textContent = locationDescription(locationObject);

            selectedText.appendChild(name);
            selectedText.appendChild(description);
            if (flag) {
                selectedResultItem.appendChild(flag);
            }
            selectedResultItem.appendChild(selectedText);
            selectedResult.classList.remove("hidden");
            input.classList.add("complete");
            input.setCustomValidity("");
            nextButton.disabled = false;
        }

        const autoCompleteJS = new autoComplete({
            selector: function () {
                return input;
            },
            placeHolder: input.placeholder,
            data: {
                src: async function (query) {
                    try {
                        const parameters = new URLSearchParams({
                            name: query,
                            language: translate("language", "en"),
                            count: "10",
                            format: "json"
                        });
                        const response = await fetch(
                            "https://geocoding-api.open-meteo.com/v1/search?" + parameters.toString()
                        );
                        if (!response.ok) {
                            return [];
                        }
                        const data = await response.json();
                        return data.results || [];
                    } catch (error) {
                        return [];
                    }
                },
                keys: ["name"]
            },
            resultsList: {
                element: function (list, data) {
                    if (data.results.length === 0) {
                        const message = document.createElement("div");
                        message.className = "noResult";
                        message.textContent = translate(
                            "pair.setup.location.noResults",
                            'Found no results for "%s"'
                        ).replace("%s", data.query);
                        list.prepend(message);
                    }
                },
                noResults: true,
                maxResults: 10
            },
            resultItem: {
                element: function (item, data) {
                    item.textContent = "";

                    const flag = createCountryFlag(data.value, true);

                    const text = document.createElement("div");
                    text.className = "location-result-text";

                    const name = document.createElement("div");
                    name.className = "location-result-name";
                    name.textContent = data.value.name;

                    const description = document.createElement("div");
                    description.className = "description";
                    description.textContent = locationDescription(data.value);

                    text.appendChild(name);
                    text.appendChild(description);
                    if (flag) {
                        item.appendChild(flag);
                    }
                    item.appendChild(text);
                    item.addEventListener("pointerdown", function () {
                        selectLocation(data.value);
                    });
                },
                highlight: false
            }
        });

        if (locationObject) {
            autoCompleteJS.input.value = locationObject.name;
        }
        renderSelection();

        function selectLocation(location) {
            if (!location) {
                return;
            }
            locationObject = location;
            autoCompleteJS.input.value = locationObject.name;
            if (!config.repair && !unitSystemTouched) {
                unitSystem.value = String(locationObject.country_code || "").toUpperCase() === "US"
                    ? "imperial"
                    : "metric";
            }
            renderSelection();
        }

        autoCompleteJS.input.addEventListener("input", function () {
            if (locationObject && autoCompleteJS.input.value === locationObject.name) {
                return;
            }
            locationObject = undefined;
            renderSelection();
        });

        autoCompleteJS.input.addEventListener("selection", function (event) {
            const feedback = event.detail;
            selectLocation(feedback && feedback.selection && feedback.selection.value);
        });

        form.addEventListener("submit", function (event) {
            event.preventDefault();
            if (!locationObject) {
                input.setCustomValidity(requiredMessage);
                input.reportValidity();
                return;
            }
            if (working) {
                return;
            }

            working = true;
            Homey.showLoadingOverlay(Homey.__("pair.setup.loading"));
            Homey.emit("setup", {
                location: locationObject,
                timezone: timezone.value,
                unitSystem: unitSystem.value,
                forecast: forecast.value
            }, function (error, valid) {
                if (error) {
                    Homey.error(error);
                } else if (!valid) {
                    Homey.error(Homey.__("pair.setup.failed"));
                } else {
                    Homey.nextView();
                }
                working = false;
                Homey.hideLoadingOverlay();
            });
        });
    }

    window.OpenMeteoLocationSetup = {init: init};
})();
