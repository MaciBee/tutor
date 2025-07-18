require('dotenv').config({ path: '../.env' });
//require('dotenv').config(); // Load environment variables
console.log('DB User:', process.env.TUTOR_DB_USER);
const cors = require('cors');
const bcrypt = require('bcrypt'); //hash
const express = require('express');
const mysql = require('mysql2');
const jwt = require('jsonwebtoken'); //stay logged in 
const JWT_SECRET = 'test-stuff'; // In production, use environment variable

const app = express();

app.use(cors()); // Add this line near the top of your server.js
//post test middleware
app.use(express.json());
// Database connection using your .env variables
const db = mysql.createConnection({
  host: process.env.TUTOR_DB_HOST,
  user: process.env.TUTOR_DB_USER,
  password: process.env.TUTOR_DB_PASS,
  database: process.env.TUTOR_DB_NAME,
  port: process.env.TUTOR_DB_PORT
});

// Test database connection
db.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err);
  } else {
    console.log('Connected to MySQL database!');
  }
});
// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user; // Make user info available to the route
    next(); // Continue to the actual route
  });
}


// Your existing routes
app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from API!' });
});

// New route that gets real data from database
app.get('/users', (req, res) => {
  db.query('SELECT * FROM users', (err, results) => {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: 'Database error'});
    } else {
      res.json(results);
    }
  });
});

//show only tutors 
// w/ rate and stuff
// Public endpoint - anyone can view tutors (no auth required)
app.get('/tutors', (req, res) => {
  const subject = req.query.subject;
  const priceFilter = req.query.price;

 let query = `
    SELECT
      tp.id as profile_id,
      tp.bio,
      tp.hourly_rate,
      tp.phone,
      tp.created_at,
      u.email,
      u.id as user_id
    FROM tutor_profiles tp
    JOIN users u ON tp.user_id = u.id
    WHERE tp.is_active = 1
  `;
  
  let params = [];
 // Subject filter  7.12
  if (subject) {
    query += ` AND LOWER(tp.bio) LIKE LOWER(?)`;
    params.push(`%${subject}%`);
  }

  // Price filter 7.13
  if (priceFilter) {
    if (priceFilter === 'under20') {
      query += ` AND tp.hourly_rate < ?`;
      params.push(20);
    } else if (priceFilter === '20to30') {
      query += ` AND tp.hourly_rate BETWEEN ? AND ?`;
      params.push(20, 30);
    } else if (priceFilter === '30to50') {
      query += ` AND tp.hourly_rate BETWEEN ? AND ?`;
      params.push(30, 50);
    } else if (priceFilter === 'over50') {
      query += ` AND tp.hourly_rate > ?`;
      params.push(50);
    }
  }
  query += ` ORDER BY tp.created_at DESC`;
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({
      success: true,
      tutors: results,
      count: results.length
    });
  });
});

/*app.get('/tutors', (req, res) => {
  db.query('SELECT email, role, created_at FROM users WHERE role ="tutor"', (err, results) =>{
    if(err){
      res.status(500).json({error:'Database error'});
    }
      else { 
      res.json(results);
    }
  });
});*/

//url parameteres
app.get('/tutors/:subject', (req, res)=>{
   const subject = req.params.subject;

   db.query('SELECT * FROM tutors_subjects WHERE subject = ?', [subject], (err, results)=>{
     if (err) {
      res.status(500).json({error: 'Database error'});
     }else{
	res.json(results); 
   }
  });
}); 
// Protected route - requires valid token
app.get('/profile', authenticateToken, (req, res) => {
  // req.user contains the decoded token info (userId, email, role)
  res.json({
    message: 'This is your protected profile!',
    user: req.user
  });
});

// view resources 7.13
// Get all study resources (public - no auth needed)
app.get('/study-resources', (req, res) => {
  const subject = req.query.subject;
  const level = req.query.level;
  const type = req.query.type;
  
  let query = `
    SELECT 
      sr.id,
      sr.title,
      sr.url,
      sr.subject,
      sr.level,
      sr.type,
      sr.description,
      sr.created_at,
      u.email as added_by_email
    FROM study_resources sr
    LEFT JOIN users u ON sr.added_by = u.id
  `;
  
  let params = [];
  let conditions = [];
  
  // Add filters if provided
  if (subject) {
    conditions.push('sr.subject = ?');
    params.push(subject);
  }
  
  if (level) {
    conditions.push('sr.level = ?');
    params.push(level);
  }
  
  if (type) {
    conditions.push('sr.type = ?');
    params.push(type);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' ORDER BY sr.created_at DESC';
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({
      success: true,
      resources: results,
      count: results.length
    });
  });
});

// Get music resources (public) 7.15
app.get('/music-resources', (req, res) => {
  db.query(
    'SELECT * FROM music_resources ORDER BY created_at DESC',
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json({
        success: true,
        resources: results,
        count: results.length
      });
    }
  );
});

//post w/ hash
app.post('/users', async (req, res) => {
  const { email, password, role } = req.body;
  
  // Simple validation
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password, and role are required' });
  }
  
  try {
    // Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.query('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', 
      [email, hashedPassword, role], (err, results) => {
      if (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: 'Failed to create user' });
      } else {
        res.json({ 
          success: true, 
          userId: results.insertId,
          message: 'User created securely'
        });
      }
    });
    
  } catch (error) {
    console.error('Hashing error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
//login auth
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Validation
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  try {
    // Step 1: Find user by email
    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      // Step 2: Check if user exists
      if (results.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      const user = results[0];
      
      // Step 3: Compare password with hash
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      
  
  if (passwordMatch) {
    // Create a session token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      message: 'Login successful',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
 } else {
        // Wrong password
        res.status(401).json({ error: 'Invalid email or password' });
      }
    });


    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

//tutor profile creation 
// Protected route - only logged-in users can create profiles
app.post('/tutor-profile', authenticateToken, async (req, res) => {
  const { bio, hourly_rate, phone } = req.body;
  const user_id = req.user.userId; // From the JWT token
  
  // Validation
  if (!bio || !hourly_rate) {
    return res.status(400).json({ error: 'Bio and hourly rate are required' });
  }
  // CHECK ROLE - Only tutors can create profiles
  if (req.user.role !== 'tutor') {
    return res.status(403).json({ error: 'Only tutors can create profiles' });
  }
  
  try {
    // Check if user already has a profile
    db.query('SELECT id FROM tutor_profiles WHERE user_id = ?', [user_id], (err, existing) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Profile already exists' });
      }
      
      // Create new profile
      db.query(
        'INSERT INTO tutor_profiles (user_id, bio, hourly_rate, phone) VALUES (?, ?, ?, ?)',
        [user_id, bio, hourly_rate, phone],
        (err, results) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to create profile' });
          }
          
          res.json({
            success: true,
            message: 'Tutor profile created successfully',
            profileId: results.insertId
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

//udpate tutor profile 
/*app.put('/tutor-profile', authenticateToken, async(req,res)=>{
  const{ bio, hourly_rate, phone} = req.body;
  const user_id = req.user.userId;

	db.query('SELECT id FROM tutor_profiles WHERE user_id = ?', [user_id], (err, existing) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

	if (existing.length ===0) { 
		   return res.status(400).json({error: 'No profile found'});
	}

	db.query(
	        'UPDATE tutor_profiles SET bio = ?, hourly_rate =?, phone = ? WHERE user_id = ?',
		 [bio, hourly_rate, phone, user_id],
	   	 (err, results) => {
                   if (err) {
            	 	console.error('Database error:', err);
            		return res.status(500).json({ error: 'Failed to create update profile'});
          		}
          
          res.json({
            success: true,
            message: 'Tutor profile updated successfully'
 	    });
         }
       );
    });
});
*/
// get current user profile
app.get('/my-tutor-profile', authenticateToken, (req,res)=> {
   const user_id = req.user.userId;

   db.query(
	'SELECT bio, hourly_rate, phone FROM tutor_profiles WHERE user_id = ?',
	[user_id], 
	(err, results) => {
	  if (err){
	    return res.status(500).json({error: 'database error' });
	}
	if (results.length ===0){
	   return res.status(404).json({error: 'no profile found'});
	}

	res.json({
   	  success:true,
	  profile: results[0]
    	});
      }
    );
});
//.put for editing tutor profile. 7.18
app.put('/tutor-profile', authenticateToken, async (req, res) => {
  const { bio, hourly_rate, phone } = req.body;
  const user_id = req.user.userId;
  
  if (!bio || !hourly_rate) {
    return res.status(400).json({ error: 'Bio and hourly rate are required' });
  }
  
  try {
    db.query(
      'UPDATE tutor_profiles SET bio = ?, hourly_rate = ?, phone = ? WHERE user_id = ?',
      [bio, hourly_rate, phone, user_id],
      (err, results) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to update profile' });
        }
        
        res.json({
          success: true,
          message: 'Tutor profile updated successfully'
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});


// add study resource 7.13
// (protected - only logged-in users)
app.post('/study-resources', authenticateToken, (req, res) => {
  const { title, url, subject, level, type, description } = req.body;
  const added_by = req.user.userId;
  
  // Basic validation
  if (!title || !url || !subject || !level || !type) {
    return res.status(400).json({ error: 'Title, URL, subject, level, and type are required' });
  }
  
  db.query(
    'INSERT INTO study_resources (title, url, subject, level, type, description, added_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [title, url, subject, level, type, description, added_by],
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to add resource' });
      }
      
      res.json({
        success: true,
        message: 'Resource added successfully',
        resourceId: results.insertId
      });
    }
  );
});

//music finder 7.15
// Add music resource
app.post('/music-resources', authenticateToken, (req, res) => {
  const { title, url, music_type, genre, duration, description } = req.body;
  const added_by = req.user.userId;
  
  if (!title || !url || !music_type) {
    return res.status(400).json({ error: 'Title, URL, and music type are required' });
  }
  
  db.query(
    'INSERT INTO music_resources (title, url, music_type, genre, duration, description, added_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [title, url, music_type, genre, duration, description, added_by],
    (err, results) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to add music resource' });
      }
      
      res.json({
        success: true,
        message: 'Music resource added successfully',
        resourceId: results.insertId
      });
    }
  );
});



app.listen(3003, () => {
  console.log('Server running on port 3003');
  console.log('Try: http://localhost:3003/api/users');
});
