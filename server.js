const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');


const app = express();

// ─── MULTER ────────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only'), false)
});

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['https://pachrukhimalkhana.vercel.app', 'http://localhost:3000', 'http://localhost:5500'],
  credentials: true
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ─── AUTH ──────────────────────────────────────────────────────────────────────
const HARDCODED_USERNAME = 'malkhanaadmin';
const HARDCODED_PASSWORD = 'malkhanaadmin@123';
const JWT_SECRET = process.env.JWT_SECRET || 'malkhana_jwt_secret_key_2024';
const JWT_EXPIRES_IN = '8h';

function authenticateToken(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token provided.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(403).json({ success: false, message: 'Invalid or expired token.' }); }
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ success: false, message: 'Username and password required.' });
  if (username !== HARDCODED_USERNAME || password !== HARDCODED_PASSWORD)
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.json({ success: true, message: 'Login successful', token, user: { username, role: 'admin' }, expiresIn: JWT_EXPIRES_IN });
});

app.get('/api/auth/verify', authenticateToken, (req, res) =>
  res.json({ success: true, message: 'Token valid', user: req.user }));

app.post('/api/auth/logout', authenticateToken, (req, res) =>
  res.json({ success: true, message: 'Logged out.' }));

// ─── MONGODB ───────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI ||
  'mongodb+srv://sandeep05kumar1997_db_user:ffz2VaI6Omp6IqjT@malkhana.r7oy4dg.mongodb.net/malkhana_db?retryWrites=true&w=majority&appName=malkhana';

const photoSchema = new mongoose.Schema({
  filename: String, mimetype: String, size: Number,
  data: String, uploaded_at: { type: Date, default: Date.now }
}, { _id: true });

/**
 * Updated schema as per new register format (SP sir's instructions):
 *
 *  1.  क्रम संख्या                          → entry_no (auto/unique)
 *  2.  स्वामी का नाम एवं पता                → owner_name, owner_address
 *  3.  केस की संख्या एवं तिथि               → case_fir_no, case_date
 *  4.  संपत्ति का प्रकार                     → property_type
 *  5.  पहचान चिन्ह सहित संपत्ति का विवरण   → property_description, identification_mark
 *  6.  मूल्य                                 → property_value
 *  7.  कहाँ, कब, किसके द्वारा तथा किस       → found_place, found_date,
 *      परिस्थिति में पाई गई                    found_by_officer, found_circumstances
 *  8.  थाने में पाई गई तिथि                 → received_at_police_station_date
 *  9.  जप्त करने के बाद संपत्ति कहाँ रखी गई → storage_location
 * 10.  निपटान की तिथि एवं विधि              → disposal_date, disposal_method
 * 11.  प्राप्ति संचिका प्रविष्टि संख्या /    → receipt_file_entry_no,
 *      बिक्री मूल्य / खरीदार / चेक विवरण      sale_amount, buyer_name,
 *                                              buyer_address, receipt_check_no,
 *                                              receipt_check_date
 * 12.  अभियुक्ति / टिप्पणी                  → accusation_remarks
 * 13.  विलम्ब का कारण                        → delay_reason
 * 14.  Remarks / अन्य टिप्पणी               → remarks
 */
const malkhanaSchema = new mongoose.Schema({
  // ── Field 1: Serial number ──────────────────────────────────────────────────
  entry_no: { type: Number, required: true, unique: true },

  // ── Field 2: Owner details ──────────────────────────────────────────────────
  owner_name:    { type: String, default: '' }, // स्वामी का नाम
  owner_address: { type: String, default: '' }, // स्वामी का पता

  // ── Field 3: Case number & date ─────────────────────────────────────────────
  case_fir_no:     { type: String, default: '' }, // केस / FIR संख्या
  case_date:       { type: Date },                // केस की तिथि
  police_station:  { type: String, default: '' }, // थाना (kept for backward compat)

  // ── Field 4: Property type ──────────────────────────────────────────────────
  // e.g. चोरी की गई / निर्यातित / दावा रहित / संदेहास्पद
  property_type: { type: String, default: '' },

  // ── Field 5: Property description & identification mark ─────────────────────
  property_description: { type: String, default: '' },
  identification_mark:  { type: String, default: '' },

  // ── Field 6: Value ──────────────────────────────────────────────────────────
  property_value: { type: String, default: '' }, // मूल्य (string to allow "₹5,000 approx")

  // ── Field 7: Where / when / by whom / circumstances found ───────────────────
  found_place:        { type: String, default: '' }, // कहाँ पाई गई
  found_date:         { type: Date },                // कब पाई गई
  found_by_officer:   { type: String, default: '' }, // किसके द्वारा
  found_circumstances:{ type: String, default: '' }, // किस परिस्थिति में

  // ── Field 8: Date received at police station ────────────────────────────────
  received_at_police_station_date: { type: Date },   // थाने में पाई गई तिथि

  // ── Field 9: Storage location after seizure ─────────────────────────────────
  storage_location: { type: String, default: '' },

  // ── Field 10: Disposal date & method ───────────────────────────────────────
  disposal_date:   { type: Date },
  disposal_method: { type: String, default: '' }, // निपटान की विधि

  // ── Field 11: Receipt file entry / sale details ─────────────────────────────
  receipt_file_entry_no: { type: String, default: '' }, // प्राप्ति संचिका प्रविष्टि संख्या
  sale_amount:           { type: String, default: '' }, // बिक्री मूल्य
  buyer_name:            { type: String, default: '' }, // खरीदार का नाम
  buyer_address:         { type: String, default: '' }, // खरीदार का पता
  receipt_check_no:      { type: String, default: '' }, // प्राप्ति चेक संख्या
  receipt_check_date:    { type: Date },                // प्राप्ति चेक तिथि

  // ── Field 12: Accusation / comments ────────────────────────────────────────
  accusation_remarks: { type: String, default: '' }, // अभियुक्ति / टिप्पणी

  // ── Field 13: Reason for delay in disposal ──────────────────────────────────
  delay_reason: { type: String, default: '' }, // विलम्ब का कारण

  // ── Field 14: General remarks ───────────────────────────────────────────────
  remarks: { type: String, default: '' }, // Remarks / अन्य टिप्पणी

  // ── Photos (up to 5) ────────────────────────────────────────────────────────
  photos: { type: [photoSchema], default: [], validate: [v => v.length <= 5, 'Max 5 photos'] }

}, { timestamps: true });

const publicTokenSchema = new mongoose.Schema({
  token:    { type: String, required: true, unique: true },
  entry_no: { type: Number, required: true },
  created_at: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 } // 30 days TTL
});

const MalkhanaRegister = mongoose.models.MalkhanaRegister || mongoose.model('MalkhanaRegister', malkhanaSchema);
const PublicToken = mongoose.models.PublicToken || mongoose.model('PublicToken', publicTokenSchema);

let cachedConnection = null;
async function connectToDatabase() {
  if (cachedConnection && mongoose.connection.readyState === 1) return cachedConnection;
  cachedConnection = await mongoose.connect(MONGODB_URI);
  return cachedConnection;
}

function stripPhotoData(record) {
  const obj = record.toObject ? record.toObject() : record;
  if (obj.photos) obj.photos = obj.photos.map(({ _id, filename, mimetype, size, uploaded_at }) =>
    ({ _id, filename, mimetype, size, uploaded_at }));
  return obj;
}

// ─── MALKHANA CRUD ─────────────────────────────────────────────────────────────
app.get('/api/malkhana', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const records = await MalkhanaRegister.find().sort({ entry_no: -1 });
    res.json({ success: true, count: records.length, data: records.map(stripPhotoData) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/malkhana/:entry_no', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const record = await MalkhanaRegister.findOne({ entry_no: req.params.entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    res.json({ success: true, data: record });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/malkhana', authenticateToken, upload.array('photos', 5), async (req, res) => {
  try {
    await connectToDatabase();
    const body = { ...req.body };
    if (req.files?.length) {
      body.photos = req.files.map(f => ({
        filename: f.originalname, mimetype: f.mimetype, size: f.size,
        data: f.buffer.toString('base64'), uploaded_at: new Date()
      }));
    }
    const saved = await new MalkhanaRegister(body).save();
    // Auto-generate public token on create
    const token = crypto.randomBytes(24).toString('hex');
    await PublicToken.create({ token, entry_no: saved.entry_no });
    res.status(201).json({ success: true, message: 'Record created', data: saved, public_token: token });
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ success: false, message: 'Entry number already exists' });
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/malkhana/:entry_no', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    delete req.body.photos;
    const updated = await MalkhanaRegister.findOneAndUpdate(
      { entry_no: req.params.entry_no }, req.body, { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Record not found' });
    res.json({ success: true, message: 'Record updated', data: updated });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/malkhana/:entry_no', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const deleted = await MalkhanaRegister.findOneAndDelete({ entry_no: req.params.entry_no });
    if (!deleted) return res.status(404).json({ success: false, message: 'Record not found' });
    await PublicToken.deleteMany({ entry_no: req.params.entry_no });
    res.json({ success: true, message: 'Record and QR token deleted', data: deleted });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/malkhana/search/:query', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const q = req.params.query;
    const records = await MalkhanaRegister.find({ $or: [
      { case_fir_no:      { $regex: q, $options: 'i' } },
      { police_station:   { $regex: q, $options: 'i' } },
      { property_type:    { $regex: q, $options: 'i' } },
      { owner_name:       { $regex: q, $options: 'i' } },
      { found_by_officer: { $regex: q, $options: 'i' } },
      { buyer_name:       { $regex: q, $options: 'i' } }
    ]});
    res.json({ success: true, count: records.length, data: records.map(stripPhotoData) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── PHOTO ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/malkhana/:entry_no/photos', authenticateToken, upload.array('photos', 5), async (req, res) => {
  try {
    await connectToDatabase();
    if (!req.files?.length) return res.status(400).json({ success: false, message: 'No files provided' });
    const record = await MalkhanaRegister.findOne({ entry_no: req.params.entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    const remaining = 5 - record.photos.length;
    if (remaining <= 0) return res.status(400).json({ success: false, message: 'Max 5 photos reached' });
    const toAdd = req.files.slice(0, remaining).map(f => ({
      filename: f.originalname, mimetype: f.mimetype, size: f.size,
      data: f.buffer.toString('base64'), uploaded_at: new Date()
    }));
    record.photos.push(...toAdd);
    await record.save();
    res.json({ success: true, message: `${toAdd.length} photo(s) added`, total_photos: record.photos.length,
      photos: record.photos.map(({ _id, filename, mimetype, size, uploaded_at }) => ({ _id, filename, mimetype, size, uploaded_at })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/malkhana/:entry_no/photos', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const record = await MalkhanaRegister.findOne({ entry_no: req.params.entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    res.json({ success: true, count: record.photos.length,
      photos: record.photos.map(({ _id, filename, mimetype, size, uploaded_at }) => ({ _id, filename, mimetype, size, uploaded_at })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/malkhana/:entry_no/photos/:photo_id', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const record = await MalkhanaRegister.findOne({ entry_no: req.params.entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    const photo = record.photos.id(req.params.photo_id);
    if (!photo) return res.status(404).json({ success: false, message: 'Photo not found' });
    res.set('Content-Type', photo.mimetype);
    res.set('Content-Disposition', `inline; filename="${photo.filename}"`);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(photo.data, 'base64'));
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/malkhana/:entry_no/photos/:photo_id', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const record = await MalkhanaRegister.findOne({ entry_no: req.params.entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    const photo = record.photos.id(req.params.photo_id);
    if (!photo) return res.status(404).json({ success: false, message: 'Photo not found' });
    photo.deleteOne();
    await record.save();
    res.json({ success: true, message: 'Photo deleted', total_photos: record.photos.length });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── QR TOKEN ROUTES ───────────────────────────────────────────────────────────

// Generate / get existing QR token for a record [Auth required]
app.post('/api/malkhana/:entry_no/qr-token', authenticateToken, async (req, res) => {
  try {
    await connectToDatabase();
    const entry_no = parseInt(req.params.entry_no);
    const record = await MalkhanaRegister.findOne({ entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });

    let pt = await PublicToken.findOne({ entry_no });
    if (!pt) {
      const token = crypto.randomBytes(24).toString('hex');
      pt = await PublicToken.create({ token, entry_no });
    }
    res.json({ success: true, token: pt.token, entry_no });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── PUBLIC ROUTES (no auth — for QR scanners) ─────────────────────────────────

app.get('/api/public/:token', async (req, res) => {
  try {
    await connectToDatabase();
    const pt = await PublicToken.findOne({ token: req.params.token });
    if (!pt) return res.status(404).json({ success: false, message: 'Invalid or expired QR code' });

    const record = await MalkhanaRegister.findOne({ entry_no: pt.entry_no });
    if (!record) return res.status(404).json({ success: false, message: 'Record no longer exists' });

    const obj = record.toObject();
    obj.photos = obj.photos.map(({ _id, filename, mimetype, size, uploaded_at }) => ({
      _id, filename, mimetype, size, uploaded_at,
      url: `${process.env.BASE_URL || 'https://malkhanabackend.vercel.app'}/api/public/${req.params.token}/photos/${_id}`
    }));
    res.json({ success: true, data: obj });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/public/:token/photos/:photo_id', async (req, res) => {
  try {
    await connectToDatabase();
    const pt = await PublicToken.findOne({ token: req.params.token });
    if (!pt) return res.status(404).send('Invalid QR token');

    const record = await MalkhanaRegister.findOne({ entry_no: pt.entry_no });
    if (!record) return res.status(404).send('Record not found');

    const photo = record.photos.id(req.params.photo_id);
    if (!photo) return res.status(404).send('Photo not found');

    res.set('Content-Type', photo.mimetype);
    res.set('Content-Disposition', `inline; filename="${photo.filename}"`);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(photo.data, 'base64'));
  } catch (e) { res.status(500).send('Error serving photo'); }
});

// ─── ROOT ──────────────────────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  try {
    await connectToDatabase();
    res.json({
      message: 'Malkhana Register API', status: 'Running', database: 'Connected',
      frontend: 'https://pachrukhimalkhana.vercel.app',
      auth: { login: 'POST /api/auth/login', verify: 'GET /api/auth/verify', logout: 'POST /api/auth/logout' },
      records: { getAll: 'GET /api/malkhana', getOne: 'GET /api/malkhana/:entry_no', create: 'POST /api/malkhana', update: 'PUT /api/malkhana/:entry_no', delete: 'DELETE /api/malkhana/:entry_no', search: 'GET /api/malkhana/search/:q' },
      photos: { upload: 'POST /api/malkhana/:entry_no/photos', list: 'GET /api/malkhana/:entry_no/photos', serve: 'GET /api/malkhana/:entry_no/photos/:id', delete: 'DELETE /api/malkhana/:entry_no/photos/:id' },
      qr: { generate: 'POST /api/malkhana/:entry_no/qr-token [Auth]', publicData: 'GET /api/public/:token [PUBLIC]', publicPhoto: 'GET /api/public/:token/photos/:id [PUBLIC]' },
      schema_fields: {
        "1_entry_no": "क्रम संख्या (auto, unique)",
        "2_owner": "owner_name, owner_address — स्वामी का नाम एवं पता",
        "3_case": "case_fir_no, case_date, police_station — केस संख्या एवं तिथि",
        "4_property_type": "property_type — संपत्ति का प्रकार",
        "5_description": "property_description, identification_mark — पहचान चिन्ह सहित विवरण",
        "6_value": "property_value — मूल्य",
        "7_found": "found_place, found_date, found_by_officer, found_circumstances",
        "8_received": "received_at_police_station_date — थाने में पाई गई तिथि",
        "9_storage": "storage_location — जप्त के बाद संपत्ति कहाँ रखी",
        "10_disposal": "disposal_date, disposal_method — निपटान की तिथि एवं विधि",
        "11_receipt": "receipt_file_entry_no, sale_amount, buyer_name, buyer_address, receipt_check_no, receipt_check_date",
        "12_accusation": "accusation_remarks — अभियुक्ति / टिप्पणी",
        "13_delay": "delay_reason — विलम्ब का कारण",
        "14_remarks": "remarks — अन्य टिप्पणी"
      }
    });
  } catch (e) { res.status(500).json({ message: 'Error', error: e.message }); }
});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
}

module.exports = app;
