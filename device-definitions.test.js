const assert = require("node:assert/strict");
const { getFriendlyStates } = require("./lib/device-definitions");
const refrigerator = require("./test/fixtures/refrigerator-026-1b0560z0336j.json");

function byId(states) {
    return Object.fromEntries(states.map(state => [state.definition.id, state]));
}

describe("Friendly device states", () => {
    it("keeps the air-conditioner mapping for non-refrigerator devices", () => {
        const states = byId(getFriendlyStates("009", { t_power: "1", t_temp: "22", sf_mode: "1" }));

        assert.deepEqual(Object.keys(states).sort(), ["power", "targetTemperature"]);
        assert.equal(states.power.value, true);
        assert.equal(states.targetTemperature.value, 22);
        assert.equal(states.targetTemperature.min, 10);
        assert.equal(states.targetTemperature.max, 35);
    });

    it("maps a refrigerator (type 026) status list", () => {
        const states = byId(getFriendlyStates(refrigerator.deviceTypeCode, refrigerator.statusList));

        assert.equal(states.fridgeTargetTemperature.value, 4);
        assert.equal(states.fridgeTargetTemperature.definition.writeProperty, "SET_REFRIGERATOR_TEMPERATURE");
        assert.equal(states.freezerTargetTemperature.value, -18);
        assert.equal(states.variableZoneTargetTemperature.value, -18);
        assert.equal(states.fridgeTemperature.value, 6);
        assert.equal(states.freezerTemperature.value, -21);
        assert.equal(states.ambientTemperature.value, 21);
        assert.equal(states.ambientHumidity.value, 50);
        assert.equal(states.superFreeze.value, false);
        assert.equal(states.fridgeDoorAlarm.value, false);
        assert.equal(states.fridgeTemperature.definition.writable, false);
        assert.equal(states.power, undefined);
    });

    it("uses the temperature limits reported by the refrigerator", () => {
        const states = byId(getFriendlyStates(refrigerator.deviceTypeCode, refrigerator.statusList));

        assert.deepEqual([states.fridgeTargetTemperature.min, states.fridgeTargetTemperature.max], [2, 9]);
        assert.deepEqual([states.freezerTargetTemperature.min, states.freezerTargetTemperature.max], [-24, -13]);
        assert.deepEqual(
            [states.variableZoneTargetTemperature.min, states.variableZoneTargetTemperature.max],
            [-20, 5],
        );
    });

    it("falls back to default limits when the refrigerator reports none", () => {
        const states = byId(getFriendlyStates("026", { refrigerator_temperature: "4" }));

        assert.deepEqual([states.fridgeTargetTemperature.min, states.fridgeTargetTemperature.max], [0, 8]);
    });

    it("skips features the refrigerator reports as absent", () => {
        const states = byId(getFriendlyStates(refrigerator.deviceTypeCode, refrigerator.statusList));

        assert.equal(refrigerator.statusList.existing_holiday_mode, "0");
        assert.equal(states.holiday, undefined);
        assert.ok(states.superCool);
        assert.ok(states.eco);
    });
});
