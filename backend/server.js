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

// Submit ticket
app.post('/checkin', upload.single('image'), async (req, res) => {
    const checkins = loadCheckins();
    const id = Date.now();
    const ticket = {
        id,
        ...req.body,
        status: 'opened',
        response: [],
        website: '',
        image: req.file ? `/uploads/${req.file.filename}` : '',
        timestamp: new Date()
    };
    checkins.push(ticket);
    saveCheckins(checkins);

    const qrURL = `${req.protocol}://${req.get('host')}/status/${id}`;
    const qr = await QRCode.toDataURL(qrURL);
    res.json({ success: true, qr });
});

// Admin dashboard
app.get('/admin', (req, res) => {
    const checkins = loadCheckins();
    let html = `<h1>Helpdesk Dashboard</h1><table border="1">
        <tr><th>Name</th><th>Email</th><th>Phone</th><th>Request</th><th>Status</th><th>Actions</th></tr>`;
    checkins.reverse().forEach(c => {
        html += `<tr>
            <td>${c.name}</td>
            <td>${c.email}</td>
            <td>${c.phone}</td>
            <td>${c.request}</td>
            <td>${c.status}</td>
            <td><a href="/review/${c.id}">Review</a></td>
        </tr>`;
    });
    html += `</table>`;
    res.send(html);
});

// Review page
app.get('/review/:id', (req,res)=>{
    const checkins = loadCheckins();
    const c = checkins.find(t=>t.id == req.params.id);
    if(!c) return res.send("Ticket not found");

    const declineOptions = ['Incomplete info','Not eligible','Other'];
    const declineHTML = declineOptions.map(o=>`<option value="${o}">${o}</option>`).join('');

    let html = `
    <h1>Review Ticket: ${c.name}</h1>
    <p>${c.request}</p>
    ${c.image? `<img src="${c.image}" class="ticket-image">` : ''}
    <form method="POST" action="/respond/${c.id}">
        <label>Action:</label>
        <select id="actionSelect" name="action">
            <option value="">--Select--</option>
            <option value="accept">Accept</option>
            <option value="decline">Decline</option>
            <option value="close">Close</option>
        </select>

        <div id="acceptFields" style="display:none; margin-top:10px;">
            <label>Cite Website:</label>
            <input type="text" name="website" placeholder="https://example.com"><br>
            <label>Message:</label>
            <textarea name="message"></textarea>
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
    const c = checkins.find(t=>t.id == req.params.id);
    if(!c) return res.status(404).send("Ticket not found");

    const {action, decline_reason, website, message} = req.body;

    if(action==='accept'){
        c.status = 'accepted';
        if(message) c.response.push({type:'admin', message, website: website || ''});
    } else if(action==='decline'){
        c.status = 'declined';
        c.response.push({type:'admin', message: decline_reason || 'Declined'});
    } else if(action==='close'){
        c.status = 'closed';
    }
    saveCheckins(checkins);
    res.redirect('/admin');
});

// Visitor status page
app.get('/status/:id',(req,res)=>{
    const checkins = loadCheckins();
    const c = checkins.find(t=>t.id == req.params.id);
    if(!c) return res.send("<h1>Ticket not found</h1>");

    let html = `<h1>Hello ${c.name}</h1><p>Status: <strong>${c.status}</strong></p>`;
    if(c.image) html += `<img src="${c.image}" class="ticket-image">`;
    if(c.response.length>0){
        html += `<h3>Messages/Responses:</h3><ul>`;
        c.response.forEach(r=>{
            if(r.website) html += `<li>${r.message} (<a href="${r.website}" target="_blank">${r.website}</a>)</li>`;
            else html += `<li>${r.message}</li>`;
        });
        html += `</ul>`;
    }
    // Form for visitor follow-up if declined
    if(c.status==='declined' || c.status==='accepted'){
        html += `
        <h3>Follow-up / Reopen Request:</h3>
        <form method="POST" action="/followup/${c.id}" enctype="multipart/form-data">
            <textarea name="message" placeholder="Add message or info" required></textarea><br>
            <input type="file" name="image" accept="image/*"><br>
            <button type="submit">Send Follow-up</button>
        </form>`;
    }
    res.send(html);
});

// Visitor follow-up
app.post('/followup/:id', upload.single('image'), (req,res)=>{
    const checkins = loadCheckins();
    const c = checkins.find(t=>t.id==req.params.id);
    if(!c) return res.status(404).send("Ticket not found");

    const msg = req.body.message;
    let imgPath = req.file ? `/uploads/${req.file.filename}` : '';
    c.response.push({type:'visitor', message: msg, image: imgPath});
    if(c.status==='declined') c.status = 'opened'; // re-open ticket
    saveCheckins(checkins);
    res.redirect(`/status/${c.id}`);
});

app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
