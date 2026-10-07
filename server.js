const express = require('express');
const https = require('https');
const app = express();

app.use(express.json());

const activeAccounts = new Map();
const pendingCommands = new Map();

// Helper สำหรับเรียก Roblox API ฝั่ง Node.js (หลีกเลี่ยง CORS บน Browser)
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
                    } else {
                        resolve(null);
                    }
                } catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

// 1. API รับข้อมูลจาก Executor
app.post('/api/update', async (req, res) => {
    const { userId, username, displayName, placeId, jobId, gameName, executor, status, details } = req.body;
    
    if (!userId) return res.status(400).json({ error: 'Invalid Data' });

    const uid = String(userId);

    // ดึงรูป Avatar ผ่าน Server
    let avatarUrl = activeAccounts.has(uid) ? activeAccounts.get(uid).avatarUrl : null;
    if (!avatarUrl) {
        avatarUrl = await fetchRobloxAvatar(uid);
    }

    activeAccounts.set(uid, {
        userId: uid,
        username: username || 'Unknown',
        displayName: displayName || 'Unknown',
        placeId: placeId || '',
        jobId: jobId || '',
        gameName: gameName || `Place ID: ${placeId}`,
        executor: executor || 'Unknown',
        status: status || 'Online',
        details: details || 'Active',
        avatarUrl: avatarUrl || 'https://tr.rbxcdn.com/30day-avatar-headshot',
        lastSeen: Date.now()
    });

    const commandToExecute = pendingCommands.get(uid) || null;
    if (commandToExecute) {
        pendingCommands.delete(uid);
    }

    res.json({
        success: true,
        action: commandToExecute
    });
});

// 2. API สั่ง Kick และลบบัญชีออกจากการ์ด
app.post('/api/kick', (req, res) => {
    const { userId } = req.body;
    const uid = String(userId);

    if (activeAccounts.has(uid)) {
        pendingCommands.set(uid, 'kick');
        // ลบข้อมูลออกจาก List ทันทีเมื่อผู้ใช้สั่งเตะการ์ดนั้น
        activeAccounts.delete(uid);
        return res.json({ success: true, message: 'ส่งคำสั่ง Kick และลบการ์ดเรียบร้อย' });
    }
    res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
});

// 3. API ดึงรายชื่อบัญชี
app.get('/api/accounts', (req, res) => {
    const now = Date.now();
    const result = [];

    activeAccounts.forEach((acc, uid) => {
        // ถ้าไม่ส่งข้อมูลเกิน 12 วินาที ให้ตัดออกจากหน้าเว็บ
        if (now - acc.lastSeen > 12000) {
            activeAccounts.delete(uid);
        } else {
            result.push(acc);
        }
    });

    res.json(result);
});

// 4. หน้าเว็บ UI
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Roblox Tracker & Control</title>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            :root {
                --bg: #0b0f19; --card: #151c2c; --border: #232d42;
                --text: #f8fafc; --sub: #94a3b8; --success: #10b981;
                --danger: #ef4444; --accent: #6366f1;
            }
            body { background: var(--bg); color: var(--text); font-family: 'Plus Jakarta Sans', sans-serif; margin: 0; padding: 24px; }
            .header { max-width: 1200px; margin: 0 auto 30px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; max-width: 1200px; margin: 0 auto; }
            .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; box-shadow: 0 10px 20px rgba(0,0,0,0.3); }
            .user-info { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
            .avatar { width: 55px; height: 55px; border-radius: 50%; border: 2px solid var(--border); background: #0f172a; object-fit: cover; }
            .badge { padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: bold; background: rgba(16,185,129,0.15); color: var(--success); }
            .details { background: rgba(0,0,0,0.25); padding: 12px; border-radius: 10px; font-size: 0.85rem; line-height: 1.6; margin-bottom: 15px; }
            .btn-kick { width: 100%; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border: none; padding: 10px; border-radius: 8px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: transform 0.1s; }
            .btn-kick:active { transform: scale(0.98); }
        </style>
    </head>
    <body>
        <div class="header">
            <h2><i class="fa-solid fa-shield-halved" style="color: var(--accent);"></i> Roblox Live Tracker</h2>
            <span style="color: var(--sub); font-size: 0.85rem;"><i class="fa-solid fa-rotate fa-spin"></i> Realtime Auto-Sync</span>
        </div>
        <div class="grid" id="accountGrid">กำลังโหลดข้อมูล...</div>

        <script>
            async function kickAccount(userId) {
                if(!confirm("สั่งเตะตัวละครนี้ออกจากเกม และลบการ์ดออกใช่หรือไม่?")) return;
                try {
                    await fetch('/api/kick', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ userId: userId })
                    });
                    fetchAccounts();
                } catch(e) { alert("เกิดข้อผิดพลาด"); }
            }

            async function fetchAccounts() {
                try {
                    const res = await fetch('/api/accounts');
                    const data = await res.json();
                    const container = document.getElementById('accountGrid');
                    
                    if(data.length === 0) {
                        container.innerHTML = '<p style="color: var(--sub); grid-column: 1/-1; text-align: center;">ไม่มีบัญชีที่กำลังออนไลน์ในขณะนี้</p>';
                        return;
                    }

                    container.innerHTML = data.map(acc => {
                        return \`
                        <div class="card">
                            <div class="user-info">
                                <img src="\${acc.avatarUrl}" class="avatar" alt="Avatar" onerror="this.src='https://tr.rbxcdn.com/30day-avatar-headshot'">
                                <div>
                                    <h3 style="margin:0; font-size: 1.1rem;">\${acc.displayName}</h3>
                                    <p style="margin:2px 0 6px 0; color:var(--sub); font-size:0.8rem;">@\${acc.username} (\${acc.userId})</p>
                                    <span class="badge">\${acc.status}</span>
                                </div>
                            </div>
                            <div class="details">
                                <div><b><i class="fa-solid fa-map-location-dot"></i> แมพ:</b> <span style="color:#38bdf8;">\${acc.gameName}</span></div>
                                <div><b><i class="fa-solid fa-terminal"></i> Executor:</b> \${acc.executor}</div>
                                <div><b><i class="fa-solid fa-server"></i> Job ID:</b> <span style="font-family:monospace;">\${acc.jobId.slice(0,10)}...</span></div>
                                <div><b><i class="fa-solid fa-circle-info"></i> สถานะ:</b> \${acc.details}</div>
                            </div>
                            <button class="btn-kick" onclick="kickAccount('\${acc.userId}')">
                                <i class="fa-solid fa-power-off"></i> สั่ง Disconnect (Kick)
                            </button>
                        </div>
                        \`;
                    }).join('');
                } catch(e) { console.error(e); }
            }

            setInterval(fetchAccounts, 2500);
            fetchAccounts();
        </script>
    </body>
    </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
