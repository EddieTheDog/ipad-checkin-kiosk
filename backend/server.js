import express from 'express';
import multer from 'multer';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// Multer setup for visitor image uploads
const upload = multer({ dest: 'uploads/' });

// Load and save check-ins
const CHECKINS_FILE = path.join(process.cwd(), 'checkins.json');
const loadCheckins = () => {
    if (!fs.existsSync(CHECKINS_FILE)) return [];
    return JSON.parse(fs.readFileSync(CHECKINS_FILE));
};
const saveCheckins = (checkins) => {
    fs.writeFileSync(CHECKINS_FILE, JSON.stringify(checkins, null, 2));
};

// Admin panel route
app.get('/admin', (req,res)=>{
    const tickets = loadCheckins();
    let html = `
    <html><head><title>Admin Panel</title>
    <link rel="stylesheet" href="/style.css">
    </head><body>
    <h1>Admin Dashboard</h1>
    <div class="admin-ticket-container">`;

    tickets.forEach(ticket=>{
        let newDot = ticket.visitorResponses.some(v=>!v.viewed) ? ' <span class="new-dot">●</span>' : '';
        html += `<div class="ticket-summary">
            <a href="/admin/ticket/${ticket.id}">${ticket.name} - ${ticket.status.toUpperCase()}</a>${newDot}
        </div>`;
    });

    html += `<p class="version-number">Version 1.0.0</p></div></body></html>`;
    res.send(html);
});

// Admin review ticket
app.get('/admin/ticket/:id', (req,res)=>{
    const checkins = loadCheckins();
    const ticket = checkins.find(t=>t.id==req.params.id);
    if(!ticket) return res.send("<h1>Ticket not found</h1>");

    let html = `<html><head><title>Admin Ticket</title>
    <link rel="stylesheet" href="/style.css"></head><body>
    <div class="status-container">
    <h1>Ticket for ${ticket.name}</h1>
    <p>Status: <strong>${ticket.status}</strong></p>
    <div class="message-container">`;

    const messages = [];
    ticket.adminResponses.forEach(a=>messages.push({type:'admin', text:a.message, website:a.website, timestamp:a.timestamp}));
    ticket.visitorResponses.forEach(v=>messages.push({type:'visitor', text:v.message, image:v.image, timestamp:v.timestamp}));
    messages.sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));

    messages.forEach(m=>{
        html += `<div class="message-box ${m.type}-box">
                    ${m.text}
                    ${m.website ? `<br><small>Cite: <a href="${m.website}" target="_blank">${m.website}</a></small>` : ''}
                    ${m.image ? `<br><img src="${m.image}" style="max-width:150px;">` : ''}
                    <div class="message-meta">${new Date(m.timestamp).toLocaleString()}</div>
                 </div>`;
    });

    html += `</div>`;

    if(ticket.status==='opened' || ticket.status==='appeal'){
        html += `<h3>Send Admin Response:</h3>
        <form method="POST" action="/admin/respond/${ticket.id}">
            <textarea name="message" placeholder="Message" required></textarea>
            <input type="text" name="website" placeholder="Optional website cite"><br>
            <button type="submit">Send</button>
        </form>
        <form method="POST" action="/admin/close/${ticket.id}">
            <button type="submit">Close Ticket</button>
        </form>
        <form method="POST" action="/admin/decline/${ticket.id}">
            <button type="submit">Decline Ticket</button>
        </form>`;
    } else {
        html += `<p class="ticket-status-msg">Ticket is ${ticket.status}. No further admin actions.</p>`;
    }

    html += `<p class="version-number">Version 1.0.0</p></div></body></html>`;
    res.send(html);
});

// Admin POST respond
app.post('/admin/respond/:id', (req,res)=>{
    const checkins = loadCheckins();
    const ticket = checkins.find(t=>t.id==req.params.id);
    if(ticket){
        if(!ticket.adminResponses) ticket.adminResponses = [];
        ticket.adminResponses.push({
            message:req.body.message,
            website:req.body.website || null,
            timestamp:new Date()
        });
        saveCheckins(checkins);
    }
    res.redirect(`/admin/ticket/${req.params.id}`);
});

// Admin close ticket
app.post('/admin/close/:id', (req,res)=>{
    const checkins = loadCheckins();
    const ticket = checkins.find(t=>t.id==req.params.id);
    if(ticket) ticket.status='closed';
    saveCheckins(checkins);
    res.redirect(`/admin/ticket/${req.params.id}`);
});

// Admin decline ticket
app.post('/admin/decline/:id', (req,res)=>{
    const checkins = loadCheckins();
    const ticket = checkins.find(t=>t.id==req.params.id);
    if(ticket) ticket.status='declined';
    saveCheckins(checkins);
    res.redirect(`/admin/ticket/${req.params.id}`);
});

// Visitor tracking page
app.get('/status/:id', (req,res)=>{
    const checkins = loadCheckins();
    const ticket = checkins.find(t => t.id == req.params.id);
    if(!ticket) return res.send("<h1>Ticket not found</h1>");

    let html = `<html><head><title>Ticket Status</title>
        <link rel="stylesheet" href="/style.css"></head><body>
        <div class="status-container">
        <h1>Hello ${ticket.name}</h1>
        <p>Status: <strong>${ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}</strong></p>
        <h3>Conversation:</h3>
        <div class="message-container">`;

    const messages = [];
    ticket.adminResponses.forEach(a=>messages.push({type:'admin', text:a.message, website:a.website, timestamp:a.timestamp}));
    ticket.visitorResponses.forEach(v=>messages.push({type:'visitor', text:v.message, image:v.image, timestamp:v.timestamp}));
    messages.sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));

    messages.forEach(m=>{
        html += `<div class="message-box ${m.type}-box">
                    ${m.text}
                    ${m.website ? `<br><small>Cite: <a href="${m.website}" target="_blank">${m.website}</a></small>` : ''}
                    ${m.image ? `<br><img src="${m.image}">` : ''}
                    <div class="message-meta">${new Date(m.timestamp).toLocaleString()}</div>
                 </div>`;
    });

    html += `</div>`;

    // Show input if admin has sent at least one message
    if(ticket.status==='opened' && ticket.adminResponses.length > 0){
        html += `<h3>Send Follow-up / Appeal:</h3>
            <form id="visitorForm" method="POST" action="/followup/${ticket.id}" enctype="multipart/form-data">
                <textarea name="message" placeholder="Your message" required></textarea>
                <input type="file" name="image" accept="image/*"><br>
                <button type="submit">Send</button>
            </form>`;
    } else if(ticket.status==='closed' || ticket.status==='declined'){
        html += `<p class="ticket-status-msg">This ticket is ${ticket.status}. You can no longer send a response. Please open a new ticket if needed.</p>`;
    } else {
        html += `<p class="ticket-status-msg">Waiting for admin response before you can reply.</p>`;
    }

    html += `<p class="version-number">Version 1.0.0</p></div></body></html>`;
    res.send(html);
});

// Visitor follow-up POST
app.post('/followup/:id', upload.single('image'), (req,res)=>{
    const checkins = loadCheckins();
    const ticket = checkins.find(t => t.id == req.params.id);
    if(ticket){
        if(!ticket.visitorResponses) ticket.visitorResponses = [];
        let imagePath = req.file ? `/uploads/${req.file.filename}` : null;
        ticket.visitorResponses.push({
            message:req.body.message,
            image:imagePath,
            timestamp:new Date(),
            viewed:false
        });
        saveCheckins(checkins);
    }
    res.redirect(`/status/${req.params.id}`);
});

// Serve uploads
app.use('/uploads', express.static('uploads'));

// Start server
app.listen(PORT, ()=>{
    console.log(`Server running on port ${PORT}`);
});
