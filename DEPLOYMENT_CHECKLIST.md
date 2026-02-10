# Deployment Checklist for v1.1.2

## Step 1: Verify Local Code is Correct

Run in terminal:
```bash
# Check version
grep '"version"' package.json
# Should show: "version": "1.1.2"

# Verify client.js has debug logs
grep "SOCKET.IO" public/client.js
# Should show multiple [SOCKET.IO] log statements

# Verify HTML files have v=1.1.2
grep "v=1.1.2" public/index.html
# Should show 3 lines with ?v=1.1.2
```

## Step 2: Coolify - Complete Restart (NOT just redeploy)

1. Go to Coolify dashboard
2. **STOP the application completely** (don't just redeploy)
3. Wait 30 seconds for all containers to fully stop
4. Check for any lingering containers:
   ```bash
   docker ps | grep who
   docker stop <any-old-containers>
   ```
5. **Start the application fresh**

## Step 3: Cloudflare Configuration

### 3a: Check WebSocket Support
1. Cloudflare Dashboard → Network
2. Ensure "WebSockets" is **ON** (should be enabled by default)

### 3b: Fix Caching Rules
1. Cloudflare Dashboard → Rules → Page Rules
2. Add rule for `whoisthespy.chhapra.cloud/*`:
   - Cache Level: **Bypass**
   - Disable Apps
   - Disable Performance
3. OR add rule specifically for your app paths:
   - `whoisthespy.chhapra.cloud/*.html` → Cache Level: Bypass
   - `whoisthespy.chhapra.cloud/*.js` → Cache Level: Bypass
   - `whoisthespy.chhapra.cloud/socket.io/*` → Cache Level: Bypass

### 3c: Purge Everything (Again)
1. Cloudflare Dashboard → Caching → Configuration
2. **Purge Everything**
3. Wait 30 seconds

## Step 4: Browser - Nuclear Option

1. Close ALL tabs of your site
2. Open DevTools: Settings → Network → "Disable cache (while DevTools is open)" ✓
3. Open new tab: `chrome://settings/clearBrowserData`
4. Select:
   - Cached images and files ✓
   - Advanced → Hosted app data ✓
5. Click "Clear data"

## Step 5: Verification

### 5a: Test Version API Directly
Open new tab and go to:
```
https://whoisthespy.chhapra.cloud/version
```

Should show:
```json
{"version":"1.1.2"}
```

Refresh 10 times - should ALWAYS be 200, never 404.
- If you see 404 sometimes: **Multiple instances running with old code**

### 5b: Test Home Page
1. Open: `https://whoisthespy.chhapra.cloud`
2. Open DevTools Console
3. Look for these EXACT logs:
   ```
   [SOCKET.IO] Configured transports: ['websocket']
   [SOCKET.IO] Client version: 4.7.2
   [SOCKET.IO] Connected to server. Socket ID: abc123
   [SOCKET.IO] Active transport: websocket
   ```

### 5c: Test Network Tab
1. Go to Network tab
2. Filter by "WS" (WebSocket) in the filter bar
3. You should see:
   - ✅ `socket.io/?EIO=4&transport=websocket` with 101 status
   - ❌ NO xhr requests with `transport=polling`

## Step 6: Check Version Display
1. Scroll to bottom of home page
2. Should show: "Version 1.1.2"
3. If blank or wrong version: **Still serving old HTML**

---

## If Problems Persist

### Check Server Logs
```bash
# In Coolify or your VPS
docker logs <container-name> | grep "Server running"
# Should show: Server running on port 3000

docker logs <container-name> | tail -50
# Check for any errors
```

### Check File Contents on Server
```bash
# SSH into your VPS
cat /path/to/app/package.json | grep version
# Should show 1.1.2

curl -I http://localhost:3000/version
# Should return 200
```

### Nuclear Option: Redeploy from Scratch
If nothing works:
1. In Coolify: Delete the application completely
2. Re-create from the GitHub repository
3. Ensure it pulls the latest `main` branch with PR #6 merged
4. Deploy fresh
