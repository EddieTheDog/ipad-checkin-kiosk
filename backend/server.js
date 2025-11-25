import express from 'express';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import multer from 'multer';

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join('./checkins.json');
const IMAGE_DIR = path.join('./uploads');
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR);

const upload = multer({ dest: IMAGE_DIR });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(IMAGE_DIR));
app.use(express.static(path.join('./frontend')));

// Load and save functions
const loadCheckins = () => fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : [];
const saveCheckins = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

// Kiosk submission route
app.post('/checkin', async (req, res) => {
  const checkins = loadCheckins();
  const id = Date.now();
  const ticket = {
    id,
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    request: req.body.request,
    status: 'opened', // opened by default
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

  // Merge admin and visitor messages chronologically
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

  // Only allow visitor to reply if ticket is opened and admin has sent at least one message
  if (ticket.status === 'opened' && ticket.adminResponses.length > 0) {
    html += `<h3>Send Follow-up / Appeal:</h3>
      <form method="POST" action="/followup/${ticket.id}" enctype="multipart/form-data">
        <textarea name="message" placeholder="Your message" required></textarea><br>
        <button type="submit">Send</button>
      </form>`;
  } else if (ticket.status === 'closed' || ticket.status === 'declined') {
    html += `<p class="ticket-status-msg">This ticket is ${ticket.status}. You can no longer send a response. Please open a new ticket if needed.</p>`;
  } else {
    html += `<p class="ticket-status-msg">Waiting for admin response before you can reply.</p>`;
  }

  html += `<p class="version-number">Version 1.0.0</p></div></body></html>`;
  res.send(html);
});

// Visitor follow-up submission
app.post('/followup/:id', (req, res) => {
  const checkins = loadCheckins();
  const ticket = checkins.find(t => t.id == req.params.id);
  if (!ticket) return res.status(404).send("Ticket not found");

  if (ticket.adminResponses.length === 0 || ticket.status !== 'opened') {
    return res.status(403).send("Cannot send message yet.");
  }

  ticket.visitorResponses.push({
    message: req.body.message,
    image: '', // visitor cannot upload images
    timestamp: new Date()
  });

  saveCheckins(checkins);
  res.redirect(`/status/${ticket.id}`);
});

// Admin routes would go here (unchanged if you already have them)

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
