(function () {
    "use strict";

    function translate(key, fallback) {
        const value = Homey.__(key);
        return value && value !== key ? value : fallback;
    }

    function translateWithTokens(key, fallback, tokens) {
        let result = translate(key, fallback);
        Object.keys(tokens).forEach(function (token) {
            result = result.replace(new RegExp("%" + token + "%", "g"), String(tokens[token]));
        });
        return result;
    }

    function clampInteger(value, min, max, fallback) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }
        return Math.max(min, Math.min(max, Math.floor(parsed)));
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
        const forecastModeControl = form.querySelector("#forecast-mode-control");
        const forecastModes = Array.from(form.querySelectorAll('input[name="forecast-mode"]'));
        const forecast = form.querySelector("#select-forecast");
        const forecastHours = form.querySelector("#forecast-hours");
        const forecastHoursRange = form.querySelector("#forecast-hours-range");
        const forecastHoursValue = form.querySelector("#forecast-hours-value");
        const forecastHour = form.querySelector("#forecast-hour");
        const forecastRelativeHoursFields = form.querySelector("#forecast-relative-hours-fields");
        const forecastDayHourFields = form.querySelector("#forecast-day-hour-fields");
        const forecastRelativePreview = form.querySelector("#forecast-relative-preview");
        const forecastFixedPreview = form.querySelector("#forecast-fixed-preview");
        const unitSystem = form.querySelector("#select-unit-system");
        if (!input || !nextButton || !selectedResult || !selectedResultItem || !timezone ||
            !forecastModeControl || forecastModes.length !== 2 || !forecast || !forecastHours || !forecastHoursRange ||
            !forecastHoursValue || !forecastHour || !forecastRelativeHoursFields ||
            !forecastDayHourFields || !forecastRelativePreview || !forecastFixedPreview || !unitSystem) {
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

        for (let hour = 0; hour < 24; hour += 1) {
            const option = document.createElement("option");
            option.value = String(hour);
            option.textContent = String(hour).padStart(2, "0") + ":00";
            option.selected = hour === 12;
            forecastHour.appendChild(option);
        }

        function getForecastMode() {
            const selected = forecastModes.find(function (element) {
                return element.checked;
            });
            return selected ? selected.value : "relative_hours";
        }

        function setForecastMode(mode) {
            forecastModes.forEach(function (element) {
                element.checked = element.value === mode;
            });
        }

        function getPreviewTimeZone() {
            if (timezone.value && timezone.value !== "auto") {
                return timezone.value;
            }
            return locationObject && locationObject.timezone
                ? locationObject.timezone
                : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        }

        function getLocale() {
            return document.documentElement.lang || navigator.language || "en-US";
        }

        function getDateParts(timestamp, timeZone) {
            const parts = new Intl.DateTimeFormat("en-CA", {
                timeZone: timeZone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).formatToParts(new Date(timestamp));
            const getPart = function (type) {
                return Number(parts.find(function (part) {
                    return part.type === type;
                }).value);
            };
            return {
                year: getPart("year"),
                month: getPart("month"),
                day: getPart("day")
            };
        }

        function getRelativeDayLabel(dayOffset, date, timeZone) {
            if (dayOffset === 0) {
                return translate("pair.setup.forecast.preview.today", "Today");
            }
            if (dayOffset === 1) {
                return translate("pair.setup.forecast.preview.tomorrow", "Tomorrow");
            }
            return new Intl.DateTimeFormat(getLocale(), {
                timeZone: timeZone,
                weekday: "long",
                day: "numeric",
                month: "long"
            }).format(date);
        }

        function formatTime(date, timeZone, forceFullHour) {
            const formatter = new Intl.DateTimeFormat(getLocale(), {
                timeZone: timeZone,
                hour: "2-digit",
                minute: "2-digit"
            });
            if (!forceFullHour) {
                return formatter.format(date);
            }
            return formatter.formatToParts(date).map(function (part) {
                return part.type === "minute" ? "00" : part.value;
            }).join("");
        }

        function renderForecastPreviews() {
            const now = Date.now();
            const timeZone = getPreviewTimeZone();
            const hours = clampInteger(forecastHours.value, 0, 360, 0);
            const target = new Date(now + (hours * 60 * 60 * 1000));
            const todayParts = getDateParts(now, timeZone);
            const targetParts = getDateParts(target.getTime(), timeZone);
            const todayNumber = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day);
            const targetNumber = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day);
            const relativeDayOffset = Math.round((targetNumber - todayNumber) / (24 * 60 * 60 * 1000));
            const relativeDateLabel = getRelativeDayLabel(relativeDayOffset, target, timeZone);
            const relativeTime = formatTime(target, timeZone, hours > 0);
            forecastHoursValue.value = hours + " h";
            forecastRelativePreview.textContent = hours === 0
                ? translateWithTokens("pair.setup.forecast.preview.now", "Now (%time%)", {time: relativeTime})
                : translateWithTokens(
                    "pair.setup.forecast.preview.relative",
                    "%date%, %time% (+%hours% h)",
                    {date: relativeDateLabel, time: relativeTime, hours: hours}
                );

            const days = clampInteger(forecast.value, 0, 15, 0);
            const hour = clampInteger(forecastHour.value, 0, 23, 12);
            const fixedDate = new Date(Date.UTC(
                todayParts.year,
                todayParts.month - 1,
                todayParts.day + days,
                hour
            ));
            const fixedDateLabel = getRelativeDayLabel(days, fixedDate, "UTC");
            const fixedTime = formatTime(fixedDate, "UTC", false);
            forecastFixedPreview.textContent = translateWithTokens(
                "pair.setup.forecast.preview.fixed",
                "%date%, %time%",
                {date: fixedDateLabel, time: fixedTime}
            );
        }

        function updateForecastFields() {
            const mode = getForecastMode();
            const relativeHours = mode === "relative_hours";
            forecastModeControl.dataset.mode = mode;
            forecastRelativeHoursFields.classList.toggle("hidden", !relativeHours);
            forecastDayHourFields.classList.toggle("hidden", relativeHours);
            forecastHours.disabled = !relativeHours;
            forecastHoursRange.disabled = !relativeHours;
            forecast.disabled = relativeHours;
            forecastHour.disabled = relativeHours;
            renderForecastPreviews();
        }

        forecastModes.forEach(function (element) {
            element.addEventListener("change", updateForecastFields);
        });
        forecastHoursRange.addEventListener("input", function () {
            forecastHours.value = forecastHoursRange.value;
            renderForecastPreviews();
        });
        forecastHours.addEventListener("input", function () {
            if (forecastHours.value === "") return;
            forecastHoursRange.value = String(clampInteger(forecastHours.value, 0, 360, 0));
            renderForecastPreviews();
        });
        forecastHours.addEventListener("change", function () {
            const hours = clampInteger(forecastHours.value, 0, 360, 0);
            forecastHours.value = String(hours);
            forecastHoursRange.value = String(hours);
            renderForecastPreviews();
        });
        forecast.addEventListener("change", renderForecastPreviews);
        forecastHour.addEventListener("change", renderForecastPreviews);
        timezone.addEventListener("change", renderForecastPreviews);

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
                if (result && result.forecastMode) {
                    setForecastMode(result.forecastMode);
                }
                if (result && result.forecastHours !== undefined) {
                    forecastHours.value = result.forecastHours;
                    forecastHoursRange.value = result.forecastHours;
                }
                if (result && result.forecastHour !== undefined) {
                    forecastHour.value = result.forecastHour;
                }
                if (result && result.unitSystem) {
                    unitSystem.value = result.unitSystem;
                }
            } finally {
                Homey.hideLoadingOverlay();
            }
        }

        updateForecastFields();

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
            renderForecastPreviews();
        }

        autoCompleteJS.input.addEventListener("input", function () {
            if (locationObject && autoCompleteJS.input.value === locationObject.name) {
                return;
            }
            locationObject = undefined;
            renderSelection();
            renderForecastPreviews();
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
                forecastMode: getForecastMode(),
                forecast: forecast.value,
                forecastHours: forecastHours.value,
                forecastHour: forecastHour.value
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
