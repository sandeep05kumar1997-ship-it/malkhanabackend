const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://sandeep05kumar1997_db_user:ffz2VaI6Omp6IqjT@malkhana.r7oy4dg.mongodb.net/malkhana_db?retryWrites=true&w=majority&appName=malkhana';

// Malkhana Schema
const malkhanaSchema = new mongoose.Schema({
  entry_no: {
    type: Number,
    required: true,
    unique: true
  },
  case_fir_no: String,
  police_station: String,
  case_section: String,
  property_description: String,
  property_type: String,
  quantity_weight: String,
  identification_mark: String,
  seal_number: String,
  date_of_seizure: Date,
  seized_by_officer: String,
  received_date_malkhana: Date,
  malkhana_register_no: String,
  storage_location: String,
  issued_date: Date,
  issued_to: String,
  return_date: Date,
  final_disposal_type: String,
  disposal_date: Date,
  remarks: String
}, {
  timestamps: true
});

// Check if model exists before creating to avoid OverwriteModelError
const MalkhanaRegister = mongoose.models.MalkhanaRegister || mongoose.model('MalkhanaRegister', malkhanaSchema);

// MongoDB connection function for serverless
let cachedConnection = null;

async function connectToDatabase() {
  if (cachedConnection && mongoose.connection.readyState === 1) {
    console.log('Using cached database connection');
    return cachedConnection;
  }

  try {
    cachedConnection = await mongoose.connect(MONGODB_URI);
    console.log('New database connection established');
    return cachedConnection;
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
}

// Routes

// GET - Get all records
app.get('/api/malkhana', async (req, res) => {
  try {
    await connectToDatabase();
    const records = await MalkhanaRegister.find().sort({ entry_no: -1 });
    res.status(200).json({
      success: true,
      count: records.length,
      data: records
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching records',
      error: error.message
    });
  }
});

// GET - Get single record by entry_no
app.get('/api/malkhana/:entry_no', async (req, res) => {
  try {
    await connectToDatabase();
    const record = await MalkhanaRegister.findOne({ entry_no: req.params.entry_no });
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Record not found'
      });
    }
    res.status(200).json({
      success: true,
      data: record
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching record',
      error: error.message
    });
  }
});

// POST - Create new record
app.post('/api/malkhana', async (req, res) => {
  try {
    await connectToDatabase();
    const newRecord = new MalkhanaRegister(req.body);
    const savedRecord = await newRecord.save();
    res.status(201).json({
      success: true,
      message: 'Record created successfully',
      data: savedRecord
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Entry number already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error creating record',
      error: error.message
    });
  }
});

// PUT - Update record
app.put('/api/malkhana/:entry_no', async (req, res) => {
  try {
    await connectToDatabase();
    const updatedRecord = await MalkhanaRegister.findOneAndUpdate(
      { entry_no: req.params.entry_no },
      req.body,
      { new: true, runValidators: true }
    );
    if (!updatedRecord) {
      return res.status(404).json({
        success: false,
        message: 'Record not found'
      });
    }
    res.status(200).json({
      success: true,
      message: 'Record updated successfully',
      data: updatedRecord
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating record',
      error: error.message
    });
  }
});

// DELETE - Delete record
app.delete('/api/malkhana/:entry_no', async (req, res) => {
  try {
    await connectToDatabase();
    const deletedRecord = await MalkhanaRegister.findOneAndDelete({ entry_no: req.params.entry_no });
    if (!deletedRecord) {
      return res.status(404).json({
        success: false,
        message: 'Record not found'
      });
    }
    res.status(200).json({
      success: true,
      message: 'Record deleted successfully',
      data: deletedRecord
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting record',
      error: error.message
    });
  }
});

// Search records
app.get('/api/malkhana/search/:query', async (req, res) => {
  try {
    await connectToDatabase();
    const query = req.params.query;
    const records = await MalkhanaRegister.find({
      $or: [
        { case_fir_no: { $regex: query, $options: 'i' } },
        { police_station: { $regex: query, $options: 'i' } },
        { property_type: { $regex: query, $options: 'i' } },
        { seized_by_officer: { $regex: query, $options: 'i' } }
      ]
    });
    res.status(200).json({
      success: true,
      count: records.length,
      data: records
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error searching records',
      error: error.message
    });
  }
});

// Root route
app.get('/', async (req, res) => {
  try {
    await connectToDatabase();
    res.json({
      message: 'Malkhana Register API',
      status: 'Running',
      database: 'Connected',
      endpoints: {
        getAll: 'GET /api/malkhana',
        getOne: 'GET /api/malkhana/:entry_no',
        create: 'POST /api/malkhana',
        update: 'PUT /api/malkhana/:entry_no',
        delete: 'DELETE /api/malkhana/:entry_no',
        search: 'GET /api/malkhana/search/:query'
      }
    });
  } catch (error) {
    res.status(500).json({
      message: 'Malkhana Register API',
      status: 'Error',
      error: error.message
    });
  }
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
  });
}

// Export for Vercel serverless
module.exports = app;
