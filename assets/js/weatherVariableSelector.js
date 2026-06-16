(function () {
    "use strict";

    const categoryOrder = [
        "temperature",
        "precipitation",
        "wind",
        "conditions",
        "pressureClouds",
        "soil",
        "solar",
        "atmosphere",
        "indices",
        "gases",
        "particles",
        "pollen",
        "other"
    ];

    function translate(key, fallback) {
        const value = Homey.__(key);
        return value && value !== key ? value : fallback;
    }

    function getOptions() {
        return new Promise(function (resolve, reject) {
            Homey.getOptions(function (error, options) {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(options);
            });
        });
    }

    function loadJson(url) {
        return new Promise(function (resolve, reject) {
            const request = new XMLHttpRequest();
            request.open("GET", url, true);
            request.onload = function () {
                if ((request.status >= 200 && request.status < 300) || request.status === 0) {
                    try {
                        resolve(JSON.parse(request.responseText));
                    } catch (error) {
                        reject(error);
                    }
                    return;
                }
                reject(new Error("Failed to load weather variables: HTTP " + request.status));
            };
            request.onerror = function () {
                reject(new Error("Failed to load weather variables"));
            };
            request.send();
        });
    }

    function localizeOption(value) {
        if (typeof value === "string") {
            return translate(value, value);
        }
        if (!value || typeof value !== "object") {
            return "";
        }
        const language = translate("language", "en");
        return value[language] || value.en || Object.values(value)[0] || "";
    }

    function getCategory(value, viewId) {
        const normalized = value.toLowerCase();

        if (viewId === "hourlyAirQualityValues") {
            if (normalized.includes("_aqi") || normalized.startsWith("european_aqi") || normalized.startsWith("us_aqi")) {
                return "indices";
            }
            if (normalized.endsWith("_pollen")) {
                return "pollen";
            }
            if (normalized.includes("uv_index")) {
                return "solar";
            }
            if (
                normalized.startsWith("pm") ||
                normalized.includes("dust") ||
                normalized.includes("aerosol") ||
                normalized.includes("elementary_carbon") ||
                normalized.includes("organic_matter")
            ) {
                return "particles";
            }
            return "gases";
        }

        if (normalized.startsWith("alarm_") || normalized.includes("weathercode") || normalized.includes("weathercondition")) {
            return "conditions";
        }
        if (
            normalized.includes("temperature") ||
            normalized.includes("humidity") ||
            normalized.includes("dewpoint") ||
            normalized.includes("wet_bulb")
        ) {
            return "temperature";
        }
        if (
            normalized.includes("precipitation") ||
            normalized.includes("rain") ||
            normalized.includes("showers") ||
            normalized.includes("snow") ||
            normalized.includes("freezing")
        ) {
            return "precipitation";
        }
        if (normalized.includes("wind")) {
            return "wind";
        }
        if (normalized.includes("pressure") || normalized.includes("cloud") || normalized.includes("visibility")) {
            return "pressureClouds";
        }
        if (normalized.startsWith("soil_")) {
            return "soil";
        }
        if (
            normalized.includes("sun") ||
            normalized.includes("daylight") ||
            normalized.includes("is_day") ||
            normalized.includes("uv_index") ||
            normalized.includes("radiation") ||
            normalized.includes("irradiance")
        ) {
            return "solar";
        }
        if (
            normalized.includes("evapotranspiration") ||
            normalized.includes("vapour_pressure") ||
            normalized.includes("vapor_pressure") ||
            normalized.includes("cape") ||
            normalized.includes("lifted_index") ||
            normalized.includes("convective") ||
            normalized.includes("boundary_layer")
        ) {
            return "atmosphere";
        }
        return "other";
    }

    function createCheckbox(entry, checked) {
        const label = document.createElement("label");
        label.className = "homey-form-checkbox weather-variable-option";

        const input = document.createElement("input");
        input.className = "homey-form-checkbox-input";
        input.type = "checkbox";
        input.name = entry.value;
        input.value = entry.value;
        input.checked = checked;

        const checkmark = document.createElement("span");
        checkmark.className = "homey-form-checkbox-checkmark";

        const text = document.createElement("span");
        text.className = "homey-form-checkbox-text";
        text.textContent = translate(entry.i18n, entry.i18n);

        label.dataset.search = (text.textContent + " " + entry.value).toLowerCase();
        label.appendChild(input);
        label.appendChild(checkmark);
        label.appendChild(text);
        return label;
    }

    async function init(config) {
        const options = await getOptions();
        const viewId = options && options.id;
        if (!viewId) {
            Homey.alert("Failed to get Pair View ID!");
            return;
        }

        const view = document.querySelector('[data-id="' + viewId + '"]') ||
            document.querySelector('[data-template-id="weatherVariables"]');
        if (!view || view.dataset.weatherVariableReady === "true") {
            return;
        }
        view.dataset.weatherVariableReady = "true";

        const form = view.querySelector("#setup-form");
        const list = view.querySelector("#checkbox-form");
        const search = view.querySelector("#variable-search");
        const summary = view.querySelector("#selection-summary");
        const noResults = view.querySelector("#variable-no-results");
        const selectVisible = view.querySelector("#select-visible");
        const clearVisible = view.querySelector("#clear-visible");
        form.querySelector("#setup-title").textContent = localizeOption(options.title);
        search.placeholder = translate("pair.weatherVariablesUi.search", "Search variables");
        search.setAttribute("aria-label", search.placeholder);
        selectVisible.textContent = translate("pair.weatherVariablesUi.selectVisible", "Select visible");
        clearVisible.textContent = translate("pair.weatherVariablesUi.clearVisible", "Clear visible");
        noResults.textContent = translate("pair.weatherVariablesUi.noResults", "No matching variables");

        let selection = null;
        if (config.repair) {
            selection = await Homey.emit("getData", {view: viewId});
        }

        const entries = await loadJson(options.json);
        const selectedValues = new Set(selection && Array.isArray(selection.data) ? selection.data : []);
        const capabilities = new Set(selection && Array.isArray(selection.capabilities) ? selection.capabilities : []);
        const hasStoredSelection = Boolean(selection && selection.hasStoredSelection);
        const groups = new Map();

        entries.forEach(function (entry) {
            const category = entry.category || getCategory(entry.value, viewId);
            if (!groups.has(category)) {
                groups.set(category, []);
            }
            groups.get(category).push(entry);
        });

        categoryOrder.forEach(function (category) {
            const groupEntries = groups.get(category);
            if (!groupEntries || groupEntries.length === 0) {
                return;
            }

            const section = document.createElement("section");
            section.className = "weather-variable-category";

            const heading = document.createElement("h2");
            heading.className = "weather-variable-category-title";
            heading.textContent = translate(
                "pair.weatherVariablesUi.categories." + category,
                category
            );

            const items = document.createElement("div");
            items.className = "weather-variable-items";

            groupEntries.forEach(function (entry) {
                let checked = Boolean(entry.default);
                if (config.repair) {
                    checked = hasStoredSelection
                        ? selectedValues.has(entry.value)
                        : capabilities.has(entry.capability);
                }
                items.appendChild(createCheckbox(entry, checked));
            });

            section.appendChild(heading);
            section.appendChild(items);
            list.appendChild(section);
        });

        const labels = Array.from(list.querySelectorAll(".weather-variable-option"));

        function updateSummary() {
            const selected = labels.filter(function (label) {
                return label.querySelector("input").checked;
            }).length;
            const visible = labels.filter(function (label) {
                return !label.hidden;
            }).length;
            summary.textContent =
                selected + " " + translate("pair.weatherVariablesUi.selected", "selected") +
                " · " + visible + " " + translate("pair.weatherVariablesUi.visible", "visible");
        }

        function filterVariables() {
            const query = search.value.trim().toLowerCase();
            let visible = 0;

            labels.forEach(function (label) {
                const matches = !query || label.dataset.search.includes(query);
                label.hidden = !matches;
                if (matches) {
                    visible += 1;
                }
            });

            Array.from(list.querySelectorAll(".weather-variable-category")).forEach(function (section) {
                section.hidden = !Array.from(section.querySelectorAll(".weather-variable-option")).some(function (label) {
                    return !label.hidden;
                });
            });

            noResults.hidden = visible !== 0;
            updateSummary();
        }

        function setVisibleSelection(checked) {
            labels.forEach(function (label) {
                if (!label.hidden) {
                    label.querySelector("input").checked = checked;
                }
            });
            updateSummary();
        }

        search.addEventListener("input", filterVariables);
        selectVisible.addEventListener("click", function () {
            setVisibleSelection(true);
        });
        clearVisible.addEventListener("click", function () {
            setVisibleSelection(false);
        });
        list.addEventListener("change", updateSummary);
        updateSummary();

        let working = false;
        form.addEventListener("submit", function (event) {
            event.preventDefault();
            if (working) {
                return;
            }
            working = true;
            Homey.showLoadingOverlay(Homey.__("pair.setup.loading"));

            const data = labels
                .filter(function (label) {
                    return label.querySelector("input").checked;
                })
                .map(function (label) {
                    return label.querySelector("input").value;
                });

            Homey.emit(viewId, data, function (error, valid) {
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

    window.OpenMeteoWeatherVariables = {init: init};
})();
