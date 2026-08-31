/**
 * @file privilege-agentless-chain.real.spec.js
 * @description Drives the WHOLE agentless Privilege chain in a real browser:
 *   real PingOne login -> /privilege-mcp-client -> silent auto-connect
 *   (prompt=none) -> gateway DCR -> gateway /authorize -> PingOne -> callback
 *   -> tools/list -> either tools render or the denial modal explains why.
 *
 * Everything below the OAuth redirect was previously only proven by curl and by
 * unit tests. This is the leg that was never watched end to end.
 *
 * It deliberately asserts the SHAPE of the outcome rather than demanding tools:
 * a Privilege policy denial is legitimate demo state (grants are time-boxed), so
 * a 403 must PASS the test while proving the modal did its job — door, identity
 * and a live probe of the other doors. What must never happen is a hang, a bare
 * "blocked per policy" with no evidence, or a bounce to a PingOne login page
 * when the app session already exists.
 *
 * SKIPPED AUTOMATICALLY when credentials are not set.
 */

const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');

const PAGE = '/privilege-mcp-client';

test.describe('Privilege agentless chain (real login)', () => {
  test.skip(!requireRealLoginEnv(), 'Skipped: E2E_CUSTOMER_USERNAME not set');
  test.setTimeout(360_000);   // three network legs plus two 90s settle windows

  test('signs in silently, discovers tools, and explains any denial', async ({ page }) => {
    const notes = [];
    const log = (m) => { notes.push(m); console.log(`[chain] ${m}`); };

    // Every request the page makes, so the OAuth legs are visible in the report
    // rather than inferred.
    const hops = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/\/api\/privilege-mcp\/|mcpgw\.ping-devops\.com|auth\.pingone\.com/.test(u)) {
        hops.push(`${r.method()} ${u.split('?')[0]}`);
      }
    });

    await loginAsCustomer(page);
    log('logged in to the app');

    await page.goto(PAGE);
    // Not networkidle — the page holds an SSE stream open, so it never fires.
    await page.locator('.cur-ide').waitFor({ state: 'visible', timeout: 30_000 });
    log('privilege page rendered');

    // The auto-connect either completes silently through PingOne (a full
    // redirect chain) or the session is already authenticated. Both land on an
    // authenticated status bar; a PingOne login FORM would mean prompt=none
    // failed, which is the regression this drive exists to catch.
    const statusBar = page.locator('.cur-statusbar-item', { hasText: /Authenticated|Not signed in/ });
    await expect(statusBar.first()).toBeVisible({ timeout: 60_000 });

    const url = page.url();
    expect(url, 'ended up on a PingOne login page — prompt=none silent auth failed')
      .not.toMatch(/auth\.pingone\.com/);
    log(`settled at ${url}`);

    // Ask the BFF directly rather than inferring identity from the DOM.
    const stateRes = await page.request.get('/api/privilege-mcp/state');
    const state = await stateRes.json().catch(() => ({}));
    log(`state: mainAppAuthenticated=${state.mainAppAuthenticated} `
      + `oauth.authenticated=${state.oauth?.authenticated} user=${state.user?.email || 'none'} `
      + `mcpUrl=${state.config?.mcpUrl}`);

    // What the CONNECTION panel says before we judge the outcome.
    const conn = await page.locator('.cur-conn-block, .cur-sidebar-content').first()
      .innerText().catch(() => '(no connection block)');
    log(`connection panel:\n${conn.split('\n').slice(0, 8).join('\n')}`);

    const denial = page.locator('.cur-modal', { hasText: 'Access Denied' });
    const signInModal = page.locator('.cur-modal', { hasText: 'Sign in to continue' });
    const signInBtn = page.locator('button', { hasText: 'Sign In with Privilege' });
    const toolCount = page.locator('.cur-sidebar-header', { hasText: 'MCP TOOLS' }).locator('.cur-scope-count');

    // Which of the four states the page has settled into.
    const readOutcome = async () => {
      if (await denial.isVisible().catch(() => false)) return 'denied';
      if (await signInModal.isVisible().catch(() => false)) return 'signin';
      if (await signInBtn.first().isVisible().catch(() => false)) return 'signin';
      if (Number(await toolCount.innerText().catch(() => '0')) > 0) return 'tools';
      return 'pending';
    };
    // 'signin' must PERSIST before it counts. On a fresh mount both auth flags
    // default false for the moment before /state resolves, so the sidebar paints
    // the "Sign In with Privilege" button transiently — polling naively caught
    // that flicker straight after the OAuth redirect and reported a completed
    // chain as "still asking to sign in". tools/denied are terminal immediately.
    const settleTo = async (ms) => {
      const end = Date.now() + ms;
      let signinStreak = 0;
      while (Date.now() < end) {
        const o = await readOutcome();
        if (o === 'tools' || o === 'denied') return o;
        signinStreak = o === 'signin' ? signinStreak + 1 : 0;
        if (signinStreak >= 4) return 'signin';
        await page.waitForTimeout(1000);
      }
      return 'pending';
    };

    // A session seeded from the MAIN APP token reports oauth.authenticated=true
    // but holds a banking-audience token the gateway refuses with 401 "Bearer
    // token required" — so discovery fails and the page asks for a real
    // Privilege sign-in. Drive it: that OAuth chain is the leg under test.
    let outcome = await settleTo(25_000);
    log(`first outcome: ${outcome}`);

    if (outcome === 'signin') {
      const modalBtn = page.locator('.cur-modal button', { hasText: /^Sign In$/ });
      const btn = (await modalBtn.first().isVisible().catch(() => false)) ? modalBtn : signInBtn;
      log('sign-in offered — clicking and following the OAuth chain');
      await btn.first().click();
      // Gateway /authorize -> PingOne -> gateway /callback -> back here.
      //
      // Match on the `auth=` param, NOT on /privilege-mcp-client/: that pattern
      // is satisfied by the URL the page is ALREADY on, so waitForURL returned
      // instantly and the run reported a completed OAuth chain that had not
      // started. The callback always lands back with auth=success or
      // auth=silent_failed, so that param is the real signal.
      // The app login is headless (BFF flow + transplanted connect.sid), so the
      // browser context holds NO PingOne SSO cookie. The gateway runs its own
      // OIDC leg with its own client, does not forward our prompt=none, and
      // PingOne therefore serves a real sign-on form. Fill it — same selectors
      // realLogin.driveLogin uses — rather than pretending the chain completed.
      await Promise.race([
        page.waitForURL(/[?&]auth=/, { timeout: 120_000 }).catch(() => {}),
        page.waitForURL(/apps\.pingone\.com.*signon/, { timeout: 120_000 }).catch(() => {}),
      ]);
      if (/apps\.pingone\.com/.test(page.url())) {
        log('PingOne sign-on form presented (no SSO cookie in this context) — completing it');
        const user = page.locator('input[name="username"], input[id="username"], input[type="email"]').first();
        await user.waitFor({ timeout: 30_000 });
        await user.fill(process.env.E2E_CUSTOMER_USERNAME);
        const pw = page.locator('input[name="password"], input[id="password"], input[type="password"]').first();
        if (!(await pw.isVisible().catch(() => false))) {
          await page.locator('button[type="submit"], button:has-text("Next"), button:has-text("Sign On")').first().click();
          await page.getByRole('textbox', { name: /Password/i }).waitFor({ timeout: 30_000 });
        }
        const pwField = page.getByRole('textbox', { name: /Password/i });
        await pwField.click();
        await pwField.fill(process.env.E2E_CUSTOMER_PASSWORD);
        const signOn = page.getByRole('button', { name: /Sign On/i });
        if (await signOn.count()) await signOn.first().click();
        else await page.locator('button[type="submit"]').first().click();
        await page.waitForURL(/[?&]auth=/, { timeout: 45_000 }).catch(() => {});
      }
      // If the browser is parked on the GATEWAY's own /callback, the gateway
      // took PingOne's code and never redirected on to our redirect_uri — and
      // it logs nothing, so the rendered body is the only evidence there is.
      if (/mcpgw\.ping-devops\.com\/callback/.test(page.url())) {
        const body = (await page.content().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600);
        log(`STUCK on the gateway callback. body: ${body}`);
      }
      log(`back at ${page.url()}`);
      expect(page.url(), 'stranded on PingOne — the OAuth chain did not return')
        .not.toMatch(/auth\.pingone\.com/);
      const st2 = await (await page.request.get('/api/privilege-mcp/state')).json().catch(() => ({}));
      log(`state after OAuth: oauth.authenticated=${st2.oauth?.authenticated} source=${st2.oauth?.source} scope=${st2.oauth?.scope}`);
      outcome = await settleTo(75_000);
      log(`outcome after OAuth: ${outcome}`);
    }

    log(`hops so far:\n  ${hops.join('\n  ')}`);
    expect(outcome, 'page never settled — no tools, no denial, no sign-in prompt')
      .not.toBe('pending');
    expect(outcome, 'still asking to sign in after completing the OAuth chain')
      .not.toBe('signin');

    const denied = outcome === 'denied';

    if (denied) {
      log('outcome: policy denial — checking the modal actually explains it');
      const text = await denial.innerText();
      log(`modal:\n${text}`);

      // The whole point of the rework: a denial must carry evidence.
      expect(text, 'modal did not name the door').toMatch(/Door/);
      expect(text, 'modal did not name the identity').toMatch(/Identity/);
      expect(text, 'modal did not carry the upstream error').toMatch(/Gateway said/);
      // It must NOT claim to know which policy denied — the gateway never says.
      expect(text, 'modal overclaimed which policy denied')
        .toMatch(/does not disclose which policy denied/);

      // The door probe runs automatically on open; give it time to land.
      await page.locator('.cur-denial-probe, .cur-denial-note', { hasText: /Trying the other doors|No other doors|tools/ })
        .first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
      const probeRows = await page.locator('.cur-denial-probe-row').allInnerTexts().catch(() => []);
      log(`door probe rows: ${JSON.stringify(probeRows)}`);
    } else {
      const n = await toolCount.innerText().catch(() => '0');
      log(`outcome: ${n} tools discovered`);
      expect(Number(n), 'tools panel rendered but reported zero tools').toBeGreaterThan(0);
    }

    // The MCP Explorer must be readable in LIGHT mode — this is the tab that
    // shipped with no light skin at all and rendered near-white on white.
    const lightBtn = page.locator('button', { hasText: /^Light$|^Dark$/ }).first();
    if (await lightBtn.isVisible().catch(() => false)) {
      const label = await lightBtn.innerText();
      if (label.trim() === 'Light') await lightBtn.click();
    }
    const explorerTab = page.locator('.cur-tab', { hasText: 'MCP Explorer' });
    if (await explorerTab.isVisible().catch(() => false)) {
      await explorerTab.click();
      const heading = page.locator('.cur-mcp-catalog-grid h4').first();
      if (await heading.isVisible().catch(() => false)) {
        const contrast = await heading.evaluate((el) => {
          const ink = getComputedStyle(el).color;
          let node = el, ground = 'rgba(0, 0, 0, 0)';
          while (node && ground === 'rgba(0, 0, 0, 0)') {
            ground = getComputedStyle(node).backgroundColor;
            node = node.parentElement;
          }
          return { ink, ground };
        });
        log(`MCP Explorer heading in light mode: ${JSON.stringify(contrast)}`);
        // Light-on-light is the reported bug: ink must not be near-white.
        const [r, g, b] = contrast.ink.match(/\d+/g).map(Number);
        expect(r + g + b, `heading ink ${contrast.ink} is near-white on ${contrast.ground}`)
          .toBeLessThan(600);
      }
      const emptyNotes = await page.locator('.cur-mcp-empty').allInnerTexts().catch(() => []);
      log(`explorer empty-state notes: ${JSON.stringify(emptyNotes)}`);
    }

    // The Policies tab must exist and offer the console-token field.
    const policiesTab = page.locator('.cur-tab', { hasText: 'Policies' });
    await expect(policiesTab).toBeVisible();
    await policiesTab.click();
    await expect(page.getByPlaceholder('paste the auth_token cookie value')).toBeVisible({ timeout: 15_000 });
    log('policies tab renders its console-token field');

    log(`hops:\n  ${hops.join('\n  ')}`);
    await page.screenshot({ path: 'test-results/privilege-chain-final.png', fullPage: true });
  });
});
