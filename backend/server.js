import express from 'express';
import cors from 'cors';
import fs from 'fs';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors()); // Allow cross-origin requests
app.use(express.json());

const DATA_FILE = './checkins.json';
const PORT = process.env.PORT || 3000;

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

// Load/save check-ins
const loadCheckins = () => fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : [];
const saveCheckins = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// Create check-in and generate QR code
app.post('/checkin', async (req, res) => {
    const checkins = loadCheckins();
    const id = Date.now();
    const newCheckin = { id, ...req.body, status: 'pending', timestamp: new Date() };
    checkins.push(newCheckin);
    saveCheckins(checkins);

    const qr = await QRCode.toDataURL(`${req.protocol}://${req.get('host')}/status/${id}`);
    res.json({ success: true, qr });
});

// Admin dashboard
app.get('/admin', (req, res) => {
    const checkins = loadCheckins();
    let html = `<h1>Admin Dashboard</h1><table border="1"><tr>
        <th>Name</th><th>Email</th><th>Phone</th><th>Meeting With</th><th>Notes</th><th>Status</th><th>Actions</th>
    </tr>`;
    checkins.reverse().forEach(c => {
        html += `<tr>
            <td>${c.name}</td>
            <td>${c.email}</td>
            <td>${c.phone}</td>
            <td>${c.meeting_with}</td>
            <td>${c.notes || ''}</td>
            <td>${c.status}</td>
            <td>
                <a href="/approve/${c.id}">✅ Approve</a> |
                <a href="/deny/${c.id}">❌ Deny</a>
            </td>
        </tr>`;
    });
    html += `</table>`;
    res.send(html);
});

// Approve / Deny routes
app.get('/approve/:id', (req, res) => {
    const checkins = loadCheckins();
    const c = checkins.find(c => c.id == req.params.id);
    if (c) { c.status = 'approved'; saveCheckins(checkins); }
    res.redirect('/admin');
});

app.get('/deny/:id', (req, res) => {
    const checkins = loadCheckins();
    const c = checkins.find(c => c.id == req.params.id);
    if (c) { c.status = 'denied'; saveCheckins(checkins); }
    res.redirect('/admin');
});

// Status page for visitors
app.get('/status/:id', (req, res) => {
    const checkins = loadCheckins();
    const c = checkins.find(c => c.id == req.params.id);
    if (!c) return res.send("<h1>Check-in not found</h1>");

    let html = `<h1>Hello ${c.name}</h1><p>Status: <strong>${c.status}</strong></p>`;
    if (c.status === 'denied') {
        html += `<p>Unfortunately, you are not approved. Please contact reception for instructions.</p>`;
    } else if (c.status === 'approved') {
        html += `<p>You are approved! Please proceed to your meeting or follow instructions.</p>`;
    } else {
        html += `<p>Your check-in is pending approval. Please wait.</p>`;
    }
    res.send(html);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
