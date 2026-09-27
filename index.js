const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Cloudinary Configuration
cloudinary.config({
    cloud_name: 'qgtma8wv',
    api_key: '226171487848885',
    api_secret: 'MSJO8EKk5EnrCMp4hgQouDMl3bw',
    secure: true
});

app.get('/', (req, res) => {
    res.json({ status: 'active', message: 'NaponTech Backend Server is running.' });
});

/* ==========================================================================
   HOMEPAGE STRUCTURED POSTS API
   ========================================================================== */

/**
 * 1. POST /api/upload-post
 * Uploads media files (up to 5 images or 1 video) to Cloudinary and attaches
 * title, description, and group metadata using Cloudinary context.
 */
app.post('/api/upload-post', async (req, res) => {
    try {
        const { title, description, files, mediaType } = req.body;

        if (!title || !description || !files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ success: false, error: 'Title, description, and files are required.' });
        }

        if (mediaType === 'video' && files.length > 1) {
            return res.status(400).json({ success: false, error: 'Maximum 1 video allowed per upload.' });
        }

        if (mediaType === 'image' && files.length > 5) {
            return res.status(400).json({ success: false, error: 'Maximum 5 images allowed per upload.' });
        }

        const postId = `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const resourceType = mediaType === 'video' ? 'video' : 'image';
        const uploadedAssets = [];

        // Upload each selected file to Cloudinary with context metadata
        for (let i = 0; i < files.length; i++) {
            const fileData = files[i];
            const uploadRes = await cloudinary.uploader.upload(fileData, {
                resource_type: resourceType,
                folder: 'homepage_posts',
                public_id: `${postId}_item_${i + 1}`,
                context: {
                    post_id: postId,
                    title: title.trim(),
                    description: description.trim(),
                    media_type: mediaType,
                    item_order: i + 1,
                    total_items: files.length
                }
            });

            uploadedAssets.push({
                public_id: uploadRes.public_id,
                secure_url: uploadRes.secure_url,
                resource_type: uploadRes.resource_type,
                order: i + 1
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Content uploaded and published successfully.',
            post_id: postId,
            title,
            description,
            media_type: mediaType,
            media: uploadedAssets
        });

    } catch (err) {
        console.error('Upload Post Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 2. GET /api/posts
 * Fetches all homepage post assets from Cloudinary, groups multi-image posts,
 * and formats structured JSON for the homepage and upload manager.
 */
app.get('/api/posts', async (req, res) => {
    try {
        // Fetch both image and video assets under homepage_posts/
        const [imageRes, videoRes] = await Promise.all([
            cloudinary.api.resources({
                type: 'upload',
                prefix: 'homepage_posts/',
                resource_type: 'image',
                context: true,
                max_results: 500
            }).catch(() => ({ resources: [] })),
            cloudinary.api.resources({
                type: 'upload',
                prefix: 'homepage_posts/',
                resource_type: 'video',
                context: true,
                max_results: 100
            }).catch(() => ({ resources: [] }))
        ]);

        const allResources = [...(imageRes.resources || []), ...(videoRes.resources || [])];
        const postGroups = {};

        allResources.forEach(resItem => {
            const ctx = (resItem.context && resItem.context.custom) || {};
            const postId = ctx.post_id || resItem.public_id.split('_item_')[0].replace('homepage_posts/', '') || resItem.public_id;

            if (!postGroups[postId]) {
                postGroups[postId] = {
                    post_id: postId,
                    title: ctx.title || 'Featured Service',
                    description: ctx.description || '',
                    media_type: ctx.media_type || (resItem.resource_type === 'video' ? 'video' : 'image'),
                    created_at: resItem.created_at,
                    media: [],
                    public_ids: []
                };
            }

            postGroups[postId].public_ids.push(resItem.public_id);
            postGroups[postId].media.push({
                type: resItem.resource_type === 'video' ? 'video' : 'image',
                src: resItem.secure_url,
                poster: resItem.resource_type === 'video' ? resItem.secure_url.replace(/\.[^/.]+$/, ".jpg") : undefined,
                order: parseInt(ctx.item_order || '1', 10)
            });
        });

        // Sort items inside each post by order, and sort posts latest first
        const formattedPosts = Object.values(postGroups).map(post => {
            post.media.sort((a, b) => a.order - b.order);
            return post;
        });

        formattedPosts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        return res.status(200).json({
            success: true,
            count: formattedPosts.length,
            posts: formattedPosts
        });

    } catch (err) {
        console.error('Fetch Posts Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 3. DELETE /api/delete-post
 * Permanently deletes all media items associated with a post from Cloudinary.
 */
app.delete('/api/delete-post', async (req, res) => {
    try {
        const { public_ids } = req.body;

        if (!public_ids || !Array.isArray(public_ids) || public_ids.length === 0) {
            return res.status(400).json({ success: false, error: 'public_ids array is required.' });
        }

        for (const pid of public_ids) {
            await cloudinary.uploader.destroy(pid, { resource_type: 'image' }).catch(() => {});
            await cloudinary.uploader.destroy(pid, { resource_type: 'video' }).catch(() => {});
        }

        return res.status(200).json({
            success: true,
            message: 'Post permanently deleted from Cloudinary.'
        });

    } catch (err) {
        console.error('Delete Post Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/* ==========================================================================
   FORM SUBMISSIONS (CONTACT / GET STARTED / FEEDBACK / ISSUES)
   ========================================================================== */

function normalizeCategory(cat) {
    if (!cat) return 'contact';
    const c = cat.toLowerCase().trim().replace(/[\s-]+/g, '_');
    if (c.includes('get_started') || c.includes('start')) return 'get_started';
    if (c.includes('feedback') || c.includes('review')) return 'feedback';
    if (c.includes('issue') || c.includes('bug')) return 'issues';
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

app.post('/api/submit', async (req, res) => {
    try {
        const { firstName, lastName, phone, email, subject, message, category } = req.body;
        if (!firstName || !lastName || !email || !message) {
            return res.status(400).json({ success: false, error: 'Missing required fields.' });
        }

        const normalizedCat = normalizeCategory(category);
        const categoryLabel = getCategoryLabel(normalizedCat);
        const readableDate = new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'long' });
        const fullName = `${firstName.trim()} ${lastName.trim()}`;
        const finalSubject = subject ? subject.trim() : 'General Inquiry';

        const fileContent = `=====================================================
NAPONTECH - ${categoryLabel.toUpperCase()}
=====================================================
Category        : ${categoryLabel}
Submission Date : ${readableDate} (UTC)
Customer Name   : ${fullName}
Email Address   : ${email.trim()}
Phone Number    : ${phone ? phone.trim() : 'Not Provided'}
Subject / Topic : ${finalSubject}
-----------------------------------------
MESSAGE:
${message.trim()}
=====================================================
`;

        const base64Data = Buffer.from(fileContent, 'utf-8').toString('base64');
        const uploadURI = `data:text/plain;base64,${base64Data}`;
        const cleanName = `${firstName.replace(/[^a-zA-Z0-9]/g, '')}_${lastName.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;

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
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/submissions', async (req, res) => {
    try {
        const result = await cloudinary.api.resources({
            resource_type: 'raw',
            type: 'upload',
            prefix: 'submissions/',
            max_results: 500,
            context: true
        });

        const formatted = result.resources.map(file => {
            const cleanId = file.public_id.replace('submissions/', '');
            let cat = 'contact';
            if (file.context && file.context.custom && file.context.custom.category) {
                cat = file.context.custom.category;
            } else if (cleanId.startsWith('get_started_')) cat = 'get_started';
            else if (cleanId.startsWith('feedback_')) cat = 'feedback';
            else if (cleanId.startsWith('issues_')) cat = 'issues';

            let senderName = 'Anonymous';
            let subject = 'Customer Inquiry';

            if (file.context && file.context.custom) {
                if (file.context.custom.sender_name) senderName = file.context.custom.sender_name;
                if (file.context.custom.subject) subject = file.context.custom.subject;
            } else {
                const parts = cleanId.replace(/\.txt$/, '').split('_');
                if (parts.length >= 3) senderName = `${parts[1]} ${parts[2]}`;
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

        formatted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return res.status(200).json({ success: true, count: formatted.length, submissions: formatted });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/delete-submission', async (req, res) => {
    try {
        const { public_id } = req.body;
        if (!public_id) return res.status(400).json({ success: false, error: 'public_id is required' });
        await cloudinary.uploader.destroy(public_id, { resource_type: 'raw' });
        return res.status(200).json({ success: true, message: 'Deleted successfully.' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/fetch-txt-content', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).send('URL is required');
        const response = await fetch(url);
        const text = await response.text();
        res.setHeader('Content-Type', 'text/plain');
        return res.send(text);
    } catch (err) {
        return res.status(500).send('Error: ' + err.message);
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});