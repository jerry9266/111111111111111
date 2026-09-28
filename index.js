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
   PROJECT TRACKING API (TXT-BACKED CLOUDINARY STORAGE)
   ========================================================================== */

/**
 * 1. POST /api/project/save (Admin Endpoint)
 * Creates or updates a project record by formatting it as a TXT file and uploading
 * to Cloudinary folder "project_records" with the unique Tracking ID tag.
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

        // Internal TXT representation of the project record
        const fileContent = `=====================================================
NAPONTECH - CLIENT PROJECT TRACKING RECORD
=====================================================
TRACKING ID         : ${cleanTrackingId}
CUSTOMER NAME       : ${customerName.trim()}
PROJECT NAME        : ${projectName.trim()}
CATEGORY            : ${category ? category.trim() : 'Web Development'}
STATUS              : ${status ? status.trim() : 'Planning'}
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

        // Upload/overwrite existing project record using public_id and tag
        const uploadResponse = await cloudinary.uploader.upload(uploadURI, {
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
        return res.status(500).json({ success: false, error: 'Failed to save project record: ' + err.message });
    }
});

/**
 * 2. POST /api/project/get (Public Customer Endpoint)
 * Searches Cloudinary by Tracking ID tag/public ID, parses the raw TXT on the server,
 * and returns ONLY clean structured project JSON (no Cloudinary metadata or TXT URLs).
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

        // Direct lookup by public ID
        let resource;
        try {
            resource = await cloudinary.api.resource(`project_records/proj_${cleanId}.txt`, { resource_type: 'raw' });
        } catch (e) {
            // Fallback search via tag if filename differs
            const tagSearch = await cloudinary.api.resources_by_tag(cleanId, { resource_type: 'raw', max_results: 1 });
            if (tagSearch.resources && tagSearch.resources.length > 0) {
                resource = tagSearch.resources[0];
            }
        }

        if (!resource || !resource.secure_url) {
            return res.status(404).json({ success: false, error: 'Project not found. Please check your Tracking ID and try again.' });
        }

        // Fetch raw text securely on server
        const fileRes = await fetch(resource.secure_url);
        const rawText = await fileRes.text();

        // Server-side parsing of TXT content
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
        const sectionBuffers = {
            description: [],
            update: [],
            next: []
        };

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
 * 3. GET /api/projects/list (Admin Endpoint)
 * Retrieves all active project records for the admin dashboard client management screen.
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
                console.warn('Skipping unreadable project file:', file.public_id);
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

/* (Existing Homepage Posts & Form Submission APIs remain intact) */

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});