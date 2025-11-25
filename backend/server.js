const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const multer = require('multer');

const app = express();
const DATA_FILE = path.join(__dirname, 'checkins.json');
const IMAGE_DIR = path.join(__dirname, 'uploads');
if(!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR);

const upload = multer({ dest: IMAGE_DIR });
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(IMAGE_DIR));
app.use(express.static(path.join(__dirname, '../frontend')));

// Helper functions
const loadCheckins = () => fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : [];
const saveCheckins = data => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null,2));

// ----------------- Kiosk Submit -----------------
app.post('/checkin', upload.single('image'), async (req,res)=>{
    const checkins = loadCheckins();
    const id = Date.now();
    const ticket = {
        id,
        status: 'opened',
        lastAdminSeen: null,
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        request: req.body.request,
        image: req.file ? `/uploads/${req.file.filename}` : null,
        adminResponses: [],
        visitorResponses: [],
        declineReason: null,
        timestamp: new Date()
    };
    checkins.push(ticket);
    saveCheckins(checkins);

    const qrURL = `${req.protocol}://${req.get('host')}/status/${id}`;
    const qr = await QRCode.toDataURL(qrURL);
    res.json({success:true, qr});
});

// ----------------- Visitor Status -----------------
app.get('/status/:id', (req,res)=>{
    const checkins = loadCheckins();
    const t = checkins.find(c=>c.id==req.params.id);
    if(!t) return res.send("<h1>Ticket not found</h1>");

    let html = `<div class="status-container">
    <h2>Hello ${t.name}</h2>
    <p>Status: <strong>${t.status}</strong>${t.status==='declined'?` (Reason: ${t.declineReason})`:''}</p>
    <div class="messages-panel">`;

    // Admin messages
    t.adminResponses.forEach(a=>{
        html += `<div class="message-panel admin-message">${a.message}
                 ${a.website?`<br><small>Cite: <a href="${a.website}" target="_blank">${a.website}</a></small>`:''}
                 <div class="timestamp">${new Date(a.timestamp).toLocaleString()}</div></div>`;
    });

    // Visitor messages
    t.visitorResponses.forEach(v=>{
        html += `<div class="message-panel visitor-message">${v.message}
                 ${v.image?`<br><img src="${v.image}" style="max-width:150px;">`:''}
                 <div class="timestamp">${new Date(v.timestamp).toLocaleString()}</div></div>`;
    });

    html += `</div>`;

    // Follow-up / appeal
    if(t.status==='opened' || t.status==='closed' || t.status==='declined'){
        html += `<h3>Send Message / Appeal</h3>
                 <form method="POST" action="/followup/${t.id}">
                     <textarea name="message" placeholder="Your message" required></textarea><br>`;
        if(t.status==='opened') html += `<input type="file" name="image" accept="image/*"><br>`;
        html += `<button type="submit">Send</button>
                 </form>`;
    }

    html += `</div>`;
    res.send(html);
});

// ----------------- Visitor Follow-Up -----------------
app.post('/followup/:id', upload.single('image'), (req,res)=>{
    const checkins = loadCheckins();
    const t = checkins.find(c=>c.id==req.params.id);
    if(!t) return res.status(404).send("Ticket not found");

    // Enforce rules: visitor cannot send multiple follow-ups until they see admin response
    const lastAdminTime = t.adminResponses.length ? new Date(t.adminResponses[t.adminResponses.length-1].timestamp) : 0;
    const lastVisitorTime = t.visitorResponses.length ? new Date(t.visitorResponses[t.visitorResponses.length-1].timestamp) : 0;

    if(lastAdminTime <= lastVisitorTime){
        return res.send("<p>Wait for admin response before sending another message.</p>");
    }

    t.visitorResponses.push({
        message: req.body.message,
        image: t.status==='opened' && req.file ? `/uploads/${req.file.filename}` : null,
        timestamp: new Date()
    });

    // Reopen if appeal
    if(t.status==='closed' || t.status==='declined') t.status='opened';

    saveCheckins(checkins);
    res.redirect(`/status/${t.id}`);
});

// ----------------- Admin Dashboard -----------------
app.get('/admin', (req,res)=>{
    const checkins = loadCheckins();
    const renderTicketRow = t=>{
        const lastAdmin = t.adminResponses.length ? new Date(t.adminResponses[t.adminResponses.length-1].timestamp) : 0;
        const hasNew = t.visitorResponses.some(v=>new Date(v.timestamp) > lastAdmin);
        const dot = hasNew ? '<span class="red-dot">●</span> ' : '';
        return `<tr>
            <td>${dot}${t.name}</td>
            <td>${t.email}</td>
            <td>${t.phone}</td>
            <td>${t.request}</td>
            <td>${t.status}</td>
            <td><a href="/review/${t.id}">Review</a></td>
        </tr>`;
    };

    let html = `<h1>Admin Dashboard</h1><table border="1">
                <tr><th>Name</th><th>Email</th><th>Phone</th><th>Request</th><th>Status</th><th>Actions</th></tr>`;
    checkins.forEach(t=> html+=renderTicketRow(t));
    html += '</table>';
    res.send(html);
});

// ----------------- Admin Review -----------------
app.get('/review/:id', (req,res)=>{
    const checkins = loadCheckins();
    const t = checkins.find(c=>c.id==req.params.id);
    if(!t) return res.send("Ticket not found");

    const declineOptions = ['Incomplete info','Not eligible','Other'];
    let html = `<h1>Review Ticket: ${t.name}</h1>
    <p><strong>Original Request:</strong> ${t.request}</p>
    <div class="messages-panel">`;

    t.visitorResponses.forEach(v=>{
        html += `<div class="message-panel visitor-message">${v.message}
                 ${v.image?`<br><img src="${v.image}" style="max-width:150px;">`:''}
                 <div class="timestamp">${new Date(v.timestamp).toLocaleString()}</div></div>`;
    });

    t.adminResponses.forEach(a=>{
        html += `<div class="message-panel admin-message">${a.message}
                 ${a.website?`<br><small>Cite: <a href="${a.website}" target="_blank">${a.website}</a></small>`:''}
                 <div class="timestamp">${new Date(a.timestamp).toLocaleString()}</div></div>`;
    });

    html += `</div>
    <form method="POST" action="/respond/${t.id}">
        <label>Action:</label>
        <select id="actionSelect" name="action" required>
            <option value="">--Select--</option>
            <option value="accept">Accept</option>
            <option value="decline">Decline</option>
            <option value="close">Close</option>
        </select>
        <div id="acceptFields" style="display:none; margin-top:10px;">
            <label>Message:</label>
            <div>
                <button type="button" onclick="addTag('b')"><b>B</b></button>
                <button type="button" onclick="addTag('i')"><i>I</i></button>
                <button type="button" onclick="addTag('u')"><u>U</u></button>
                <button type="button" onclick="addTag('blockquote')">Quote</button>
                <button type="button" onclick="addTag('table')">Table</button>
            </div>
            <textarea id="adminMessage" name="message" rows="6" style="width:100%;"></textarea><br>
            <label>Cite Website (optional):</label>
            <input type="text" name="website" placeholder="https://example.com">
        </div>
        <div id="declineFields" style="display:none; margin-top:10px;">
            <label>Decline reason:</label>
            <select name="decline_reason">
                <option value="">--Select reason--</option>
                ${declineOptions.map(o=>`<option value="${o}">${o}</option>`).join('')}
            </select>
        </div>
        <br><button type="submit">Submit</button>
    </form>
    <a href="/admin">Back to Dashboard</a>
    <script>
    document.getElementById('actionSelect').addEventListener('change', function(){
        document.getElementById('acceptFields').style.display = this.value==='accept'?'block':'none';
        document.getElementById('declineFields').style.display = this.value==='decline'?'block':'none';
    });
    function addTag(tag){
        const textarea = document.getElementById('adminMessage');
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.substring(start,end);
        const insert = selected?'<'+tag+'>'+selected+'</'+tag+'>':'<'+tag+'></'+tag+'>';
        textarea.setRangeText(insert, start, end, 'end');
        textarea.focus();
    }
    </script>`;

    res.send(html);
});

// ----------------- Admin Respond -----------------
app.post('/respond/:id', (req,res)=>{
    const checkins = loadCheckins();
    const t = checkins.find(c=>c.id==req.params.id);
    if(!t) return res.status(404).send("Ticket not found");

    const {action, message, website, decline_reason} = req.body;

    if(action==='accept'){
        t.status='accepted';
        if(message) t.adminResponses.push({message, website: website||'', timestamp: new Date()});
    } else if(action==='decline'){
        t.status='declined';
        t.declineReason = decline_reason || 'Declined';
        if(decline_reason) t.adminResponses.push({message:'Declined: '+decline_reason, timestamp: new Date()});
    } else if(action==='close'){
        t.status='closed';
    }

    t.lastAdminSeen = new Date();
    saveCheckins(checkins);
    res.redirect('/admin');
});

app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
