const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();

// ─── MULTER (memory storage — we convert to Base64 ourselves) ─────────────────
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  }
});

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ─── AUTH CONFIG ───────────────────────────────────────────────────────────────
const HARDCODED_USERNAME = 'malkhanaadmin';
const HARDCODED_PASSWORD = 'malkhanaadmin@123';
const JWT_SECRET = process.env.JWT_SECRET || 'malkhana_jwt_secret_key_2024';
const JWT_EXPIRES_IN = '8h';

// ─── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(403).json({ success: false, message: 'Invalid or expired token. Please login again.' });
  }
}

// ─── AUTH ROUTES (Public) ──────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }
  if (username !== HARDCODED_USERNAME || password !== HARDCODED_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Invalid username or password.' });
  }
  const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.status(200).json({
    success: true,
    message: 'Login successful',
    token,
    user: { username, role: 'admin' },
    expiresIn: JWT_EXPIRES_IN
  });
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.status(200).json({ success: true, message: 'Token is valid', user: req.user });
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
  res.status(200).json({ success: true, message: 'Logged out successfully.' });
});

// ─── MONGODB ───────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI ||
  'mongodb+srv://sandeep05kumar1997_db_user:ffz2VaI6Omp6IqjT@malkhana.r7oy4dg.mongodb.net/malkhana_db?retryWrites=true&w=majority&appName=malkhana';

// Photo sub-schema
const photoSchema = new mongoose.Schema({
  filename:    { type: String, required: true },
  mimetype:    { type: String, required: true },
  size:        { type: Number },
  data:        { type: String, required: true }, // Base64 string
  uploaded_at: { type: Date, default: Date.now }
}, { _id: true });

// Main schema
const malkhanaSchema = new mongoose.Schema({
  entry_no:               { type: Number, required: true, unique: true },
  case_fir_no:            String,
  police_station:         String,
  case_section:           String,
  property_description:   String,
  property_type:          String,
  quantity_weight:        String,
  identification_mark:    String,
  seal_number:            String,
  date_of_seizure:        Date,
  seized_by_officer:      String,
  received_date_malkhana: Date,
  malkhana_register_no:   String,
  storage_location:       String,
  issued_date:            Date,
  issued_to:              String,
  return_date:            Date,
  final_disposal_type:    String,
  disposal_date:          Date,
  remarks:                String,
  photos: {
    type: [photoSchema],
    default: [],
    validate: [v => v.length <= 5, 'Maximum 5 photos allowed per entry']
  }
}, { timestamps: true });

const MalkhanaRegister = mongoose.models.MalkhanaRegister ||
  mongoose.model('MalkhanaRegister', malkhanaSchema);

let cachedConnection = null;
async function connectToDatabase() {
  if (cachedConnection && mongoose.connection.readyState === 1) return cachedConnection;
  cachedConnection = await mongoose.connect(MONGODB_URI);
  console.log('Database connection established');
  return cachedConnection;
}

// ─── HELPER: strip Base64 data for list views (return metadata only) ──────────
function stripPhotoData(record) {
  const obj = record.toObject ? record.toObject() : record;
  if (obj.photos) {
    obj.photos = obj.photos.map(({ _id, filename, mimetype, size, uploaded_at }) =>
      ({ _id, filename, mimetype, size, uploaded_at })
    );
  }
  return obj;
}

// ─── MALKHANA CRUD ROUTES (all protected) ─────────────────────────────────────

// GET all — photos metadata only (no Base64 blobs in list for performance)
app.get('/api/malkhana', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const records = await MalkhanaRegister.find().sort({ entry_no: -1 });
    res.status(200).json({ success: true, count: records.length, data: records.map(stripPhotoData) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching records', error: error.message });
  }
});

// GET single — full record including Base64 photo data
app.get('/api/malkhana/:entry_no', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const record = await MalkhanaRegister.findOne({ entry_no: req.params.entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    res.status(200).json({ success: true, data: record });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching record', error: error.message });
  }
});

// POST create — supports multipart/form-data with photos[] field
app.post('/api/malkhana', authenticateToken, upload.array('photos', 5), async (req, res) => {
  try {
    await connectToDatabase();
    const body = { ...req.body };

    if (req.files && req.files.length > 0) {
      body.photos = req.files.map(file => ({
        filename:    file.originalname,
        mimetype:    file.mimetype,
        size:        file.size,
        data:        file.buffer.toString('base64'),
        uploaded_at: new Date()
      }));
    }

    const newRecord = new MalkhanaRegister(body);
    const saved = await newRecord.save();
    res.status(201).json({ success: true, message: 'Record created successfully', data: saved });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Entry number already exists' });
    }
    res.status(500).json({ success: false, message: 'Error creating record', error: error.message });
  }
});

// PUT update — text fields only (use /photos routes to manage photos)
app.put('/api/malkhana/:entry_no', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    delete req.body.photos; // guard: photos managed via dedicated routes
    const updated = await MalkhanaRegister.findOneAndUpdate(
      { entry_no: req.params.entry_no },
      req.body,
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Record not found' });
    res.status(200).json({ success: true, message: 'Record updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating record', error: error.message });
  }
});

// DELETE record — removes record + all embedded photos
app.delete('/api/malkhana/:entry_no', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const deleted = await MalkhanaRegister.findOneAndDelete({ entry_no: req.params.entry_no });
    if (!deleted) return res.status(404).json({ success: false, message: 'Record not found' });
    res.status(200).json({ success: true, message: 'Record and all its photos deleted', data: deleted });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting record', error: error.message });
  }
});

// Search
app.get('/api/malkhana/search/:query', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const query = req.params.query;
    const records = await MalkhanaRegister.find({
      $or: [
        { case_fir_no:       { $regex: query, $options: 'i' } },
        { police_station:    { $regex: query, $options: 'i' } },
        { property_type:     { $regex: query, $options: 'i' } },
        { seized_by_officer: { $regex: query, $options: 'i' } }
      ]
    });
    res.status(200).json({ success: true, count: records.length, data: records.map(stripPhotoData) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error searching records', error: error.message });
  }
});

// ─── PHOTO ROUTES ──────────────────────────────────────────────────────────────

// POST /api/malkhana/:entry_no/photos — upload photos (max 5 total per entry)
app.post('/api/malkhana/:entry_no/photos', authenticateToken, upload.array('photos', 5), async (req, res) => {
  try {
    await connectToDatabase();
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No image files provided' });
    }

    const record = await MalkhanaRegister.findOne({ entry_no: req.params.entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });

    const remaining = 5 - record.photos.length;
    if (remaining <= 0) {
      return res.status(400).json({ success: false, message: 'Maximum of 5 photos already reached' });
    }

    const toAdd = req.files.slice(0, remaining).map(file => ({
      filename:    file.originalname,
      mimetype:    file.mimetype,
      size:        file.size,
      data:        file.buffer.toString('base64'),
      uploaded_at: new Date()
    }));

    record.photos.push(...toAdd);
    await record.save();

    res.status(200).json({
      success: true,
      message: `${toAdd.length} photo(s) added successfully`,
      total_photos: record.photos.length,
      photos: record.photos.map(({ _id, filename, mimetype, size, uploaded_at }) =>
        ({ _id, filename, mimetype, size, uploaded_at }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error uploading photos', error: error.message });
  }
});

// GET /api/malkhana/:entry_no/photos — list photo metadata
app.get('/api/malkhana/:entry_no/photos', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const record = await MalkhanaRegister.findOne({ entry_no: req.params.entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });

    const metadata = record.photos.map(({ _id, filename, mimetype, size, uploaded_at }) =>
      ({ _id, filename, mimetype, size, uploaded_at }));

    res.status(200).json({ success: true, count: metadata.length, photos: metadata });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching photos', error: error.message });
  }
});

// GET /api/malkhana/:entry_no/photos/:photo_id — serve raw image (for <img src="">)
app.get('/api/malkhana/:entry_no/photos/:photo_id', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const record = await MalkhanaRegister.findOne({ entry_no: req.params.entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });

    const photo = record.photos.id(req.params.photo_id);
    if (!photo) return res.status(404).json({ success: false, message: 'Photo not found' });

    const imgBuffer = Buffer.from(photo.data, 'base64');
    res.set('Content-Type', photo.mimetype);
    res.set('Content-Disposition', `inline; filename="${photo.filename}"`);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(imgBuffer);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error serving photo', error: error.message });
  }
});

// DELETE /api/malkhana/:entry_no/photos/:photo_id — remove a single photo
app.delete('/api/malkhana/:entry_no/photos/:photo_id', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const record = await MalkhanaRegister.findOne({ entry_no: req.params.entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });

    const photo = record.photos.id(req.params.photo_id);
    if (!photo) return res.status(404).json({ success: false, message: 'Photo not found' });

    photo.deleteOne();
    await record.save();

    res.status(200).json({
      success: true,
      message: 'Photo deleted successfully',
      total_photos: record.photos.length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting photo', error: error.message });
  }
});

// ─── ROOT ──────────────────────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  try {
    await connectToDatabase();
    res.json({
      message: 'Malkhana Register API',
      status: 'Running',
      database: 'Connected',
      auth_endpoints: {
        login:  'POST /api/auth/login',
        verify: 'GET  /api/auth/verify  [Auth]',
        logout: 'POST /api/auth/logout  [Auth]'
      },
      record_endpoints: {
        getAll:  'GET    /api/malkhana                           [Auth]',
        getOne:  'GET    /api/malkhana/:entry_no                 [Auth]',
        create:  'POST   /api/malkhana  (multipart/form-data)    [Auth]',
        update:  'PUT    /api/malkhana/:entry_no                 [Auth]',
        delete:  'DELETE /api/malkhana/:entry_no                 [Auth]',
        search:  'GET    /api/malkhana/search/:query             [Auth]'
      },
      photo_endpoints: {
        upload: 'POST   /api/malkhana/:entry_no/photos           [Auth] field: photos',
        list:   'GET    /api/malkhana/:entry_no/photos           [Auth]',
        serve:  'GET    /api/malkhana/:entry_no/photos/:photo_id [Auth] → raw image',
        delete: 'DELETE /api/malkhana/:entry_no/photos/:photo_id [Auth]'
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Malkhana Register API', status: 'Error', error: error.message });
  }
});

// ─── LOCAL DEV ─────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}

module.exports = app;
