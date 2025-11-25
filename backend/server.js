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

// Helpers
const loadCheckins = () => fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : [];
const saveCheckins = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data,null,2));

// Kiosk submit
app.post('/checkin', async (req,res)=>{
    const checkins = loadCheckins();
    const id = Date.now();
    const ticket = {
        id,
        ...req.body,
        status: 'opened',
        adminResponses: [],
        visitorResponses: [],
        timestamp: new Date()
    };
    checkins.push(ticket);
    saveCheckins(checkins);

    const qrURL = `${req.protocol}://${req.get('host')}/status/${id}`;
    const qr = await QRCode.toDataURL(qrURL);
    res.json({success:true, qr});
});

// Visitor status page
app.get('/status/:id', (req,res)=>{
    const checkins = loadCheckins();
    const ticket = checkins.find(t => t.id == req.params.id);
    if(!ticket) return res.send("<h1>Ticket not found</h1>");

    let html = `<h1>Hello ${ticket.name}</h1><p>Status: <strong>${ticket.status}</strong></p>`;

    // Admin messages
    if(ticket.adminResponses.length){
        html += `<h3>Admin Responses:</h3>`;
        ticket.adminResponses.forEach(a=>{
            html += `<div style="border:1px solid #007bff; background:#f0f8ff; padding:5px; margin-bottom:5px;">
                        ${a.message}
                        ${a.website ? `<br><small>Cite: <a href="${a.website}" target="_blank">${a.website}</a></small>` : ''}
                        <br><small>${new Date(a.timestamp).toLocaleString()}</small>
                     </div>`;
        });
    }

    // Visitor messages
    if(ticket.visitorResponses.length){
        html += `<h3>Your Messages:</h3>`;
        ticket.visitorResponses.forEach(v=>{
            html += `<div style="border:1px solid #ccc; padding:5px; margin-bottom:5px;">
                        ${v.message}
                        ${v.image ? `<br><img src="${v.image}" style="max-width:150px;">` : ''}
                        <br><small>${new Date(v.timestamp).toLocaleString()}</small>
                     </div>`;
        });
    }

    // Follow-up form
    const allowFollowUp = true; // Only text for appeals or follow-ups
    html += `<h3>Send Follow-up / Appeal:</h3>
             <form method="POST" action="/followup/${ticket.id}" enctype="multipart/form-data">
                 <textarea name="message" placeholder="Your message" required></textarea><br>`;
    if(ticket.status==='opened'){
        html += `<input type="file" name="image" accept="image/*"><br>`;
    }
    html += `<button type="submit"${!allowFollowUp?' disabled':''}>Send Follow-up</button>
             </form>`;

    res.send(html);
});

// Visitor follow-up
app.post('/followup/:id', upload.single('image'), (req,res)=>{
    const checkins = loadCheckins();
    const ticket = checkins.find(t => t.id == req.params.id);
    if(!ticket) return res.status(404).send("Ticket not found");

    const img = (ticket.status==='opened') ? (req.file ? `/uploads/${req.file.filename}` : '') : '';

    ticket.visitorResponses.push({
        message: req.body.message,
        image: img,
        timestamp: new Date()
    });

    // Reopen if closed/declined
    if(ticket.status==='closed' || ticket.status==='declined'){
        ticket.status='opened';
    }

    saveCheckins(checkins);
    res.redirect(`/status/${ticket.id}`);
});

// Admin dashboard
app.get('/admin', (req,res)=>{
    const checkins = loadCheckins();
    const renderTicketRow = (t)=>{
        const lastAdmin = t.adminResponses.length ? new Date(t.adminResponses[t.adminResponses.length-1].timestamp) : 0;
        const hasNew = t.visitorResponses.some(v=>new Date(v.timestamp) > lastAdmin);
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

    let html = `<h1>Admin Dashboard</h1>`;
    const categories = [
        {title:'Waiting for Review', filter: t=>t.status==='opened'},
        {title:'Accepted / In Progress', filter: t=>t.status==='accepted'},
        {title:'Closed / Declined', filter: t=>t.status==='closed'||t.status==='declined'}
    ];
    categories.forEach(cat=>{
        html+=`<h2>${cat.title}</h2><table border="1">
            <tr><th>Name</th><th>Email</th><th>Phone</th><th>Request</th><th>Status</th><th>Actions</th></tr>`;
        checkins.filter(cat.filter).forEach(t=>{ html+=renderTicketRow(t); });
        html+=`</table>`;
    });
    res.send(html);
});

// Admin review page with rich text
app.get('/review/:id', (req,res)=>{
    const checkins = loadCheckins();
    const t = checkins.find(c=>c.id==req.params.id);
    if(!t) return res.send("Ticket not found");

    const declineOptions = ['Incomplete info','Not eligible','Other'];

    let html = `<h1>Review Ticket: ${t.name}</h1>
    <p><strong>Original Request:</strong> ${t.request}</p>`;

    // Visitor messages
    html += `<h3>Visitor Messages:</h3>`;
    html += t.visitorResponses.length ? t.visitorResponses.map(v=>`
    <div style="border:1px solid #ccc; padding:5px; margin-bottom:5px;">
        ${v.message}
        ${v.image ? `<br><img src="${v.image}" style="max-width:100px;">` : ''}
        <br><small>${new Date(v.timestamp).toLocaleString()}</small>
    </div>`).join('') : '<p>No visitor messages yet.</p>';

    // Admin messages
    html += `<h3>Admin Responses:</h3>`;
    html += t.adminResponses.length ? t.adminResponses.map(a=>`
    <div style="border:1px solid #007bff; padding:5px; margin-bottom:5px; background:#f0f8ff">
        ${a.message}
        ${a.website ? `<br><small>Cite: <a href="${a.website}" target="_blank">${a.website}</a></small>` : ''}
        <br><small>${new Date(a.timestamp).toLocaleString()}</small>
    </div>`).join('') : '<p>No admin responses yet.</p>';

    // Review form
    html += `<form method="POST" action="/respond/${t.id}">
        <label>Action:</label>
        <select id="actionSelect" name="action">
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

// Admin respond
app.post('/respond/:id', (req,res)=>{
    const checkins = loadCheckins();
    const t = checkins.find(c=>c.id==req.params.id);
    if(!t) return res.status(404).send("Ticket not found");

    const {action, message, decline_reason, website} = req.body;

    if(action==='accept'){
        t.status='accepted';
        if(message) t.adminResponses.push({message: message, website: website||'', timestamp: new Date()});
    } else if(action==='decline'){
        t.status='declined';
        t.adminResponses.push({message: decline_reason || 'Declined', timestamp: new Date()});
    } else if(action==='close'){
        t.status='closed';
    }

    saveCheckins(checkins);
    res.redirect('/admin');
});

app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
