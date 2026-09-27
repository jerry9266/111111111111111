const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 5000;

// Enable Cross-Origin Resource Sharing (CORS)
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
    res.json({ status: 'active', message: 'NaponTech Server is active.' });
});

/**
 * Normalizes input category strings
 */
function normalizeCategory(cat) {
    if (!cat) return 'contact';
    const c = cat.toLowerCase().trim().replace(/[\s-]+/g, '_');
    if (c.includes('get_started') || c.includes('getstarted') || c.includes('start')) return 'get_started';
    if (c.includes('feedback') || c.includes('review')) return 'feedback';
    if (c.includes('issue') || c.includes('report') || c.includes('bug')) return 'issues';
    return 'contact';
}

function getCategoryLabel(cat) {
    switch (cat) {
        case 'get_started': return 'Get Started';
        case 'feedback': return 'Feedback';
        case 'issues': return 'Issues';
        default: return 'Contact Us';
    }
}

/**
 * 1. POST /api/submit
 * Receives form inputs, tags with category, generates TXT, and uploads to Cloudinary.
 */
app.post('/api/submit', async (req, res) => {
    try {
        const { firstName, lastName, phone, email, subject, message, category } = req.body;

        if (!firstName || !lastName || !email || !message) {
            return res.status(400).json({ success: false, error: 'Missing required form fields.' });
        }

        const normalizedCat = normalizeCategory(category);
        const categoryLabel = getCategoryLabel(normalizedCat);
        const readableDate = new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'long' });
        const fullName = `${firstName.trim()} ${lastName.trim()}`;
        const finalSubject = subject ? subject.trim() : 'General Inquiry';

        // TXT content format
        const fileContent = `=====================================================
NAPONTECH - ${categoryLabel.toUpperCase()}
=====================================================
Category        : ${categoryLabel}
Submission Date : ${readableDate} (UTC)
Customer Name   : ${fullName}
Email Address   : ${email.trim()}
Phone Number    : ${phone ? phone.trim() : 'Not Provided'}
Subject / Topic : ${finalSubject}
-----------------------------------------------------
MESSAGE:
${message.trim()}
=====================================================
`;

        const base64Data = Buffer.from(fileContent, 'utf-8').toString('base64');
        const uploadURI = `data:text/plain;base64,${base64Data}`;
        const cleanName = `${firstName.replace(/[^a-zA-Z0-9]/g, '')}_${lastName.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;
        
        // Upload to Cloudinary with tags and context metadata
        const uploadResponse = await cloudinary.uploader.upload(uploadURI, {
            resource_type: 'raw',
            folder: 'submissions',
            public_id: `${normalizedCat}_${cleanName}.txt`,
            tags: [normalizedCat, 'napontech_message'],
            context: {
                category: normalizedCat,
                sender_name: fullName,
                subject: finalSubject
            }
        });

        return res.status(200).json({
            success: true,
            message: 'Message stored successfully.',
            fileUrl: uploadResponse.secure_url,
            publicId: uploadResponse.public_id,
            category: normalizedCat
        });

    } catch (error) {
        console.error('Submission Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to upload message to Cloudinary.',
            details: error.message
        });
    }
});

/**
 * 2. GET /api/submissions
 * Retrieves all stored messages with metadata and tags for categorizing & date grouping.
 */
app.get('/api/submissions', async (req, res) => {
    try {
        const result = await cloudinary.api.resources({
            resource_type: 'raw',
            type: 'upload',
            prefix: 'submissions/',
            max_results: 500,
            context: true,
            tags: true
        });

        const formattedFiles = result.resources.map(file => {
            const cleanId = file.public_id.replace('submissions/', '');
            
            // Extract category from context or filename prefix
            let cat = 'contact';
            if (file.context && file.context.custom && file.context.custom.category) {
                cat = file.context.custom.category;
            } else if (cleanId.startsWith('get_started_')) {
                cat = 'get_started';
            } else if (cleanId.startsWith('feedback_')) {
                cat = 'feedback';
            } else if (cleanId.startsWith('issues_')) {
                cat = 'issues';
            }

            // Extract sender name and subject
            let senderName = 'Anonymous';
            let subject = 'Customer Inquiry';

            if (file.context && file.context.custom) {
                if (file.context.custom.sender_name) senderName = file.context.custom.sender_name;
                if (file.context.custom.subject) subject = file.context.custom.subject;
            } else {
                // Fallback name parser from filename
                const parts = cleanId.replace(/\.txt$/, '').split('_');
                if (parts.length >= 3) {
                    senderName = `${parts[1]} ${parts[2]}`;
                }
            }

            return {
                public_id: file.public_id,
                filename: cleanId,
                name: senderName,
                subject: subject,
                category: cat,
                category_label: getCategoryLabel(cat),
                url: file.secure_url,
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
        console.error('Fetch Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to retrieve messages from Cloudinary.',
            details: error.message
        });
    }
});

/**
 * 3. DELETE /api/delete-submission
 * Permanently deletes a TXT file from Cloudinary storage to free space.
 */
app.delete('/api/delete-submission', async (req, res) => {
    try {
        const { public_id } = req.body;

        if (!public_id) {
            return res.status(400).json({ success: false, error: 'public_id is required for deletion.' });
        }

        const result = await cloudinary.uploader.destroy(public_id, { resource_type: 'raw' });

        if (result.result === 'ok' || result.result === 'not found') {
            return res.status(200).json({
                success: true,
                message: 'Message deleted permanently from Cloudinary.'
            });
        } else {
            return res.status(500).json({
                success: false,
                error: 'Could not delete file from Cloudinary.',
                details: result
            });
        }
    } catch (error) {
        console.error('Delete Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Server error while deleting file.',
            details: error.message
        });
    }
});

/**
 * 4. GET /api/fetch-txt-content
 * Proxy to read raw file text content securely
 */
app.get('/api/fetch-txt-content', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).send('URL is required.');

        const response = await fetch(url);
        const text = await response.text();
        res.setHeader('Content-Type', 'text/plain');
        return res.send(text);
    } catch (err) {
        return res.status(500).send('Error reading file: ' + err.message);
    }
});

app.listen(PORT, () => {
    console.log(`NaponTech server running on port ${PORT}`);
});