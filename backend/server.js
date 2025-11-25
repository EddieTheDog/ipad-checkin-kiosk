import express from 'express';
import cors from 'cors';
import fs from 'fs';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Configure CORS to allow frontend
app.use(cors({
    origin: 'https://ipad-checkin-kiosk.onrender.com', // replace with your frontend domain
    methods: ['GET','POST','PUT','DELETE','OPTIONS'],
    credentials: true
}));

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
    const newCheckin = { id, ...req.body, status: 'pending', response: '', timestamp: new Date() };
    checkins.push(newCheckin);
    saveCheckins(checkins);

    const qr = await QRCode.toDataURL(`${req.protocol}://${req.get('host')}/status/${id}`);
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
    let optionsHTML = declineOptions.map(o => `<option value="${o}">${o}</option>`).join('');

    let html = `<h1>Review Request: ${c.name}</h1>
        <p>Request: ${c.request}</p>
        <form action="/respond/${c.id}" method="POST">
            <label>Status:</label>
            <select name="status">
                <option value="approved">Approve</option>
                <option value="denied">Deny</option>
            </select><br><br>
            <label>Decline reason / Response:</label><br>
            <select name="decline_reason"><option value="">--Select if denied--</option>${optionsHTML}</select><br>
            <textarea name="response" placeholder="Write response here"></textarea><br>
            <input type="text" name="contact_method" placeholder="Email or Call"><br><br>
            <button type="submit">Submit & Close</button>
        </form>
        <br><a href="/admin">Back to Admin Dashboard</a>`;
    res.send(html);
});

// Handle admin response
app.post('/respond/:id', (req, res) => {
    const checkins = loadCheckins();
    const c = checkins.find(c => c.id == req.params.id);
    if (!c) return res.status(404).send("Request not found");

    const { status, decline_reason, response, contact_method } = req.body;
    c.status = status;
    c.response = status === 'denied' ? decline_reason : response;
    c.contact_method = contact_method || '';
    saveCheckins(checkins);
    res.redirect('/admin');
});

// Visitor status page
app.get('/status/:id', (req, res) => {
    const checkins = loadCheckins();
    const c = checkins.find(c => c.id == req.params.id);
    if (!c) return res.send("<h1>Request not found</h1>");

    let html = `<h1>Hello ${c.name}</h1><p>Status: <strong>${c.status}</strong></p>`;
    if (c.response) html += `<p>Message: ${c.response}</p>`;
    if (c.contact_method) html += `<p>Contact Method: ${c.contact_method}</p>`;
    res.send(html);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
