'use strict';

const fs = require('node:fs');
const path = require('node:path');

const headerScriptPath = path.join(__dirname, '../../public/swagger-ui-header.js');
const serverPath = path.join(__dirname, '../../server.js');

describe('Swagger UI page header', () => {
    test('offers a PingOne sign-in link that returns to the current docs page', () => {
        const script = fs.readFileSync(headerScriptPath, 'utf8');

        expect(script).toContain('Sign in with PingOne');
        expect(script).toContain('/api/auth/oauth/login?return_to=');
        expect(script).toContain('window.location.pathname + window.location.search');
    });

    test('identifies the page as the Banking Demo API', () => {
        const script = fs.readFileSync(headerScriptPath, 'utf8');

        expect(script).toContain('Banking Demo API');
        expect(script).toContain('swagger-demo-header');
    });

    test('wires the header asset into Swagger UI', () => {
        const server = fs.readFileSync(serverPath, 'utf8');

        expect(server).toContain("customJs: '/api/docs/swagger-ui-header.js'");
        expect(server).toContain("app.get('/api/docs/swagger-ui-header.js'");
        expect(server).toContain('.swagger-demo-header');
    });

    test('uses the signed-in browser session instead of exposing manual authorization', () => {
        const server = fs.readFileSync(serverPath, 'utf8');

        expect(server).toContain('requestInterceptor');
        expect(server).toContain("request.credentials = 'include'");
        expect(server).toContain('.swagger-ui .auth-wrapper');
        expect(server).toContain('.swagger-ui .authorization__btn');
    });
});
