const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const http = require('http');
const { Server } = require('socket.io');
const { Readable } = require('stream');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors());
app.use(express.json());

// --- Cloudinary Config ---
cloudinary.config({
    cloud_name: 'dyhhksvot',
    api_key: '843162796934642',
    api_secret: 'BZuIO8S5N9JxNB_zTDRRbRf6j2U'
});

// --- Database Setup ---
const db = new sqlite3.Database('./content.sqlite', (err) => {
    if (err) console.error("Database connection error:", err.message);
    else console.log("Connected to SQLite persistent database.");
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        cloudinary_url TEXT,
        thumbnail_url TEXT,
        file_type TEXT,
        title TEXT,
        tags TEXT,
        upload_timestamp INTEGER
    )`);
});

// --- Security & Validation ---
const sanitizeInput = (str) => {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>]/g, '').trim(); // Prevent basic XSS
};

const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain'
];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB Max size
    fileFilter: (req, file, cb) => {
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPG, PNG, WebP, GIF, PDF, and TXT are allowed.'));
        }
    }
});

// Validate Actual File Magic Numbers (Security against fake extensions)
function validateBuffer(buffer, mimetype) {
    if (mimetype === 'text/plain') return !buffer.includes(0x00); // Text should not contain binary null bytes
    
    const bytes = Array.from(buffer.slice(0, 12));
    const toHex = (arr) => arr.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    
    if (mimetype === 'image/jpeg') return toHex(bytes.slice(0, 3)) === 'FFD8FF';
    if (mimetype === 'image/png') return toHex(bytes.slice(0, 8)) === '89504E470D0A1A0A';
    if (mimetype === 'image/gif') return toHex(bytes.slice(0, 4)) === '47494638'; // GIF8
    if (mimetype === 'application/pdf') return toHex(bytes.slice(0, 4)) === '25504446'; // %PDF
    if (mimetype === 'image/webp') {
        // WebP header: RIFF (4 bytes) + Size (4 bytes) + WEBP (4 bytes)
        return toHex(bytes.slice(0, 4)) === '52494646' && toHex(bytes.slice(8, 12)) === '57454250';
    }
    return false;
}

// --- API Endpoints ---

// 1. Fetch Feed (Pagination & DB Only)
app.get('/api/pins', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Fetch `limit + 1` to easily determine if there's a next page
    db.all(`SELECT * FROM files ORDER BY upload_timestamp DESC LIMIT ? OFFSET ?`, [limit + 1, offset], (err, rows) => {
        if (err) return res.status(500).json({ error: "Failed to fetch feed" });
        
        const hasMore = rows.length > limit;
        const data = rows.slice(0, limit).map(row => ({
            id: row.id,
            source: 'uploaded',
            imageUrl: row.cloudinary_url,
            thumbnailUrl: row.thumbnail_url,
            title: row.title,
            fileType: row.file_type,
            tags: row.tags ? row.tags.split(',') : []
        }));
        
        res.json({
            data,
            currentPage: page,
            hasMore
        });
    });
});

// 2. Search API (DB Only)
app.get('/api/search', (req, res) => {
    const query = sanitizeInput(req.query.q);
    if (!query) return res.json({ data: [], hasMore: false });
    
    const likeQuery = `%${query}%`;
    db.all(`SELECT * FROM files WHERE title LIKE ? OR tags LIKE ? OR file_type LIKE ? ORDER BY upload_timestamp DESC LIMIT 40`,
        [likeQuery, likeQuery, likeQuery],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Search failed" });
            
            const data = rows.map(row => ({
                id: row.id,
                source: 'uploaded',
                imageUrl: row.cloudinary_url,
                thumbnailUrl: row.thumbnail_url,
                title: row.title,
                fileType: row.file_type,
                tags: row.tags ? row.tags.split(',') : []
            }));
            
            res.json({ data, hasMore: false });
        }
    );
});

// 3. Upload Endpoint (Restricted & Secured)
app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload error: ${err.message}` });
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: "No file provided" });
        
        // Deep validation of file contents
        if (!validateBuffer(req.file.buffer, req.file.mimetype)) {
            return res.status(400).json({ error: "File contents do not match MIME type, or file is unsupported/corrupt." });
        }
        
        const title = sanitizeInput(req.body.title) || 'New Upload';
        const tagsRaw = sanitizeInput(req.body.tags) || 'uploaded';
        const tagsArray = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
        const fileType = req.file.mimetype;
        
        // Determine Cloudinary resource type (raw for text files)
        const resourceType = fileType === 'text/plain' ? 'raw' : 'auto';
        
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: "pinterest_feed",
                resource_type: resourceType,
                context: `title=${title}`,
                tags: tagsArray
            },
            (error, result) => {
                if (error) return res.status(500).json({ error: "Cloudinary upload failed" });
                
                let thumbnailUrl = result.secure_url;
                if (fileType.startsWith('image/')) {
                    thumbnailUrl = result.secure_url.replace('/upload/', '/upload/w_400,c_scale,q_auto,f_auto/');
                } else if (fileType === 'application/pdf') {
                    // Generates an image thumbnail of the first page of the PDF
                    thumbnailUrl = result.secure_url.replace('/upload/', '/upload/w_400,c_scale,q_auto,f_jpg,pg_1/');
                } else {
                    thumbnailUrl = null; // No thumbnail available for txt
                }
                
                const newRecord = {
                    id: result.asset_id || `upload_${Date.now()}`,
                    cloudinary_url: result.secure_url,
                    thumbnail_url: thumbnailUrl,
                    file_type: fileType,
                    title: title,
                    tags: tagsArray.join(','),
                    upload_timestamp: Date.now()
                };
                
                // Store as the Single Source of Truth in SQLite
                db.run(`INSERT INTO files (id, cloudinary_url, thumbnail_url, file_type, title, tags, upload_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [newRecord.id, newRecord.cloudinary_url, newRecord.thumbnail_url, newRecord.file_type, newRecord.title, newRecord.tags, newRecord.upload_timestamp],
                    function(dbErr) {
                        if (dbErr) return res.status(500).json({ error: "Database save failed" });
                        
                        // Prepare exact shape for frontend backward compatibility
                        const emitPayload = {
                            id: newRecord.id,
                            source: 'uploaded',
                            imageUrl: newRecord.cloudinary_url,
                            thumbnailUrl: newRecord.thumbnail_url,
                            title: newRecord.title,
                            fileType: newRecord.file_type,
                            tags: tagsArray
                        };
                        
                        io.emit('new_pin', emitPayload);
                        res.status(201).json({ message: "Upload successful", pin: emitPayload });
                    }
                );
            }
        );
        
        const bufferStream = new Readable();
        bufferStream.push(req.file.buffer);
        bufferStream.push(null);
        bufferStream.pipe(uploadStream);
    });
});

app.get('/', (req, res) => res.send("Secure Personal Content Platform Running!"));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));