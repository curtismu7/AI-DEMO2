# MFA Device Picker UI — Testing Guide

**Status:** ✅ Implemented and Ready for Testing

## What's New

The MFA Test Page (`/mfa-test`) now includes a device picker UI that allows users to explicitly select which MFA device to use before verification. This resolves the previous "device not found" errors by requiring device selection as a separate step.

### Device Display Format

Each device is now displayed with:
- **Nickname** (if available) — bold, primary identifier
- **Masked Contact Info** — secondary line showing:
  - SMS: `***-****-1234` (last 4 digits of phone)
  - Email: `f***@example.com` (1/3 of local part visible)
  - FIDO2: Device type/name (e.g., "iPhone", "Security Key")

Example layout:
```
┌─────────────────────────────────────────┐
│ My Work Phone                      ✓    │
│ ***-****-5678                            │
└─────────────────────────────────────────┘
```

## Test Flows

### SMS OTP Testing

1. Navigate to **MFA Test Page** → **SMS OTP Testing** section
2. Click **"Initiate SMS OTP Challenge"** button
3. Wait for success (green status)
4. **Device Picker** appears showing "Available SMS Devices:"
   - Shows all enrolled SMS devices with masked phone numbers
   - Click device button to select (turns green with ✓)
5. Enter 6-digit OTP code in the input field
   - Real OTP: Wait for SMS to arrive (authenticates with actual PingOne)
   - Test bypass: Enter `123123` (always works, useful for rapid testing without waiting)
6. Click **"Verify OTP"** button
7. ✅ **Expected:** SMS OTP verification succeeds

---

### Email OTP Testing

1. Navigate to **Email OTP Testing** section
2. Click **"Initiate Email OTP Challenge"** button
3. Wait for success
4. **Device Picker** appears showing "Available Email Devices:"
   - Shows enrolled email devices with masked email addresses
   - Click device button to select
5. Enter 6-digit OTP code (or test code `123123`)
6. Click **"Verify OTP"** button
7. ✅ **Expected:** Email OTP verification succeeds

---

### FIDO2/Passkey Testing

1. Navigate to **FIDO2/Passkey Testing** section
2. Click **"Initiate FIDO2 Challenge"** button
3. Wait for WebAuthn options to load
4. **Device Picker** appears showing "Available FIDO2 Devices:"
   - Shows enrolled FIDO2 passkeys
   - Click device button to select
5. Click **"Verify FIDO2 with Passkey"** button
6. Use your passkey (biometric/PIN on device)
7. ✅ **Expected:** FIDO2 assertion succeeds

---

## Key Features

✅ **Device Selection Required**
- OTP verification now requires explicit device selection
- Prevents "device not found" errors
- Clear visual feedback (green button = selected)

✅ **Privacy-First Display**
- Phone numbers masked: `***-****-XXXX`
- Email addresses masked: `f***@example.com`
- User nicknames shown when available

✅ **Selection State Tracking**
- Shows loading state while selecting
- Displays errors if selection fails
- Checkmark (✓) shows current selection

✅ **Integration with Backend**
- Calls `/api/mfa/test/integration/select-device` endpoint
- Respects PingOne device authorization flow
- Works with all MFA methods (SMS, Email, FIDO2)

---

## Testing Checklist

### Pre-Test Setup
- [ ] User has at least one enrolled SMS device
- [ ] User has at least one enrolled Email device
- [ ] User has at least one enrolled FIDO2 device
- [ ] Dev server running (`npm start` in `banking_api_ui/`)
- [ ] API server running on port 3001

### SMS OTP Tests
- [ ] Device picker shows SMS devices with masked phone numbers
- [ ] Device picker shows nickname if configured
- [ ] Clicking device button selects it (green highlight)
- [ ] Verify OTP fails if no device selected
- [ ] Verify OTP succeeds with correct OTP code
- [ ] Device selection is remembered during same challenge

### Email OTP Tests
- [ ] Device picker shows email devices with masked addresses
- [ ] Device picker shows nickname if configured
- [ ] Clicking device button selects it (green highlight)
- [ ] Verify OTP fails if no device selected
- [ ] Verify OTP succeeds with correct OTP code

### FIDO2 Tests
- [ ] Device picker shows FIDO2 devices with display names
- [ ] Device picker shows nickname if configured
- [ ] Clicking device button selects it (green highlight)
- [ ] FIDO2 assertion fails if no device selected
- [ ] FIDO2 assertion succeeds after biometric/PIN

### Edge Cases
- [ ] Multiple devices of same type show all options
- [ ] Switching device selection updates state
- [ ] Device selection errors display clearly
- [ ] Very long email addresses are properly masked
- [ ] Very long nicknames don't break layout

---

## Known Issues

### To Monitor
1. **Device Population Timing** — ensure devices populate quickly from initiate response
2. **Masking Format** — verify masked values don't cause confusion
3. **Selection Persistence** — confirm selection survives page reload if needed

---

## API Endpoint Reference

### Device Selection Endpoint
```
POST /api/mfa/test/integration/select-device
```

**Request:**
```json
{
  "daId": "device-auth-id-from-initiate",
  "deviceId": "user-selected-device-id",
  "userId": "optional-test-user-override"
}
```

**Response:**
```json
{
  "success": true,
  "daId": "device-auth-id",
  "selectedDevice": "device-id"
}
```

---

## Browser Compatibility

- ✅ Chrome/Chromium (recommended)
- ✅ Safari 14+
- ✅ Firefox 90+
- ✅ Edge 90+

FIDO2/WebAuthn support varies by browser and OS — all major platforms supported.

---

## Support

If device picker doesn't appear or selection fails:

1. **Check Server Logs:** `tail -f /tmp/bank-api-server.log`
2. **Verify Devices Enrolled:** Device Management section shows all enrolled devices
3. **Check Network:** DevTools Network tab shows `/api/mfa/test/integration/select-device` calls
4. **Reset State:** Initiate challenge again to reload device list

