# HTTPS Setup for Local Development

This guide explains how to enable HTTPS for the frontend development server to ensure camera access works properly from mobile devices.

## Why HTTPS is Required

Modern browsers require HTTPS for accessing sensitive APIs like `getUserMedia()` (camera access), especially when:

- Accessing from a different device (e.g., phone connecting to laptop's dev server)
- The origin is not `localhost` or `127.0.0.1`

Without HTTPS, camera access will be blocked by the browser's security policies.

## Automatic Setup

We've already set up HTTPS for you! The certificates are generated and the development server is configured to use them.

### Quick Start

1. **Start the development server:**

   ```bash
   npm run dev
   ```

2. **Access from your computer:**

   - `https://localhost:8080`
   - `https://127.0.0.1:8080`

3. **Access from your phone:**
   - `https://192.168.1.103:8080` (or your current local IP)

## Manual Setup (if needed)

If you need to regenerate certificates or set up on a new machine:

```bash
# Run our setup script
./scripts/setup-https.sh
```

Or manually:

```bash
# Install mkcert
brew install mkcert  # macOS
# For other platforms: https://github.com/FiloSottile/mkcert#installation

# Install local CA
mkcert -install

# Generate certificates
mkdir -p certs
cd certs
mkcert localhost 127.0.0.1 $(ipconfig getifaddr en0) ::1
cd ..

# Start development server
npm run dev
```

## Certificate Details

- **Location:** `./certs/`
- **Files:**
  - `localhost+3.pem` (certificate)
  - `localhost+3-key.pem` (private key)
- **Validity:** 3 months
- **Domains:** localhost, 127.0.0.1, your local IP, IPv6 localhost

## Mobile Device Setup

### For Phone Access:

1. **Ensure same WiFi network:** Your phone and development machine must be on the same WiFi network

2. **Find your local IP:**

   ```bash
   ipconfig getifaddr en0  # macOS
   # or check the console output when starting the dev server
   ```

3. **Access from phone:**

   - Open Safari (iOS) or Chrome (Android)
   - Navigate to `https://YOUR_LOCAL_IP:8080`
   - You may see a security warning - this is normal for local certificates

4. **Accept the certificate:**

   - **iOS Safari:** Tap "Advanced" → "Proceed to website"
   - **Android Chrome:** Tap "Advanced" → "Proceed to site (unsafe)"

5. **Test camera access:**
   - Go to the recording page OR use our camera test page: `https://YOUR_LOCAL_IP:8080/test-camera.html`
   - Try to add a camera or click "Start Camera"
   - The browser should prompt for camera permission
   - Grant permission to test `getUserMedia()` functionality

## Troubleshooting

### Certificate Issues

If you see certificate errors:

```bash
# Regenerate certificates
rm -rf certs/
./scripts/setup-https.sh
```

### IP Address Changes

If your local IP changes (common with DHCP):

```bash
# Check current IP
ipconfig getifaddr en0

# Regenerate certificates with new IP
rm -rf certs/
./scripts/setup-https.sh
```

### Port Already in Use

If port 8080 is busy:

```bash
# Check what's using the port
lsof -ti:8080

# Kill the process if needed
kill -9 $(lsof -ti:8080)
```

### Browser Cache Issues

If you're having issues after certificate changes:

1. Clear browser cache and cookies for localhost
2. Restart the browser
3. Try incognito/private mode

## Network Address Detection

The app automatically detects the appropriate URL for phone access:

- **Localhost access:** Automatically converts to network IP for QR codes
- **Network access:** Uses current URL as-is
- **Domain access:** Works with existing SSL certificates

You can see the detected address in:

- Browser console logs
- Camera configuration UI (blue info box)

## Security Notes

- These certificates are only trusted on your local machine
- They're perfect for development but should never be used in production
- The private key is stored locally and should not be shared
- Certificates expire after 3 months for security

## Production Deployment

For production:

- Use a proper SSL certificate from a trusted CA
- Configure your reverse proxy (nginx, Apache) or hosting platform
- Ensure HTTPS is enforced across your entire application

## Verification

To verify HTTPS is working:

1. **Check the URL bar:** Should show `https://` with a lock icon
2. **Check console:** Network address detection should show HTTPS URLs
3. **Test camera access:** `getUserMedia()` should work without security errors
4. **Check from phone:** Camera permissions should be available

### Quick Test Page

We've included a dedicated camera test page for easy verification:

**Desktop:** `https://localhost:8080/test-camera.html`
**Phone:** `https://192.168.1.103:8080/test-camera.html`

This page will:

- ✅ Verify HTTPS and secure context
- ✅ Test camera permissions and `getUserMedia()`
- ✅ Display real-time video stream
- ✅ Show detailed connection information
- ✅ Provide troubleshooting guidance

### Expected Results

**✅ Success indicators:**

- Green protocol check: "Camera access should work!"
- Camera permission prompt appears
- Video stream displays without errors
- No console security warnings

**❌ Failure indicators:**

- Red protocol check: "Camera access may be blocked"
- `NotAllowedError` or `NotSecureError` in console
- No camera permission prompt
- "This site is not secure" warnings

## Additional Resources

- [mkcert GitHub Repository](https://github.com/FiloSottile/mkcert)
- [MDN: getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Chrome Developer: HTTPS for Localhost](https://web.dev/how-to-use-local-https/)
