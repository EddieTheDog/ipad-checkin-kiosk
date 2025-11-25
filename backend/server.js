import express from 'express';
import fs from 'fs';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_FILE = './checkins.json';
const PORT = process.env.PORT || 3000;

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

// Load/save check-ins
const loadCheckins = () => fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : [];
const saveCheckins = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// POST /checkin
app.post('/checkin', async (req, res) => {
    const checkins = loadCheckins();
    const id = Date.now();
    const newCheckin = { id, ...req.body, status: 'opened', response: '', website: '', timestamp: new Date() };
    checkins.push(newCheckin);
    saveCheckins(checkins);

    // QR code points to full website + status
    const qrURL = `${req.protocol}://${req.get('host')}/status/${id}`;
    const qr = await QRCode.toDataURL(qrURL);
    res.json({ success: true, qr });
});

// Admin dashboard
app.get('/admin', (req, res) => {
    const checkins = loadCheckins();
    let html = `<h1>Admin Dashboard</h1><table border="1">
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
app.get('/review/:id', (req, res) => {
    const checkins = loadCheckins();
    const c = checkins.find(c => c.id == req.params.id);
    if (!c) return res.send("Request not found");

    const declineOptions = ['Incomplete info', 'Not eligible', 'Other'];
    let declineHTML = declineOptions.map(o => `<option value="${o}">${o}</option>`).join('');

    let html = `
    <h1>Review Request: ${c.name}</h1>
    <p>Request: ${c.request}</p>
    <form id="reviewForm" action="/respond/${c.id}" method="POST">
      <label>Action:</label>
      <select id="actionSelect" name="action">
        <option value="">--Select--</option>
        <option value="accept">Accept</option>
        <option value="decline">Decline</option>
      </select>

      <div id="acceptFields" style="display:none; margin-top:10px;">
        <label>Cite Website:</label>
        <input type="text" name="website" placeholder="https://example.com"><br>
        <label>Message:</label>
        <textarea name="message" placeholder="Write your message"></textarea>
      </div>

      <div id="declineFields" style="display:none; margin-top:10px;">
        <label>Decline reason:</label>
        <select name="decline_reason">
          <option value="">--Select reason--</option>
          ${declineHTML}
        </select>
      </div>

      <br><button type="submit">Submit & Close</button>
    </form>
    <a href="/admin">Back to Admin Dashboard</a>

    <script>
    document.getElementById('actionSelect').addEventListener('change', function(){
      const acceptDiv = document.getElementById('acceptFields');
      const declineDiv = document.getElementById('declineFields');
      if(this.value === 'accept'){
        acceptDiv.style.display = 'block';
        declineDiv.style.display = 'none';
      } else if(this.value === 'decline'){
        acceptDiv.style.display = 'none';
        declineDiv.style.display = 'block';
      } else {
        acceptDiv.style.display = 'none';
        declineDiv.style.display = 'none';
      }
    });
    </script>
    `;
    res.send(html);
});

// Handle admin response
app.post('/respond/:id', (req, res) => {
    const checkins = loadCheckins();
    const c = checkins.find(c => c.id == req.params.id);
    if (!c) return res.status(404).send("Request not found");

    const { action, decline_reason, website, message } = req.body;

    if(action === 'accept'){
        c.status = 'accepted'; // ticket now opened
        c.website = website || '';
        c.response = message || '';
    } else if(action === 'decline'){
        c.status = 'declined'; // permanently locked
        c.response = decline_reason || 'Declined';
    }

    saveCheckins(checkins);
    res.redirect('/admin');
});

// Visitor status page
app.get('/status/:id', (req, res) => {
    const checkins = loadCheckins();
    const c = checkins.find(c => c.id == req.params.id);
    if (!c) return res.send("<h1>Request not found</h1>");

    let html = `<h1>Hello ${c.name}</h1><p>Status: <strong>${c.status}</strong></p>`;
    if(c.status === 'accepted'){
        if(c.website) html += `<p>Cited Website: <a href="${c.website}" target="_blank">${c.website}</a></p>`;
        if(c.response) html += `<p>Message: ${c.response}</p>`;
    } else if(c.status === 'declined'){
        html += `<p>Reason: ${c.response}</p>`;
    }
    res.send(html);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
