import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { initializeApp } from 'firebase/app';
import { 
    getFirestore, collection, getDocs, addDoc, query, where, 
    updateDoc, doc, deleteDoc, arrayUnion, arrayRemove, getDoc 
} from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

// 1. Firebase Configuration (Provided by you)
const firebaseConfig = {
  apiKey: "AIzaSyAd_4CQApsoDRTrYvAUW-lZeb0WLmbHeMU",
  authDomain: "dfyuf-8f796.firebaseapp.com",
  projectId: "dfyuf-8f796",
  storageBucket: "dfyuf-8f796.firebasestorage.app",
  messagingSenderId: "399032471916",
  appId: "1:399032471916:web:ef7ebe359217133fa96349",
  measurementId: "G-75Z2FCXJ6N"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);

// 2. Initialize Express & Middleware
const app = express();
app.use(cors());
app.use(express.json());

// Set up Multer for handling file uploads in memory before sending to Firebase
const upload = multer({ storage: multer.memoryStorage() });

// ==========================================
// USER AUTHENTICATION APIs
// ==========================================

// SIGN UP
app.post('/api/signup', async (req, res) => {
    try {
        let { username, email, password, avatar } = req.body;
        if (!username.startsWith('@')) username = '@' + username;

        const usersRef = collection(db, 'users');
        
        // Check if username exists
        const q = query(usersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Add new user
        const newUser = { username, email, password, avatar };
        await addDoc(usersRef, newUser);

        res.status(201).json({ message: 'User created successfully', user: newUser });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// LOG IN
app.post('/api/login', async (req, res) => {
    try {
        let { username, password } = req.body;
        if (!username.startsWith('@') && !username.includes('@')) username = '@' + username;

        const usersRef = collection(db, 'users');
        // Check username match
        const q1 = query(usersRef, where('username', '==', username), where('password', '==', password));
        const snap1 = await getDocs(q1);

        // Check email match (if they entered an email instead of @username)
        const q2 = query(usersRef, where('email', '==', username), where('password', '==', password));
        const snap2 = await getDocs(q2);

        if (snap1.empty && snap2.empty) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const userData = snap1.empty ? snap2.docs[0].data() : snap1.docs[0].data();
        res.status(200).json({ message: 'Login successful', user: userData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ==========================================
// POSTS & MEDIA APIs
// ==========================================

// GET ALL POSTS
app.get('/api/posts', async (req, res) => {
    try {
        const postsRef = collection(db, 'posts');
        const snapshot = await getDocs(postsRef);
        
        let posts = [];
        snapshot.forEach(doc => {
            posts.push({ id: doc.id, ...doc.data() });
        });

        // Sort descending by timestamp
        posts.sort((a, b) => b.timestamp - a.timestamp);
        res.status(200).json(posts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// CREATE NEW POST (Handles Files + Data)
app.post('/api/posts', upload.fields([{ name: 'media', maxCount: 5 }, { name: 'thumbnail', maxCount: 1 }]), async (req, res) => {
    try {
        const { user, desc, type, profile } = req.body;
        const files = req.files['media'];
        const thumbFile = req.files['thumbnail'] ? req.files['thumbnail'][0] : null;

        if (!files || files.length === 0) return res.status(400).json({ error: 'No media files provided' });

        let mediaUrls = [];
        let thumbnailUrl = '';

        // 1. Upload Media Files
        for (let file of files) {
            const fileRef = ref(storage, `posts/${Date.now()}_${file.originalname}`);
            const snapshot = await uploadBytes(fileRef, file.buffer, { contentType: file.mimetype });
            const downloadUrl = await getDownloadURL(snapshot.ref);
            mediaUrls.push(downloadUrl);
        }

        // 2. Upload Thumbnail (if it's a video, frontend sends the generated thumbnail blob)
        if (thumbFile) {
            const thumbRef = ref(storage, `thumbnails/${Date.now()}_thumb.jpg`);
            const snapshot = await uploadBytes(thumbRef, thumbFile.buffer, { contentType: thumbFile.mimetype });
            thumbnailUrl = await getDownloadURL(snapshot.ref);
        } else {
            thumbnailUrl = mediaUrls[0]; // Fallback to first image if it's an image post
        }

        // 3. Save to Firestore
        const newPost = {
            type,
            date: new Date().toISOString().split('T')[0],
            timestamp: Date.now(),
            user,
            desc,
            likes: [],
            comments: [],
            shares: 0,
            src: type === 'video' ? mediaUrls[0] : mediaUrls,
            thumb: thumbnailUrl,
            profile
        };

        const docRef = await addDoc(collection(db, 'posts'), newPost);
        res.status(201).json({ message: 'Post created', post: { id: docRef.id, ...newPost } });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to upload post' });
    }
});

// DELETE POST
app.delete('/api/posts/:id', async (req, res) => {
    try {
        const postId = req.params.id;
        const postRef = doc(db, 'posts', postId);
        const postSnap = await getDoc(postRef);

        if (!postSnap.exists()) return res.status(404).json({ error: 'Post not found' });

        // NOTE: In a complete production app, you would also extract the Storage URLs 
        // from the post data and call deleteObject() on them here to clean up your Firebase Storage.
        
        await deleteDoc(postRef);
        res.status(200).json({ message: 'Post deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ==========================================
// INTERACTIONS APIs
// ==========================================

// TOGGLE LIKE
app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const postId = req.params.id;
        const { username } = req.body;
        const postRef = doc(db, 'posts', postId);
        
        const postSnap = await getDoc(postRef);
        if (!postSnap.exists()) return res.status(404).json({ error: 'Post not found' });

        const postData = postSnap.data();
        const hasLiked = postData.likes.includes(username);

        if (hasLiked) {
            await updateDoc(postRef, { likes: arrayRemove(username) });
            res.status(200).json({ message: 'Unliked', liked: false });
        } else {
            await updateDoc(postRef, { likes: arrayUnion(username) });
            res.status(200).json({ message: 'Liked', liked: true });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ADD COMMENT
app.post('/api/posts/:id/comment', async (req, res) => {
    try {
        const postId = req.params.id;
        const { user, text, pic } = req.body;

        const postRef = doc(db, 'posts', postId);
        const newComment = { user, text, pic, timestamp: Date.now() };

        await updateDoc(postRef, {
            comments: arrayUnion(newComment)
        });

        res.status(200).json({ message: 'Comment added', comment: newComment });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// SEARCH & USERS APIs
// ==========================================

// GET ALL REGISTERED USERS (For Search View)
app.get('/api/users', async (req, res) => {
    try {
        const usersRef = collection(db, 'users');
        const snapshot = await getDocs(usersRef);
        
        let users = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            delete data.password; // Do not send passwords to the client!
            users.push({ id: doc.id, ...data });
        });
        
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// START SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});