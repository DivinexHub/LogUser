const express = require('express');
const https = require('https');
const crypto = require('crypto');
const app = express();

app.use(express.json({ limit: '10mb' }));

const users = new Map();
const activeAccounts = new Map();
const pendingCommands = new Map();

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function fetchRobloxAvatar(userId) {
    return new Promise((resolve) => {
        const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.data && parsed.data[0] && parsed.data[0].imageUrl) {
                        resolve(parsed.data[0].imageUrl);
                    } else { resolve(null); }
                } catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

// ====================================================
// 1. ENDPOINT สำหรับ LOADSTRING (/script.lua)
// ====================================================
app.get('/script.lua', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.send(`
local RawKey = getgenv().SecretKey or "default_user"
local SECRET_KEY = string.lower(tostring(RawKey))

local SERVER_URL = "https://loguser.onrender.com/api/update"
local Players = game:GetService("Players")
local TeleportService = game:GetService("TeleportService")
local HttpService = game:GetService("HttpService")
local MarketplaceService = game:GetService("MarketplaceService")
local CoreGui = game:GetService("CoreGui")

local LocalPlayer = Players.LocalPlayer
local savedPosition = nil

-- บันทึกพิกัดตัวละคร
task.spawn(function()
    while task.wait(1) do
        pcall(function()
            if LocalPlayer.Character and LocalPlayer.Character:FindFirstChild("HumanoidRootPart") then
                savedPosition = LocalPlayer.Character.HumanoidRootPart.CFrame
            end
        end)
    end
end)

-- โหลดสคริปต์ซ้ำอัตโนมัติเมื่อ Teleport ย้าย Map/Server (QueueOnTeleport)
local function queueScript()
    local queueFunc = (syn and syn.queue_on_teleport) or queue_on_teleport or (fluxus and fluxus.queue_on_teleport)
    if queueFunc then
        pcall(function()
            queueFunc('getgenv().SecretKey = "' .. SECRET_KEY .. '"; loadstring(game:HttpGet("https://loguser.onrender.com/script.lua"))()')
        end)
    end
end

-- ย้ายตำแหน่งเดิมหลังจากวาร์ปเสร็จ
local function restorePosition()
    local joinData = LocalPlayer:GetJoinData()
    if joinData and joinData.TeleportData and joinData.TeleportData.pos then
        local p = joinData.TeleportData.pos
        local targetCFrame = CFrame.new(p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12])
        task.spawn(function()
            local char = LocalPlayer.Character or LocalPlayer.CharacterAdded:Wait()
            local hrp = char:WaitForChild("HumanoidRootPart", 10)
            if hrp then
                task.wait(1.5)
                hrp.CFrame = targetCFrame
            end
        end)
    end
end
pcall(restorePosition)

-- ฟังก์ชัน Rejoin
local isRejoining = false
local function safeRejoin()
    if isRejoining then return end
    isRejoining = true

    queueScript()

    local teleportOptions = Instance.new("TeleportOptions")
    if savedPosition then
        local c = {savedPosition:GetComponents()}
        teleportOptions:SetTeleportData({ pos = c })
    end

    -- สุ่มย้ายไป Server อื่นถ้าอยู่ใน Server เดิมคนเดียว
    pcall(function()
        TeleportService:Teleport(game.PlaceId, LocalPlayer, teleportOptions:GetTeleportData())
    end)

    task.wait(3)
    pcall(function()
        TeleportService:TeleportToPlaceInstance(game.PlaceId, game.JobId, LocalPlayer, nil, teleportOptions:GetTeleportData())
    end)
    
    task.wait(3)
    isRejoining = false
end

-- ดักจับกรณี Teleport ล้มเหลว ให้ลองใหม่
TeleportService.TeleportInitFailed:Connect(function()
    isRejoining = false
    task.wait(2)
    safeRejoin()
end)

local gameTitle = "Place ID: " .. tostring(game.PlaceId)
task.spawn(function()
    for i = 1, 5 do
        local success, result = pcall(function()
            return MarketplaceService:GetProductInfo(game.PlaceId).Name
        end)
        if success and result and result ~= "" then gameTitle = result; break end
        task.wait(2)
    end
end)

local function getExecutorName()
    return (identifyexecutor and identifyexecutor()) or (getexecutorname and getexecutorname()) or "Unknown Executor"
end

local b = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local function base64Decode(data)
    data = string.gsub(data, '[^'..b..'=]', '')
    return (data:gsub('.', function(x)
        if (x == '=') then return '' end
        local r, f = '', (b:find(x) - 1)
        for i = 6, 1, -1 do r = r .. (f % 2^i - f % 2^(i-1) >= 1 and '1' or '0') end
        return r;
    end):gsub('%d%d%d%d%d%d%d%d', function(x)
        local c = 0
        for i = 1, 8 do c = c + (x:sub(i, i) == '1' and 2^(8-i) or 0) end
        return string.char(c)
    end))
end

local manualKicked = false

local function sendStatus(statusType, details)
    if manualKicked then return end
    local payload = {
        secretKey = SECRET_KEY,
        userId = LocalPlayer.UserId,
        username = LocalPlayer.Name,
        displayName = LocalPlayer.DisplayName,
        placeId = game.PlaceId,
        jobId = game.JobId,
        gameName = gameTitle,
        executor = getExecutorName(),
        status = statusType or "Online",
        details = details or "Active"
    }
    local requestFunc = (syn and syn.request) or (http and http.request) or request or http_request
    if requestFunc then
        pcall(function()
            local res = requestFunc({
                Url = SERVER_URL,
                Method = "POST",
                Headers = {["Content-Type"] = "application/json"},
                Body = HttpService:JSONEncode(payload)
            })
            if res and res.Body then
                local resData = HttpService:JSONDecode(res.Body)
                if resData and resData.action then
                    local act = resData.action
                    if act == "kick" then
                        manualKicked = true
                        LocalPlayer:Kick("\\n[Web Control]\\nถูกสั่ง Disconnect จากหน้าเว็บ")
                    elseif act == "rejoin" then 
                        safeRejoin()
                    elseif string.sub(act, 1, 8) == "execute:" then
                        local encodedCode = string.sub(act, 9)
                        local success, codeToRun = pcall(function() return base64Decode(encodedCode) end)
                        if success and codeToRun then
                            task.spawn(function()
                                local func, err = loadstring(codeToRun)
                                if func then func() else warn("[Exec Error]: " .. tostring(err)) end
                            end)
                        end
                    end
                end
            end
        end)
    end
end

-- พยายาม Rejoin ล่วงหน้าหากขึ้น Error Prompt
CoreGui.RobloxPromptGui.promptOverlay.ChildAdded:Connect(function(child)
    if child.Name == "ErrorPrompt" and not manualKicked then
        pcall(safeRejoin)
    end
end)

task.spawn(function()
    while task.wait(3) do
        if not manualKicked then sendStatus("Online", "Active") end
    end
end)
sendStatus("Online", "Connected")
    `);
});

// ====================================================
// 2. AUTH & USER API ENDPOINTS
// ====================================================
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
    
    const userLower = username.toLowerCase().trim();
    if (users.has(userLower)) return res.status(400).json({ error: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' });

    users.set(userLower, {
        passwordHash: hashPassword(password),
        userKey: userLower
    });

    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const userLower = (username || '').toLowerCase().trim();
    const user = users.get(userLower);

    if (!user || user.passwordHash !== hashPassword(password)) {
        return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    res.json({ success: true, userKey: user.userKey });
});

app.post('/api/update', async (req, res) => {
    const { secretKey, userId, username, displayName, placeId, jobId, gameName, executor } = req.body;
    if (!userId) return res.status(400).json({ error: 'Invalid Data' });

    const key = (secretKey || 'default_user').toLowerCase().trim();
    const uid = String(userId);
    let avatarUrl = activeAccounts.has(uid) ? activeAccounts.get(uid).avatarUrl : null;
    if (!avatarUrl) {
        avatarUrl = await fetchRobloxAvatar(uid);
    }

    activeAccounts.set(uid, {
        secretKey: key,
        userId: uid,
        username: username || 'Unknown',
        displayName: displayName || 'Unknown',
        placeId: placeId || '',
        jobId: jobId || '',
        gameName: gameName || `Place ID: ${placeId}`,
        executor: executor || 'Unknown',
        status: 'Active',
        avatarUrl: avatarUrl || 'https://tr.rbxcdn.com/30day-avatar-headshot',
        lastSeen: Date.now()
    });

    const commandToExecute = pendingCommands.get(uid) || null;
    if (commandToExecute) pendingCommands.delete(uid);

    res.json({ success: true, action: commandToExecute });
});

app.post('/api/action', (req, res) => {
    const { userId, action, code } = req.body;
    const uid = String(userId);

    if (activeAccounts.has(uid)) {
        const acc = activeAccounts.get(uid);
        if (action === 'kick') {
            pendingCommands.set(uid, 'kick');
            acc.status = 'Disconnected';
        } else if (action === 'rejoin') {
            pendingCommands.set(uid, 'rejoin');
        } else if (action === 'execute') {
            pendingCommands.set(uid, `execute:${code}`);
        }
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'User not found' });
});

app.get('/api/accounts', (req, res) => {
    const userKey = (req.query.key || '').toLowerCase().trim();
    const now = Date.now();
    const result = [];
    
    activeAccounts.forEach((acc) => {
        if (acc.secretKey === userKey) {
            if (acc.status !== 'Disconnected' && (now - acc.lastSeen > 12000)) {
                acc.status = 'Not in Game';
            }
            result.push(acc);
        }
    });
    
    res.json(result);
});

// ====================================================
// 3. FRONTEND (LOGIN & DASHBOARD UI)
// ====================================================
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Roblox Control Center</title>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            :root {
                --bg: #07090e; --card-bg: rgba(15, 23, 42, 0.75); --border: rgba(255, 255, 255, 0.08);
                --text-main: #f8fafc; --text-sub: #64748b; --accent: #6366f1; --success: #10b981;
                --warning: #f59e0b; --danger: #f43f5e;
            }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
                background-color: var(--bg);
                background-image: radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%);
                color: var(--text-main); font-family: 'Plus Jakarta Sans', sans-serif; min-height: 100vh; padding: 32px 24px;
            }
            .container { max-width: 1320px; margin: 0 auto; }
            
            .auth-box {
                max-width: 400px; margin: 80px auto; background: var(--card-bg); border: 1px solid var(--border);
                border-radius: 20px; padding: 32px; backdrop-filter: blur(12px); text-align: center;
            }
            .auth-box h2 { font-size: 1.5rem; margin-bottom: 20px; }
            .auth-input { width: 100%; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 10px; padding: 12px; color: white; margin-bottom: 14px; outline: none; }
            .auth-input:focus { border-color: var(--accent); }
            .auth-btn { width: 100%; background: var(--accent); color: white; border: none; padding: 12px; border-radius: 10px; font-weight: 700; cursor: pointer; margin-bottom: 10px; }
            .auth-btn-sub { background: transparent; border: 1px solid var(--border); color: var(--text-sub); }
            
            .header-panel {
                background: var(--card-bg); backdrop-filter: blur(12px); border: 1px solid var(--border);
                border-radius: 20px; padding: 20px 28px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;
            }
            .brand { display: flex; align-items: center; gap: 14px; }
            .brand-icon { width: 46px; height: 46px; background: linear-gradient(135deg, var(--accent), #4f46e5); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; color: white; }
            .user-tag { background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); color: #818cf8; padding: 6px 14px; border-radius: 20px; font-size: 0.82rem; font-weight: 700; }
            .logout-btn { background: rgba(244, 63, 94, 0.15); color: var(--danger); border: 1px solid rgba(244, 63, 94, 0.3); padding: 6px 14px; border-radius: 20px; cursor: pointer; font-weight: 700; font-size: 0.82rem; margin-left: 10px; }

            .script-guide {
                background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 14px; padding: 14px 20px; margin-bottom: 24px; color: #34d399; font-size: 0.85rem; font-weight: 600; display: flex; justify-content: space-between; align-items: center;
            }

            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 24px; }
            .card { background: var(--card-bg); backdrop-filter: blur(12px); border: 1px solid var(--border); border-radius: 20px; padding: 22px; display: flex; flex-direction: column; justify-content: space-between; position: relative; overflow: hidden; }
            .card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--accent), var(--success)); }
            
            .user-profile { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
            .user-info { display: flex; align-items: center; gap: 14px; }
            .avatar { width: 56px; height: 56px; border-radius: 16px; object-fit: cover; border: 2px solid var(--border); background: #020617; }
            .user-meta h3 { font-size: 1.05rem; font-weight: 700; }
            .user-meta p { font-size: 0.8rem; color: var(--text-sub); }

            .status-tag { padding: 4px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; }
            .status-tag.active { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
            .status-tag.disconnected { background: rgba(244, 63, 94, 0.15); color: #f87171; border: 1px solid rgba(244, 63, 94, 0.3); }
            .status-tag.notingame { background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); }

            .info-grid { background: rgba(2, 6, 23, 0.5); border: 1px solid var(--border); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 0.82rem; margin-bottom: 16px; }
            .info-item { display: flex; justify-content: space-between; }
            .info-label { color: var(--text-sub); }
            .info-value { font-weight: 600; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

            .exec-box { margin-bottom: 16px; }
            .exec-input { width: 100%; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 8px; color: #a5f3fc; padding: 10px; font-family: monospace; font-size: 0.8rem; resize: vertical; height: 70px; margin-bottom: 6px; }
            .exec-input:focus { outline: none; border-color: var(--accent); }
            .btn-exec { width: 100%; background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); padding: 8px; border-radius: 8px; font-weight: 600; font-size: 0.8rem; cursor: pointer; transition: all 0.2s; }
            .btn-exec:hover { background: var(--accent); color: white; }

            .actions-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .btn-act { padding: 10px; border-radius: 10px; font-weight: 700; font-size: 0.82rem; cursor: pointer; border: none; display: flex; align-items: center; justify-content: center; gap: 6px; }
            .btn-rejoin { background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); }
            .btn-rejoin:hover { background: var(--warning); color: white; }
            .btn-kick { background: rgba(244, 63, 94, 0.15); color: var(--danger); border: 1px solid rgba(244, 63, 94, 0.3); }
            .btn-kick:hover { background: var(--danger); color: white; }

            .empty-state { grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: var(--card-bg); border-radius: 20px; border: 1px solid var(--border); color: var(--text-sub); }
        </style>
    </head>
    <body>
        <div id="authPanel" class="auth-box">
            <h2 id="authTitle"><i class="fa-solid fa-user-shield" style="color: var(--accent);"></i> เข้าสู่ระบบ</h2>
            <input type="text" id="username" class="auth-input" placeholder="ชื่อผู้ใช้ (Username)">
            <input type="password" id="password" class="auth-input" placeholder="รหัสผ่าน (Password)">
            <button class="auth-btn" onclick="handleAuth()"><span id="authBtnText">เข้าสู่ระบบ</span></button>
            <button class="auth-btn auth-btn-sub" onclick="toggleAuthMode()"><span id="subBtnText">ยังไม่มีบัญชี? สมัครสมาชิก</span></button>
        </div>

        <div id="dashPanel" class="container" style="display: none;">
            <div class="header-panel">
                <div class="brand">
                    <div class="brand-icon"><i class="fa-solid fa-cubes"></i></div>
                    <div>
                        <h1 style="font-size: 1.25rem;">Roblox Control Hub</h1>
                        <p style="font-size: 0.8rem; color: var(--text-sub);">Remote Command Center</p>
                    </div>
                </div>
                <div>
                    <span class="user-tag"><i class="fa-solid fa-user"></i> <span id="currentUserName">User</span></span>
                    <button class="logout-btn" onclick="logout()"><i class="fa-solid fa-right-from-bracket"></i> ออกจากระบบ</button>
                </div>
            </div>

            <div class="script-guide">
                <span><i class="fa-solid fa-code"></i> โค้ดสำหรับวางใน Executor บนมือถือของคุณ:</span>
                <code id="luaScriptCode" style="background: rgba(0,0,0,0.4); padding: 4px 10px; border-radius: 6px; font-family: monospace;">getgenv().SecretKey = "..." ; loadstring(...)()</code>
            </div>

            <div class="grid" id="accountGrid">
                <div class="empty-state" id="emptyState">
                    <i class="fa-solid fa-ghost fa-2x"></i><br><br>ไม่มีตัวละครกำลังออนไลน์ในบัญชีนี้
                </div>
            </div>
        </div>

        <script>
            let isRegisterMode = false;
            let loggedInUserKey = localStorage.getItem('app_user_key');

            function toggleAuthMode() {
                isRegisterMode = !isRegisterMode;
                document.getElementById('authTitle').innerHTML = isRegisterMode ? '<i class="fa-solid fa-user-plus" style="color: var(--accent);"></i> สมัครสมาชิก' : '<i class="fa-solid fa-user-shield" style="color: var(--accent);"></i> เข้าสู่ระบบ';
                document.getElementById('authBtnText').innerText = isRegisterMode ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
                document.getElementById('subBtnText').innerText = isRegisterMode ? 'มีบัญชีอยู่แล้ว? เข้าสู่ระบบ' : 'ยังไม่มีบัญชี? สมัครสมาชิก';
            }

            async function handleAuth() {
                const u = document.getElementById('username').value.trim();
                const p = document.getElementById('password').value.trim();
                if(!u || !p) return alert('กรุณากรอก Username และ Password');

                const endpoint = isRegisterMode ? '/api/register' : '/api/login';
                try {
                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ username: u, password: p })
                    });
                    const data = await res.json();
                    if(!res.ok) return alert(data.error || 'เกิดข้อผิดพลาด');

                    if(isRegisterMode) {
                        alert('สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบ');
                        toggleAuthMode();
                    } else {
                        loggedInUserKey = data.userKey;
                        localStorage.setItem('app_user_key', loggedInUserKey);
                        checkLoginState();
                    }
                } catch(e) { alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้'); }
            }

            function logout() {
                localStorage.removeItem('app_user_key');
                loggedInUserKey = null;
                checkLoginState();
            }

            function checkLoginState() {
                if(loggedInUserKey) {
                    document.getElementById('authPanel').style.display = 'none';
                    document.getElementById('dashPanel').style.display = 'block';
                    document.getElementById('currentUserName').innerText = loggedInUserKey;
                    document.getElementById('luaScriptCode').innerText = \`getgenv().SecretKey = "\${loggedInUserKey}"\\nloadstring(game:HttpGet("https://loguser.onrender.com/script.lua"))()\`;
                    fetchAccounts();
                } else {
                    document.getElementById('authPanel').style.display = 'block';
                    document.getElementById('dashPanel').style.display = 'none';
                }
            }

            function encodeBase64Safe(str) {
                return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
                    return String.fromCharCode('0x' + p1);
                }));
            }

            async function sendAction(userId, action) {
                try {
                    let codePayload = '';
                    if (action === 'execute') {
                        const inputElem = document.getElementById('code-' + userId);
                        if (!inputElem || !inputElem.value.trim()) return alert('กรุณาใส่โค้ด Luau ก่อนกดรัน');
                        codePayload = encodeBase64Safe(inputElem.value);
                    }

                    await fetch('/api/action', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ userId: userId, action: action, code: codePayload })
                    });

                    if(action === 'kick') fetchAccounts();
                    else if(action === 'execute') {
                        alert('ส่งโค้ดเรียบร้อยแล้ว!');
                        document.getElementById('code-' + userId).value = '';
                    } else alert('ส่งคำสั่ง Rejoin เรียบร้อย!');
                } catch(e) { alert('เกิดข้อผิดพลาดในการส่งคำสั่ง'); }
            }

            function getStatusBadge(status) {
                if (status === 'Active') return '<span class="status-tag active"><i class="fa-solid fa-circle"></i> Active</span>';
                if (status === 'Disconnected') return '<span class="status-tag disconnected"><i class="fa-solid fa-ban"></i> Disconnected</span>';
                return '<span class="status-tag notingame"><i class="fa-solid fa-plug-circle-xmark"></i> Not in Game</span>';
            }

            async function fetchAccounts() {
                if(!loggedInUserKey) return;
                try {
                    const res = await fetch('/api/accounts?key=' + encodeURIComponent(loggedInUserKey));
                    const data = await res.json();
                    const container = document.getElementById('accountGrid');
                    const emptyState = document.getElementById('emptyState');
                    
                    if(data.length === 0) {
                        if(emptyState) emptyState.style.display = 'block';
                        document.querySelectorAll('.card').forEach(card => card.remove());
                        return;
                    } else {
                        if(emptyState) emptyState.style.display = 'none';
                    }

                    data.forEach(acc => {
                        let cardElem = document.getElementById('card-' + acc.userId);
                        if (!cardElem) {
                            const newCardHtml = \`
                            <div class="card" id="card-\${acc.userId}">
                                <div>
                                    <div class="user-profile">
                                        <div class="user-info">
                                            <img src="\${acc.avatarUrl}" class="avatar">
                                            <div class="user-meta">
                                                <h3>\${acc.displayName}</h3>
                                                <p>@\${acc.username}</p>
                                            </div>
                                        </div>
                                        <div id="status-\${acc.userId}">\${getStatusBadge(acc.status)}</div>
                                    </div>
                                    <div class="info-grid">
                                        <div class="info-item"><span class="info-label">Map:</span><span class="info-value" id="map-\${acc.userId}" style="color:#38bdf8;">\${acc.gameName}</span></div>
                                        <div class="info-item"><span class="info-label">Executor:</span><span class="info-value" id="exec-\${acc.userId}">\${acc.executor}</span></div>
                                    </div>
                                    <div class="exec-box">
                                        <textarea id="code-\${acc.userId}" class="exec-input" placeholder="วางโค้ด Luau ที่นี่..."></textarea>
                                        <button class="btn-exec" onclick="sendAction('\${acc.userId}', 'execute')">
                                            <i class="fa-solid fa-play"></i> Run Luau Code
                                        </button>
                                    </div>
                                </div>
                                <div class="actions-row">
                                    <button class="btn-act btn-rejoin" onclick="sendAction('\${acc.userId}', 'rejoin')"><i class="fa-solid fa-rotate"></i> Rejoin</button>
                                    <button class="btn-act btn-kick" onclick="sendAction('\${acc.userId}', 'kick')"><i class="fa-solid fa-power-off"></i> Kick</button>
                                </div>
                            </div>
                            \`;
                            container.insertAdjacentHTML('beforeend', newCardHtml);
                        } else {
                            document.getElementById('map-' + acc.userId).innerText = acc.gameName;
                            document.getElementById('exec-' + acc.userId).innerText = acc.executor;
                            document.getElementById('status-' + acc.userId).innerHTML = getStatusBadge(acc.status);
                        }
                    });
                } catch(e) { console.error(e); }
            }

            setInterval(fetchAccounts, 2500);
            checkLoginState();
        </script>
    </body>
    </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
