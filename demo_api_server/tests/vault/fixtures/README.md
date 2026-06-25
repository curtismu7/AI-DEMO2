# Vault Test Fixtures

⚠️ **These fixtures are TEST DATA ONLY. Never use these passwords or values in production.**

## valid-v1.vault

- Vault format version: 1
- Password: `golden-test-password`
- Entries:
  - `GREETING` → `hello-world`
  - `NOTE` → `example only — never use`
- File HMAC valid; round-trips through openVault/read.

## corrupted-v1.vault

- Same as valid-v1.vault with byte 0 of `entries.GREETING.value` (base64-decoded) XOR'd with 0xFF.
- Whole-file HMAC verification MUST FAIL on this file (verifyFileHmac returns false).
- If a future change in canonicalJson key ordering changes the on-disk bytes, regenerate BOTH
  fixtures from a fresh run and verify the round-trip + corruption tests still behave identically.

## Regeneration

To regenerate these fixtures (e.g. after a format version bump), run from `banking_api_server/`:

```bash
node -e "
(async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const { deriveKek, aeadSeal, hkdfFileHmacKey } = require('./lib/vault/crypto');
  const { canonicalJson, computeFileHmac } = require('./lib/vault/format');
  // ...see the original generation script in 269-01 commit history
})().catch(e => { console.error(e); process.exit(1); });
"
```

After regeneration, re-run `npx jest tests/vault/golden.test.js` to confirm the new fixtures
behave identically.
