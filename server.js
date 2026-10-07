const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// หน่วยความจำเก็บข้อมูล Client (In-memory storage)
const activeAccounts = new Map();

// API Endpoint สำหรับรับข้อมูลจาก Executor
app.post('/api/update', async (req, res) => {
    const { userId, username, displayName, placeId, jobId, executor, status, details } = req.body;
    
    if (!userId) return res.status(400).send('Invalid Data');

    // ดึงข้อมูลชื่อแมพจริงจาก Roblox API
    let gameName = "Unknown Place (" + placeId + ")";
    try {
        const placeRes = await axios.get(`https://apis.roblox.com/universes/v1/places/${placeId}/universe-info`);
        const universeId = placeRes.data.universeId;
        const gameRes = await axios.get(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
        if (gameRes.data.data[0]) {
            gameName = gameRes.data.data[0].name;
        }
    } catch (e) {
        // กรณีดึงชื่อแมพไม่สำเร็จ ให้ใช้ Place ID แทน
    }

    // อัปเดตข้อมูลบัญชี
    activeAccounts.set(userId, {
        userId,
        username,
        displayName,
        placeId,
        jobId,
        gameName,
        executor,
        status,
        details,
        avatarUrl: `https://tr.rbxcdn.com/30DAY-AvatarHeadshot-${userId}/150/150/AvatarHeadshot/Png/noFilter`,
        lastSeen: Date.now()
    });

    res.json({ success: true });
});

// API สำหรับส่งข้อมูลให้ Frontend
app.get('/api/accounts', (req, res) => {
    const now = Date.now();
    const accounts = Array.from(activeAccounts.values()).map(acc => {
        // ถ้าไม่ได้ส่งสัญญาณเกิน 15 วินาที ให้ตีเป็น Disconnected
        if (now - acc.lastSeen > 15000 && acc.status !== 'Rejoining') {
            acc.status = 'Offline';
        }
        return acc;
    });
    res.json(accounts);
});

// หน้า Web Dashboard
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Roblox Live Tracker & Auto-Rejoin</title>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            :root {
                --bg: #0f172a; --card: #1e293b; --border: #334155;
                --text: #f8fafc; --sub: #94a3b8; --success: #10b981;
                --warning: #f59e0b; --danger: #ef4444; --accent: #6366f1;
            }
            body { background: var(--bg); color: var(--text); font-family: 'Plus Jakarta Sans', sans-serif; margin: 0; padding: 20px; }
            .header { display: flex; align-items: center; justify-content: space-between; max-width: 1200px; margin: 0 auto 30px; border-bottom: 1px solid var(--border); padding-bottom: 15px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; max-width: 1200px; margin: 0 auto; }
            .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; position: relative; }
            .card.Online { border-top: 4px solid var(--success); }
            .card.Rejoining { border-top: 4px solid var(--warning); }
            .card.Offline { border-top: 4px solid var(--danger); }
            .user-info { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
            .avatar { width: 60px; height: 60px; border-radius: 50%; background: #000; border: 2px solid var(--border); }
            .badge { padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: bold; }
            .badge-Online { background: rgba(16,185,129,0.2); color: var(--success); }
            .badge-Rejoining { background: rgba(245,158,11,0.2); color: var(--warning); }
            .badge-Offline { background: rgba(239,68,68,0.2); color: var(--danger); }
            .details { background: rgba(0,0,0,0.2); padding: 12px; border-radius: 10px; font-size: 0.85rem; line-height: 1.6; }
        </style>
    </head>
    <body>
        <div class="header">
            <h2><i class="fa-solid fa-gamepad"></i> Roblox Executor Live Tracker</h2>
            <span style="color: var(--sub); font-size: 0.9rem;"><i class="fa-solid fa-rotate"></i> Realtime Auto-Sync</span>
        </div>
        <div class="grid" id="accountGrid">Loading accounts...</div>

        <script>
            async function fetchAccounts() {
                try {
                    const res = await fetch('/api/accounts');
                    const data = await res.json();
                    const container = document.getElementById('accountGrid');
                    
                    if(data.length === 0) {
                        container.innerHTML = '<p style="color: var(--sub);">ไม่มีบัญชีที่กำลังออนไลน์ขณะนี้ (ให้รัน Script บน Executor)</p>';
                        return;
                    }

                    container.innerHTML = data.map(acc => \`
                        <div class="card \${acc.status}">
                            <div class="user-info">
                                <img src="\${acc.avatarUrl}" class="avatar" onerror="this.src='https://via.placeholder.com/60'">
                                <div>
                                    <h3 style="margin:0;">\${acc.displayName}</h3>
                                    <p style="margin:0; color:var(--sub); font-size:0.8rem;">@\${acc.username} (\${acc.userId})</p>
                                    <span class="badge badge-\${acc.status}">\${acc.status}</span>
                                </div>
                            </div>
                            <div class="details">
                                <div><b>แมพ:</b> \${acc.gameName}</div>
                                <div><b>Executor:</b> \${acc.executor}</div>
                                <div><b>Job ID:</b> <span style="font-family:monospace;">\${acc.jobId.slice(0,8)}...</span></div>
                                <div><b>สถานะเพิ่มเติม:</b> \${acc.details}</div>
                            </div>
                        </div>
                    \`).join('');
                } catch(e) { console.error(e); }
            }

            setInterval(fetchAccounts, 3000);
            fetchAccounts();
        </script>
    </body>
    </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
