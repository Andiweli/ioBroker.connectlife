"use strict";

const legacyClientModule = require("./lib/connectlife-client");
const { ConnectLifeClient } = require("./lib/connectlife-client-v011");

legacyClientModule.ConnectLifeClient = ConnectLifeClient;

const startAdapter = require("./main");

if (require.main !== module) {
    module.exports = startAdapter;
} else {
    startAdapter();
}
