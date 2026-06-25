# Email OTP Device Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3-step inline modal to the Profile page that lets a logged-in user enroll an email OTP MFA device — enter email → receive OTP → verify → device appears in list.

**Architecture:** The BFF already has `enrollEmailDevice` in `mfaService.js` and `completeSmsEnrollment` as the OTP-activation pattern. We add `completeEmailEnrollment` to `mfaService.js` mirroring that pattern, wire it to a new `POST /api/auth/mfa/enroll/email/verify` route, update `POST /api/auth/mfa/enroll/email` to accept an explicit `email` body param (falling back to session), and add a 3-step modal in `Profile.js`.

**Tech Stack:** Express (BFF routes), Jest (unit tests), React (Profile.js modal — no new component file)

---

## File Map

| File | Change |
|---|---|
| `demo_api_server/services/mfaService.js` | Add `completeEmailEnrollment(userId, deviceId, otp)` |
| `demo_api_server/routes/mfa.js` | Accept `email` body param on `/enroll/email`; add `/enroll/email/verify` route |
| `demo_api_server/src/__tests__/mfaService.test.js` | Add tests for `completeEmailEnrollment` |
| `demo_api_ui/src/components/Profile.js` | Replace toast placeholder with 3-step enrollment modal |
| `demo_api_ui/src/components/Profile.css` | Add modal styles |

---

## Task 1: Add `completeEmailEnrollment` to mfaService.js

**Files:**
- Modify: `demo_api_server/services/mfaService.js`
- Test: `demo_api_server/src/__tests__/mfaService.test.js`

The SMS enrollment completion (`completeSmsEnrollment`) uses `PUT /users/{userId}/devices/{deviceId}` with `Content-Type: application/vnd.pingidentity.device.activate+json` and body `{ otp }`. Email activation uses the same endpoint and content-type.

- [ ] **Step 1: Write the failing test**

Open `demo_api_server/src/__tests__/mfaService.test.js` and add this `describe` block near the other enrollment tests:

```js
describe('completeEmailEnrollment', () => {
  it('PUTs otp to /users/{userId}/devices/{deviceId} with activate content-type', async () => {
    mockAxios.put.mockResolvedValueOnce({
      data: { id: 'dev-abc', type: 'EMAIL', status: 'ACTIVE' },
    });
    const result = await mfaService.completeEmailEnrollment('user-1', 'dev-abc', '123456');
    expect(mockAxios.put).toHaveBeenCalledWith(
      expect.stringContaining('/users/user-1/devices/dev-abc'),
      { otp: '123456' },
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/vnd.pingidentity.device.activate+json',
        }),
      }),
    );
    expect(result.status).toBe('ACTIVE');
  });

  it('throws a wrapped error when PingOne returns 400', async () => {
    mockAxios.put.mockRejectedValueOnce(
      Object.assign(new Error('Bad OTP'), { response: { status: 400, data: { code: 'INVALID_OTP' } } }),
    );
    await expect(
      mfaService.completeEmailEnrollment('user-1', 'dev-abc', '000000'),
    ).rejects.toMatchObject({ message: expect.stringContaining('completeEmailEnrollment') });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd demo_api_server
npx jest mfaService.test --testNamePattern="completeEmailEnrollment" --no-coverage
```

Expected: FAIL — `mfaService.completeEmailEnrollment is not a function`

- [ ] **Step 3: Implement `completeEmailEnrollment` in mfaService.js**

Find `completeSmsEnrollment` (around line 568) in `demo_api_server/services/mfaService.js`. Add the following immediately after it (before `initFido2Registration`):

```js
/**
 * Complete email OTP device enrollment by submitting the OTP sent to the address.
 * @param {string} userId
 * @param {string} deviceId - from enrollEmailDevice
 * @param {string} otp      - 6-digit code emailed to the user
 * Returns { id, type, status }
 */
async function completeEmailEnrollment(userId, deviceId, otp) {
  try {
    const workerToken = await _getWorkerToken();
    const url = `${_apiBaseUrl()}/users/${userId}/devices/${deviceId}`;
    const reqBody = { otp };
    const debugRequest = {
      method: 'PUT',
      url,
      body: reqBody,
      contentType: 'application/vnd.pingidentity.device.activate+json',
      headers: _debugHeaders(workerToken, 'application/vnd.pingidentity.device.activate+json'),
    };
    let data;
    try {
      const resp = await axios.put(url, reqBody, {
        headers: {
          Authorization: `Bearer ${workerToken}`,
          'Content-Type': 'application/vnd.pingidentity.device.activate+json',
        },
        timeout: 10000,
      });
      data = resp.data;
    } catch (err) {
      err._debug = { request: debugRequest, response: err.response?.data || null };
      throw err;
    }
    console.log(
      '[MFA] completed email enrollment userId=%s deviceId=%s status=%s',
      userId, data.id, data.status,
    );
    return { ...data, _debug: { request: debugRequest, response: data } };
  } catch (err) {
    throw _wrapError('completeEmailEnrollment', err);
  }
}
```

Also add `completeEmailEnrollment` to the `module.exports` object at the bottom of the file (it already exports `completeSmsEnrollment` — add the new one next to it):

```js
completeEmailEnrollment,
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
cd demo_api_server
npx jest mfaService.test --testNamePattern="completeEmailEnrollment" --no-coverage
```

Expected: PASS — 2 tests pass

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/mfaService.js demo_api_server/src/__tests__/mfaService.test.js
git commit -m "feat(mfa): add completeEmailEnrollment service method"
```

---

## Task 2: Update BFF routes — accept email body param + add verify endpoint

**Files:**
- Modify: `demo_api_server/routes/mfa.js`

- [ ] **Step 1: Update `POST /enroll/email` to accept explicit email body param**

Find the existing route in `demo_api_server/routes/mfa.js` (around line 372):

```js
router.post('/enroll/email', authenticateToken, async (req, res) => {
  try {
    const userId = req.session.user?.id;
    const email = req.session.user?.email;
```

Replace those two lines (keep everything else) so it reads:

```js
router.post('/enroll/email', authenticateToken, async (req, res) => {
  try {
    const userId = req.session.user?.oauthId || req.session.user?.id;
    const email = req.body.email || req.session.user?.email;
```

- [ ] **Step 2: Add `POST /enroll/email/verify` route**

Find the `// POST /api/auth/mfa/enroll/fido2-init` comment (around line 388) and insert the new route immediately before it:

```js
// POST /api/auth/mfa/enroll/email/verify
// Activate an email OTP device by submitting the OTP sent to the enrolled address.
// Body: { deviceId, otp }
// Returns { deviceId, status }
router.post('/enroll/email/verify', authenticateToken, async (req, res) => {
  try {
    const userId = req.session.user?.oauthId || req.session.user?.id;
    const { deviceId, otp } = req.body;
    if (!userId) {
      return res.status(401).json({ error: 'no_session', message: 'Not authenticated.' });
    }
    if (!deviceId || !otp) {
      return res.status(400).json({ error: 'invalid_body', message: 'deviceId and otp are required.' });
    }
    const result = await mfaService.completeEmailEnrollment(userId, deviceId, otp);
    res.json({ deviceId: result.id, status: result.status });
  } catch (err) {
    console.error('[MFA route] POST /enroll/email/verify failed:', err.message);
    const status = err.status || (err.pingError === 'INVALID_OTP' ? 422 : 500);
    res.status(status).json({ error: 'verify_failed', message: err.message, pingError: err.pingError });
  }
});

```

- [ ] **Step 3: Smoke-test the routes manually**

Start the API server and confirm the routes are mounted without error:

```bash
curl -sk https://api.ping.demo:3001/api/auth/mfa/enroll/email \
  -X POST -H "Content-Type: application/json" -d '{"email":"test@test.com"}' \
  | python3 -m json.tool
```

Expected: `{ "error": "no_session" }` (401) — route exists, auth guard fires.

```bash
curl -sk https://api.ping.demo:3001/api/auth/mfa/enroll/email/verify \
  -X POST -H "Content-Type: application/json" -d '{"deviceId":"x","otp":"123456"}' \
  | python3 -m json.tool
```

Expected: `{ "error": "no_session" }` (401) — same.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/routes/mfa.js
git commit -m "feat(mfa): add enroll/email body param + enroll/email/verify route"
```

---

## Task 3: Add enrollment modal to Profile.js

**Files:**
- Modify: `demo_api_ui/src/components/Profile.js`
- Modify: `demo_api_ui/src/components/Profile.css`

The modal has 3 steps driven by a `enrollStep` state: `null` (closed) → `'email'` → `'otp'` → `'done'`. The `deviceId` returned from step 1 is held in state to pass to step 2.

- [ ] **Step 1: Add enrollment state to Profile.js**

In `Profile.js`, find the existing state declarations (around line 55–60):

```js
const [devices, setDevices] = useState([]);
const [devicesLoading, setDevicesLoading] = useState(true);
const [removingId, setRemovingId] = useState(null);
```

Add immediately after:

```js
const [enrollStep, setEnrollStep] = useState(null); // null | 'email' | 'otp' | 'done'
const [enrollEmail, setEnrollEmail] = useState('');
const [enrollDeviceId, setEnrollDeviceId] = useState('');
const [enrollOtp, setEnrollOtp] = useState('');
const [enrollBusy, setEnrollBusy] = useState(false);
```

- [ ] **Step 2: Add `handleOpenEnroll` and two submit handlers**

Add these three functions after `handleRemoveDevice` (around line 112):

```js
const handleOpenEnroll = () => {
  setEnrollEmail(user?.email || '');
  setEnrollOtp('');
  setEnrollDeviceId('');
  setEnrollStep('email');
};

const handleEnrollSendOtp = async (e) => {
  e.preventDefault();
  if (!enrollEmail.trim()) return;
  setEnrollBusy(true);
  try {
    const res = await bffAxios.post('/api/auth/mfa/enroll/email', { email: enrollEmail.trim() });
    setEnrollDeviceId(res.data.deviceId);
    setEnrollStep('otp');
  } catch (err) {
    toast.error(err.response?.data?.message || 'Failed to send OTP');
  } finally {
    setEnrollBusy(false);
  }
};

const handleEnrollVerifyOtp = async (e) => {
  e.preventDefault();
  if (!enrollOtp.trim()) return;
  setEnrollBusy(true);
  try {
    await bffAxios.post('/api/auth/mfa/enroll/email/verify', {
      deviceId: enrollDeviceId,
      otp: enrollOtp.trim(),
    });
    setEnrollStep('done');
    await loadDevices();
  } catch (err) {
    toast.error(err.response?.data?.message || 'Invalid OTP — please try again');
  } finally {
    setEnrollBusy(false);
  }
};
```

- [ ] **Step 3: Replace the toast placeholder with `handleOpenEnroll`**

Find (around line 251):

```js
<button type="button" className="up-btn up-btn--add" onClick={() => toast.info('Device enrollment coming soon')}>
  + Add New Device
</button>
```

Replace with:

```js
<button type="button" className="up-btn up-btn--add" onClick={handleOpenEnroll}>
  + Add New Device
</button>
```

- [ ] **Step 4: Add the modal JSX**

Find the closing `</div>` of the `up-page` root div (last line before the final `}`), which currently looks like:

```jsx
    </div>
  );
}
```

Insert the modal immediately before that closing `</div>`:

```jsx
      {/* Email OTP Enrollment Modal */}
      {enrollStep !== null && (
        <div className="up-modal-backdrop" onClick={() => enrollStep !== 'done' && !enrollBusy && setEnrollStep(null)}>
          <div className="up-modal" onClick={e => e.stopPropagation()}>
            {enrollStep === 'email' && (
              <>
                <div className="up-modal__header">
                  <span className="up-modal__title">Add Email OTP Device</span>
                  <button type="button" className="up-modal__close" onClick={() => setEnrollStep(null)} disabled={enrollBusy}>✕</button>
                </div>
                <form onSubmit={handleEnrollSendOtp} className="up-modal__body">
                  <p className="up-modal__desc">We'll send a one-time code to this address to verify it.</p>
                  <div className="up-form__field">
                    <label htmlFor="enroll-email">EMAIL</label>
                    <input
                      id="enroll-email"
                      type="email"
                      value={enrollEmail}
                      onChange={e => setEnrollEmail(e.target.value)}
                      required
                      autoFocus
                      disabled={enrollBusy}
                    />
                  </div>
                  <div className="up-modal__actions">
                    <button type="button" className="up-btn up-btn--secondary" onClick={() => setEnrollStep(null)} disabled={enrollBusy}>Cancel</button>
                    <button type="submit" className="up-btn up-btn--edit" disabled={enrollBusy}>
                      {enrollBusy ? 'Sending…' : 'Send OTP'}
                    </button>
                  </div>
                </form>
              </>
            )}

            {enrollStep === 'otp' && (
              <>
                <div className="up-modal__header">
                  <span className="up-modal__title">Enter Verification Code</span>
                  <button type="button" className="up-modal__close" onClick={() => setEnrollStep(null)} disabled={enrollBusy}>✕</button>
                </div>
                <form onSubmit={handleEnrollVerifyOtp} className="up-modal__body">
                  <p className="up-modal__desc">Code sent to <strong>{enrollEmail}</strong>. Enter it below.</p>
                  <div className="up-form__field">
                    <label htmlFor="enroll-otp">VERIFICATION CODE</label>
                    <input
                      id="enroll-otp"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={8}
                      value={enrollOtp}
                      onChange={e => setEnrollOtp(e.target.value.replace(/\D/g, ''))}
                      required
                      autoFocus
                      disabled={enrollBusy}
                      placeholder="123456"
                    />
                  </div>
                  <div className="up-modal__actions">
                    <button type="button" className="up-btn up-btn--secondary" onClick={() => setEnrollStep('email')} disabled={enrollBusy}>Back</button>
                    <button type="submit" className="up-btn up-btn--edit" disabled={enrollBusy}>
                      {enrollBusy ? 'Verifying…' : 'Verify'}
                    </button>
                  </div>
                </form>
              </>
            )}

            {enrollStep === 'done' && (
              <>
                <div className="up-modal__header">
                  <span className="up-modal__title">Device Added</span>
                </div>
                <div className="up-modal__body">
                  <p className="up-modal__desc">✅ Email OTP device enrolled successfully.</p>
                  <div className="up-modal__actions">
                    <button type="button" className="up-btn up-btn--edit" onClick={() => setEnrollStep(null)}>Done</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 5: Add modal CSS to Profile.css**

Append to `demo_api_ui/src/components/Profile.css`:

```css
/* ── Enrollment modal ─────────────────────────────────────── */
.up-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.up-modal {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  width: 100%;
  max-width: 420px;
  margin: 1rem;
}

.up-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem 0;
}

.up-modal__title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1a1a1a;
}

.up-modal__close {
  background: none;
  border: none;
  font-size: 1rem;
  cursor: pointer;
  color: #666;
  padding: 0.25rem;
  line-height: 1;
}

.up-modal__close:hover {
  color: #1a1a1a;
}

.up-modal__body {
  padding: 1rem 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.up-modal__desc {
  margin: 0;
  color: #555;
  font-size: 0.9rem;
  line-height: 1.5;
}

.up-modal__actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}
```

- [ ] **Step 6: Build and verify no compile errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -8
```

Expected: `The build folder is ready to be deployed.` — exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/Profile.js demo_api_ui/src/components/Profile.css
git commit -m "feat(profile): add email OTP device enrollment modal"
```

---

## Task 4: End-to-end verification

- [ ] **Step 1: Confirm services are running**

```bash
./run.sh status 2>/dev/null | grep -E "OK|ERROR"
```

Expected: All OK.

- [ ] **Step 2: Log in and open Profile**

Navigate to `https://api.ping.demo:4000/profile` while authenticated as a customer user.

Expected: Profile page renders. MFA Devices section shows "No MFA devices enrolled." and "+ Add New Device" button.

- [ ] **Step 3: Open modal — email step**

Click "+ Add New Device".

Expected: Modal opens with email pre-filled from user profile, "Send OTP" button.

- [ ] **Step 4: Send OTP**

Confirm/edit the email and click "Send OTP".

Expected: Modal transitions to OTP input step, shows "Code sent to [email]". Check the email inbox for a 6-digit code from PingOne.

- [ ] **Step 5: Verify OTP**

Enter the 6-digit code and click "Verify".

Expected: Modal shows "✅ Email OTP device enrolled successfully." and a Done button. Device list refreshes and shows the new EMAIL device.

- [ ] **Step 6: Confirm device in PingOne**

```bash
set -a; source demo_api_server/.env; set +a
TOKEN=$(curl -s -X POST "https://auth.pingone.com/${PINGONE_ENVIRONMENT_ID}/as/token" \
  -u "${PINGONE_WORKER_CLIENT_ID}:${PINGONE_WORKER_CLIENT_SECRET}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s "https://api.pingone.com/v1/environments/${PINGONE_ENVIRONMENT_ID}/users/4511829e-44a0-4cab-8f42-1f9ad860ae91/devices" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
devs = d.get('_embedded', {}).get('devices', [])
for dev in devs: print(dev.get('type'), dev.get('status'), dev.get('email',''))
"
```

Expected: `EMAIL ACTIVE <enrolled address>` appears in the output.
