const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 5000;

// Enable Cross-Origin Resource Sharing (CORS) for all origins
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cloudinary Configuration (Hardcoded Credentials)
cloudinary.config({
    cloud_name: 'qgtma8wv',
    api_key: '226171487848885',
    api_secret: 'MSJO8EKk5EnrCMp4hgQouDMl3bw',
    secure: true
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'active', message: 'NaponTech Backend Server is running.' });
});

/**
 * 1. POST /api/submit
 * Receives form details, converts them to a formatted TXT file, 
 * and uploads to Cloudinary folder "submissions".
 */
app.post('/api/submit', async (req, res) => {
    try {
        const { firstName, lastName, phone, email, subject, message } = req.body;
        
        if (!firstName || !lastName || !email || !message) {
            return res.status(400).json({ success: false, error: 'Missing required form fields.' });
        }
        
        const timestamp = new Date().toISOString();
        const readableDate = new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'long' });
        
        // Generate the TXT file content
        const fileContent = `=========================================
NAPONTECH CONTACT FORM SUBMISSION
=========================================
Submission Date : ${readableDate} (UTC)
First Name      : ${firstName}
Last Name       : ${lastName}
Full Name       : ${firstName} ${lastName}
Email Address   : ${email}
Phone Number    : ${phone || 'Not Provided'}
Subject / Topic : ${subject || 'General Inquiry'}
-----------------------------------------
MESSAGE:
${message}
=========================================
`;
        
        // Convert raw string to base64 data URI for Cloudinary raw upload
        const base64Data = Buffer.from(fileContent, 'utf-8').toString('base64');
        const uploadURI = `data:text/plain;base64,${base64Data}`;
        const fileName = `${firstName.toLowerCase()}_${lastName.toLowerCase()}_${Date.now()}`;
        
        // Upload to Cloudinary as "raw" resource
        const uploadResponse = await cloudinary.uploader.upload(uploadURI, {
            resource_type: 'raw',
            folder: 'submissions',
            public_id: `${fileName}.txt`,
            tags: ['contact_submission', 'txt_entry']
        });
        
        return res.status(200).json({
            success: true,
            message: 'Submission converted to TXT and stored in Cloudinary successfully.',
            fileUrl: uploadResponse.secure_url,
            publicId: uploadResponse.public_id,
            createdAt: uploadResponse.created_at
        });
        
    } catch (error) {
        console.error('Cloudinary Upload Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to upload submission to Cloudinary.',
            details: error.message
        });
    }
});

/**
 * 2. GET /api/submissions
 * Retrieves all stored TXT submissions from Cloudinary for the Admin Dashboard.
 */
app.get('/api/submissions', async (req, res) => {
    try {
        const result = await cloudinary.api.resources({
            resource_type: 'raw',
            type: 'upload',
            prefix: 'submissions/',
            max_results: 100
        });
        
        const formattedFiles = result.resources.map(file => {
            const cleanName = file.public_id.replace('submissions/', '');
            return {
                public_id: file.public_id,
                filename: cleanName,
                url: file.secure_url,
                format: file.format || 'txt',
                bytes: file.bytes,
                created_at: file.created_at
            };
        });
        
        // Sort latest first
        formattedFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        return res.status(200).json({
            success: true,
            count: formattedFiles.length,
            submissions: formattedFiles
        });
        
    } catch (error) {
        console.error('Error fetching submissions:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch submissions from Cloudinary.',
            details: error.message
        });
    }
});

/**
 * 3. GET /api/fetch-txt-content
 * Proxy endpoint to read raw TXT content to prevent browser CORS when viewing text.
 */
app.get('/api/fetch-txt-content', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).send('URL query parameter is required');
        
        const response = await fetch(url);
        const text = await response.text();
        res.setHeader('Content-Type', 'text/plain');
        return res.send(text);
    } catch (err) {
        return res.status(500).send('Error reading text file: ' + err.message);
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});