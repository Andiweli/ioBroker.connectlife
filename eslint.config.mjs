import config from "@iobroker/eslint-config";

export default [
    ...config,
    {
        ignores: [
            ".vscode/",
            "*.test.js",
            "test/**/*.js",
            "*.config.mjs",
            "build",
            "dist",
            "lib/connectlife-client.js",
        ],
    },
    {
        rules: {
            "jsdoc/require-jsdoc": "off",
            "jsdoc/require-param": "off",
            "jsdoc/require-param-description": "off",
            "jsdoc/require-returns-description": "off",
            "jsdoc/require-returns-check": "off",
            "no-console": "off",
        },
    },
];
