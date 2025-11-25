import express from 'express';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_FILE = './checkins.json';
const IMAGE_DIR = './uploads';
if(!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR);

const upload = multer({ dest: IMAGE_DIR });
const PORT = process.env.PORT || 3000;

// Serve frontend and uploaded images
app.use('/uploads', express.static(IMAGE_DIR));
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

const loadCheckins = () => fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : [];
const saveCheckins = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// Kiosk ticket submission (no images)
app.post('/checkin', async (req, res) => {
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
    res.json({ success: true, qr });
});

// Visitor QR page
app.get('/status/:id', (req, res) => {
    const checkins = loadCheckins();
    const ticket = checkins.find(t => t.id == req.params.id);
    if(!ticket) return res.send("<h1>Ticket not found</h1>");

    let html = `<h1>Hello ${ticket.name}</h1><p>Status: <strong>${ticket.status}</strong></p>`;

    // Admin responses (formatted)
    if(ticket.adminResponses.length > 0){
        html += `<h3>Admin Responses:</h3><div>`;
        ticket.adminResponses.forEach(r=>{
            html += `<div style="border:1px solid #ccc; padding:8px; margin-bottom:5px;">
                        ${r.message}
                        ${r.image? `<br><img src="${r.image}" style="max-width:150px;">`: ''}
                        <br><small>${new Date(r.timestamp).toLocaleString()}</small>
                     </div>`;
        });
        html += `</div>`;
    }

    // Visitor follow-up form (plain text only)
    html += `
        <h3>Send Follow-up / Appeal:</h3>
        <form method="POST" action="/followup/${ticket.id}" enctype="multipart/form-data">
            <textarea name="message" placeholder="Your message" required></textarea><br>
            <input type="file" name="image" accept="image/*"><br>
            <button type="submit">Send Follow-up</button>
        </form>
    `;

    res.send(html);
});

// Visitor follow-up (plain text only)
app.post('/followup/:id', upload.single('image'), (req,res)=>{
    const checkins = loadCheckins();
    const ticket = checkins.find(t => t.id == req.params.id);
    if(!ticket) return res.status(404).send("Ticket not found");

    ticket.visitorResponses.push({
        message: req.body.message,
        image: req.file ? `/uploads/${req.file.filename}` : '',
        timestamp: new Date()
    });

    if(ticket.status==='declined' || ticket.status==='closed'){
        ticket.status = 'opened';
    }

    saveCheckins(checkins);
    res.redirect(`/status/${ticket.id}`);
});

// Admin dashboard
app.get('/admin', (req,res)=>{
    const checkins = loadCheckins();

    // Separate categories
    const waiting = checkins.filter(c=>c.status==='opened');
    const inProgress = checkins.filter(c=>c.status==='accepted');
    const closed = checkins.filter(c=>c.status==='closed' || c.status==='declined');

    const renderTicketRow = (t) => {
        // red dot if visitorResponses.length > lastAdminResponse timestamp
        const lastAdmin = t.adminResponses.length ? new Date(t.adminResponses[t.adminResponses.length-1].timestamp) : 0;
        const hasNew = t.visitorResponses.some(v => new Date(v.timestamp) > lastAdmin);
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

    html += `<h2>Waiting for Review</h2><table border="1">
            <tr><th>Name</th><th>Email</th><th>Phone</th><th>Request</th><th>Status</th><th>Actions</th></tr>`;
    waiting.forEach(t=>{ html+=renderTicketRow(t); });
    html += `</table>`;

    html += `<h2>In Progress / Accepted</h2><table border="1">
            <tr><th>Name</th><th>Email</th><th>Phone</th><th>Request</th><th>Status</th><th>Actions</th></tr>`;
    inProgress.forEach(t=>{ html+=renderTicketRow(t); });
    html += `</table>`;

    html += `<h2>Closed / Declined</h2><table border="1">
            <tr><th>Name</th><th>Email</th><th>Phone</th><th>Request</th><th>Status</th><th>Actions</th></tr>`;
    closed.forEach(t=>{ html+=renderTicketRow(t); });
    html += `</table>`;

    res.send(html);
});

// Admin review page
app.get('/review/:id', (req,res)=>{
    const checkins = loadCheckins();
    const t = checkins.find(c=>c.id==req.params.id);
    if(!t) return res.send("Ticket not found");

    const declineOptions = ['Incomplete info','Not eligible','Other'];
    const declineHTML = declineOptions.map(o=>`<option value="${o}">${o}</option>`).join('');

    let html = `
    <h1>Review Ticket: ${t.name}</h1>
    <p>${t.request}</p>

    ${t.visitorResponses.length ? '<h3>Visitor Messages:</h3>' : ''}
    ${t.visitorResponses.map(v => `<div style="border:1px solid #ccc; padding:5px; margin-bottom:5px;">
        ${v.message}
        ${v.image ? `<br><img src="${v.image}" style="max-width:100px;">` : ''}
        <br><small>${new Date(v.timestamp).toLocaleString()}</small>
    </div>`).join('')}

    <form method="POST" action="/respond/${t.id}">
        <label>Action:</label>
        <select id="actionSelect" name="action">
            <option value="">--Select--</option>
            <option value="accept">Accept</option>
            <option value="decline">Decline</option>
            <option value="close">Close</option>
        </select>

        <div id="acceptFields" style="display:none; margin-top:10px;">
            <label>Message (formatted HTML allowed):</label>
            <textarea name="message" rows="6" style="width:100%;"></textarea><br>
            <label>Cite Website (optional):</label>
            <input type="text" name="website" placeholder="https://example.com">
        </div>

        <div id="declineFields" style="display:none; margin-top:10px;">
            <label>Decline reason:</label>
            <select name="decline_reason">
                <option value="">--Select reason--</option>
                ${declineHTML}
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
    </script>
    `;
    res.send(html);
});

// Handle admin response
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
