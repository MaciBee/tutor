require('dotenv').config({ path: '../.env' });
//require('dotenv').config(); // Load environment variables
console.log('DB User:', process.env.TUTOR_DB_USER);
const cors = require('cors');
const bcrypt = require('bcrypt'); //hash
const express = require('express');
const mysql = require('mysql2');
const helmet = require('helmet');
const sanitizeHtml = require('sanitize-html');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken'); //stay logged in 
//const JWT_SECRET = 'test-stuff'; // In production, use environment variable
//const nodemailer = require('nodemailer');7.28
const fs = require('fs'); //logging 7.28
const path = require('path'); //7.28

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('JWT_SECRET environment variable is required');
    process.exit(1);
}

const app = express();
app.use(helmet());

// Create logs directory if it doesn't exist 7.28
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

app.use(cors()); // Add this line near the top of your server.js
//post test middleware
app.use(express.json());

app.set('trust proxy', true);

// Database connection using your .env variables
const db = mysql.createPool({
    host: process.env.TUTOR_DB_HOST,
    user: process.env.TUTOR_DB_USER,
    password: process.env.TUTOR_DB_PASS,
    database: process.env.TUTOR_DB_NAME,
    port: process.env.TUTOR_DB_PORT,
    connectionLimit: 10,
    reconnect: true
});
// Test database pool
db.getConnection((err, connection) => {
    if (err) {
        console.error('Database pool connection failed:', err);
    } else {
        console.log('Connected to MySQL database pool!');
        connection.release(); // Important: release the test connection
    }
});

// Test database connection
//db.connect((err) => {
//  if (err) {
//    console.error('Database connection failed:', err);
//  } else {
//    console.log('Connected to MySQL database!');
//  }
//});

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

/*
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
*/
//show only tutors 
// w/ rate and stuff
// Public endpoint - anyone can view tutors (no auth required)
app.get('/tutors', (req, res) => {
  const subject = req.query.subject;
  const priceFilter = req.query.price;

// Enhanced query that includes availability 7.24
let query = `
    SELECT 
        tp.id as profile_id,
        tp.bio,
        tp.hourly_rate,
        tp.phone,
        tp.created_at,
        u.email,
        u.id as user_id,
        GROUP_CONCAT(DISTINCT s.name SEPARATOR ", ") as subjects_taught,
        GROUP_CONCAT(DISTINCT 
            CASE 
                WHEN ta.day_of_week IS NOT NULL 
                THEN CONCAT(
                    UPPER(SUBSTRING(ta.day_of_week, 1, 1)), 
                    LOWER(SUBSTRING(ta.day_of_week, 2)), 
                    ' ', 
                    TIME_FORMAT(ta.start_time, '%l:%i%p'), 
                    '-', 
                    TIME_FORMAT(ta.end_time, '%l:%i%p')
                )
                ELSE NULL 
            END 
            SEPARATOR " | "
        ) as availability_text
    FROM tutor_profiles tp
    JOIN users u ON tp.user_id = u.id
    LEFT JOIN tutor_subjects ts ON tp.id = ts.tutor_id
    LEFT JOIN subjects s ON ts.subject_id = s.id
    LEFT JOIN tutor_availability ta ON tp.id = ta.tutor_id AND ta.is_available = 1
    WHERE tp.is_active = 1
`;

  
  let params = [];
 // Subject filter  7.12
/*  if (subject) {
    query += ` AND LOWER(tp.bio) LIKE LOWER(?)`;
    params.push(`%${subject}%`);
  }
*/
//replaced sub filter7.22
// IMPROVED Subject filter - searches both structured subjects AND bio
if (subject) {
    // First try to find tutors who selected this subject in the database
    query += ` AND (
        tp.id IN (
            SELECT DISTINCT ts.tutor_id 
            FROM tutor_subjects ts 
            JOIN subjects s ON ts.subject_id = s.id 
            WHERE LOWER(s.name) LIKE LOWER(?)
        )
        OR LOWER(tp.bio) LIKE LOWER(?)
    )`;
    params.push(`%${subject}%`, `%${subject}%`);
    // This searches BOTH:
    // 1. Tutors who selected the subject in checkboxes
    // 2. Tutors who mentioned it in their bio (fallback for old profiles)
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
 // query += ` ORDER BY tp.created_at DESC`;
 // replaced query+= from above w/ new one 7.23
    query += ` 
        GROUP BY tp.id, u.id
        ORDER BY tp.created_at DESC
    `;
  
  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    //Sanitize user-generated fields before sending 7.18  
  const sanitizedTutors = results.map(tutor => ({
      ...tutor,
      bio: tutor.bio ? sanitizeHtml(tutor.bio) : ''
    }));
 
   res.json({
      success: true,
      tutors: sanitizedTutors,  // ←7.31 changed to use sanitize results
      count: sanitizedTutors.length
//      tutors: results,
//      count: results.length
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
//enhanced 7.21 
app.get('/tutors/:subject', (req, res)=>{
   const subject = req.params.subject;
    
    const query = `
        SELECT tp.*, ts.experience_level, s.name as subject_name, u.email
        FROM tutor_profiles tp
        JOIN tutor_subjects ts ON tp.id = ts.tutor_id  
        JOIN subjects s ON ts.subject_id = s.id
        JOIN users u ON tp.user_id = u.id
        WHERE s.name = ? OR s.id = ?
        AND tp.is_active = 1
    `;
    
    db.query(query, [subject, subject], (err, results) => {
        if (err) {
            res.status(500).json({error: 'Database error'});
        } else {
            res.json({
                success: true,
                tutors: results
            }); 
        }
    });
});
//also edited app.pst(/tutor/profile) to match 

/*7.21 edit to make suj selection work- this was old code -no subj selection-
   db.query('SELECT * FROM tutors_subjects WHERE subject = ?', [subject], (err, results)=>{
     if (err) {
      res.status(500).json({error: 'Database error'});
     }else{
	res.json(results); 
   }
  });
});

*/ 
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
//    
    const sanitizedResources = results.map(resource => ({
      ...resource,
      title: resource.title ? sanitizeHtml(resource.title) : '',
      description: resource.description ? sanitizeHtml(resource.description) : ''
    }));

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
//
    const sanitizedMusic = results.map(resource => ({
      ...resource,
      title: resource.title ? sanitizeHtml(resource.title) : '',
      description: resource.description ? sanitizeHtml(resource.description) : '',
      genre: resource.genre ? sanitizeHtml(resource.genre) : '',
      music_type: resource.music_type ? sanitizeHtml(resource.music_type) : ''

    }));      
      res.json({
        success: true,
        resources: results,
        count: results.length
      });
    }
  );
});
// Limit each IP to 10 registration requests per hour 7/17
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Too many accounts created from this IP, please try again later.' }
});
/*
//post w/ hash
app.post('/users', registerLimiter, async (req, res) => {
//app.post('/users', async (req, res) => {
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
*/
//7.31 improved post user password lenght and other stuff 
app.post('/users', registerLimiter, async (req, res) => {
  const { email, password, role } = req.body;
  
  // Enhanced validation
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password, and role are required' });
  }
  
  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  
  // Role validation
  const validRoles = ['student', 'tutor'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Role must be student or tutor' });
  }
  
  // Password strength
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  
  try {
    // Check for existing email
    db.query('SELECT id FROM users WHERE email = ?', [email], async (err, existingUsers) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      if (existingUsers.length > 0) {
        return res.status(400).json({ error: 'Email already registered' });
      }
      
      // Hash password and create user
      const hashedPassword = await bcrypt.hash(password, 10);
      
      db.query('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', 
        [email, hashedPassword, role], (err, results) => {
        if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Failed to create user' });
        } else {
          res.json({ 
            success: true, 
            message: 'User created successfully! Please log in.'
          });
        }
      });
    });
    
  } catch (error) {
    console.error('Hashing error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});


// Limit each IP to 5 login requests per 15 minutes 7.17
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' }
});

//login auth
//app.post('/auth/login', async (req, res) => {
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
//7.21 changed profile to inclde sub selection 
app.post('/tutor-profile', authenticateToken, async (req, res) => {
    const { bio, hourly_rate, phone, subjects } = req.body; // subjects is defined here
    const user_id = req.user.userId;

    // Validation
    if (!bio || !hourly_rate) {
        return res.status(400).json({ error: 'Bio and hourly rate are required' });
    }

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

                    const profileId = results.insertId;
                    
                    // Save subjects if provided - subjects is accessible here
                    if (subjects && subjects.length > 0) {
                        const subjectInserts = subjects.map(subjectId => 
                            [profileId, subjectId, 'intermediate']
                        );
                        
                        db.query(
                            'INSERT INTO tutor_subjects (tutor_id, subject_id, experience_level) VALUES ?',
                            [subjectInserts],
                            (err) => {
                                if (err) {
                                    console.error('Subject insert error:', err);
                                }
                                // Send response after subjects are saved
                                res.json({
                                    success: true,
                                    message: 'Tutor profile created successfully',
                                    profileId: profileId
                                });
                            }
                        );
                    } else {
                        // No subjects selected, just send response
                        res.json({
                            success: true,
                            message: 'Tutor profile created successfully',
                            profileId: profileId
                        });
                    }
                }
            );
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

/*commented  7.21
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
          
//new 7.21
                const profileId = results.insertId;
                // NEW: Save subjects if provided
                if (subjects && subjects.length > 0) {
                    const subjectInserts = subjects.map(subjectId => 
                        [profileId, subjectId, 'intermediate'] // default experience level
                    );
                    
                    db.query(
                        'INSERT INTO tutor_subjects (tutor_id, subject_id, experience_level) VALUES ?',
                        [subjectInserts],
                        (err) => {
                            if (err) console.error('Subject insert error:', err);
                        }
                    );
                }
//end new here
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

7.21 end comment */ 



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
//santize
   const profile = results[0];
   const sanitizedProfile = {
       ...profile,
       bio: profile.bio ? sanitizeHtml(profile.bio) : ''
  };

	res.json({
   	  success:true,
//	  profile: results[0]
          profile: sanitizedProfile  // ← Fixed: 8.1.25
  
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
// add availabiliy 7.24
// NEW: Get tutor's availability schedule
app.get('/my-availability', authenticateToken, (req, res) => {
    const user_id = req.user.userId;
    
    // First, get the tutor's profile ID from their user ID
    db.query('SELECT id FROM tutor_profiles WHERE user_id = ?', [user_id], (err, profileResults) => {
        if (err) {
            console.error('Database error finding tutor profile:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (profileResults.length === 0) {
            return res.status(404).json({ error: 'Tutor profile not found' });
        }
        
        const tutorId = profileResults[0].id;
        
        // Now get their availability
        db.query(
            'SELECT * FROM tutor_availability WHERE tutor_id = ? AND is_available = 1 ORDER BY day_of_week, start_time',
            [tutorId],
            (err, availabilityResults) => {
                if (err) {
                    console.error('Database error loading availability:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                res.json({
                    success: true,
                    availability: availabilityResults,
                    count: availabilityResults.length
                });
            }
        );
    });
});
//7.27 
//Get specific tutor's availability for booking
app.get('/availability/:tutorId', (req, res) => {
    const tutorId = req.params.tutorId;
    
    db.query(
        'SELECT * FROM tutor_availability WHERE tutor_id = ? AND is_available = 1 ORDER BY day_of_week, start_time',
        [tutorId],
        (err, results) => {
            if (err) {
                console.error('Database error loading tutor availability:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.json({
                success: true,
                availability: results,
                count: results.length
            });
        }
    );
});


//7.24
// NEW: Add tutor availability (no /tutor-api prefix since that gets stripped)
app.post('/availability', authenticateToken, (req, res) => {
    const { day_of_week, start_time, end_time } = req.body;
    const user_id = req.user.userId;
    
    // Validation
    if (!day_of_week || !start_time || !end_time) {
        return res.status(400).json({ error: 'Day, start time, and end time are required' });
    }
    
    // Check if user is a tutor
    if (req.user.role !== 'tutor') {
        return res.status(403).json({ error: 'Only tutors can set availability' });
    }
    
    try {
        // First, get the tutor's profile ID
        db.query('SELECT id FROM tutor_profiles WHERE user_id = ?', [user_id], (err, profileResults) => {
            if (err) {
                console.error('Database error finding tutor profile:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (profileResults.length === 0) {
                return res.status(400).json({ error: 'You must create a tutor profile first' });
            }
            
            const tutorId = profileResults[0].id;
            
            // Insert the availability
            db.query(
                'INSERT INTO tutor_availability (tutor_id, day_of_week, start_time, end_time, is_available) VALUES (?, ?, ?, ?, 1)',
                [tutorId, day_of_week, start_time, end_time],
                (err, results) => {
                    if (err) {
                        console.error('Database error adding availability:', err);
                        // Check if it's a duplicate time slot error
                        if (err.code === 'ER_DUP_ENTRY') {
                            return res.status(400).json({ error: 'You already have availability set for this time slot' });
                        }
                        return res.status(500).json({ error: 'Failed to add availability' });
                    }
                    
                    res.json({
                        success: true,
                        message: 'Availability added successfully',
                        availabilityId: results.insertId
                    });
                }
            );
        });
        
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});
//
// NEW: Delete tutor availability
app.delete('/availability/:id', authenticateToken, (req, res) => {
    const availabilityId = req.params.id;
    const user_id = req.user.userId;
    
    try {
        // First verify this availability belongs to the logged-in tutor
        db.query(
            `SELECT ta.id FROM tutor_availability ta 
             JOIN tutor_profiles tp ON ta.tutor_id = tp.id 
             WHERE ta.id = ? AND tp.user_id = ?`,
            [availabilityId, user_id],
            (err, results) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                if (results.length === 0) {
                    return res.status(404).json({ error: 'Availability not found or not yours' });
                }
                
                // Delete the availability
                db.query('DELETE FROM tutor_availability WHERE id = ?', [availabilityId], (err) => {
                    if (err) {
                        console.error('Database error deleting availability:', err);
                        return res.status(500).json({ error: 'Failed to delete availability' });
                    }
                    
                    res.json({
                        success: true,
                        message: 'Availability deleted successfully'
                    });
                });
            }
        );
        
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 7.28 Handle session request submission (SERVER SIDE)
app.post('/session-request', authenticateToken, async (req, res) => {
const { 
    tutor_id, 
    tutor_email,
    day_of_week, 
    start_time, 
    end_time, 
    duration, 
    current_work, 
    current_challenge, 
    learning_goal,
    preferred_time,
    total_amount 
} = req.body;
    
    const student_id = req.user.userId;
    const student_email = req.user.email;
    
    try {
        // Create the email content
        const emailContent = `
Hello!

You have received a tutoring session request through your autodidacting.org profile.
STUDENT DETAILS:
Student: ${student_email}
Available Window: ${day_of_week.charAt(0).toUpperCase() + day_of_week.slice(1)} ${start_time} - ${end_time}
Preferred Time: ${req.body.preferred_time}
Duration: ${duration} hours
Total Rate: $${total_amount}


WHAT THE STUDENT IS WORKING ON:
${current_work}

THEIR CURRENT CHALLENGE:
${current_challenge}

THEIR LEARNING GOAL:
${learning_goal}

---

TO RESPOND:
Reply directly to this email or contact the student at: ${student_email}
        `;

        // TEMPORARY: Log instead of sending email
        console.log('\n=== EMAIL THAT WOULD BE SENT ===');
        console.log('To:', tutor_email);
        console.log('From:', student_email);
        console.log('Subject: Tutoring Session Request -', day_of_week, start_time);
        console.log('\nContent:');
        console.log(emailContent);
        console.log('=== END EMAIL ===\n');
// NEW: Also save to log file 7.28
const timestamp = new Date().toISOString();
const logEntry = `
=== BOOKING REQUEST ${timestamp} ===
Student: ${student_email}
Tutor: ${tutor_email}
Requested: ${day_of_week.charAt(0).toUpperCase() + day_of_week.slice(1)} ${start_time}-${end_time}
Preferred: ${preferred_time}
Duration: ${duration} hours ($${total_amount})

Working on: ${current_work}
Challenge: ${current_challenge}
Goal: ${learning_goal}

STATUS: PENDING (needs manual email)
=== END REQUEST ===

`;

const logFile = path.join(__dirname, 'logs', 'booking_requests.log');
fs.appendFileSync(logFile, logEntry);
console.log('📝 Request logged to file:', logFile);

        
        res.json({
            success: true,
            message: 'Session request logged successfully'
        });
        
    } catch (error) {
        console.error('Error processing session request:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process session request'
        });
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
