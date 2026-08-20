(function () {
    "use strict";

    function translate(key, fallback) {
        const value = Homey.__(key);
        return value && value !== key ? value : fallback;
    }

    function clamp(value, min, max, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
    }

    function formatNumber(value) {
        try {
            return new Intl.NumberFormat(typeof Homey.getLanguage === "function" ? Homey.getLanguage() : undefined).format(value);
        } catch (error) {
            return String(value);
        }
    }

    async function init(config) {
        const form = document.querySelector(".hy-view.visible form.forecast-model-form, form.forecast-model-form");
        if (!form || form.dataset.ready === "true") return;
        form.dataset.ready = "true";

        const modes = Array.from(form.querySelectorAll('input[name="forecast-mode"], input[name="forecast-model-mode"]'));
        const modeControl = form.querySelector("#forecast-mode-control, #forecast-model-mode-control");
        const relativeFields = form.querySelector("#forecast-relative-hours-fields, #forecast-model-relative-fields");
        const dayHourFields = form.querySelector("#forecast-day-hour-fields, #forecast-model-day-hour-fields");
        const hours = form.querySelector("#forecast-hours-range, #forecast-model-hours");
        const hoursInput = form.querySelector("#forecast-hours, #forecast-model-hours-input");
        const hoursValue = form.querySelector("#forecast-hours-value, #forecast-model-hours-value");
        const day = form.querySelector("#select-forecast, #forecast-model-day");
        const hour = form.querySelector("#forecast-hour, #forecast-model-hour");
        const relativePreview = form.querySelector("#forecast-relative-preview");
        const fixedPreview = form.querySelector("#forecast-fixed-preview");
        const model = form.querySelector("#forecast-weather-model");
        const filterSummary = form.querySelector("#forecast-weather-model-filter-summary");
        const description = form.querySelector("#forecast-weather-model-description");
        const run = form.querySelector("#forecast-weather-model-run");
        const update = form.querySelector("#forecast-weather-model-update");
        const horizon = form.querySelector("#forecast-weather-model-horizon");
        if (!modeControl || modes.length !== 2 || !relativeFields || !dayHourFields || !hours || !hoursInput ||
            !hoursValue || !day || !hour || !model || !description || !run || !update) {
            throw new Error("Forecast and model setup view is missing required elements");
        }

        if (day.options.length === 0) {
            for (let index = 0; index <= 15; index += 1) {
                const option = document.createElement("option");
                option.value = String(index);
                option.textContent = index === 0
                    ? translate("pair.setup.forecast.today", "Current day")
                    : index === 1
                        ? translate("pair.setup.forecast.1day", "Tomorrow")
                        : translate("pair.setup.forecast." + index + "day", "In " + index + " days");
                day.appendChild(option);
            }
        }
        if (hour.options.length === 0) {
            for (let index = 0; index < 24; index += 1) {
                const option = document.createElement("option");
                option.value = String(index);
                option.textContent = String(index).padStart(2, "0") + ":00";
                hour.appendChild(option);
            }
        }

        const fallbackInfo = {value: "best_match", i18nKey: "best_match", provider: "Open-Meteo", label: "Best Match (recommended)", description: "Automatically combines the best available models for this location.", runFrequency: "Depends on the local model", updateInterval: "Depends on the local model", forecastLengthDays: 16};
        const modelAliases = {ecmwf_ifs04: "ecmwf_ifs", gfs_seamless: "ncep_gfs_seamless", gfs_global: "ncep_gfs_global"};
        const timingKeys = {
            "Depends on the local model": "pair.setup.weatherModel.timingValues.dependsLocal",
            "Depends on the component model": "pair.setup.weatherModel.timingValues.dependsComponent",
            "Hourly": "pair.setup.weatherModel.timingValues.hourly",
            "Every 3 hours": "pair.setup.weatherModel.timingValues.every3Hours",
            "Every 6 hours": "pair.setup.weatherModel.timingValues.every6Hours",
            "Every 12 hours": "pair.setup.weatherModel.timingValues.every12Hours",
            "00, 06, 12 and 18 UTC": "pair.setup.weatherModel.timingValues.runs0018Utc"
        };
        let modelInfo = {best_match: fallbackInfo};

        function localizeTiming(value) {
            return timingKeys[value] ? translate(timingKeys[value], value) : value;
        }

        function populateModels(models, selectedValue) {
            const available = Array.isArray(models) && models.length ? models : [fallbackInfo];
            modelInfo = {};
            model.replaceChildren();
            const groups = new Map();
            available.forEach(function (info) {
                modelInfo[info.value] = info;
                let group = groups.get(info.provider);
                if (!group) {
                    group = document.createElement("optgroup");
                    group.label = info.provider;
                    groups.set(info.provider, group);
                    model.appendChild(group);
                }
                const option = document.createElement("option");
                option.value = info.value;
                option.textContent = translate("pair.setup.weatherModel.options." + info.i18nKey, info.label);
                option.dataset.descriptionI18n = "pair.setup.weatherModel.descriptions." + info.i18nKey;
                group.appendChild(option);
            });
            const normalized = modelAliases[selectedValue] || selectedValue;
            model.value = modelInfo[normalized] ? normalized : "best_match";
        }

        function selectedMode() {
            const selected = modes.find((element) => element.checked);
            return selected ? selected.value : "relative_hours";
        }

        function render() {
            const info = modelInfo[model.value] || modelInfo.best_match || fallbackInfo;
            const maxDay = Math.max(0, Math.floor(info.forecastLengthDays) - 1);
            const maxHours = Math.max(0, Math.floor((info.forecastLengthDays - 1) * 24));
            hours.max = String(maxHours);
            hoursInput.max = String(maxHours);
            hours.value = String(clamp(hours.value, 0, maxHours, 0));
            hoursInput.value = hours.value;
            Array.from(day.options).forEach(function (option) {
                const unavailable = Number(option.value) > maxDay;
                option.disabled = unavailable;
                option.hidden = unavailable;
            });
            day.value = String(clamp(day.value, 0, maxDay, 0));

            const relative = selectedMode() === "relative_hours";
            modeControl.dataset.mode = relative ? "relative_hours" : "day_hour";
            relativeFields.classList.toggle("hidden", !relative);
            dayHourFields.classList.toggle("hidden", relative);
            hoursValue.value = clamp(hours.value, 0, maxHours, 0) + " h";
            hoursInput.disabled = !relative;
            hours.disabled = !relative;
            day.disabled = relative;
            hour.disabled = relative;
            if (relativePreview) {
                const value = clamp(hours.value, 0, maxHours, 0);
                relativePreview.textContent = value === 0 ? translate("pair.setup.forecast.preview.today", "Today") : "+" + value + " h";
            }
            if (fixedPreview && day.selectedIndex >= 0) {
                fixedPreview.textContent = day.options[day.selectedIndex].textContent + ", " + String(clamp(hour.value, 0, 23, 12)).padStart(2, "0") + ":00";
            }
            const option = model.options[model.selectedIndex];
            description.textContent = translate(option && option.dataset.descriptionI18n, info.description);
            run.textContent = localizeTiming(info.runFrequency);
            update.textContent = localizeTiming(info.updateInterval);
            if (horizon) {
                horizon.textContent = translate("pair.setup.weatherModel.horizonDays", "%days% days")
                    .replace("%days%", formatNumber(info.forecastLengthDays));
            }
        }

        modes.forEach((element) => element.addEventListener("change", render));
        hours.addEventListener("input", function () { hoursInput.value = hours.value; render(); });
        hoursInput.addEventListener("input", function () {
            const info = modelInfo[model.value] || fallbackInfo;
            const maxHours = Math.max(0, Math.floor((info.forecastLengthDays - 1) * 24));
            hours.value = String(clamp(hoursInput.value, 0, maxHours, 0));
            render();
        });
        model.addEventListener("change", render);
        day.addEventListener("change", render);
        hour.addEventListener("change", render);

        Homey.showLoadingOverlay(translate("pair.setup.loading", "Loading"));
        try {
            const data = await Homey.emit("getData", {view: "forecastAndModel"});
            populateModels(data && data.weatherModels, data && data.weatherModel);
            if (data) {
                const selected = modes.find((element) => element.value === data.forecastMode);
                if (selected) selected.checked = true;
                hours.value = String(clamp(data.forecastHours, 0, 360, 0));
                hoursInput.value = hours.value;
                day.value = String(clamp(data.forecast, 0, 15, 0));
                hour.value = String(clamp(data.forecastHour, 0, 23, 12));
                if (filterSummary && data.location) {
                    filterSummary.textContent = translate("pair.setup.weatherModel.filteredForLocation", "%count% models for %location%")
                        .replace("%count%", String((data.weatherModels || []).length))
                        .replace("%location%", data.location.name || "");
                }
            }
        } catch (error) {
            populateModels([fallbackInfo], "best_match");
            Homey.error(error);
        } finally {
            Homey.hideLoadingOverlay();
        }
        render();

        form.addEventListener("submit", function (event) {
            event.preventDefault();
            Homey.emit("forecastAndModel", {
                forecastMode: selectedMode(), forecastHours: hours.value, forecast: day.value,
                forecastHour: hour.value, weatherModel: model.value
            }, function (error) {
                if (error) return Homey.error(error);
                Homey.nextView();
            });
        });
    }

    window.OpenMeteoForecastModelSetup = {init: init};
})();
