const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// --- MIDDLEWARE ---
app.use(cors()); 
app.use(express.json());

// Hardcoded Supabase Credentials
const SUPABASE_URL = 'https://bshwxezcykimreovpaal.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IR8-A2h11THiDVxAqwlA-Q_vJuuIy2h';

// Initialize Supabase Client for the Server
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false } // Required for server environments
});

// --- AUTHENTICATION MIDDLEWARE (PRODUCTION STANDARD) ---
// This verifies the user's JWT token sent from the frontend.
// It ensures that only the actual logged-in user can make posts or comments.
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
        return res.status(401).json({ error: "Unauthorized: Token expired or invalid" });
    }

    req.user = user; // Attach the securely verified user to the request
    next();
};


// ==========================================
// 1. PUBLIC AUTH ROUTES
// ==========================================

// SIGNUP
app.post('/auth/signup', async (req, res) => {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
        return res.status(400).json({ error: "Email, password, and username are required." });
    }

    try {
        // 1. Create Auth User
        const { data: authData, error: authError } = await supabase.auth.signUp({ 
            email, 
            password 
        });

        if (authError) throw authError;

        // 2. Insert into 'users' table
        if (authData.user) {
            const { error: dbError } = await supabase.from('users').insert([
                { 
                    id: authData.user.id, 
                    username: username, 
                    email: email,
                    avatar_url: null // Can be updated later via a profile edit route
                }
            ]);
            
            // If username is taken, it will throw a unique constraint error here
            if (dbError) throw dbError;
        }

        res.status(200).json({ message: "Signup successful", user: authData.user, session: authData.session });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// LOGIN
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Fetch user profile to get the username
        const { data: profile } = await supabase.from('users').select('username, avatar_url').eq('id', data.user.id).single();

        res.status(200).json({ 
            message: "Login successful", 
            user: { ...data.user, profile },
            session: data.session
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});


// ==========================================
// 2. PROTECTED API ROUTES (Requires Token)
// ==========================================

// CREATE POST
app.post('/api/posts', authenticateUser, async (req, res) => {
    const { video_url, caption } = req.body;

    if (!video_url) {
        return res.status(400).json({ error: "video_url is required." });
    }

    try {
        const { data, error } = await supabase.from('posts').insert([
            {
                user_id: req.user.id, // Securely pulled from the verified token
                video_url: video_url,
                caption: caption || "",
                likes_count: 0
            }
        ]).select().single();

        if (error) throw error;
        res.status(201).json({ message: "Post created", post: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET FEED (Fetch all posts with user data, comments, and comment users)
app.get('/api/posts', authenticateUser, async (req, res) => {
    try {
        const { data: posts, error } = await supabase
            .from('posts')
            .select(`
                id, video_url, caption, created_at, likes_count,
                users ( id, username, avatar_url ),
                comments ( id, comment, created_at, users ( username, avatar_url ) )
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Also fetch the posts that the current user has liked so the frontend knows which heart icon to color red
        const { data: userLikes } = await supabase
            .from('likes')
            .select('post_id')
            .eq('user_id', req.user.id);

        const likedPostIds = userLikes ? userLikes.map(like => like.post_id) : [];

        res.status(200).json({ posts, likedPostIds });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ADD COMMENT
app.post('/api/posts/:postId/comments', authenticateUser, async (req, res) => {
    const { postId } = req.params;
    const { comment } = req.body;

    if (!comment) return res.status(400).json({ error: "Comment text is required." });

    try {
        const { data, error } = await supabase.from('comments').insert([
            {
                post_id: postId,
                user_id: req.user.id,
                comment: comment
            }
        ]).select().single();

        if (error) throw error;
        res.status(201).json({ message: "Comment added", comment: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// TOGGLE LIKE
app.post('/api/posts/:postId/like', authenticateUser, async (req, res) => {
    const { postId } = req.params;
    const userId = req.user.id;

    try {
        // 1. Check if like already exists
        const { data: existingLike } = await supabase
            .from('likes')
            .select('id')
            .eq('post_id', postId)
            .eq('user_id', userId)
            .single();

        if (existingLike) {
            // UNLIKE: Remove from likes table
            await supabase.from('likes').delete().eq('id', existingLike.id);
            
            // Decrement posts likes_count (For production, an SQL RPC function is safer, but this works for testing)
            const { data: post } = await supabase.from('posts').select('likes_count').eq('id', postId).single();
            await supabase.from('posts').update({ likes_count: Math.max(0, post.likes_count - 1) }).eq('id', postId);

            return res.status(200).json({ message: "Post unliked", liked: false });
        } else {
            // LIKE: Insert into likes table
            const { error: likeError } = await supabase.from('likes').insert([{ post_id: postId, user_id: userId }]);
            if (likeError) throw likeError;

            // Increment posts likes_count
            const { data: post } = await supabase.from('posts').select('likes_count').eq('id', postId).single();
            await supabase.from('posts').update({ likes_count: post.likes_count + 1 }).eq('id', postId);

            return res.status(200).json({ message: "Post liked", liked: true });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- SERVER START ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});