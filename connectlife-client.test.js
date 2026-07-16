const assert = require("node:assert/strict");
const { ConnectLifeClient } = require("./lib/connectlife-client-v011");

describe("ConnectLifeClient request metadata", () => {
    it("creates a unique 32-character randStr for every request", () => {
        const client = new ConnectLifeClient({ login: "test", password: "test" });
        const first = client.getCommonRequestData();
        const second = client.getCommonRequestData();

        assert.match(first.randStr, /^[a-f0-9]{32}$/);
        assert.match(second.randStr, /^[a-f0-9]{32}$/);
        assert.notEqual(first.randStr, second.randStr);
        assert.ok(Number(second.timeStamp) > Number(first.timeStamp));
    });
});
