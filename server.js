const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const room = req.query.room || 'unknown';
    const ts = Date.now();
    const name = `${room}_${ts}_${file.originalname}`;
    cb(null, name);
  }
});
const upload = multer({ storage });

app.post('/upload', upload.single('video'), (req, res) => {
  const room = req.query.room;
  const password = req.query.password;
  if (!room || !password) return res.status(400).send('room & password required');
  if (!rooms[room] || rooms[room].password !== password) {
    return res.status(403).send('Invalid room or password');
  }
  console.log('File saved:', req.file.filename);
  io.to(room).emit('new-file', { filename: req.file.filename });
  res.send({ ok: true, filename: req.file.filename });
});

app.get('/files', (req, res) => {
  const room = req.query.room;
  if (!room) return res.status(400).send('room required');
  const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.startsWith(room + '_'));
  res.send(files.sort().reverse());
});

app.get('/uploads/:name', (req, res) => {
  const name = req.params.name;
  const filePath = path.join(UPLOAD_DIR, name);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send('Not found');
});

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('join-room', ({ room, password, role }, ack) => {
    if (!room || !password) return ack({ ok: false, err: 'room & password required' });

    if (!rooms[room]) {
      rooms[room] = { password, clients: [] };
      console.log(`Room created: ${room}`);
    }
    if (rooms[room].password !== password) {
      return ack({ ok: false, err: 'wrong password' });
    }

    socket.join(room);
    rooms[room].clients.push({ id: socket.id, role });
    socket.data.room = room;
    socket.data.role = role;
    ack({ ok: true });
  });

  socket.on('offer', data => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit('offer', data);
  });

  socket.on('answer', data => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit('answer', data);
  });

  socket.on('ice-candidate', data => {
    const room = socket.data.room;
    if (!room) return;
    socket.to(room).emit('ice-candidate', data);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (room && rooms[room]) {
      rooms[room].clients = rooms[room].clients.filter(c => c.id !== socket.id);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server listening on http://0.0.0.0:${PORT}`));
