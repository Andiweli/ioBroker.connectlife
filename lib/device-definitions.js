"use strict";

const REFRIGERATOR_TYPE_CODE = "026";

const onOff = value => Number(value) !== 0;

const CLIMATE_DEFINITIONS = {
    t_power: {
        id: "power",
        name: "Power",
        type: "boolean",
        role: "switch.power",
        toState: onOff,
    },
    t_temp: {
        id: "targetTemperature",
        name: "Target temperature",
        type: "number",
        role: "level.temperature",
        unit: "°C",
        min: 10,
        max: 35,
        toState: Number,
    },
    t_work_mode: {
        id: "mode",
        name: "Operating mode",
        type: "number",
        role: "level.mode.airconditioner",
        states: {
            0: "fan",
            1: "heat",
            2: "cool",
            3: "dry",
            4: "auto",
        },
        toState: Number,
    },
    t_fan_speed: {
        id: "fanSpeed",
        name: "Fan speed",
        type: "number",
        role: "level.mode.fan",
        states: {
            0: "auto",
            5: "super low",
            6: "low",
            7: "medium",
            8: "high",
            9: "super high",
        },
        toState: Number,
    },
    t_fan_mute: {
        id: "silent",
        name: "Silent mode",
        type: "boolean",
        role: "switch.mode.silent",
        toState: onOff,
    },
    t_super: {
        id: "turbo",
        name: "Turbo mode",
        type: "boolean",
        role: "switch.mode.boost",
        toState: onOff,
    },
    t_eco: {
        id: "eco",
        name: "Eco mode",
        type: "boolean",
        role: "switch.mode.eco",
        toState: onOff,
    },
    t_swing_direction: {
        id: "horizontalSwing",
        name: "Horizontal swing",
        type: "number",
        role: "level.mode.swing",
        states: {
            0: "straight",
            1: "right",
            2: "both sides",
            3: "swing",
            4: "left",
        },
        toState: Number,
    },
    t_swing_angle: {
        id: "verticalSwing",
        name: "Vertical swing",
        type: "number",
        role: "level.mode.swing",
        toState: Number,
    },
};

// Mapping based on the Home Assistant ConnectLife data dictionary for device type 026
// (https://github.com/oyvindwe/connectlife-ha). `writeProperty` is the command property the cloud
// expects for writes, `existsProperty` hides a state when the appliance reports the feature as absent,
// and `minProperty`/`maxProperty` read the appliance's own limits, falling back to `min`/`max`.
// Definitions with `writable: false` are created below `status` instead of `controls`.
const REFRIGERATOR_DEFINITIONS = {
    refrigerator_temperature: {
        id: "fridgeTargetTemperature",
        name: "Fridge target temperature",
        type: "number",
        role: "level.temperature",
        unit: "°C",
        min: 0,
        max: 8,
        minProperty: "refrigerator_min_temperature",
        maxProperty: "refrigerator_max_temperature",
        writeProperty: "SET_REFRIGERATOR_TEMPERATURE",
        existsProperty: "refr_room",
        toState: Number,
    },
    freeze_temperature: {
        id: "freezerTargetTemperature",
        name: "Freezer target temperature",
        type: "number",
        role: "level.temperature",
        unit: "°C",
        min: -30,
        max: -5,
        minProperty: "freeze_min_temperature",
        maxProperty: "freeze_max_temperature",
        writeProperty: "SET_FREEZE_TEMPERATURE",
        existsProperty: "free_room",
        toState: Number,
    },
    variation_temperature: {
        id: "variableZoneTargetTemperature",
        name: "Variable zone target temperature",
        type: "number",
        role: "level.temperature",
        unit: "°C",
        min: -20,
        max: 5,
        minProperty: "variation_min_temperature",
        maxProperty: "variation_max_temperature",
        writeProperty: "SET_VARIATION_TEMPERATURE",
        existsProperty: "vari_room",
        toState: Number,
    },
    sr_mode: {
        id: "superCool",
        name: "Super cool",
        type: "boolean",
        role: "switch.mode.boost",
        writeProperty: "SET_SR_MODE",
        existsProperty: "existing_sr_mode",
        toState: onOff,
    },
    sf_mode: {
        id: "superFreeze",
        name: "Super freeze",
        type: "boolean",
        role: "switch.mode.boost",
        writeProperty: "SET_SF_MODE",
        existsProperty: "existing_sf_mode",
        toState: onOff,
    },
    save_mode: {
        id: "eco",
        name: "Eco mode",
        type: "boolean",
        role: "switch.mode.eco",
        writeProperty: "SET_SAVE_MODE",
        existsProperty: "existing_save_mode",
        toState: onOff,
    },
    holiday_mode: {
        id: "holiday",
        name: "Holiday mode",
        type: "boolean",
        role: "switch.mode",
        existsProperty: "existing_holiday_mode",
        toState: onOff,
    },
    refrigerator_real_temperature: {
        id: "fridgeTemperature",
        name: "Fridge temperature",
        type: "number",
        role: "value.temperature",
        unit: "°C",
        writable: false,
        existsProperty: "refr_room",
        toState: Number,
    },
    freeze_real_temperature: {
        id: "freezerTemperature",
        name: "Freezer temperature",
        type: "number",
        role: "value.temperature",
        unit: "°C",
        writable: false,
        existsProperty: "free_room",
        toState: Number,
    },
    variation_real_temperature: {
        id: "variableZoneTemperature",
        name: "Variable zone temperature",
        type: "number",
        role: "value.temperature",
        unit: "°C",
        writable: false,
        existsProperty: "vari_room",
        toState: Number,
    },
    environment_real_temperature: {
        id: "ambientTemperature",
        name: "Ambient temperature",
        type: "number",
        role: "value.temperature",
        unit: "°C",
        writable: false,
        toState: Number,
    },
    environment_humidity: {
        id: "ambientHumidity",
        name: "Ambient humidity",
        type: "number",
        role: "value.humidity",
        unit: "%",
        writable: false,
        toState: Number,
    },
    open_refrigerator_door_alarm: {
        id: "fridgeDoorAlarm",
        name: "Fridge door open alarm",
        type: "boolean",
        role: "indicator.alarm",
        writable: false,
        existsProperty: "refr_room",
        toState: onOff,
    },
    open_freeze_door_alarm: {
        id: "freezerDoorAlarm",
        name: "Freezer door open alarm",
        type: "boolean",
        role: "indicator.alarm",
        writable: false,
        existsProperty: "free_room",
        toState: onOff,
    },
    open_variation_door_alarm: {
        id: "variableZoneDoorAlarm",
        name: "Variable zone door open alarm",
        type: "boolean",
        role: "indicator.alarm",
        writable: false,
        existsProperty: "vari_room",
        toState: onOff,
    },
    refr_room_over_temp_alarm: {
        id: "fridgeOverTemperatureAlarm",
        name: "Fridge over-temperature alarm",
        type: "boolean",
        role: "indicator.alarm",
        writable: false,
        existsProperty: "refr_room",
        toState: onOff,
    },
    free_room_over_temp_alarm_failure: {
        id: "freezerOverTemperatureAlarm",
        name: "Freezer over-temperature alarm",
        type: "boolean",
        role: "indicator.alarm",
        writable: false,
        existsProperty: "free_room",
        toState: onOff,
    },
    var_room_over_temp_alarm: {
        id: "variableZoneOverTemperatureAlarm",
        name: "Variable zone over-temperature alarm",
        type: "boolean",
        role: "indicator.alarm",
        writable: false,
        existsProperty: "vari_room",
        toState: onOff,
    },
};

function readLimit(status, property, fallback) {
    if (property && property in status && !Number.isNaN(Number(status[property]))) {
        return Number(status[property]);
    }
    return fallback;
}

/**
 * Returns the friendly states to create for a device's statusList.
 *
 * @param {string|number} deviceTypeCode ConnectLife device type code
 * @param {Record<string, string|number>} status statusList reported by the cloud
 */
function getFriendlyStates(deviceTypeCode, status) {
    const definitions =
        String(deviceTypeCode) === REFRIGERATOR_TYPE_CODE ? REFRIGERATOR_DEFINITIONS : CLIMATE_DEFINITIONS;
    const states = [];

    for (const [apiProperty, definition] of Object.entries(definitions)) {
        if (!(apiProperty in status)) {
            continue;
        }
        if (definition.existsProperty && Number(status[definition.existsProperty]) === 0) {
            continue;
        }

        states.push({
            apiProperty,
            definition,
            min: readLimit(status, definition.minProperty, definition.min),
            max: readLimit(status, definition.maxProperty, definition.max),
            value: definition.toState(status[apiProperty]),
        });
    }

    return states;
}

module.exports = { getFriendlyStates };
