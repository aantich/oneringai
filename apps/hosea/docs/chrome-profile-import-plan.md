# Chrome Profile & Password Import for hosea

## Overview

Add two features to the hosea Electron app:
1. **Chrome Profile Import** - Import cookies, localStorage, history from Chrome to make the browser automation look human-like
2. **Chrome Password Manager Access** - Import saved passwords for autofill functionality

**Scope**: macOS first (Windows/Linux later), personal automation use case, full autofill

## Current Architecture

The app already has:
- Cookie persistence at `~/.hosea/browser_cookies/` (JSON format)
- Isolated session partitions: `persist:browser_{instanceId}`
- Stealth configuration for anti-bot detection
- Existing `browser_import_cookies` / `browser_export_cookies` tools

## Technical Challenges

### Chrome Data Encryption
- **Cookies**: AES-256-GCM encrypted in `Network/Cookies` SQLite DB
- **Passwords**: Same encryption in `Login Data` SQLite DB
- **Encryption Key Location**:
  - macOS: Keychain (service: "Chrome Safe Storage")
  - Windows: `Local State` file, DPAPI encrypted
  - Linux: `Local State` or plaintext

### File Locking
- Chrome locks database files while running
- Need to either copy files or prompt user to close Chrome

---

## Feature 1: Chrome Profile Import

### New File Structure
```
apps/hosea/src/main/browser/chrome-import/
├── index.ts                  # Exports
├── types.ts                  # Type definitions
├── ChromeProfileImporter.ts  # Main importer class
├── ChromeLocator.ts          # Find Chrome profiles
├── CookieDecryptor.ts        # Platform-specific decryption
├── HistoryReader.ts          # Read History SQLite
└── LocalStorageReader.ts     # Read LevelDB
```

### Implementation Steps

1. **ChromeLocator** - Discover Chrome profiles
   - Get Chrome data directory per platform
   - List available profiles (Default, Profile 1, etc.)
   - Detect if Chrome is running

2. **CookieDecryptor** - Platform-specific decryption
   - macOS: Access Keychain via `security` CLI or `keytar` npm
   - Windows: Read from Local State, decrypt with DPAPI
   - Linux: Read from Local State (often plaintext)

3. **ChromeProfileImporter** - Main import logic
   - Read cookies from `Network/Cookies` SQLite
   - Decrypt cookie values
   - Convert to Electron cookie format
   - Import via `session.cookies.set()`

4. **IPC Handlers** - Add to `src/main/index.ts`
   ```typescript
   ipcMain.handle('chrome-import:list-profiles', ...)
   ipcMain.handle('chrome-import:check-chrome-running', ...)
   ipcMain.handle('chrome-import:import-cookies', ...)
   ```

5. **UI** - Settings section or modal dialog
   - Profile selector dropdown
   - Domain filter (optional)
   - Import button with progress

### Chrome Data Locations
| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Google/Chrome/Default/` |
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\` |
| Linux | `~/.config/google-chrome/default/` |

---

## Feature 2: Chrome Password Access

### Security Considerations
- Passwords encrypted with same system as cookies
- Must use Electron's `safeStorage` API for secure local storage
- Never log passwords
- Require explicit user consent

### New File Structure
```
apps/hosea/src/main/credentials/
├── index.ts
├── types.ts
├── CredentialStore.ts        # Secure storage with safeStorage
├── PasswordImporter.ts       # Import from Chrome
└── AutofillService.ts        # Fill credentials into pages
```

### Implementation Steps

1. **PasswordImporter** - Read Chrome Login Data
   - Same decryption as cookies
   - Extract: origin, username, encrypted password
   - Decrypt password values

2. **CredentialStore** - Secure local storage
   - Use `electron.safeStorage.encryptString()` for passwords
   - Store at `~/.hosea/credentials/`
   - APIs: store, getForUrl, list, delete

3. **AutofillService** - Fill credentials
   - Detect login pages
   - Find matching credentials by URL
   - Fill via JavaScript injection

4. **Consent Flow**
   - Security warning dialog
   - Require explicit confirmation
   - Show summary without passwords

---

## Critical Files to Modify

| File | Changes |
|------|---------|
| `src/main/index.ts` | Add IPC handlers for chrome-import and credentials |
| `src/preload/index.ts` | Expose APIs to renderer |
| `src/main/BrowserService.ts` | Integrate autofill service |
| `src/renderer/pages/SettingsPage.tsx` | Add import UI section |

---

## Dependencies

```json
{
  "dependencies": {
    "better-sqlite3": "^9.4.3"  // SQLite reading (needs Electron rebuild)
  }
}
```

### macOS Keychain Decryption (Phase 1 focus)

Chrome stores its encryption key in macOS Keychain:
- Service: `Chrome Safe Storage`
- Account: `Chrome`

Access via CLI (no native module needed):
```bash
security find-generic-password -s "Chrome Safe Storage" -a "Chrome" -w
```

This returns the base64-encoded encryption key. Then decrypt cookies/passwords:
1. Read `encrypted_value` from SQLite (starts with `v10` prefix on macOS)
2. Strip `v10` prefix
3. Extract IV (first 12 bytes after prefix)
4. Decrypt with AES-256-GCM using the Keychain key

### Windows/Linux (Future)
- Windows: DPAPI via `electron.safeStorage` or PowerShell
- Linux: Read plaintext key from `Local State` or use system keyring

---

## Implementation Phases

### Phase 1: Cookie Import (Foundation)
1. Create `chrome-import/` module structure
2. Implement `ChromeLocator.ts` - find Chrome profiles on macOS
3. Implement `CookieDecryptor.ts` - macOS Keychain decryption
4. Implement `ChromeProfileImporter.ts` - read & decrypt cookies
5. Add IPC handlers in `src/main/index.ts`
6. Add import UI (Settings page or modal)

### Phase 2: Password Import + Storage
1. Create `credentials/` module structure
2. Implement `PasswordImporter.ts` (reuse CookieDecryptor)
3. Implement `CredentialStore.ts` with `safeStorage` encryption
4. Simple confirmation dialog (personal use = lighter consent)
5. Add IPC handlers for credential management

### Phase 3: Full Autofill
1. Implement `AutofillService.ts`
2. Login page detection (look for password fields)
3. Autofill dropdown UI in BrowserViewHost
4. Credential save prompt when new login detected
5. Browser tool: `browser_autofill_credentials`

---

## Verification

1. **Cookie Import Test**
   - Close Chrome, run import
   - Navigate to a site where you're logged in (in Chrome)
   - Verify authentication persists

2. **Password Import Test**
   - Import passwords with consent flow
   - Verify stored credentials (list shows usernames, masked passwords)
   - Test autofill on login page

3. **Platform Tests**
   - Test on macOS (Keychain access)
   - Test on Windows (DPAPI)
   - Test with Chrome running (should warn/offer copy)
