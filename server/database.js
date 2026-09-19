const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'tabbe.db');

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Initialize tables sequentially using serialize
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Error creating users table:', err);
    } else {
      console.log('✓ users table ready');
    }
  });
  
  // Add name column to users table if it doesn't exist (migration)
  db.run(`ALTER TABLE users ADD COLUMN name TEXT`, (err) => {
    // Ignore error if column already exists
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding name to users:', err);
    }
  });

  // Persons table
  db.run(`CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT,
    full_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) {
      console.error('Error creating persons table:', err);
    } else {
      console.log('✓ persons table ready');
    }
  });

  // Sessions table
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    person_id INTEGER,
    transcript TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) {
      console.error('Error creating sessions table:', err);
    } else {
      console.log('✓ sessions table ready');
    }
  });

  // Person metadata table (for storing extracted information)
  db.run(`CREATE TABLE IF NOT EXISTS person_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) {
      console.error('Error creating person_metadata table:', err);
    } else {
      console.log('✓ person_metadata table ready');
    }
  });

  // Groups table
  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, name)
  )`, (err) => {
    if (err) {
      console.error('Error creating groups table:', err);
    } else {
      console.log('✓ groups table ready');
    }
  });

  // Person groups junction table (many-to-many relationship)
  db.run(`CREATE TABLE IF NOT EXISTS person_groups (
    person_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (person_id, group_id),
    FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) {
      console.error('Error creating person_groups table:', err);
    } else {
      console.log('✓ person_groups table ready');
    }
  });

  // Calendar events table
  db.run(`CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    person_id INTEGER,
    session_id INTEGER,
    event_type TEXT NOT NULL CHECK(event_type IN ('session', 'referenced')),
    event_date DATE NOT NULL,
    summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) {
      console.error('Error creating calendar_events table:', err);
    } else {
      console.log('✓ calendar_events table ready');
    }
  });

  // Add user_id columns to existing tables if they don't exist (migration)
  db.run(`ALTER TABLE persons ADD COLUMN user_id INTEGER`, (err) => {
    // Ignore error if column already exists
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding user_id to persons:', err);
    }
  });
  
  db.run(`ALTER TABLE sessions ADD COLUMN user_id INTEGER`, (err) => {
    // Ignore error if column already exists
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding user_id to sessions:', err);
    }
  });

  // Create indexes for faster lookups
  db.run(`CREATE INDEX IF NOT EXISTS idx_user_username ON users(username)`, (err) => {
    if (err) console.error('Error creating index idx_user_username:', err);
  });
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_person_user ON persons(user_id)`, (err) => {
    if (err) console.error('Error creating index idx_person_user:', err);
  });
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_person_full_name ON persons(full_name)`, (err) => {
    if (err) console.error('Error creating index idx_person_full_name:', err);
  });
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(user_id)`, (err) => {
    if (err) console.error('Error creating index idx_session_user:', err);
  });
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_session_person ON sessions(person_id)`, (err) => {
    if (err) console.error('Error creating index idx_session_person:', err);
  });
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_metadata_person ON person_metadata(person_id)`, (err) => {
    if (err) {
      console.error('Error creating index idx_metadata_person:', err);
    }
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_group_user ON groups(user_id)`, (err) => {
    if (err) console.error('Error creating index idx_group_user:', err);
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_person_groups_person ON person_groups(person_id)`, (err) => {
    if (err) console.error('Error creating index idx_person_groups_person:', err);
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_person_groups_group ON person_groups(group_id)`, (err) => {
    if (err) {
      console.error('Error creating index idx_person_groups_group:', err);
    }
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_calendar_user ON calendar_events(user_id)`, (err) => {
    if (err) {
      console.error('Error creating index idx_calendar_user:', err);
    }
  });

  db.run(`CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(event_date)`, (err) => {
    if (err) {
      console.error('Error creating index idx_calendar_date:', err);
    } else {
      console.log('Database tables initialized successfully');
    }
  });
});

// Database helper functions
const dbHelpers = {
  // User operations
  createUser: (username, passwordHash, name = null) => {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)',
        [username, passwordHash, name],
        function(err) {
          if (err) {
            reject(err);
          } else {
            db.get(
              'SELECT id, username, name, created_at FROM users WHERE id = ?',
              [this.lastID],
              (err, row) => {
                if (err) reject(err);
                else resolve(row);
              }
            );
          }
        }
      );
    });
  },
  
  updateUserName: (userId, name) => {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET name = ? WHERE id = ?',
        [name, userId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            db.get(
              'SELECT id, username, name, created_at FROM users WHERE id = ?',
              [userId],
              (err, row) => {
                if (err) reject(err);
                else resolve(row);
              }
            );
          }
        }
      );
    });
  },

  getUserByUsername: (username) => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE username = ?',
        [username],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  },

  getUserById: (userId) => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT id, username, name, created_at FROM users WHERE id = ?',
        [userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  },

  // Person operations
  createPerson: (userId, firstName, lastName, fullName) => {
    return new Promise((resolve, reject) => {
      // Normalize names: trim and clean whitespace
      const normalizedFirstName = firstName ? firstName.trim().replace(/\s+/g, ' ') : null;
      const normalizedLastName = lastName ? lastName.trim().replace(/\s+/g, ' ') : null;
      const normalizedFullName = fullName ? fullName.trim().replace(/\s+/g, ' ') : null;
      
      db.run(
        'INSERT INTO persons (user_id, first_name, last_name, full_name) VALUES (?, ?, ?, ?)',
        [userId, normalizedFirstName, normalizedLastName, normalizedFullName],
        function(err) {
          if (err) {
            reject(err);
          } else {
            // Fetch the created person to get all fields including timestamps
            db.get(
              'SELECT * FROM persons WHERE id = ?',
              [this.lastID],
              (err, row) => {
                if (err) reject(err);
                else {
                  console.log('[Database] Created person:', row);
                  resolve(row);
                }
              }
            );
          }
        }
      );
    });
  },

  findPersonByName: (userId, name) => {
    return new Promise((resolve, reject) => {
      if (!name || !name.trim()) {
        resolve(null);
        return;
      }
      
      const normalizedName = name.trim();
      
      // First try exact match (case-insensitive)
      db.get(
        'SELECT * FROM persons WHERE user_id = ? AND (LOWER(TRIM(full_name)) = LOWER(?) OR LOWER(TRIM(first_name)) = LOWER(?)) LIMIT 1',
        [userId, normalizedName, normalizedName],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          
          if (row) {
            resolve(row);
            return;
          }
          
          // If exact match not found, try LIKE match (case-insensitive)
          db.get(
            'SELECT * FROM persons WHERE user_id = ? AND (LOWER(full_name) LIKE LOWER(?) OR LOWER(first_name) LIKE LOWER(?)) LIMIT 1',
            [userId, `%${normalizedName}%`, `%${normalizedName}%`],
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        }
      );
    });
  },

  // Find similar names using fuzzy matching (Levenshtein + substring rules).
  // Only returns people whose names are genuinely similar to the extracted name.
  findSimilarNames: (userId, name, threshold = 0.72) => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM persons WHERE user_id = ?', [userId], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        
        const normalizedName = name.toLowerCase().trim().replace(/\s+/g, ' ');
        const queryTokens = normalizedName.split(/\s+/).filter(Boolean);
        const similar = [];
        
        for (const person of rows) {
          const personName = person.full_name.toLowerCase().trim();
          const firstName = person.first_name?.toLowerCase().trim() || '';
          const firstTokenOfFull = personName.split(/\s+/)[0] || '';
          
          const fullNameSimilarity = calculateSimilarity(normalizedName, personName);
          const firstNameSimilarity = firstName ? calculateSimilarity(normalizedName, firstName) : 0;
          const firstTokenSimilarity = firstTokenOfFull ? calculateSimilarity(normalizedName, firstTokenOfFull) : 0;
          const maxSimilarity = Math.max(fullNameSimilarity, firstNameSimilarity, firstTokenSimilarity);
          
          const substringMatch = isSubstringMatch(normalizedName, personName) || isSubstringMatch(personName, normalizedName);
          // Require either real similarity (typos/nicknames) or a clear substring (e.g. "Jo" in "Joel")
          if (maxSimilarity >= threshold || substringMatch) {
            similar.push({
              person,
              similarity: maxSimilarity,
              matchType: fullNameSimilarity >= firstNameSimilarity && fullNameSimilarity >= firstTokenSimilarity ? 'fullName' : (firstNameSimilarity >= firstTokenSimilarity ? 'firstName' : 'firstToken')
            });
          }
        }
        
        similar.sort((a, b) => b.similarity - a.similarity);
        resolve(similar);
      });
    });
  },

  getAllPersons: (userId) => {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM persons WHERE user_id = ? ORDER BY updated_at DESC', [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  getPersonById: (userId, id) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM persons WHERE id = ? AND user_id = ?', [id, userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  updatePersonTimestamp: (id) => {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE persons SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  },
  
  updatePerson: (id, firstName, lastName, fullName) => {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE persons SET first_name = ?, last_name = ?, full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [firstName, lastName, fullName, id],
        function(err) {
          if (err) {
            reject(err);
          } else {
            // Fetch the updated person
            db.get(
              'SELECT * FROM persons WHERE id = ?',
              [id],
              (err, row) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(row);
                }
              }
            );
          }
        }
      );
    });
  },

  deletePerson: (userId, personId) => {
    return new Promise((resolve, reject) => {
      // First verify the person belongs to the user
      db.get(
        'SELECT * FROM persons WHERE id = ? AND user_id = ?',
        [personId, userId],
        (err, person) => {
          if (err) {
            reject(err);
            return;
          }
          
          if (!person) {
            reject(new Error('Person not found or does not belong to user'));
            return;
          }
          
          // Delete the person (CASCADE will handle sessions, metadata, and group associations)
          db.run(
            'DELETE FROM persons WHERE id = ? AND user_id = ?',
            [personId, userId],
            function(err) {
              if (err) {
                reject(err);
              } else {
                resolve({ success: true, deletedId: personId });
              }
            }
          );
        }
      );
    });
  },

  // Session operations
  createSession: (userId, personId, transcript, notes) => {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO sessions (user_id, person_id, transcript, notes) VALUES (?, ?, ?, ?)',
        [userId, personId, transcript, notes],
        function(err) {
          if (err) {
            reject(err);
          } else {
            // Fetch the created session to get all fields including created_at
            db.get(
              'SELECT * FROM sessions WHERE id = ?',
              [this.lastID],
              (err, row) => {
                if (err) reject(err);
                else resolve(row);
              }
            );
          }
        }
      );
    });
  },

  getSessionsByPerson: (userId, personId) => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM sessions WHERE person_id = ? AND user_id = ? ORDER BY created_at DESC',
        [personId, userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  },

  getSessionById: (userId, sessionId) => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM sessions WHERE id = ? AND user_id = ?',
        [sessionId, userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  },

  updateSessionNotes: (sessionId, notes) => {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE sessions SET notes = ? WHERE id = ?',
        [notes, sessionId],
        function(err) {
          if (err) reject(err);
          else resolve({ id: sessionId, changes: this.changes });
        }
      );
    });
  },

  updateSession: (userId, sessionId, { notes, transcript }) => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM sessions WHERE id = ? AND user_id = ?',
        [sessionId, userId],
        (err, existing) => {
          if (err) return reject(err);
          if (!existing) return reject(new Error('Session not found or access denied'));

          const newNotes = notes !== undefined ? notes : existing.notes;
          const newTranscript = transcript !== undefined ? transcript : existing.transcript;

          db.run(
            'UPDATE sessions SET notes = ?, transcript = ? WHERE id = ? AND user_id = ?',
            [newNotes, newTranscript, sessionId, userId],
            function(runErr) {
              if (runErr) return reject(runErr);
              db.get(
                'SELECT * FROM sessions WHERE id = ?',
                [sessionId],
                (getErr, row) => {
                  if (getErr) reject(getErr);
                  else resolve(row);
                }
              );
            }
          );
        }
      );
    });
  },

  getAllSessions: (userId) => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC',
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  },

  /**
   * Transfer a session from one person to another for the same user.
   * Also updates any calendar_events tied to this session to point at the new person.
   */
  transferSessionPerson: (userId, sessionId, newPersonId) => {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Verify session belongs to user
        db.get(
          'SELECT * FROM sessions WHERE id = ? AND user_id = ?',
          [sessionId, userId],
          (err, sessionRow) => {
            if (err) {
              reject(err);
              return;
            }
            if (!sessionRow) {
              reject(new Error('Session not found or access denied'));
              return;
            }

            const oldPersonId = sessionRow.person_id;

            // Verify new person belongs to user
            db.get(
              'SELECT * FROM persons WHERE id = ? AND user_id = ?',
              [newPersonId, userId],
              (personErr, personRow) => {
                if (personErr) {
                  reject(personErr);
                  return;
                }
                if (!personRow) {
                  reject(new Error('Target person not found or access denied'));
                  return;
                }

                // Update session's person_id
                db.run(
                  'UPDATE sessions SET person_id = ? WHERE id = ? AND user_id = ?',
                  [newPersonId, sessionId, userId],
                  function (updateErr) {
                    if (updateErr) {
                      reject(updateErr);
                      return;
                    }

                    // Update any calendar events tied to this session
                    db.run(
                      'UPDATE calendar_events SET person_id = ? WHERE user_id = ? AND session_id = ?',
                      [newPersonId, userId, sessionId],
                      (calErr) => {
                        if (calErr) {
                          reject(calErr);
                          return;
                        }

                        // Return updated session row
                        db.get(
                          'SELECT * FROM sessions WHERE id = ? AND user_id = ?',
                          [sessionId, userId],
                          (getErr, updatedSession) => {
                            if (getErr) {
                              reject(getErr);
                            } else {
                              resolve({
                                session: updatedSession,
                                oldPersonId,
                                newPerson: personRow,
                              });
                            }
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });
  },

  updateMetadataValue: (metadataId, value) => {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE person_metadata SET value = ? WHERE id = ?',
        [value, metadataId],
        function(err) {
          if (err) reject(err);
          else resolve({ id: metadataId, changes: this.changes });
        }
      );
    });
  },

  getAllMetadata: () => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM person_metadata',
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  },

  // Metadata operations
  setPersonMetadata: (userId, personId, key, value) => {
    return new Promise((resolve, reject) => {
      // First verify the person belongs to the user
      db.get('SELECT id FROM persons WHERE id = ? AND user_id = ?', [personId, userId], (err, person) => {
        if (err) {
          reject(err);
          return;
        }
        if (!person) {
          reject(new Error('Person not found or access denied'));
          return;
        }
        db.run(
          'INSERT INTO person_metadata (person_id, key, value) VALUES (?, ?, ?)',
          [personId, key, value],
          function(insertErr) {
            if (insertErr) reject(insertErr);
            else resolve({ id: this.lastID });
          }
        );
      });
    });
  },

  getPersonMetadata: (userId, personId) => {
    return new Promise((resolve, reject) => {
      // Join with persons table to ensure user_id matches
      db.all(
        `SELECT pm.* FROM person_metadata pm 
         INNER JOIN persons p ON pm.person_id = p.id 
         WHERE pm.person_id = ? AND p.user_id = ?`,
        [personId, userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  },

  getAllPersonData: (userId, personId) => {
    return new Promise(async (resolve, reject) => {
      try {
        const person = await dbHelpers.getPersonById(userId, personId);
        if (!person) {
          reject(new Error('Person not found or access denied'));
          return;
        }
        const sessions = await dbHelpers.getSessionsByPerson(userId, personId);
        const metadata = await dbHelpers.getPersonMetadata(userId, personId);
        resolve({ person, sessions, metadata });
      } catch (err) {
        reject(err);
      }
    });
  },

  /**
   * Batch load person + sessions + metadata for multiple person IDs in 3 queries.
   * Returns array of { person, sessions, metadata } in the same order as personIds.
   */
  getAllPersonDataForPersonIds: (userId, personIds) => {
    return new Promise((resolve, reject) => {
      if (!personIds || personIds.length === 0) {
        resolve([]);
        return;
      }
      const placeholders = personIds.map(() => '?').join(',');
      const personsSql = `SELECT * FROM persons WHERE id IN (${placeholders}) AND user_id = ?`;
      const sessionsSql = `SELECT * FROM sessions WHERE person_id IN (${placeholders}) AND user_id = ? ORDER BY created_at DESC`;
      const metaSql = `SELECT pm.* FROM person_metadata pm
        INNER JOIN persons p ON pm.person_id = p.id
        WHERE pm.person_id IN (${placeholders}) AND p.user_id = ?`;

      db.serialize(() => {
        const runAll = (sql, params, label) =>
          new Promise((res, rej) => {
            db.all(sql, params, (err, rows) => {
              if (err) rej(err);
              else res(rows);
            });
          });

        Promise.all([
          runAll(personsSql, [...personIds, userId], 'persons'),
          runAll(sessionsSql, [...personIds, userId], 'sessions'),
          runAll(metaSql, [...personIds, userId], 'metadata')
        ])
          .then(([persons, sessions, metadata]) => {
            const personMap = new Map(persons.map((p) => [p.id, { person: p, sessions: [], metadata: [] }]));
            sessions.forEach((s) => {
              const entry = personMap.get(s.person_id);
              if (entry) entry.sessions.push(s);
            });
            metadata.forEach((m) => {
              const entry = personMap.get(m.person_id);
              if (entry) entry.metadata.push(m);
            });
            const ordered = personIds
              .map((id) => personMap.get(id))
              .filter(Boolean)
              .map(({ person, sessions: s, metadata: m }) => ({ person, sessions: s, metadata: m }));
            resolve(ordered);
          })
          .catch(reject);
      });
    });
  },

  // Group operations
  createGroup: (userId, name) => {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO groups (user_id, name) VALUES (?, ?)',
        [userId, name.trim()],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint')) {
              reject(new Error('Group with this name already exists'));
            } else {
              reject(err);
            }
          } else {
            db.get(
              'SELECT * FROM groups WHERE id = ?',
              [this.lastID],
              (err, row) => {
                if (err) reject(err);
                else resolve(row);
              }
            );
          }
        }
      );
    });
  },

  getAllGroups: (userId) => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM groups WHERE user_id = ? ORDER BY name ASC',
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  },

  getGroupById: (userId, groupId) => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM groups WHERE id = ? AND user_id = ?',
        [groupId, userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  },

  updateGroup: (userId, groupId, name) => {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE groups SET name = ? WHERE id = ? AND user_id = ?',
        [name.trim(), groupId, userId],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint')) {
              reject(new Error('Group with this name already exists'));
            } else {
              reject(err);
            }
          } else {
            db.get(
              'SELECT * FROM groups WHERE id = ? AND user_id = ?',
              [groupId, userId],
              (err, row) => {
                if (err) reject(err);
                else resolve(row);
              }
            );
          }
        }
      );
    });
  },

  deleteGroup: (userId, groupId) => {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM groups WHERE id = ? AND user_id = ?',
        [groupId, userId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  },

  addPersonToGroup: (userId, personId, groupId) => {
    return new Promise((resolve, reject) => {
      // Verify person and group belong to user
      db.get(
        'SELECT id FROM persons WHERE id = ? AND user_id = ?',
        [personId, userId],
        (err, person) => {
          if (err) {
            reject(err);
            return;
          }
          if (!person) {
            reject(new Error('Person not found'));
            return;
          }

          db.get(
            'SELECT id FROM groups WHERE id = ? AND user_id = ?',
            [groupId, userId],
            (err, group) => {
              if (err) {
                reject(err);
                return;
              }
              if (!group) {
                reject(new Error('Group not found'));
                return;
              }

              db.run(
                'INSERT OR IGNORE INTO person_groups (person_id, group_id) VALUES (?, ?)',
                [personId, groupId],
                function(err) {
                  if (err) reject(err);
                  else resolve();
                }
              );
            }
          );
        }
      );
    });
  },

  removePersonFromGroup: (userId, personId, groupId) => {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM person_groups 
         WHERE person_id = ? AND group_id = ? 
         AND EXISTS (SELECT 1 FROM persons WHERE id = ? AND user_id = ?)
         AND EXISTS (SELECT 1 FROM groups WHERE id = ? AND user_id = ?)`,
        [personId, groupId, personId, userId, groupId, userId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  },

  getPersonsInGroup: (userId, groupId) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT p.* FROM persons p
         INNER JOIN person_groups pg ON p.id = pg.person_id
         WHERE pg.group_id = ? AND p.user_id = ?
         ORDER BY p.full_name ASC`,
        [groupId, userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  },

  getGroupsForPerson: (userId, personId) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT g.* FROM groups g
         INNER JOIN person_groups pg ON g.id = pg.group_id
         WHERE pg.person_id = ? AND g.user_id = ?
         ORDER BY g.name ASC`,
        [personId, userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  },

  getAllPersonsWithGroups: (userId) => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM persons WHERE user_id = ? ORDER BY updated_at DESC',
        [userId],
        async (err, persons) => {
          if (err) {
            reject(err);
            return;
          }

          // Get groups for each person
          const personsWithGroups = await Promise.all(
            persons.map(async (person) => {
              try {
                const groups = await dbHelpers.getGroupsForPerson(userId, person.id);
                return { ...person, groups };
              } catch (error) {
                console.error(`Error getting groups for person ${person.id}:`, error);
                return { ...person, groups: [] };
              }
            })
          );

          resolve(personsWithGroups);
        }
      );
    });
  }
};

// Levenshtein (edit) distance: min edits (insert/delete/substitute) to turn s1 into s2
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[len1][len2];
}

// Similarity in [0,1]: 1 = identical, 0 = no relation. Uses Levenshtein so only
// real typos/nicknames (e.g. "Joel" vs "Joel", "jol" vs "Joel") score high.
function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0;
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLen;
}

// Check if one string is a meaningful substring/abbreviation of another (for name matching).
// Requires at least 2 chars for "contains" so "a" doesn't match "Anna".
function isSubstringMatch(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (!s1 || !s2) return false;

  // One contains the other: only count if the contained part has length >= 2
  // so "jo" in "joel" matches, but "a" in "anna" does not
  if (s1.length >= 2 && s2.length >= 2) {
    if (s1.includes(s2) || s2.includes(s1)) return true;
  }

  // Single initial: only match if the other name starts with that letter (e.g. "J" -> "John")
  if (s1.length === 1 && s2.startsWith(s1)) return true;
  if (s2.length === 1 && s1.startsWith(s2)) return true;

  // Abbreviation with period (e.g. "J." matches "Joel")
  if (s1.endsWith('.') && s1.length >= 2 && s2.startsWith(s1.slice(0, -1))) return true;
  if (s2.endsWith('.') && s2.length >= 2 && s1.startsWith(s2.slice(0, -1))) return true;

  return false;
}

// Calendar event operations
// Convert a Date to YYYY-MM-DD using LOCAL timezone (not UTC).
// toISOString() always returns UTC which shifts the date for any UTC-behind timezone.
function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

dbHelpers.createCalendarEvent = (userId, personId, sessionId, eventType, eventDate, summary = null) => {
  return new Promise((resolve, reject) => {
    // Format date as YYYY-MM-DD in local timezone
    const dateStr = eventDate instanceof Date
      ? toLocalDateStr(eventDate)
      : eventDate;
    
    db.run(
      'INSERT INTO calendar_events (user_id, person_id, session_id, event_type, event_date, summary) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, personId, sessionId, eventType, dateStr, summary],
      function(err) {
        if (err) {
          reject(err);
        } else {
          db.get(
            'SELECT * FROM calendar_events WHERE id = ?',
            [this.lastID],
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        }
      }
    );
  });
};

dbHelpers.getCalendarEvents = (userId, startDate = null, endDate = null) => {
  return new Promise((resolve, reject) => {
    let query = `
      SELECT ce.*, p.full_name as person_name,
             s.notes as session_notes, s.transcript as session_transcript, s.created_at as session_created_at
      FROM calendar_events ce
      LEFT JOIN persons p ON ce.person_id = p.id
      LEFT JOIN sessions s ON ce.session_id = s.id
      WHERE ce.user_id = ?
    `;
    const params = [userId];
    
    if (startDate && endDate) {
      query += ' AND ce.event_date >= ? AND ce.event_date <= ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      query += ' AND ce.event_date >= ?';
      params.push(startDate);
    } else if (endDate) {
      query += ' AND ce.event_date <= ?';
      params.push(endDate);
    }
    
    query += ' ORDER BY ce.event_date ASC, s.created_at ASC, ce.event_type ASC';
    
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

dbHelpers.getCalendarEventsByDate = (userId, date) => {
  return new Promise((resolve, reject) => {
    const dateStr = date instanceof Date
      ? toLocalDateStr(date)
      : date;
    
    db.all(
      `SELECT ce.*, p.full_name as person_name,
              s.notes as session_notes, s.transcript as session_transcript, s.created_at as session_created_at
       FROM calendar_events ce
       LEFT JOIN persons p ON ce.person_id = p.id
       LEFT JOIN sessions s ON ce.session_id = s.id
       WHERE ce.user_id = ? AND ce.event_date = ?
       ORDER BY s.created_at ASC, ce.event_type ASC`,
      [userId, dateStr],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
};

dbHelpers.deleteCalendarEvent = (userId, eventId) => {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM calendar_events WHERE id = ? AND user_id = ?',
      [eventId, userId],
      function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes > 0 });
      }
    );
  });
};

module.exports = { db, dbHelpers };

