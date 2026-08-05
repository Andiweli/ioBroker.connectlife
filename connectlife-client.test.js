const assert = require("node:assert/strict");
const { ConnectLifeClient } = require("./lib/connectlife-client-v011");

const silentLog = {
    debug() {},
    info() {},
    warn() {},
    error() {},
};

function createClient(options = {}) {
    return new ConnectLifeClient({
        login: "test",
        password: "test",
        log: silentLog,
        ...options,
    });
}

describe("ConnectLifeClient request metadata", () => {
    it("creates a unique 32-character randStr for every request", () => {
        const client = createClient();
        const first = client.getCommonRequestData();
        const second = client.getCommonRequestData();

        assert.match(first.randStr, /^[a-f0-9]{32}$/);
        assert.match(second.randStr, /^[a-f0-9]{32}$/);
        assert.notEqual(first.randStr, second.randStr);
        assert.ok(Number(second.timeStamp) > Number(first.timeStamp));
    });

    it("recognizes Gigya rate-limit responses", () => {
        const client = createClient();

        assert.equal(client.isRateLimitError(new Error("Api rate limit exceeded")), true);
        assert.equal(client.isRateLimitError(new Error("Gigya error 403048")), true);
        assert.equal(client.isRateLimitError(new Error("Invalid password")), false);
    });

    it("captures OAuth refresh-token metadata", () => {
        const client = createClient();
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

    it("keeps using an access token that is still valid during login backoff", async () => {
        const client = createClient();
        client.accessToken = "access";
        client.accessTokenHardValidUntil = Date.now() + 10 * 60 * 1000;

        const result = await client.handleRateLimit(new Error("Api rate limit exceeded"));

        assert.equal(result, "access");
        assert.ok(client.loginBlockedUntil > Date.now());
        assert.ok(client.tokenValidUntil > Date.now());
    });

    it("returns retry metadata immediately instead of blocking adapter startup", async () => {
        const client = createClient();
        client.loginBackoffMs = 1234;

        await assert.rejects(
            () => client.handleRateLimit(new Error("Api rate limit exceeded")),
            error => {
                assert.equal(error.isRateLimit, true);
                assert.equal(error.retryAfterMs, 1234);
                assert.ok(error.retryAt > Date.now());
                return true;
            },
        );

        assert.ok(client.loginBlockedUntil > Date.now());
    });

    it("does not contact the login endpoint again while the backoff is active", async () => {
        const client = createClient();
        client.loginBlockedUntil = Date.now() + 5000;

        await assert.rejects(
            () => client.obtainToken(false),
            error => {
                assert.equal(error.isRateLimit, true);
                assert.ok(error.retryAfterMs > 0);
                assert.ok(error.retryAfterMs <= 5000);
                return true;
            },
        );
    });

    it("uses the adapter-provided timer for short retry delays", async () => {
        let scheduledDelay = 0;
        const client = createClient({
            scheduleTimeout(callback, milliseconds) {
                scheduledDelay = milliseconds;
                callback();
            },
        });

        await client.wait(100);
        assert.equal(scheduledDelay, 100);
    });
});
