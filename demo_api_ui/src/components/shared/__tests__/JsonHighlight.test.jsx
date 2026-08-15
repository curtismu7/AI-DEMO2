import React from "react";
import { render } from "@testing-library/react";
import { tokenize } from "../JsonHighlight";

describe("JsonHighlight", () => {
  test("marks token audience and scope fields for emphasis", () => {
    const tokens = tokenize('{"aud":"gateway","scope":"gateway:mcp:invoke","sub":"user-1"}');

    expect(tokens.find((token) => token.text.startsWith('"aud"'))).toMatchObject({ focused: true });
    expect(tokens.find((token) => token.text.startsWith('"scope"'))).toMatchObject({ focused: true });
    expect(tokens.find((token) => token.text.startsWith('"sub"'))).not.toMatchObject({ focused: true });
  });

  test("marks payload and RarAuthorizationDetails in Authorize JSON", () => {
    const tokens = tokenize('{"payload":{},"RarAuthorizationDetails":[],"result":"PERMIT"}');

    expect(tokens.find((token) => token.text.startsWith('"payload"'))).toMatchObject({ focused: true });
    expect(tokens.find((token) => token.text.startsWith('"RarAuthorizationDetails"'))).toMatchObject({ focused: true });
    expect(tokens.find((token) => token.text.startsWith('"result"'))).toMatchObject({ critical: true });
  });

  test("returns no tokens for undefined/null text instead of throwing", () => {
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
});
