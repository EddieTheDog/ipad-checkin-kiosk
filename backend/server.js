import express from 'express';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import multer from 'multer';

const app = express();
const PORT = process.env.PORT || 3000;

// File paths
const DATA_FILE = path.join(process.cwd(), 'checkins.json');
const IMAGE_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR);

// Multer for uploads
const upload = multer({ dest: IMAGE_DIR });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(IMAGE_DIR));
app.use(express.static(path.join(process.cwd(), 'frontend')));

// Load / Save helpers
const loadCheckins = () => fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : [];
const saveCheckins = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// --------- Routes ---------

// Kiosk submit
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

// Visitor tracking page
app.get('/status/:id', (req, res) => {
  const checkins = loadCheckins();
  const ticket = checkins.find(t => t.id == req.params.id);
  if (!ticket) return res.send("<h1>Ticket not found</h1>");

  let html = `
  <html>
  <head>
      <title>Ticket Status</title>
      <link rel="stylesheet" href="/style.css">
  </head>
  <body>
  <div class="status-container">
      <h1>Hello ${ticket.name}</h1>
      <p>Status: <strong>${ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}</strong></p>
      <h3>Conversation:</h3>
      <div class="message-container">`;

  // Merge messages
  const messages = [];
  ticket.adminResponses.forEach(a => messages.push({ type: 'admin', text: a.message, website: a.website, timestamp: a.timestamp }));
  ticket.visitorResponses.forEach(v => messages.push({ type: 'visitor', text: v.message, image: v.image, timestamp: v.timestamp }));
  messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  messages.forEach(m => {
    html += `<div class="message-box ${m.type}-box">
                ${m.text}
                ${m.website ? `<br><small>Cite: <a href="${m.website}" target="_blank">${m.website}</a></small>` : ''}
                ${m.image ? `<br><img src="${m.image}" style="max-width:150px;">` : ''}
                <div class="message-meta">${new Date(m.timestamp).toLocaleString()}</div>
             </div>`;
  });

  html += `</div>`;

  // Show form only if ticket is opened and admin has responded
  if (ticket.status === 'opened' && ticket.adminResponses.length > 0) {
    html += `<h3>Send Follow-up / Appeal:</h3>
      <form method="POST" action="/followup/${ticket.id}">
          <textarea name="message" placeholder="Your message" required></textarea><br>
          <button type="submit">Send</button>
      </form>`;
  } else if (ticket.status === 'closed' || ticket.status === 'declined') {
    html += `<p class="ticket-status-msg">This ticket is ${ticket.status}. You can no longer respond. Please open a new ticket if needed.</p>`;
  } else {
    html += `<p class="ticket-status-msg">Waiting for admin response before you can reply.</p>`;
  }

  html += `<p class="version-number">Version 1.0.0</p></div></body></html>`;
  res.send(html);
});

// Visitor follow-up (text only)
app.post('/followup/:id', (req, res) => {
  const checkins = loadCheckins();
  const ticket = checkins.find(t => t.id == req.params.id);
  if (!ticket) return res.status(404).send("Ticket not found");

  if (ticket.adminResponses.length === 0 || ticket.status !== 'opened') {
    return res.status(403).send("Cannot send message yet.");
  }

  ticket.visitorResponses.push({
    message: req.body.message,
    image: '',
    timestamp: new Date()
  });

  saveCheckins(checkins);
  res.redirect(`/status/${ticket.id}`);
});

// --------- Admin routes (example) ---------
// Add/update admin response
app.post('/admin/respond/:id', (req, res) => {
  const checkins = loadCheckins();
  const ticket = checkins.find(t => t.id == req.params.id);
  if (!ticket) return res.status(404).send("Ticket not found");

  ticket.adminResponses.push({
    message: req.body.message,
    website: req.body.website || '',
    timestamp: new Date()
  });

  saveCheckins(checkins);
  res.redirect('/admin'); // or wherever your admin dashboard is
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
