const express = require('express');
const app = express();

app.use(express.json());

// ตัวแปรเก็บข้อมูลไอดีที่กำลังออนไลน์ในหน่วยความจำ
const activeAccounts = new Map();
// ตัวแปรเก็บคำสั่งค้างไว้รอส่งให้ Executor (เช่น คำสั่ง Kick)
const pendingCommands = new Map();

// 1. API รับการอัปเดตสถานะจาก Executor
app.post('/api/update', (req, res) => {
    const { userId, username, displayName, placeId, jobId, gameName, executor, status, details } = req.body;
    
    if (!userId) return res.status(400).json({ error: 'Invalid Data' });

    const uid = String(userId);

    // อัปเดตข้อมูลบัญชี
    activeAccounts.set(uid, {
        userId: uid,
        username: username || 'Unknown',
        displayName: displayName || 'Unknown',
        placeId: placeId || '',
        jobId: jobId || '',
        gameName: gameName || `Place ID: ${placeId}`, // รับชื่อแมพตรงจาก Executor
        executor: executor || 'Unknown',
        status: status || 'Online',
        details: details || 'Active',
        lastSeen: Date.now()
    });

    // ตรวจสอบว่ามีคำสั่งค้างสำหรับ User นี้หรือไม่ (เช่น kick)
    const commandToExecute = pendingCommands.get(uid) || null;
    if (commandToExecute) {
        pendingCommands.delete(uid); // ลบคำสั่งออกเมื่อส่งแล้ว
    }

    res.json({
        success: true,
        action: commandToExecute // ส่งคำสั่งกลับไปที่ Executor
    });
});

// 2. API สั่ง Kick จากหน้าเว็บ
app.post('/api/kick', (req, res) => {
    const { userId } = req.body;
    const uid = String(userId);

    if (activeAccounts.has(uid)) {
        pendingCommands.set(uid, 'kick');
        
        // อัปเดตสถานะชั่วคราว
        const acc = activeAccounts.get(uid);
        acc.status = 'Disconnecting...';
        activeAccounts.set(uid, acc);

        return res.json({ success: true, message: 'ส่งคำสั่ง Kick แล้ว' });
    }
    res.status(404).json({ error: 'ไม่พบบัญชีนี้' });
});

// 3. API สำหรับส่งข้อมูลให้ Frontend
app.get('/api/accounts', (req, res) => {
    const now = Date.now();
    const result = [];

    activeAccounts.forEach((acc) => {
        // ถ้าไม่ได้ส่งสัญญาณเกิน 15 วินาที ถือว่า Offline
        if (now - acc.lastSeen > 15000 && acc.status !== 'Rejoining') {
            acc.status = 'Offline';
        }
        result.push(acc);
    });

    res.json(result);
});

// 4. หน้าเว็บ Dashboard UI
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Roblox Live Tracker & Control (Node.js)</title>
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            :root {
                --bg: #0b0f19; --card: #151c2c; --border: #232d42;
                --text: #f8fafc; --sub: #94a3b8; --success: #10b981;
                --warning: #f59e0b; --danger: #ef4444; --accent: #6366f1;
            }
            body { background: var(--bg); color: var(--text); font-family: 'Plus Jakarta Sans', sans-serif; margin: 0; padding: 24px; }
            .header { max-width: 1200px; margin: 0 auto 30px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; max-width: 1200px; margin: 0 auto; }
            .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 20px; box-shadow: 0 10px 20px rgba(0,0,0,0.3); transition: transform 0.2s; }
            .card:hover { transform: translateY(-2px); }
            .card.Online { border-top: 4px solid var(--success); }
            .card.Rejoining { border-top: 4px solid var(--warning); }
            .card.Offline { border-top: 4px solid var(--danger); }
            .user-info { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
            .avatar { width: 60px; height: 60px; border-radius: 50%; border: 2px solid var(--border); background: #0f172a; object-fit: cover; }
            .badge { padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: bold; }
            .badge-Online { background: rgba(16,185,129,0.15); color: var(--success); }
            .badge-Rejoining { background: rgba(245,158,11,0.15); color: var(--warning); }
            .badge-Offline { background: rgba(239,68,68,0.15); color: var(--danger); }
            .details { background: rgba(0,0,0,0.25); padding: 12px; border-radius: 10px; font-size: 0.85rem; line-height: 1.6; margin-bottom: 15px; }
            .btn-kick { width: 100%; background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border: none; padding: 10px; border-radius: 8px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: opacity 0.2s; }
            .btn-kick:hover { opacity: 0.9; }
            .btn-kick:disabled { background: #475569; cursor: not-allowed; }
        </style>
    </head>
    <body>
        <div class="header">
            <h2><i class="fa-solid fa-shield-halved" style="color: var(--accent);"></i> Roblox Live Tracker</h2>
            <span style="color: var(--sub); font-size: 0.85rem;"><i class="fa-solid fa-rotate fa-spin"></i> Live Sync</span>
        </div>
        <div class="grid" id="accountGrid">กำลังโหลดข้อมูล...</div>

        <script>
            async function kickAccount(userId) {
                if(!confirm("คุณแน่ใจหรือไม่ว่าต้องการเตะตัวละครนี้ออกจากเกม?")) return;
                try {
                    await fetch('/api/kick', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ userId: userId })
                    });
                    alert("ส่งคำสั่ง Kick แล้ว ตัวละครจะหลุดออกในไม่กี่วินาที");
                    fetchAccounts();
                } catch(e) { alert("เกิดข้อผิดพลาดในการส่งคำสั่ง"); }
            }

            async function fetchAccounts() {
                try {
                    const res = await fetch('/api/accounts');
                    const data = await res.json();
                    const container = document.getElementById('accountGrid');
                    
                    if(data.length === 0) {
                        container.innerHTML = '<p style="color: var(--sub); grid-column: 1/-1; text-align: center;">ไม่มีบัญชีที่กำลังรันสคริปต์อยู่</p>';
                        return;
                    }

                    container.innerHTML = data.map(acc => {
                        return \`
                        <div class="card \${acc.status}">
                            <div class="user-info">
                                <img src="https://via.placeholder.com/60" id="img-\${acc.userId}" class="avatar" alt="Avatar">
                                <div>
                                    <h3 style="margin:0; font-size: 1.1rem;">\${acc.displayName}</h3>
                                    <p style="margin:2px 0 6px 0; color:var(--sub); font-size:0.8rem;">@\${acc.username} (\${acc.userId})</p>
                                    <span class="badge badge-\${acc.status}">\${acc.status}</span>
                                </div>
                            </div>
                            <div class="details">
                                <div><b><i class="fa-solid fa-map-location-dot"></i> แมพ:</b> <span style="color:#38bdf8;">\${acc.gameName}</span></div>
                                <div><b><i class="fa-solid fa-terminal"></i> Executor:</b> \${acc.executor}</div>
                                <div><b><i class="fa-solid fa-server"></i> Job ID:</b> <span style="font-family:monospace;">\${acc.jobId.slice(0,10)}...</span></div>
                                <div><b><i class="fa-solid fa-circle-info"></i> สถานะ:</b> \${acc.details}</div>
                            </div>
                            <button class="btn-kick" \${acc.status === 'Offline' ? 'disabled' : ''} onclick="kickAccount('\${acc.userId}')">
                                <i class="fa-solid fa-power-off"></i> สั่ง Disconnect (Kick)
                            </button>
                        </div>
                        \`;
                    }).join('');

                    // ดึงรูป Avatar สดจาก Roblox API ฝั่ง Browser (แก้ไขปัญหาภาพดำ)
                    data.forEach(acc => {
                        fetch(\`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=\${acc.userId}&size=150x150&format=Png&isCircular=false\`)
                        .then(r => r.json())
                        .then(imgData => {
                            if(imgData.data && imgData.data[0] && imgData.data[0].imageUrl) {
                                const imgEl = document.getElementById(\`img-\${acc.userId}\`);
                                if(imgEl) imgEl.src = imgData.data[0].imageUrl;
                            }
                        }).catch(() => {});
                    });

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
    
