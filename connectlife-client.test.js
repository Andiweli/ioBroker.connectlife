const assert = require("node:assert/strict");
const { ConnectLifeClient } = require("./lib/connectlife-client-v011");

const silentLog = {
    debug() {},
    info() {},
    warn() {},
    error() {},
};

describe("ConnectLifeClient request metadata", () => {
    it("creates a unique 32-character randStr for every request", () => {
        const client = new ConnectLifeClient({ login: "test", password: "test", log: silentLog });
        const first = client.getCommonRequestData();
        const second = client.getCommonRequestData();

        assert.match(first.randStr, /^[a-f0-9]{32}$/);
        assert.match(second.randStr, /^[a-f0-9]{32}$/);
        assert.notEqual(first.randStr, second.randStr);
        assert.ok(Number(second.timeStamp) > Number(first.timeStamp));
    });

    it("recognizes Gigya rate-limit responses", () => {
        const client = new ConnectLifeClient({ login: "test", password: "test", log: silentLog });

        assert.equal(client.isRateLimitError(new Error("Api rate limit exceeded")), true);
        assert.equal(client.isRateLimitError(new Error("Gigya error 403048")), true);
        assert.equal(client.isRateLimitError(new Error("Invalid password")), false);
    });

    it("captures OAuth refresh-token metadata", () => {
        const client = new ConnectLifeClient({ login: "test", password: "test", log: silentLog });
        const refreshExpiry = Date.now() + 24 * 60 * 60 * 1000;

        client.oauthTokenUrl = "https://example.invalid/oauth/token";
        client.oauthClientData = {
            client_id: "client",
            client_secret: "secret",
            redirect_uri: "https://example.invalid/redirect",
        };
        client.captureTokenResponse({
            access_token: "access",
            expires_in: 3600,
            refresh_token: "refresh",
            refreshTokenExpiredTime: refreshExpiry,
        });

        assert.equal(client.refreshToken, "refresh");
        assert.equal(client.refreshTokenValidUntil, refreshExpiry);
        assert.equal(client.canRefreshAccessToken(), true);
        assert.ok(client.accessTokenHardValidUntil > Date.now());
    });

    it("keeps using an access token that is still valid during login backoff", () => {
        const client = new ConnectLifeClient({ login: "test", password: "test", log: silentLog });
        client.accessToken = "access";
        client.accessTokenHardValidUntil = Date.now() + 10 * 60 * 1000;

        const result = client.handleRateLimit(new Error("Api rate limit exceeded"));

        assert.equal(result, "access");
        assert.ok(client.loginBlockedUntil > Date.now());
        assert.ok(client.tokenValidUntil > Date.now());
    });
});
