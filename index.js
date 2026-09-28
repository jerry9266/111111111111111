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

// Body parsers with high payload capacity for images/videos
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Cloudinary Configuration (Hardcoded Credentials)
cloudinary.config({
    cloud_name: 'qgtma8wv',
    api_key: '226171487848885',
    api_secret: 'MSJO8EKk5EnrCMp4hgQouDMl3bw',
    secure: true
});

// Server Health Check
app.get('/', (req, res) => {
    res.json({ status: 'active', message: 'NaponTech Backend Server is running.' });
});

/* ==========================================================================
   1. HOMEPAGE CONTENT SYSTEM (IMAGE / VIDEO / METADATA)
   ========================================================================== */

/**
 * POST /api/upload-post
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
 * GET /api/posts
 * Fetches all homepage posts from Cloudinary and formats structured JSON.
 */
app.get('/api/posts', async (req, res) => {
    try {
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
 * DELETE /api/delete-post
 * Permanently deletes homepage post assets from Cloudinary.
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
   2. FORM SUBMISSIONS SYSTEM (CONTACT / GET STARTED / FEEDBACK / ISSUES)
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

/**
 * POST /api/submit
 * Receives form inputs, tags category, generates TXT, and uploads to Cloudinary.
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
        console.error('Submit Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/submissions
 * Retrieves stored contact messages for Admin Dashboard.
 */
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
        console.error('Fetch Submissions Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/delete-submission
 * Permanently deletes a TXT submission from Cloudinary.
 */
app.delete('/api/delete-submission', async (req, res) => {
    try {
        const { public_id } = req.body;
        if (!public_id) return res.status(400).json({ success: false, error: 'public_id is required' });
        await cloudinary.uploader.destroy(public_id, { resource_type: 'raw' });
        return res.status(200).json({ success: true, message: 'Submission deleted permanently from Cloudinary.' });
    } catch (err) {
        console.error('Delete Submission Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/fetch-txt-content
 * Secure proxy endpoint for reading raw TXT content without CORS errors.
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
        return res.status(500).send('Error reading text content: ' + err.message);
    }
});

/* ==========================================================================
   3. CLIENT PROJECT TRACKING SYSTEM (TXT-BASED CLOUDINARY STORAGE)
   ========================================================================== */

/**
 * POST /api/project/save (Admin)
 * Creates or updates a project record by uploading a TXT representation to Cloudinary.
 */
app.post('/api/project/save', async (req, res) => {
    try {
        const {
            trackingId,
            customerName,
            projectName,
            category,
            projectDescription,
            status,
            progress,
            startDate,
            expectedCompletion,
            currentUpdate,
            nextStep,
            adminNotes
        } = req.body;

        if (!trackingId || !customerName || !projectName) {
            return res.status(400).json({ success: false, error: 'Tracking ID, Customer Name, and Project Name are required.' });
        }

        const cleanTrackingId = trackingId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        const readableDate = new Date().toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'full', timeStyle: 'long' });

        const fileContent = `=====================================================
NAPONTECH - CLIENT PROJECT TRACKING RECORD
=====================================================
TRACKING ID         : ${cleanTrackingId}
CUSTOMER NAME       : ${customerName.trim()}
PROJECT NAME        : ${projectName.trim()}
CATEGORY            : ${category ? category.trim() : 'Web Development'}
STATUS              : ${status ? status.trim() : 'Planning & Discovery'}
PROGRESS            : ${progress !== undefined ? progress : 0}
START DATE          : ${startDate ? startDate.trim() : 'Not specified'}
TARGET COMPLETION   : ${expectedCompletion ? expectedCompletion.trim() : 'Pending'}
LAST UPDATED        : ${readableDate} (UTC)
-----------------------------------------------------
PROJECT DESCRIPTION:
${projectDescription ? projectDescription.trim() : 'No description provided.'}
-----------------------------------------------------
CURRENT UPDATE:
${currentUpdate ? currentUpdate.trim() : 'Project initialized.'}
-----------------------------------------------------
NEXT STEP:
${nextStep ? nextStep.trim() : 'Initial kickoff and requirement review.'}
-----------------------------------------------------
ADMIN NOTES:
${adminNotes ? adminNotes.trim() : 'None.'}
=====================================================
`;

        const base64Data = Buffer.from(fileContent, 'utf-8').toString('base64');
        const uploadURI = `data:text/plain;base64,${base64Data}`;

        await cloudinary.uploader.upload(uploadURI, {
            resource_type: 'raw',
            folder: 'project_records',
            public_id: `proj_${cleanTrackingId}.txt`,
            overwrite: true,
            tags: [cleanTrackingId, 'project_record', 'napontech_tracking'],
            context: {
                tracking_id: cleanTrackingId,
                customer_name: customerName.trim(),
                project_name: projectName.trim(),
                status: status || 'Planning',
                progress: String(progress || 0)
            }
        });

        return res.status(200).json({
            success: true,
            message: 'Project record saved successfully.',
            trackingId: cleanTrackingId
        });

    } catch (err) {
        console.error('Save Project Error:', err);
        return res.status(500).json({ success: false, error: 'Failed to save project: ' + err.message });
    }
});

/**
 * POST /api/project/get (Public Customer Endpoint)
 * Looks up a project by Tracking ID tag, parses raw TXT on the server,
 * and returns clean structured JSON (no Cloudinary metadata exposed).
 */
app.post('/api/project/get', async (req, res) => {
    try {
        const { trackingId } = req.body;

        if (!trackingId || typeof trackingId !== 'string') {
            return res.status(400).json({ success: false, error: 'Please enter a valid Tracking ID.' });
        }

        const cleanId = trackingId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');

        if (cleanId.length < 3 || cleanId.length > 50) {
            return res.status(404).json({ success: false, error: 'Project not found. Please check your Tracking ID and try again.' });
        }

        let resource;
        try {
            resource = await cloudinary.api.resource(`project_records/proj_${cleanId}.txt`, { resource_type: 'raw' });
        } catch (e) {
            const tagSearch = await cloudinary.api.resources_by_tag(cleanId, { resource_type: 'raw', max_results: 1 });
            if (tagSearch.resources && tagSearch.resources.length > 0) {
                resource = tagSearch.resources[0];
            }
        }

        if (!resource || !resource.secure_url) {
            return res.status(404).json({ success: false, error: 'Project not found. Please check your Tracking ID and try again.' });
        }

        const fileRes = await fetch(resource.secure_url);
        const rawText = await fileRes.text();

        const projectData = {
            trackingId: cleanId,
            customerName: '',
            projectName: '',
            category: 'Web Development',
            status: 'In Progress',
            progress: 0,
            startDate: 'Not specified',
            expectedCompletion: 'Pending',
            lastUpdated: new Date(resource.created_at).toLocaleDateString(),
            projectDescription: '',
            currentUpdate: '',
            nextStep: ''
        };

        const lines = rawText.split('\n');
        let currentSection = null;
        const sectionBuffers = { description: [], update: [], next: [] };

        for (let line of lines) {
            const trimmed = line.trim();

            if (/^={3,}|^--{3,}/.test(trimmed)) continue;

            if (trimmed === 'PROJECT DESCRIPTION:') { currentSection = 'description'; continue; }
            if (trimmed === 'CURRENT UPDATE:') { currentSection = 'update'; continue; }
            if (trimmed === 'NEXT STEP:') { currentSection = 'next'; continue; }
            if (trimmed === 'ADMIN NOTES:') { currentSection = null; continue; }

            if (currentSection) {
                sectionBuffers[currentSection].push(line);
                continue;
            }

            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                const key = line.substring(0, colonIdx).trim().toUpperCase();
                const val = line.substring(colonIdx + 1).trim();

                if (key === 'CUSTOMER NAME') projectData.customerName = val;
                else if (key === 'PROJECT NAME') projectData.projectName = val;
                else if (key === 'CATEGORY') projectData.category = val;
                else if (key === 'STATUS') projectData.status = val;
                else if (key === 'PROGRESS') projectData.progress = parseInt(val, 10) || 0;
                else if (key === 'START DATE') projectData.startDate = val;
                else if (key === 'TARGET COMPLETION') projectData.expectedCompletion = val;
                else if (key === 'LAST UPDATED') projectData.lastUpdated = val;
            }
        }

        projectData.projectDescription = sectionBuffers.description.join('\n').trim();
        projectData.currentUpdate = sectionBuffers.update.join('\n').trim();
        projectData.nextStep = sectionBuffers.next.join('\n').trim();

        return res.status(200).json({
            success: true,
            project: projectData
        });

    } catch (err) {
        console.error('Track Project Error:', err);
        return res.status(500).json({ success: false, error: 'Could not retrieve project data at this time.' });
    }
});

/**
 * GET /api/projects/list (Admin)
 * Lists all active project records for the admin dashboard.
 */
app.get('/api/projects/list', async (req, res) => {
    try {
        const result = await cloudinary.api.resources({
            resource_type: 'raw',
            type: 'upload',
            prefix: 'project_records/',
            max_results: 500,
            context: true
        });

        const projects = [];

        for (const file of result.resources) {
            try {
                const rawRes = await fetch(file.secure_url);
                const rawText = await rawRes.text();

                const proj = {
                    trackingId: file.public_id.replace('project_records/proj_', '').replace('.txt', ''),
                    customerName: 'Client',
                    projectName: 'Project',
                    category: 'Development',
                    status: 'In Progress',
                    progress: 0,
                    lastUpdated: new Date(file.created_at).toLocaleDateString(),
                    currentUpdate: '',
                    nextStep: '',
                    projectDescription: '',
                    startDate: '',
                    expectedCompletion: '',
                    adminNotes: ''
                };

                const lines = rawText.split('\n');
                let sec = null;
                const buffers = { desc: [], update: [], next: [], notes: [] };

                for (let l of lines) {
                    const trimmed = l.trim();
                    if (/^={3,}|^--{3,}/.test(trimmed)) continue;
                    if (trimmed === 'PROJECT DESCRIPTION:') { sec = 'desc'; continue; }
                    if (trimmed === 'CURRENT UPDATE:') { sec = 'update'; continue; }
                    if (trimmed === 'NEXT STEP:') { sec = 'next'; continue; }
                    if (trimmed === 'ADMIN NOTES:') { sec = 'notes'; continue; }

                    if (sec) {
                        buffers[sec].push(l);
                        continue;
                    }

                    const cIdx = l.indexOf(':');
                    if (cIdx > 0) {
                        const k = l.substring(0, cIdx).trim().toUpperCase();
                        const v = l.substring(cIdx + 1).trim();
                        if (k === 'CUSTOMER NAME') proj.customerName = v;
                        else if (k === 'PROJECT NAME') proj.projectName = v;
                        else if (k === 'CATEGORY') proj.category = v;
                        else if (k === 'STATUS') proj.status = v;
                        else if (k === 'PROGRESS') proj.progress = parseInt(v, 10) || 0;
                        else if (k === 'START DATE') proj.startDate = v;
                        else if (k === 'TARGET COMPLETION') proj.expectedCompletion = v;
                    }
                }

                proj.projectDescription = buffers.desc.join('\n').trim();
                proj.currentUpdate = buffers.update.join('\n').trim();
                proj.nextStep = buffers.next.join('\n').trim();
                proj.adminNotes = buffers.notes.join('\n').trim();

                projects.push(proj);
            } catch (inner) {
                console.warn('Skipping record:', file.public_id);
            }
        }

        return res.status(200).json({
            success: true,
            count: projects.length,
            projects: projects
        });

    } catch (err) {
        console.error('List Projects Error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});