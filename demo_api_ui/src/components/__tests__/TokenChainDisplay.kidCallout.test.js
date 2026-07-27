/**
 * Token chain — signing-key callout on the authorize-decision step.
 *
 * The two engines expose decision parameters at DIFFERENT paths:
 *   live PingOne  → authorizeRequest.body.parameters
 *   simulated     → authorizeRequest.parameters
 * A reader handling only one shape renders empty in the other mode while
 * looking correct in whichever mode was tested. Both are asserted here.
 */
import { readAuthorizeParameters } from "../TokenChainDisplay";

describe("readAuthorizeParameters — engine shape normalisation", () => {
  test("reads the live PingOne shape (request.body.parameters)", () => {
    const event = {
      id: "authorize-decision",
      authorizeRequest: {
        method: "POST",
        url: "https://api.pingone.com/v1/environments/e/decisionEndpoints/d",
        body: { parameters: { TokenKid: "kid-abc", TokenKidKnown: true } },
      },
    };
    const params = readAuthorizeParameters(event);
    expect(params.TokenKid).toBe("kid-abc");
    expect(params.TokenKidKnown).toBe(true);
  });

  test("reads the simulated shape (request.parameters)", () => {
    const event = {
      id: "authorize-decision",
      authorizeRequest: { parameters: { TokenKid: "kid-sim", TokenKidKnown: false } },
    };
    const params = readAuthorizeParameters(event);
    expect(params.TokenKid).toBe("kid-sim");
    expect(params.TokenKidKnown).toBe(false);
  });

  test("returns null when no parameters are present", () => {
    expect(readAuthorizeParameters({ id: "authorize-decision" })).toBeNull();
    expect(readAuthorizeParameters({ id: "authorize-decision", authorizeRequest: {} })).toBeNull();
  });

  test("returns null for an event with no authorizeRequest at all", () => {
    expect(readAuthorizeParameters({ id: "user-token" })).toBeNull();
  });
});
