const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const multer = require('multer');

const app = express();
const DATA_FILE = path.join(__dirname,'checkins.json');
const IMAGE_DIR = path.join(__dirname,'uploads');
if(!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR);

const upload = multer({ dest: IMAGE_DIR });
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(IMAGE_DIR));
app.use(express.static(path.join(__dirname,'../frontend')));

// --- Helpers ---
const loadCheckins = () => fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : [];
const saveCheckins = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2));

// --- Kiosk submit ---
app.post('/checkin', async (req,res)=>{
    const checkins = loadCheckins();
    const id = Date.now();
    const ticket = {
        id,
        ...req.body,
        status: 'opened',
        adminResponses: [],
        visitorResponses: [],
        lastAdminSeen: 0,
        timestamp: new Date()
    };
    checkins.push(ticket);
    saveCheckins(checkins);

    const qrURL = `${req.protocol}://${req.get('host')}/status/${id}`;
    const qr = await QRCode.toDataURL(qrURL);
    res.json({success:true, qr});
});

// --- Visitor status page ---
app.get('/status/:id', (req,res)=>{
    const checkins = loadCheckins();
    const t = checkins.find(x=>x.id==req.params.id);
    if(!t) return res.send("<h1>Ticket not found</h1>");

    let html = `<h1>Hello ${t.name}</h1>
                <p>Status: <strong>${t.status}</strong></p>`;

    // Conversation panel
    html += `<div class="message-panel">`;

    // Admin responses
    t.adminResponses.forEach(a=>{
        html += `<div class="message-admin">
                    ${a.message}${a.website ? `<br><small>Cite: <a href="${a.website}" target="_blank">${a.website}</a></small>`:''}
                    <div class="message-meta">${new Date(a.timestamp).toLocaleString()}</div>
                 </div>`;
    });

    // Visitor responses
    t.visitorResponses.forEach(v=>{
        html += `<div class="message-visitor">
                    ${v.message}${v.image?`<br><img src="${v.image}" style="max-width:150px;">`:''}
                    <div class="message-meta">${new Date(v.timestamp).toLocaleString()}</div>
                 </div>`;
    });
    html += `</div>`;

    // Follow-up form rules
    let allowFollowUp = false;
    if(t.status==='opened' && t.adminResponses.length>0){
        // Visitor can only respond after admin message
        const lastAdmin = t.adminResponses[t.adminResponses.length-1].timestamp;
        const lastVisitor = t.visitorResponses.length ? t.visitorResponses[t.visitorResponses.length-1].timestamp : 0;
        allowFollowUp = lastAdmin>lastVisitor;
    } else if(t.status==='closed' || t.status==='declined'){
        allowFollowUp = true; // Appeal
    }

    html += `<h3>Send Follow-up / Appeal:</h3>`;
    if(allowFollowUp){
        html += `<form method="POST" action="/followup/${t.id}">
                    <textarea name="message" placeholder="Your message" required></textarea><br>
                    <button type="submit">Send</button>
                 </form>`;
    } else {
        html += `<p>You cannot send a response yet. Wait for admin reply or click appeal if ticket is closed.</p>`;
    }

    res.send(html);
});

// --- Visitor follow-up ---
app.post('/followup/:id', (req,res)=>{
    const checkins = loadCheckins();
    const t = checkins.find(x=>x.id==req.params.id);
    if(!t) return res.status(404).send("Ticket not found");

    t.visitorResponses.push({message:req.body.message, timestamp:new Date()});

    if(t.status==='closed' || t.status==='declined'){
        t.status='opened'; // reopen on appeal
    }

    saveCheckins(checkins);
    res.redirect(`/status/${t.id}`);
});

// --- Admin dashboard ---
app.get('/admin', (req,res)=>{
    const checkins = loadCheckins();

    const renderTicketRow = (t)=>{
        const lastAdmin = t.adminResponses.length ? t.adminResponses[t.adminResponses.length-1].timestamp : 0;
        const hasNew = t.visitorResponses.some(v=>v.timestamp>lastAdmin);
        const dot = hasNew ? '🔴 ' : '';
        return `<tr>
            <td>${dot}${t.name}</td>
            <td>${t.email}</td>
            <td>${t.phone}</td>
            <td>${t.request}</td>
            <td>${t.status}</td>
            <td><a href="/review/${t.id}">Review</a></td>
        </tr>`;
    };

    let html = `<h1>Admin Dashboard</h1>
                <table border="1">
                <tr><th>Name</th><th>Email</th><th>Phone</th><th>Request</th><th>Status</th><th>Actions</th></tr>`;
    checkins.forEach(t=>html+=renderTicketRow(t));
    html += `</table>`;
    res.send(html);
});

// --- Admin review page ---
app.get('/review/:id',(req,res)=>{
    const checkins = loadCheckins();
    const t = checkins.find(c=>c.id==req.params.id);
    if(!t) return res.send("Ticket not found");

    let html = `<h1>Review Ticket: ${t.name}</h1>
                <div class="message-panel">`;

    t.adminResponses.forEach(a=>{
        html += `<div class="message-admin">
                    ${a.message}${a.website ? `<br><small>Cite: <a href="${a.website}" target="_blank">${a.website}</a></small>`:''}
                    <div class="message-meta">${new Date(a.timestamp).toLocaleString()}</div>
                 </div>`;
    });

    t.visitorResponses.forEach(v=>{
        html += `<div class="message-visitor">
                    ${v.message}${v.image?`<br><img src="${v.image}" style="max-width:150px;">`:''}
                    <div class="message-meta">${new Date(v.timestamp).toLocaleString()}</div>
                 </div>`;
    });
    html += `</div>`;

    // Only allow admin to respond if accepted
    const canRespond = t.status==='accepted' && t.visitorResponses.length>0 && (!t.adminResponses.length || t.visitorResponses[t.visitorResponses.length-1].timestamp>t.adminResponses[t.adminResponses.length-1].timestamp);

    html += `<form method="POST" action="/respond/${t.id}">
                <label>Action:</label>
                <select name="action" id="actionSelect">
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
                        <option value="Incomplete info">Incomplete info</option>
                        <option value="Not eligible">Not eligible</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
                <br><button type="submit"${!canRespond ? ' disabled' : ''}>Submit</button>
             </form>

             <br><a href="/admin">Back to Dashboard</a>

             <script>
             document.getElementById('actionSelect').addEventListener('change', function(){
                const acceptDiv = document.getElementById('acceptFields');
                const declineDiv = document.getElementById('declineFields');
                if(this.value==='accept'){
                    acceptDiv.style.display='block';
                    declineDiv.style.display='none';
                } else if(this.value==='decline'){
                    acceptDiv.style.display='none';
                    declineDiv.style.display='block';
                } else {
                    acceptDiv.style.display='none';
                    declineDiv.style.display='none';
                }
             });

             function addTag(tag){
                const textarea = document.getElementById('adminMessage');
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const selected = textarea.value.substring(start,end);
                const insert = selected ? '<'+tag+'>'+selected+'</'+tag+'>' : '<'+tag+'></'+tag+'>';
                textarea.setRangeText(insert, start, end, 'end');
                textarea.focus();
             }
             </script>`;

    res.send(html);
});

// --- Admin respond ---
app.post('/respond/:id',(req,res)=>{
    const checkins = loadCheckins();
    const t = checkins.find(c=>c.id==req.params.id);
    if(!t) return res.status(404).send("Ticket not found");

    const {action,message,decline_reason,website} = req.body;

    if(action==='accept'){
        t.status='accepted';
        if(message) t.adminResponses.push({message:message,website:website||'',timestamp:new Date()});
    } else if(action==='decline'){
        t.status='declined';
        t.adminResponses.push({message:'Declined: '+(decline_reason||'No reason'),timestamp:new Date()});
    } else if(action==='close'){
        t.status='closed';
    }

    saveCheckins(checkins);
    res.redirect('/review/'+t.id);
});

app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
