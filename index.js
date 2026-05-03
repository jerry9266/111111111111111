const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Middleware
app.use(cors()); // Allows your frontend to make requests to this server
app.use(express.json()); // Parses JSON body data

// Hardcoded Supabase Credentials
const SUPABASE_URL = 'https://bshwxezcykimreovpaal.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IR8-A2h11THiDVxAqwlA-Q_vJuuIy2h';

// Initialize Supabase Client
// persistSession: false is CRITICAL on a backend server so users don't share sessions!
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: false
    }
});

// --- ROUTES ---

// 1. Health Check (To verify the server is running on Render)
app.get('/', (req, res) => {
    res.json({ status: 'Server is running perfectly!' });
});

// 2. Sign Up Route
app.post('/signup', async (req, res) => {
    const { email, password, fullName } = req.body;
    
    if (!email || !password || !fullName) {
        return res.status(400).json({ error: "Email, password, and full name are required." });
    }
    
    try {
        // Create user in Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email,
            password
        });
        
        if (error) throw error;
        
        // Insert into custom 'users' table
        if (data.user) {
            const { error: dbError } = await supabase.from('users').insert([
                { id: data.user.id, full_name: fullName, email: email }
            ]);
            
            if (dbError) {
                console.log("DB Insert Warning:", dbError.message);
                // We won't crash the request here, just log it.
            }
        }
        
        res.status(200).json({
            message: "Signup successful",
            user: data.user,
            session: data.session
        });
        
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 3. Login Route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
    }
    
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        res.status(200).json({
            message: "Login successful",
            user: data.user,
            session: data.session
        });
        
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// --- START SERVER ---
// Render will automatically assign a port to process.env.PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});